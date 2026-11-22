//! Embedded MCP server exposing the global memory to agents (stdio, JSON-RPC 2.0, one message per line).
//!
//! Agents launch it as `neuron --mcp-memory --db <neuron.db> --memory-file <memory.md> [--agent <kind>]`:
//! the same executable as the app, so nothing else has to be installed. It opens the shared SQLite
//! database (WAL + busy timeout make it safe next to the running app) and keeps `memory.md` in sync.

use std::io::{BufRead, Write};
use std::path::PathBuf;

use serde_json::{Value, json};

use super::{MemoryCategory, MemoryPaths, export, import_if_changed, render_file};
use crate::db::{Db, memories};
use crate::error::{AppError, AppResult};
use crate::util::now_ms;

/// Name under which agents see the server (tools appear as `mcp__neuron__…` in Claude Code).
pub const SERVER_NAME: &str = "neuron";
pub const TOOL_NAMES: [&str; 3] = ["neuron_memory_read", "neuron_memory_search", "neuron_memory_save"];
const FLAG: &str = "--mcp-memory";
const DEFAULT_PROTOCOL: &str = "2025-06-18";

/// How an agent process launches the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpLaunch {
    pub command: PathBuf,
    pub args: Vec<String>,
}

impl McpLaunch {
    pub fn new(exe: PathBuf, paths: &MemoryPaths, agent: &str) -> Self {
        Self {
            command: exe,
            args: vec![
                FLAG.into(),
                "--db".into(),
                paths.db_path.display().to_string(),
                "--memory-file".into(),
                paths.file_path.display().to_string(),
                "--agent".into(),
                agent.into(),
            ],
        }
    }

    pub fn display(&self) -> String {
        let mut parts = vec![format!("\"{}\"", self.command.display())];
        parts.extend(self.args.iter().map(|a| if a.contains(' ') { format!("\"{a}\"") } else { a.clone() }));
        parts.join(" ")
    }
}

/// `main` hook: runs the MCP server when launched with `--mcp-memory`, returning the exit code.
pub fn entry_from_args() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    if !args.iter().any(|a| a == FLAG) {
        return None;
    }
    let value = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let (Some(db), Some(file)) = (value("--db"), value("--memory-file")) else {
        eprintln!("usage: neuron --mcp-memory --db <neuron.db> --memory-file <memory.md> [--agent <kind>]");
        return Some(2);
    };
    // Logs go to stderr: stdout is the protocol channel.
    let _ = tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .with_env_filter(tracing_subscriber::EnvFilter::new("warn,neuron_lib=info"))
        .try_init();
    let paths = MemoryPaths { db_path: PathBuf::from(db), file_path: PathBuf::from(file) };
    let agent = value("--agent").unwrap_or_else(|| "agent".into());
    match serve(&paths, &agent, std::io::stdin().lock(), std::io::stdout().lock()) {
        Ok(()) => Some(0),
        Err(err) => {
            tracing::error!(%err, "mcp memory server failed");
            Some(1)
        }
    }
}

/// Serve requests until stdin closes.
pub fn serve(paths: &MemoryPaths, agent: &str, input: impl BufRead, mut output: impl Write) -> AppResult<()> {
    let db = Db::open(&paths.db_path)?;
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(message) => handle(&db, paths, agent, &message),
            Err(err) => Some(error_response(Value::Null, -32700, &format!("parse error: {err}"))),
        };
        if let Some(response) = response {
            writeln!(output, "{response}")?;
            output.flush()?;
        }
    }
    Ok(())
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// One JSON-RPC message → optional response (notifications get none).
pub fn handle(db: &Db, paths: &MemoryPaths, agent: &str, message: &Value) -> Option<Value> {
    let id = message.get("id").cloned();
    let method = message.get("method").and_then(Value::as_str).unwrap_or_default();
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let id = id?; // notifications (initialized, cancelled…) need no answer
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(DEFAULT_PROTOCOL),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": SERVER_NAME, "title": "Neuron — mémoire globale", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Mémoire globale de l'utilisateur, partagée par tous ses agents via Neuron. \
                Consulte-la (neuron_memory_read / neuron_memory_search) pour respecter ses préférences. \
                N'enregistre (neuron_memory_save) que des informations durables : quand l'utilisateur le demande \
                ou exprime clairement une préférence ou une règle permanente.",
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => Ok(call_tool(db, paths, agent, &params)),
        _ => Err((-32601, format!("méthode inconnue : {method}"))),
    };
    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, msg)) => error_response(id, code, &msg),
    })
}

fn category_schema() -> Value {
    json!({
        "type": "string",
        "enum": MemoryCategory::ALL.iter().map(|c| c.as_db()).collect::<Vec<_>>(),
        "description": "profile = qui est l'utilisateur ; tech_preferences = outils/stack préférés ; \
            code_style = conventions de code ; strict_rules = règles à respecter impérativement ; other = divers",
    })
}

pub fn tool_definitions() -> Value {
    json!([
        {
            "name": "neuron_memory_read",
            "title": "Lire la mémoire",
            "description": "Lit la mémoire globale de l'utilisateur (profil, préférences techniques, style de code, \
                règles strictes), éventuellement limitée à une catégorie. Renvoie du Markdown.",
            "inputSchema": { "type": "object", "properties": { "category": category_schema() } },
            "annotations": { "readOnlyHint": true },
        },
        {
            "name": "neuron_memory_search",
            "title": "Chercher dans la mémoire",
            "description": "Recherche plein texte (préfixes, insensible aux accents) dans la mémoire globale.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Mots à chercher" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 },
                },
                "required": ["query"],
            },
            "annotations": { "readOnlyHint": true },
        },
        {
            "name": "neuron_memory_save",
            "title": "Enregistrer un souvenir",
            "description": "Ajoute un souvenir durable à la mémoire globale (visible par tous les agents et dans \
                ~/.neuron/memory.md). Une information courte et autonome par appel. N'enregistre que ce que \
                l'utilisateur demande de retenir ou exprime clairement comme préférence/règle permanente.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "category": category_schema(),
                    "content": { "type": "string", "description": "Le souvenir, formulé de façon autonome" },
                },
                "required": ["category", "content"],
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false },
        },
    ])
}

fn text_result(text: String, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
}

fn call_tool(db: &Db, paths: &MemoryPaths, agent: &str, params: &Value) -> Value {
    let name = params.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let file = paths.file_path.clone();
    let source = format!("agent:{agent}");
    let outcome: AppResult<String> = db.blocking(move |c| {
        // Edits made in memory.md since the last sync are seen by the agent.
        import_if_changed(c, &file, now_ms())?;
        match name.as_str() {
            "neuron_memory_read" => {
                let all = memories::list(c)?;
                let filtered: Vec<_> = match args.get("category").and_then(Value::as_str) {
                    Some(cat) => all.into_iter().filter(|m| m.category.as_db() == cat).collect(),
                    None => all,
                };
                if filtered.is_empty() {
                    return Ok("La mémoire est vide pour l'instant.".into());
                }
                Ok(render_file(&filtered))
            }
            "neuron_memory_search" => {
                let query = args.get("query").and_then(Value::as_str).unwrap_or_default();
                let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(10);
                let hits = memories::search(c, query, usize::try_from(limit).unwrap_or(10))?;
                if hits.is_empty() {
                    return Ok(format!("Aucun souvenir ne correspond à « {query} »."));
                }
                Ok(hits
                    .iter()
                    .map(|h| format!("- [{}] {}", h.memory.category.label(), h.memory.content.replace('\n', " ")))
                    .collect::<Vec<_>>()
                    .join("\n"))
            }
            "neuron_memory_save" => {
                let category = args
                    .get("category")
                    .and_then(Value::as_str)
                    .map(MemoryCategory::from_db)
                    .unwrap_or(MemoryCategory::Other);
                let content = args.get("content").and_then(Value::as_str).unwrap_or_default();
                let duplicate = memories::list(c)?
                    .into_iter()
                    .any(|m| m.content.trim().eq_ignore_ascii_case(content.trim()));
                if duplicate {
                    return Ok("Déjà en mémoire, rien à ajouter.".into());
                }
                let saved = memories::insert(c, category, content, &source, now_ms())?;
                export(c, &file)?;
                Ok(format!("Enregistré dans « {} » : {}", saved.category.label(), saved.content))
            }
            other => Err(AppError::Invalid(format!("outil inconnu : {other}"))),
        }
    });
    match outcome {
        Ok(text) => text_result(text, false),
        Err(err) => text_result(format!("Erreur : {err}"), true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_roundtrip_over_stdio() {
        let dir = std::env::temp_dir().join(format!("neuron-mcp-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let paths = MemoryPaths { db_path: dir.join("neuron.db"), file_path: dir.join("memory.md") };
        let input = [
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}),
            json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
            json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"neuron_memory_save","arguments":{"category":"strict_rules","content":"Ne jamais pousser sans demande"}}}),
            json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"neuron_memory_search","arguments":{"query":"pousser"}}}),
            json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"neuron_memory_read","arguments":{}}}),
            json!({"jsonrpc":"2.0","id":6,"method":"nope"}),
        ]
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n");
        let mut out = Vec::new();
        serve(&paths, "claude_code", input.as_bytes(), &mut out).unwrap();
        let replies: Vec<Value> =
            String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(replies.len(), 6, "no reply to the notification");
        assert_eq!(replies[0]["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(replies[1]["result"]["tools"].as_array().unwrap().len(), 3);
        assert_eq!(replies[2]["result"]["isError"], false);
        assert!(replies[3]["result"]["content"][0]["text"].as_str().unwrap().contains("Ne jamais pousser"));
        assert!(replies[4]["result"]["content"][0]["text"].as_str().unwrap().contains("## Règles strictes"));
        assert_eq!(replies[5]["error"]["code"], -32601);
        let file = std::fs::read_to_string(&paths.file_path).unwrap();
        assert!(file.contains("- Ne jamais pousser sans demande"), "memory.md exported");
        let _ = std::fs::remove_dir_all(dir);
    }
}

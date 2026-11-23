//! Embedded MCP server exposing Neuron to agents (stdio, JSON-RPC 2.0, one message per line): the global memory
//! (read, search, save, update, delete) and, in a project, its `.neuron/context.md` (read, rewrite).
//!
//! Agents launch it as `neuron --mcp-memory --db <neuron.db> --memory-file <memory.md> [--agent <kind>]
//! [--project <dir>]`: the same executable as the app, so nothing else has to be installed. It opens the shared
//! SQLite database (WAL + busy timeout make it safe next to the running app) and keeps `memory.md` in sync.
//! Without `--project` (Antigravity registers it once, globally), the project is the server's working directory
//! when it holds a `.neuron/context.md`.

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::{Value, json};

use super::{Memory, MemoryCategory, MemoryPaths, export, import_if_changed};
use crate::db::{Db, memories};
use crate::error::{AppError, AppResult};
use crate::util::now_ms;

/// Name under which agents see the server (tools appear as `mcp__neuron__…` in Claude Code).
pub const SERVER_NAME: &str = "neuron";
/// Every tool (pre-approved for the agents Neuron launches).
pub const TOOL_NAMES: [&str; 7] = [
    "neuron_memory_read",
    "neuron_memory_search",
    "neuron_memory_save",
    "neuron_memory_update",
    "neuron_memory_delete",
    "neuron_project_context_read",
    "neuron_project_context_update",
];
const FLAG: &str = "--mcp-memory";
const DEFAULT_PROTOCOL: &str = "2025-06-18";
/// Short memory ids shown to agents (UUID prefix, resolved back when unique).
const SHORT_ID: usize = 8;
const MAX_CONTEXT_BYTES: usize = 100 * 1024;

/// How an agent process launches the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpLaunch {
    pub command: PathBuf,
    pub args: Vec<String>,
}

impl McpLaunch {
    /// `project`: root of the chat's project (its `.neuron/context.md` becomes editable through the server).
    pub fn new(exe: PathBuf, paths: &MemoryPaths, agent: &str, project: Option<&Path>) -> Self {
        let mut args = vec![
            FLAG.into(),
            "--db".into(),
            paths.db_path.display().to_string(),
            "--memory-file".into(),
            paths.file_path.display().to_string(),
            "--agent".into(),
            agent.into(),
        ];
        if let Some(dir) = project {
            args.extend(["--project".into(), dir.display().to_string()]);
        }
        Self { command: exe, args }
    }

    pub fn display(&self) -> String {
        let mut parts = vec![format!("\"{}\"", self.command.display())];
        parts.extend(self.args.iter().map(|a| if a.contains(' ') { format!("\"{a}\"") } else { a.clone() }));
        parts.join(" ")
    }
}

/// What a server instance serves.
pub struct Server {
    pub paths: MemoryPaths,
    pub agent: String,
    /// Project root whose `.neuron/context.md` the tools read and write.
    pub project: Option<PathBuf>,
}

/// `main` hook: runs the MCP server when launched with `--mcp-memory`, returning the exit code.
pub fn entry_from_args() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    if !args.iter().any(|a| a == FLAG) {
        return None;
    }
    let value = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let (Some(db), Some(file)) = (value("--db"), value("--memory-file")) else {
        eprintln!(
            "usage: neuron --mcp-memory --db <neuron.db> --memory-file <memory.md> [--agent <kind>] [--project <dir>]"
        );
        return Some(2);
    };
    // Logs go to stderr: stdout is the protocol channel.
    let _ = tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .with_env_filter(tracing_subscriber::EnvFilter::new("warn,neuron_lib=info"))
        .try_init();
    let project = value("--project")
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok().filter(|d| d.join(crate::context::CONTEXT_REL).is_file()));
    let server = Server {
        paths: MemoryPaths { db_path: PathBuf::from(db), file_path: PathBuf::from(file) },
        agent: value("--agent").unwrap_or_else(|| "agent".into()),
        project,
    };
    match serve(&server, std::io::stdin().lock(), std::io::stdout().lock()) {
        Ok(()) => Some(0),
        Err(err) => {
            tracing::error!(%err, "mcp memory server failed");
            Some(1)
        }
    }
}

/// Serve requests until stdin closes.
pub fn serve(server: &Server, input: impl BufRead, mut output: impl Write) -> AppResult<()> {
    let db = Db::open(&server.paths.db_path)?;
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(message) => handle(&db, server, &message),
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
pub fn handle(db: &Db, server: &Server, message: &Value) -> Option<Value> {
    let id = message.get("id").cloned();
    let method = message.get("method").and_then(Value::as_str).unwrap_or_default();
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let id = id?; // notifications (initialized, cancelled…) need no answer
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(DEFAULT_PROTOCOL),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": SERVER_NAME, "title": "Neuron — mémoire et contexte de projet", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Tu es lancé par Neuron, l'application qui pilote les agents IA de l'utilisateur. \
                Mémoire globale partagée par tous ses agents : consulte-la (neuron_memory_read / neuron_memory_search) \
                pour respecter ses préférences ; ajoute (neuron_memory_save), corrige (neuron_memory_update) ou retire \
                (neuron_memory_delete) des souvenirs quand il le demande ou exprime clairement une préférence ou une \
                règle durable. Dans un projet, neuron_project_context_read / neuron_project_context_update donnent \
                accès à son fichier .neuron/context.md (architecture, décisions, conventions).",
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_definitions(server.project.is_some()) })),
        "tools/call" => Ok(call_tool(db, server, &params)),
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

/// Tool list; the project tools only when the server knows the project.
pub fn tool_definitions(with_project: bool) -> Value {
    let mut tools = vec![
        json!({
            "name": "neuron_memory_read",
            "title": "Lire la mémoire",
            "description": "Lit la mémoire globale de l'utilisateur (profil, préférences techniques, style de code, \
                règles strictes), éventuellement limitée à une catégorie. Chaque souvenir est précédé de son \
                identifiant [id] (pour neuron_memory_update / neuron_memory_delete).",
            "inputSchema": { "type": "object", "properties": { "category": category_schema() } },
            "annotations": { "readOnlyHint": true },
        }),
        json!({
            "name": "neuron_memory_search",
            "title": "Chercher dans la mémoire",
            "description": "Recherche plein texte (préfixes, insensible aux accents) dans la mémoire globale. \
                Renvoie les souvenirs avec leur identifiant [id].",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Mots à chercher" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 },
                },
                "required": ["query"],
            },
            "annotations": { "readOnlyHint": true },
        }),
        json!({
            "name": "neuron_memory_save",
            "title": "Enregistrer un souvenir",
            "description": "Ajoute un souvenir durable à la mémoire globale (visible par tous les agents et dans \
                ~/.neuron/memory.md). Une information courte et autonome par appel. N'enregistre que ce que \
                l'utilisateur demande de retenir ou exprime clairement comme préférence/règle permanente ; jamais \
                de secret.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "category": category_schema(),
                    "content": { "type": "string", "description": "Le souvenir, formulé de façon autonome" },
                },
                "required": ["category", "content"],
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false },
        }),
        json!({
            "name": "neuron_memory_update",
            "title": "Modifier un souvenir",
            "description": "Corrige un souvenir existant (texte et/ou catégorie), par exemple quand une préférence \
                a changé. `id` = l'identifiant affiché par neuron_memory_read / neuron_memory_search.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Identifiant du souvenir (ses premiers caractères suffisent)" },
                    "content": { "type": "string", "description": "Nouveau texte (inchangé si absent)" },
                    "category": category_schema(),
                },
                "required": ["id"],
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true },
        }),
        json!({
            "name": "neuron_memory_delete",
            "title": "Supprimer un souvenir",
            "description": "Retire un souvenir devenu faux ou que l'utilisateur veut oublier.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string", "description": "Identifiant du souvenir" } },
                "required": ["id"],
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": true, "idempotentHint": true },
        }),
    ];
    if with_project {
        tools.push(json!({
            "name": "neuron_project_context_read",
            "title": "Lire le contexte du projet",
            "description": "Lit .neuron/context.md, le contexte du projet que Neuron injecte dans chaque nouveau chat \
                du projet (objectif, architecture, décisions, conventions, commandes).",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "readOnlyHint": true },
        }));
        tools.push(json!({
            "name": "neuron_project_context_update",
            "title": "Mettre à jour le contexte du projet",
            "description": "Réécrit .neuron/context.md avec le contenu Markdown COMPLET fourni (lis-le d'abord et \
                garde ce qui reste vrai). À utiliser pour consigner ce qui est durable sur le projet : architecture, \
                décisions, conventions, commandes utiles. Reste concis.",
            "inputSchema": {
                "type": "object",
                "properties": { "content": { "type": "string", "description": "Nouveau contenu complet du fichier" } },
                "required": ["content"],
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": true },
        }));
    }
    Value::Array(tools)
}

fn text_result(text: String, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
}

fn short(id: &str) -> &str {
    id.get(..SHORT_ID).unwrap_or(id)
}

/// Full id of a memory from its (short) id.
fn resolve_id(conn: &Connection, id: &str) -> AppResult<String> {
    let id = id.trim().trim_matches(['[', ']']);
    if id.is_empty() {
        return Err(AppError::Invalid("identifiant manquant".into()));
    }
    let matches: Vec<String> = memories::list(conn)?.into_iter().map(|m| m.id).filter(|m| m.starts_with(id)).collect();
    match matches.as_slice() {
        [one] => Ok(one.clone()),
        [] => Err(AppError::NotFound(format!("aucun souvenir avec l'identifiant {id}"))),
        _ => Err(AppError::Invalid(format!("identifiant ambigu : {id}"))),
    }
}

/// Memories by category, each with its short id.
fn render_with_ids(items: &[Memory]) -> String {
    let mut out = String::new();
    for category in MemoryCategory::ALL {
        let in_cat: Vec<&Memory> = items.iter().filter(|m| m.category == category).collect();
        if in_cat.is_empty() {
            continue;
        }
        out.push_str(&format!("## {}\n\n", category.label()));
        for m in in_cat {
            out.push_str(&format!("- [{}] {}\n", short(&m.id), m.content.replace('\n', "\n  ")));
        }
        out.push('\n');
    }
    out.trim_end().to_string()
}

fn call_tool(db: &Db, server: &Server, params: &Value) -> Value {
    let name = params.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    if name.starts_with("neuron_project_context") {
        return match project_tool(server.project.as_deref(), &name, &args) {
            Ok(text) => text_result(text, false),
            Err(err) => text_result(format!("Erreur : {err}"), true),
        };
    }
    let file = server.paths.file_path.clone();
    let source = format!("agent:{}", server.agent);
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
                Ok(render_with_ids(&filtered))
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
                    .map(|h| {
                        format!(
                            "- [{}] ({}) {}",
                            short(&h.memory.id),
                            h.memory.category.label(),
                            h.memory.content.replace('\n', " ")
                        )
                    })
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
                let duplicate =
                    memories::list(c)?.into_iter().any(|m| m.content.trim().eq_ignore_ascii_case(content.trim()));
                if duplicate {
                    return Ok("Déjà en mémoire, rien à ajouter.".into());
                }
                let saved = memories::insert(c, category, content, &source, now_ms())?;
                export(c, &file)?;
                Ok(format!("Enregistré [{}] dans « {} » : {}", short(&saved.id), saved.category.label(), saved.content))
            }
            "neuron_memory_update" => {
                let id = resolve_id(c, args.get("id").and_then(Value::as_str).unwrap_or_default())?;
                let current = memories::get(c, &id)?.ok_or_else(|| AppError::NotFound(id.clone()))?;
                let category = args
                    .get("category")
                    .and_then(Value::as_str)
                    .map(MemoryCategory::from_db)
                    .unwrap_or(current.category);
                let content = args.get("content").and_then(Value::as_str).unwrap_or(&current.content).to_string();
                let saved = memories::update(c, &id, category, &content, now_ms())?;
                export(c, &file)?;
                Ok(format!("Modifié [{}] dans « {} » : {}", short(&saved.id), saved.category.label(), saved.content))
            }
            "neuron_memory_delete" => {
                let id = resolve_id(c, args.get("id").and_then(Value::as_str).unwrap_or_default())?;
                let current = memories::get(c, &id)?.ok_or_else(|| AppError::NotFound(id.clone()))?;
                memories::delete(c, &id)?;
                export(c, &file)?;
                Ok(format!("Supprimé : {}", current.content))
            }
            other => Err(AppError::Invalid(format!("outil inconnu : {other}"))),
        }
    });
    match outcome {
        Ok(text) => text_result(text, false),
        Err(err) => text_result(format!("Erreur : {err}"), true),
    }
}

fn project_tool(project: Option<&Path>, name: &str, args: &Value) -> AppResult<String> {
    let root = project.ok_or_else(|| AppError::Invalid("ce chat n'est pas rattaché à un projet Neuron".into()))?;
    match name {
        "neuron_project_context_read" => Ok(crate::context::read_context(root)?
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Le fichier .neuron/context.md est vide ou absent.".into())),
        "neuron_project_context_update" => {
            let content = args.get("content").and_then(Value::as_str).unwrap_or_default();
            if content.trim().is_empty() {
                return Err(AppError::Invalid("contenu vide : le fichier n'a pas été modifié".into()));
            }
            if content.len() > MAX_CONTEXT_BYTES {
                return Err(AppError::Invalid("contenu trop long (100 Ko max)".into()));
            }
            crate::context::write_context(root, content)?;
            Ok(format!("{} mis à jour ({} lignes).", crate::context::CONTEXT_REL, content.lines().count()))
        }
        other => Err(AppError::Invalid(format!("outil inconnu : {other}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(id: i64, name: &str, arguments: Value) -> Value {
        json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":arguments}})
    }

    fn run(server: &Server, messages: &[Value]) -> Vec<Value> {
        let input = messages.iter().map(Value::to_string).collect::<Vec<_>>().join("\n");
        let mut out = Vec::new();
        serve(server, input.as_bytes(), &mut out).unwrap();
        String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect()
    }

    fn text(reply: &Value) -> &str {
        reply["result"]["content"][0]["text"].as_str().unwrap()
    }

    fn server(dir: &Path, project: Option<PathBuf>) -> Server {
        Server {
            paths: MemoryPaths { db_path: dir.join("neuron.db"), file_path: dir.join("memory.md") },
            agent: "claude_code".into(),
            project,
        }
    }

    #[test]
    fn protocol_roundtrip_over_stdio() {
        let dir = std::env::temp_dir().join(format!("neuron-mcp-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = server(&dir, None);
        let replies = run(
            &s,
            &[
                json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}),
                json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
                json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
                call(
                    3,
                    "neuron_memory_save",
                    json!({"category":"strict_rules","content":"Ne jamais pousser sans demande"}),
                ),
                call(4, "neuron_memory_search", json!({"query":"pousser"})),
                call(5, "neuron_memory_read", json!({})),
                json!({"jsonrpc":"2.0","id":6,"method":"nope"}),
            ],
        );
        assert_eq!(replies.len(), 6, "no reply to the notification");
        assert_eq!(replies[0]["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(replies[1]["result"]["tools"].as_array().unwrap().len(), 5, "no project tools outside a project");
        assert_eq!(replies[2]["result"]["isError"], false);
        assert!(text(&replies[3]).contains("Ne jamais pousser"));
        assert!(text(&replies[4]).contains("## Règles strictes"));
        assert_eq!(replies[5]["error"]["code"], -32601);
        let file = std::fs::read_to_string(&s.paths.file_path).unwrap();
        assert!(file.contains("- Ne jamais pousser sans demande"), "memory.md exported");

        // Update and delete by the short id shown in the listing.
        let id = text(&replies[4]).split(['[', ']']).nth(1).unwrap().to_string();
        let replies = run(
            &s,
            &[
                call(
                    7,
                    "neuron_memory_update",
                    json!({"id": id, "content": "Ne jamais pousser sans accord explicite"}),
                ),
                call(8, "neuron_memory_read", json!({})),
                call(9, "neuron_memory_delete", json!({"id": id})),
                call(10, "neuron_memory_read", json!({})),
                call(11, "neuron_memory_delete", json!({"id": "zzzz"})),
            ],
        );
        assert!(text(&replies[0]).starts_with("Modifié"), "{}", text(&replies[0]));
        assert!(text(&replies[1]).contains("accord explicite"));
        assert!(text(&replies[2]).starts_with("Supprimé"));
        assert_eq!(text(&replies[3]), "La mémoire est vide pour l'instant.");
        assert_eq!(replies[4]["result"]["isError"], true);
        assert!(!std::fs::read_to_string(&s.paths.file_path).unwrap().contains("pousser"), "memory.md follows");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn project_context_tools() {
        let dir = std::env::temp_dir().join(format!("neuron-mcp-{}", uuid::Uuid::new_v4().simple()));
        let project = dir.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        crate::context::ensure_context_file(&project, "proj").unwrap();
        let s = server(&dir, Some(project.clone()));
        let replies = run(
            &s,
            &[
                json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}),
                call(2, "neuron_project_context_read", json!({})),
                call(3, "neuron_project_context_update", json!({"content": "# proj\n\nArchitecture : Tauri.\n"})),
                call(4, "neuron_project_context_update", json!({"content": "  "})),
            ],
        );
        assert_eq!(replies[0]["result"]["tools"].as_array().unwrap().len(), 7);
        assert!(text(&replies[1]).contains("proj"));
        assert_eq!(replies[2]["result"]["isError"], false);
        assert_eq!(replies[3]["result"]["isError"], true, "empty content refused");
        let written = std::fs::read_to_string(project.join(crate::context::CONTEXT_REL)).unwrap();
        assert_eq!(written, "# proj\n\nArchitecture : Tauri.\n");
        let _ = std::fs::remove_dir_all(dir);
    }
}

//! Embedded MCP server exposing remote workspace tools (`neuron --mcp-remote`) to CLI agents.
//!
//! Spawned by Claude Code / Codex as `neuron --mcp-remote --data-dir <dir> --thread <thread_id>`.
//! Instead of opening a second iroh endpoint, every `tools/call` forwards over the local control channel
//! (`control.rs`) to the running Neuron instance, which validates the active session and relays the operation
//! to the target device over its existing iroh connection.

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{Value, json};

use crate::error::{AppError, AppResult};
use crate::remote::workspace::{SearchMode, WorkspaceOp};

/// MCP server name seen by agents (tools appear as `mcp__neuron_remote__…` in Claude Code).
pub const SERVER_NAME: &str = "neuron_remote";
pub const TOOL_READ: &str = "remote_read";
pub const TOOL_WRITE: &str = "remote_write";
pub const TOOL_EDIT: &str = "remote_edit";
pub const TOOL_SEARCH: &str = "remote_search";
pub const TOOL_RUN: &str = "remote_run";

pub const READ_ONLY_TOOLS: [&str; 2] = [TOOL_READ, TOOL_SEARCH];
pub const EDIT_TOOLS: [&str; 2] = [TOOL_WRITE, TOOL_EDIT];
pub const ALL_TOOLS: [&str; 5] = [TOOL_READ, TOOL_WRITE, TOOL_EDIT, TOOL_SEARCH, TOOL_RUN];

const FLAG: &str = "--mcp-remote";
const DEFAULT_PROTOCOL: &str = "2025-06-18";

/// How an agent process launches the remote workspace MCP server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteMcpLaunch {
    pub command: PathBuf,
    pub args: Vec<String>,
}

impl RemoteMcpLaunch {
    pub fn new(exe: PathBuf, data_dir: &Path, thread_id: &str) -> Self {
        Self {
            command: exe,
            args: vec![
                FLAG.into(),
                "--data-dir".into(),
                data_dir.display().to_string(),
                "--thread".into(),
                thread_id.into(),
            ],
        }
    }
}

/// `main` hook: runs the remote workspace MCP server when launched with `--mcp-remote`.
pub fn entry_from_args() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    if !args.iter().any(|a| a == FLAG) {
        return None;
    }
    let value = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let (Some(data_dir), Some(thread_id)) = (value("--data-dir"), value("--thread")) else {
        eprintln!("usage: neuron --mcp-remote --data-dir <dir> --thread <thread_id>");
        return Some(2);
    };
    let _ = tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .with_env_filter(tracing_subscriber::EnvFilter::new("warn,neuron_lib=info"))
        .try_init();

    let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() else {
        eprintln!("failed to start async runtime");
        return Some(1);
    };
    let data_dir = PathBuf::from(data_dir);
    match serve(&rt, &data_dir, &thread_id, std::io::stdin().lock(), std::io::stdout().lock()) {
        Ok(()) => Some(0),
        Err(err) => {
            tracing::error!(%err, "mcp remote server failed");
            Some(1)
        }
    }
}

/// Serve JSON-RPC 2.0 requests line-by-line until stdin closes.
pub fn serve(
    rt: &tokio::runtime::Runtime,
    data_dir: &Path,
    thread_id: &str,
    input: impl BufRead,
    mut output: impl Write,
) -> AppResult<()> {
    for line in input.lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(message) => handle(rt, data_dir, thread_id, &message),
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

fn text_result(text: String, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
}

pub fn handle(rt: &tokio::runtime::Runtime, data_dir: &Path, thread_id: &str, message: &Value) -> Option<Value> {
    let id = message.get("id").cloned()?;
    let method = message.get("method").and_then(Value::as_str).unwrap_or_default();
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(DEFAULT_PROTOCOL),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": {
                "name": SERVER_NAME,
                "title": crate::i18n::pick("Neuron — espace de travail distant", "Neuron — remote workspace"),
                "version": env!("CARGO_PKG_VERSION"),
            },
            "instructions": crate::i18n::pick(
                "Outils de fichiers, recherche et terminal exécutés sur l'appareil cible de ce chat.",
                "File, search and shell tools executed on this chat's target device.",
            ),
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => Ok(call_tool(rt, data_dir, thread_id, &params)),
        _ => Err((-32601, format!("unknown method: {method}"))),
    };
    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, msg)) => error_response(id, code, &msg),
    })
}

pub fn tool_definitions() -> Value {
    json!([
        {
            "name": TOOL_READ,
            "description": "Read a UTF-8 file (with line numbers) or list a directory on the target device. Paths are relative to the workspace root unless absolute.",
            "annotations": { "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File or directory path (default '.')." },
                    "offset": { "type": "integer", "description": "1-based starting line number (files only)." },
                    "limit": { "type": "integer", "description": "Max lines to read (default 400, max 2000)." }
                },
                "required": ["path"]
            }
        },
        {
            "name": TOOL_WRITE,
            "description": "Create or overwrite a text file on the target device (creates parent directories if needed).",
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Target file path." },
                    "content": { "type": "string", "description": "Complete file contents." }
                },
                "required": ["path", "content"]
            }
        },
        {
            "name": TOOL_EDIT,
            "description": "Edit a text file on the target device by replacing an exact snippet `old_text` with `new_text`.",
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Target file path." },
                    "old_text": { "type": "string", "description": "Exact existing text to replace." },
                    "new_text": { "type": "string", "description": "Replacement text." },
                    "replace_all": { "type": "boolean", "description": "Replace every occurrence (default false)." }
                },
                "required": ["path", "old_text", "new_text"]
            }
        },
        {
            "name": TOOL_SEARCH,
            "description": "Search files on the target device (respects .gitignore). mode='glob' matches paths (*, **, ?); mode='grep' searches text inside files.",
            "annotations": { "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "mode": { "type": "string", "enum": ["glob", "grep"] },
                    "pattern": { "type": "string", "description": "Glob pattern or text substring." },
                    "path": { "type": "string", "description": "Optional subfolder (default '.')." },
                    "case_insensitive": { "type": "boolean" },
                    "max_results": { "type": "integer", "description": "Max results (default 100, max 200)." }
                },
                "required": ["mode", "pattern"]
            }
        },
        {
            "name": TOOL_RUN,
            "description": "Run a shell command on the target device (PowerShell on Windows, sh on Unix) inside the workspace.",
            "annotations": { "readOnlyHint": false, "destructiveHint": true, "openWorldHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Shell command to execute." },
                    "cwd": { "type": "string", "description": "Optional working subfolder (default '.')." },
                    "timeout_secs": { "type": "integer", "description": "Timeout in seconds (default 60, max 300)." }
                },
                "required": ["command"]
            }
        }
    ])
}

/// Converts an MCP `tools/call` name + arguments into a typed [`WorkspaceOp`] and call timeout.
pub fn parse_tool_op(name: &str, args: &Value) -> AppResult<(WorkspaceOp, Duration)> {
    let req_str = |key: &str| -> AppResult<String> {
        args.get(key)
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| AppError::Invalid(format!("missing string argument: {key}")))
    };
    let opt_str = |key: &str| args.get(key).and_then(Value::as_str).map(str::to_string);
    let opt_usize = |key: &str| args.get(key).and_then(Value::as_u64).and_then(|v| usize::try_from(v).ok());
    let opt_u64 = |key: &str| args.get(key).and_then(Value::as_u64);
    let opt_bool = |key: &str| args.get(key).and_then(Value::as_bool);

    match name {
        TOOL_READ => Ok((
            WorkspaceOp::Read {
                path: opt_str("path").unwrap_or_else(|| ".".into()),
                offset: opt_usize("offset"),
                limit: opt_usize("limit"),
            },
            Duration::from_secs(90),
        )),
        TOOL_WRITE => {
            Ok((WorkspaceOp::Write { path: req_str("path")?, content: req_str("content")? }, Duration::from_secs(90)))
        }
        TOOL_EDIT => Ok((
            WorkspaceOp::Edit {
                path: req_str("path")?,
                old_text: req_str("old_text")?,
                new_text: req_str("new_text")?,
                replace_all: opt_bool("replace_all"),
            },
            Duration::from_secs(90),
        )),
        TOOL_SEARCH => {
            let mode = match req_str("mode")?.as_str() {
                "glob" => SearchMode::Glob,
                "grep" => SearchMode::Grep,
                other => return Err(AppError::Invalid(format!("invalid search mode: {other}"))),
            };
            Ok((
                WorkspaceOp::Search {
                    mode,
                    pattern: req_str("pattern")?,
                    path: opt_str("path"),
                    case_insensitive: opt_bool("case_insensitive"),
                    max_results: opt_usize("max_results"),
                },
                Duration::from_secs(90),
            ))
        }
        TOOL_RUN => {
            let timeout_secs = opt_u64("timeout_secs");
            let wait = Duration::from_secs(timeout_secs.unwrap_or(60).clamp(1, 300) + 15);
            Ok((WorkspaceOp::Run { command: req_str("command")?, cwd: opt_str("cwd"), timeout_secs }, wait))
        }
        other => Err(AppError::Invalid(format!("unknown tool: {other}"))),
    }
}

fn call_tool(rt: &tokio::runtime::Runtime, data_dir: &Path, thread_id: &str, params: &Value) -> Value {
    let name = params.get("name").and_then(Value::as_str).unwrap_or_default();
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    let (op, timeout) = match parse_tool_op(name, &args) {
        Ok(parsed) => parsed,
        Err(err) => return text_result(err.to_string(), true),
    };
    let payload = json!({ "threadId": thread_id, "op": op });
    match rt.block_on(crate::control::request_with_timeout(data_dir, "remote_workspace_op", payload, timeout)) {
        Ok(val) => {
            let text = val.get("text").and_then(Value::as_str).unwrap_or_default().to_string();
            let is_error = val.get("isError").and_then(Value::as_bool).unwrap_or(false);
            text_result(text, is_error)
        }
        Err(err) => text_result(err.to_string(), true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_and_list_tools() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let init =
            handle(&rt, Path::new("."), "t1", &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" })).unwrap();
        assert_eq!(init["result"]["serverInfo"]["name"], SERVER_NAME);

        let list =
            handle(&rt, Path::new("."), "t1", &json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).unwrap();
        let names: Vec<&str> =
            list["result"]["tools"].as_array().unwrap().iter().filter_map(|t| t["name"].as_str()).collect();
        assert_eq!(names, ALL_TOOLS);
    }

    #[test]
    fn parses_tool_operations() {
        let (op, _) = parse_tool_op(TOOL_READ, &json!({ "path": "src/main.rs", "offset": 5, "limit": 20 })).unwrap();
        assert!(matches!(op, WorkspaceOp::Read { path, offset: Some(5), limit: Some(20) } if path == "src/main.rs"));

        let (op, wait) = parse_tool_op(TOOL_RUN, &json!({ "command": "cargo test", "timeout_secs": 120 })).unwrap();
        assert!(matches!(op, WorkspaceOp::Run { command, timeout_secs: Some(120), .. } if command == "cargo test"));
        assert_eq!(wait, Duration::from_secs(135));

        assert!(parse_tool_op(TOOL_SEARCH, &json!({ "mode": "nope", "pattern": "x" })).is_err());
        assert!(parse_tool_op("unknown_tool", &json!({})).is_err());
    }
}

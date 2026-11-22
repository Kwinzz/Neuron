//! Claude Code adapter: one long-lived `claude -p` process per thread, bidirectional stream-json.
//!
//! - stdin: `{"type":"user",...}` turns, `control_response` for permissions, `control_request` interrupt.
//! - stdout: parsed by [`parser::ClaudeParser`].
//! - Permissions are delegated to Neuron with `--permission-prompts host --permission-prompt-tool stdio`.

pub mod parser;

use std::collections::VecDeque;
use std::process::Stdio;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::agents::events::AgentKind;
use crate::agents::{AdapterEvent, AgentAdapter, SessionCommand, SessionHandle, SessionSpec};
use crate::error::{AppError, AppResult};

use parser::ClaudeParser;

const STDERR_TAIL_BYTES: usize = 4096;

pub struct ClaudeCodeAdapter {
    /// Executable name or path (default `claude`, resolved through PATH).
    pub binary: String,
}

impl Default for ClaudeCodeAdapter {
    fn default() -> Self {
        Self { binary: std::env::var("NEURON_CLAUDE_BIN").unwrap_or_else(|_| "claude".into()) }
    }
}

/// Builds the CLI arguments for a session (pure, unit-tested).
pub fn build_args(spec: &SessionSpec) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-prompts",
        "host",
        "--permission-prompt-tool",
        "stdio",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let mode = match spec.permission_mode.as_str() {
        m @ ("manual" | "acceptEdits" | "auto" | "plan" | "bypassPermissions" | "dontAsk") => m,
        _ => "manual",
    };
    args.extend(["--permission-mode".into(), mode.into()]);
    if mode == "bypassPermissions" {
        args.push("--allow-dangerously-skip-permissions".into());
    }
    if let Some(model) = spec.model.as_deref().filter(|m| !m.trim().is_empty()) {
        args.extend(["--model".into(), model.trim().into()]);
    }
    if let Some(session) = spec.resume.as_deref().filter(|s| !s.is_empty()) {
        args.extend(["--resume".into(), session.into()]);
    }
    if let Some(extra) = spec.append_system_prompt.as_deref().filter(|s| !s.trim().is_empty()) {
        args.extend(["--append-system-prompt".into(), extra.into()]);
    }
    args
}

/// JSON line written to stdin for a command, or `None` for commands handled otherwise.
pub fn encode_command(command: &SessionCommand) -> Option<Value> {
    match command {
        SessionCommand::Prompt(text) => Some(json!({
            "type": "user",
            "message": { "role": "user", "content": text },
        })),
        SessionCommand::Permission(d) => {
            let response = if d.allow {
                json!({ "behavior": "allow", "updatedInput": d.input })
            } else {
                json!({
                    "behavior": "deny",
                    "message": d.message.clone().unwrap_or_else(|| "Refusé par l'utilisateur dans Neuron.".into()),
                })
            };
            Some(json!({
                "type": "control_response",
                "response": { "subtype": "success", "request_id": d.request_id, "response": response },
            }))
        }
        SessionCommand::Interrupt => Some(json!({
            "type": "control_request",
            "request_id": uuid::Uuid::new_v4().to_string(),
            "request": { "subtype": "interrupt" },
        })),
        SessionCommand::Shutdown => None,
    }
}

impl AgentAdapter for ClaudeCodeAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::ClaudeCode
    }

    fn start(&self, spec: &SessionSpec) -> AppResult<SessionHandle> {
        if !spec.cwd.is_dir() {
            return Err(AppError::Invalid(format!("dossier de travail introuvable : {}", spec.cwd.display())));
        }
        let mut cmd = Command::new(&self.binary);
        cmd.args(build_args(spec))
            .current_dir(&spec.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|err| {
            AppError::Other(format!(
                "impossible de lancer « {} » ({err}). Claude Code est-il installé et dans le PATH ?",
                self.binary
            ))
        })?;
        let pid = child.id();
        let (Some(stdin), Some(stdout), Some(stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            return Err(AppError::Other("pipes du processus indisponibles".into()));
        };

        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();
        let (ev_tx, ev_rx) = mpsc::unbounded_channel::<AdapterEvent>();

        // stdin writer
        tauri::async_runtime::spawn(async move {
            let mut stdin = stdin;
            while let Some(command) = cmd_rx.recv().await {
                if matches!(command, SessionCommand::Shutdown) {
                    break; // dropping stdin = EOF → claude exits after the current turn
                }
                if let Some(value) = encode_command(&command) {
                    let line = format!("{value}\n");
                    if stdin.write_all(line.as_bytes()).await.is_err() || stdin.flush().await.is_err() {
                        break;
                    }
                }
            }
        });

        // stderr tail (diagnostics only)
        let (tail_tx, tail_rx) = tokio::sync::oneshot::channel::<String>();
        tauri::async_runtime::spawn(async move {
            let mut stderr = stderr;
            let mut tail: VecDeque<u8> = VecDeque::with_capacity(STDERR_TAIL_BYTES);
            let mut buf = [0u8; 1024];
            while let Ok(n) = stderr.read(&mut buf).await {
                if n == 0 {
                    break;
                }
                for b in &buf[..n] {
                    if tail.len() == STDERR_TAIL_BYTES {
                        tail.pop_front();
                    }
                    tail.push_back(*b);
                }
            }
            let _ = tail_tx.send(String::from_utf8_lossy(&tail.into_iter().collect::<Vec<_>>()).into_owned());
        });

        // stdout → parser → events, then wait for exit
        let thread_id = spec.thread_id.clone();
        tauri::async_runtime::spawn(async move {
            let mut parser = ClaudeParser::new();
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        for event in parser.feed(&line) {
                            if let AdapterEvent::Warning(w) = &event {
                                tracing::debug!(thread = %thread_id, "claude: {w}");
                                continue;
                            }
                            if ev_tx.send(event).is_err() {
                                break;
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(err) => {
                        tracing::warn!(thread = %thread_id, %err, "claude stdout read failed");
                        break;
                    }
                }
            }
            let code = child.wait().await.ok().and_then(|s| s.code());
            let stderr_tail = tail_rx.await.unwrap_or_default();
            let _ = ev_tx.send(AdapterEvent::Exited { code, stderr_tail });
        });

        Ok(SessionHandle { commands: cmd_tx, events: ev_rx, pid })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::PermissionDecision;
    use std::path::PathBuf;

    fn spec() -> SessionSpec {
        SessionSpec {
            thread_id: "t".into(),
            cwd: PathBuf::from("."),
            model: Some("sonnet".into()),
            permission_mode: "acceptEdits".into(),
            resume: Some("abc".into()),
            append_system_prompt: None,
        }
    }

    #[test]
    fn args_include_protocol_flags() {
        let args = build_args(&spec());
        let joined = args.join(" ");
        assert!(joined.contains("--input-format stream-json --output-format stream-json --verbose"));
        assert!(joined.contains("--permission-prompt-tool stdio"));
        assert!(joined.contains("--permission-mode acceptEdits"));
        assert!(joined.contains("--model sonnet"));
        assert!(joined.contains("--resume abc"));
        assert!(!joined.contains("--allow-dangerously-skip-permissions"));

        let mut bypass = spec();
        bypass.permission_mode = "bypassPermissions".into();
        assert!(build_args(&bypass).contains(&"--allow-dangerously-skip-permissions".to_string()));
        let mut weird = spec();
        weird.permission_mode = "rm -rf".into();
        assert!(build_args(&weird).join(" ").contains("--permission-mode manual"));
    }

    #[test]
    fn encodes_commands() {
        let prompt = encode_command(&SessionCommand::Prompt("salut".into())).unwrap();
        assert_eq!(prompt["message"]["content"], "salut");

        let allow = encode_command(&SessionCommand::Permission(PermissionDecision {
            request_id: "r1".into(),
            allow: true,
            input: json!({"file_path": "a"}),
            message: None,
        }))
        .unwrap();
        assert_eq!(allow["response"]["request_id"], "r1");
        assert_eq!(allow["response"]["response"]["behavior"], "allow");
        assert_eq!(allow["response"]["response"]["updatedInput"]["file_path"], "a");

        let deny = encode_command(&SessionCommand::Permission(PermissionDecision {
            request_id: "r2".into(),
            allow: false,
            input: Value::Null,
            message: None,
        }))
        .unwrap();
        assert_eq!(deny["response"]["response"]["behavior"], "deny");

        assert_eq!(encode_command(&SessionCommand::Interrupt).unwrap()["request"]["subtype"], "interrupt");
        assert!(encode_command(&SessionCommand::Shutdown).is_none());
    }
}

//! Codex adapter: `codex exec --json` runs ONE process per turn; later turns use
//! `codex exec … resume <thread_id> -- <prompt>`. Codex never asks for approvals in exec mode: the sandbox
//! decides (manual/edits/auto → workspace-write, plan → read-only, bypass → no sandbox).
//! The session task below hides that from the registry: it looks like any other long-lived session.

pub mod parser;

use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;

use crate::agents::events::{AgentKind, TokenUsage};
use crate::agents::process::{command, spawn_error, spawn_tail};
use crate::agents::{AdapterEvent, AgentAdapter, SessionCommand, SessionHandle, SessionSpec, kill_process_tree};
use crate::error::{AppError, AppResult};

use parser::CodexParser;

/// Reasoning levels Codex models may accept (`model_reasoning_effort`).
pub const EFFORT_LEVELS: &[&str] = &["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

pub struct CodexAdapter {
    pub binary: String,
}

impl Default for CodexAdapter {
    fn default() -> Self {
        Self { binary: std::env::var("NEURON_CODEX_BIN").unwrap_or_else(|_| "codex".into()) }
    }
}

/// Arguments for one turn.
pub fn turn_args(spec: &SessionSpec, thread: Option<&str>, prompt: &str) -> Vec<String> {
    let mut args: Vec<String> = ["exec", "--json", "--skip-git-repo-check"].iter().map(|s| s.to_string()).collect();
    match spec.permission_mode.as_str() {
        "plan" => args.extend(["--sandbox".into(), "read-only".into()]),
        "bypassPermissions" => args.push("--dangerously-bypass-approvals-and-sandbox".into()),
        _ => args.extend(["--sandbox".into(), "workspace-write".into()]),
    }
    if let Some(model) = spec.model.as_deref().filter(|m| !m.trim().is_empty()) {
        args.extend(["-m".into(), model.trim().into()]);
    }
    if let Some(effort) = spec.effort.as_deref().filter(|e| EFFORT_LEVELS.contains(e)) {
        args.extend(["-c".into(), format!("model_reasoning_effort=\"{effort}\"")]);
    }
    if let Some(mcp) = &spec.mcp {
        use crate::memory::mcp::SERVER_NAME;
        // TOML literal strings ('…'): Windows paths keep their backslashes.
        let lit = |s: &str| format!("'{}'", s.replace('\'', ""));
        let list = mcp.args.iter().map(|a| lit(a)).collect::<Vec<_>>().join(",");
        args.extend(["-c".into(), format!("mcp_servers.{SERVER_NAME}.command={}", lit(&mcp.command.display().to_string()))]);
        args.extend(["-c".into(), format!("mcp_servers.{SERVER_NAME}.args=[{list}]")]);
    }
    if let Some(thread) = thread.filter(|t| !t.is_empty()) {
        args.extend(["resume".into(), thread.into()]);
    }
    args.extend(["--".into(), prompt.into()]);
    args
}

impl AgentAdapter for CodexAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Codex
    }

    fn start(&self, spec: &SessionSpec) -> AppResult<SessionHandle> {
        if !spec.cwd.is_dir() {
            return Err(AppError::Invalid(format!("dossier de travail introuvable : {}", spec.cwd.display())));
        }
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();
        let (ev_tx, ev_rx) = mpsc::unbounded_channel::<AdapterEvent>();
        let binary = self.binary.clone();
        let spec = spec.clone();
        tauri::async_runtime::spawn(session_loop(binary, spec, cmd_rx, ev_tx));
        Ok(SessionHandle { commands: cmd_tx, events: ev_rx, pid: None })
    }
}

/// Runs turns one after another; prompts sent during a turn are queued.
async fn session_loop(
    binary: String,
    spec: SessionSpec,
    mut commands: mpsc::UnboundedReceiver<SessionCommand>,
    events: mpsc::UnboundedSender<AdapterEvent>,
) {
    let mut thread = spec.resume.clone();
    let mut queue: VecDeque<String> = VecDeque::new();
    let cwd: PathBuf = spec.cwd.clone();

    'session: loop {
        let prompt = match queue.pop_front() {
            Some(p) => p,
            None => match commands.recv().await {
                Some(SessionCommand::Prompt(p)) => p,
                Some(SessionCommand::Shutdown) | None => break,
                Some(_) => continue,
            },
        };

        let args = turn_args(&spec, thread.as_deref(), &prompt);
        let mut child = match command(&binary, &args, &cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(err) => {
                let _ = events.send(AdapterEvent::TurnComplete {
                    usage: TokenUsage::default(),
                    duration_ms: None,
                    error: Some(spawn_error(&binary, err).to_string()),
                });
                continue;
            }
        };
        let pid = child.id();
        let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else { continue };
        let tail = spawn_tail(stderr);
        let mut lines = BufReader::new(stdout).lines();
        let mut parser = CodexParser::new(uuid::Uuid::new_v4().simple().to_string());
        let started = std::time::Instant::now();
        let mut completed = false;
        let mut shutdown = false;

        loop {
            tokio::select! {
                line = lines.next_line() => match line {
                    Ok(Some(line)) => {
                        for event in parser.feed(&line) {
                            match &event {
                                AdapterEvent::SessionInit { session_ref, .. } => thread = Some(session_ref.clone()),
                                AdapterEvent::Warning(w) => {
                                    tracing::debug!(thread = %spec.thread_id, "codex: {w}");
                                    continue;
                                }
                                AdapterEvent::TurnComplete { .. } => completed = true,
                                _ => {}
                            }
                            let event = match event {
                                AdapterEvent::TurnComplete { usage, error, .. } => AdapterEvent::TurnComplete {
                                    usage,
                                    error,
                                    duration_ms: Some(i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX)),
                                },
                                other => other,
                            };
                            let _ = events.send(event);
                        }
                    }
                    _ => break,
                },
                command = commands.recv() => match command {
                    Some(SessionCommand::Prompt(p)) => queue.push_back(p),
                    Some(SessionCommand::Interrupt) => {
                        queue.clear();
                        if let Some(pid) = pid { kill_process_tree(pid); }
                    }
                    Some(SessionCommand::Shutdown) | None => {
                        shutdown = true;
                        if let Some(pid) = pid { kill_process_tree(pid); }
                    }
                    Some(SessionCommand::Permission(_)) => {}
                },
            }
        }

        let code = child.wait().await.ok().and_then(|s| s.code());
        if !completed {
            let stderr_tail = tail.await.unwrap_or_default();
            let detail = stderr_tail.lines().rev().find(|l| !l.trim().is_empty()).map(str::trim).unwrap_or("");
            let _ = events.send(AdapterEvent::TurnComplete {
                usage: TokenUsage::default(),
                duration_ms: Some(i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX)),
                error: Some(if detail.is_empty() {
                    format!("Codex s'est arrêté (code {}).", code.map_or("?".into(), |c| c.to_string()))
                } else {
                    format!("Codex : {detail}")
                }),
            });
        }
        if shutdown {
            break 'session;
        }
    }
    let _ = events.send(AdapterEvent::Exited { code: Some(0), stderr_tail: String::new() });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(mode: &str) -> SessionSpec {
        SessionSpec {
            thread_id: "t".into(),
            cwd: PathBuf::from("."),
            model: Some("gpt-6-luna".into()),
            effort: Some("high".into()),
            permission_mode: mode.into(),
            resume: None,
            append_system_prompt: None,
            mcp: None,
        }
    }

    #[test]
    fn turn_args_first_and_resumed() {
        let first = turn_args(&spec("manual"), None, "-hello").join(" ");
        assert_eq!(
            first,
            "exec --json --skip-git-repo-check --sandbox workspace-write -m gpt-6-luna -c model_reasoning_effort=\"high\" -- -hello"
        );
        let resumed = turn_args(&spec("plan"), Some("th-1"), "suite").join(" ");
        assert!(resumed.contains("--sandbox read-only"));
        assert!(resumed.ends_with("resume th-1 -- suite"));
        let bypass = turn_args(&spec("bypassPermissions"), None, "x").join(" ");
        assert!(bypass.contains("--dangerously-bypass-approvals-and-sandbox") && !bypass.contains("--sandbox"));
    }
}

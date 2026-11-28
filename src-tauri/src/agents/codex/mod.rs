//! Codex adapter: `codex exec --json` runs ONE process per turn; later turns use
//! `codex exec … resume <thread_id> -- <prompt>`. Codex never asks for approvals in exec mode: the sandbox
//! decides (manual/edits/auto → workspace-write, plan → read-only, bypass → no sandbox).
//! The session task below hides that from the registry: it looks like any other long-lived session.

pub mod limits;
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
pub fn turn_args(spec: &SessionSpec, thread: Option<&str>, turn: &crate::agents::UserTurn) -> Vec<String> {
    let mut args: Vec<String> = ["exec", "--json", "--skip-git-repo-check"].iter().map(|s| s.to_string()).collect();
    if spec.remote_mcp.is_some() {
        // Cross-device workspace: keep the AI host strictly read-only so Codex never modifies local files.
        args.extend(["--sandbox".into(), "read-only".into()]);
    } else {
        match spec.permission_mode.as_str() {
            "plan" => args.extend(["--sandbox".into(), "read-only".into()]),
            "bypassPermissions" => args.push("--dangerously-bypass-approvals-and-sandbox".into()),
            _ => args.extend(["--sandbox".into(), "workspace-write".into()]),
        }
    }
    if let Some(model) = spec.model.as_deref().filter(|m| !m.trim().is_empty()) {
        args.extend(["-m".into(), model.trim().into()]);
    }
    if let Some(effort) = spec.effort.as_deref().filter(|e| EFFORT_LEVELS.contains(e)) {
        args.extend(["-c".into(), format!("model_reasoning_effort=\"{effort}\"")]);
    }
    let lit = |s: &str| format!("'{}'", s.replace('\'', ""));
    if let Some(mcp) = &spec.mcp {
        use crate::memory::mcp::SERVER_NAME;
        // TOML literal strings ('…'): Windows paths keep their backslashes.
        let list = mcp.args.iter().map(|a| lit(a)).collect::<Vec<_>>().join(",");
        args.extend([
            "-c".into(),
            format!("mcp_servers.{SERVER_NAME}.command={}", lit(&mcp.command.display().to_string())),
        ]);
        args.extend(["-c".into(), format!("mcp_servers.{SERVER_NAME}.args=[{list}]")]);
    }
    if let Some(remote_mcp) = &spec.remote_mcp {
        use crate::remote::mcp::SERVER_NAME;
        let list = remote_mcp.args.iter().map(|a| lit(a)).collect::<Vec<_>>().join(",");
        args.extend([
            "-c".into(),
            format!("mcp_servers.{SERVER_NAME}.command={}", lit(&remote_mcp.command.display().to_string())),
        ]);
        args.extend(["-c".into(), format!("mcp_servers.{SERVER_NAME}.args=[{list}]")]);
    }
    // `--image=<path>`: the `=` form, because `-i` takes several values and would swallow the prompt.
    args.extend(turn.attachments.iter().filter(|a| a.is_image).map(|a| format!("--image={}", a.path)));
    if let Some(thread) = thread.filter(|t| !t.is_empty()) {
        args.extend(["resume".into(), thread.into()]);
    }
    args.extend(["--".into(), turn.text_with_note(|a| a.is_image)]);
    args
}

/// `/review [instructions]` → `codex exec review` (uncommitted changes, or the given instructions).
pub fn review_args(spec: &SessionSpec, instructions: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = ["exec", "review", "--json"].iter().map(|s| s.to_string()).collect();
    if let Some(model) = spec.model.as_deref().filter(|m| !m.trim().is_empty()) {
        args.extend(["-m".into(), model.trim().into()]);
    }
    if let Some(effort) = spec.effort.as_deref().filter(|e| EFFORT_LEVELS.contains(e)) {
        args.extend(["-c".into(), format!("model_reasoning_effort=\"{effort}\"")]);
    }
    match instructions {
        Some(text) => args.extend(["--".into(), text.into()]),
        None => args.push("--uncommitted".into()),
    }
    args
}

impl AgentAdapter for CodexAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Codex
    }

    fn start(&self, spec: &SessionSpec) -> AppResult<SessionHandle> {
        if !spec.cwd.is_dir() {
            return Err(AppError::Invalid(crate::tr!(
                "dossier de travail introuvable : {}",
                "working folder not found: {}",
                spec.cwd.display()
            )));
        }
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();
        let (ev_tx, ev_rx) = mpsc::unbounded_channel::<AdapterEvent>();
        let binary = self.binary.clone();
        let spec = spec.clone();
        let turn_pid = crate::agents::TurnPid::default();
        tauri::async_runtime::spawn(session_loop(binary, spec, cmd_rx, ev_tx, std::sync::Arc::clone(&turn_pid)));
        Ok(SessionHandle { commands: cmd_tx, events: ev_rx, pid: None, turn_pid: Some(turn_pid) })
    }
}

/// Runs turns one after another; prompts sent during a turn are queued.
async fn session_loop(
    binary: String,
    spec: SessionSpec,
    mut commands: mpsc::UnboundedReceiver<SessionCommand>,
    events: mpsc::UnboundedSender<AdapterEvent>,
    turn_pid: crate::agents::TurnPid,
) {
    let mut thread = spec.resume.clone();
    let mut queue: VecDeque<crate::agents::UserTurn> = VecDeque::new();
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

        // Slash commands: `/review` is its own Codex command; `/<skill>` becomes an explicit instruction.
        let (args, is_review) = match crate::agents::slash::codex_rewrite(&cwd, &prompt.text) {
            Some(crate::agents::slash::CodexSlash::Review(instructions)) => {
                (review_args(&spec, instructions.as_deref()), true)
            }
            Some(crate::agents::slash::CodexSlash::Prompt(text)) => {
                let turn = crate::agents::UserTurn { text, attachments: prompt.attachments.clone() };
                (turn_args(&spec, thread.as_deref(), &turn), false)
            }
            None => (turn_args(&spec, thread.as_deref(), &prompt), false),
        };
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
        turn_pid.store(pid.unwrap_or(0), std::sync::atomic::Ordering::Relaxed);
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
                                // A review runs in its own Codex thread: the conversation keeps resuming the chat's.
                                AdapterEvent::SessionInit { .. } if is_review => continue,
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
                    Some(SessionCommand::Permission(_) | SessionCommand::SetMode(_)) => {}
                },
            }
        }

        let code = child.wait().await.ok().and_then(|s| s.code());
        turn_pid.store(0, std::sync::atomic::Ordering::Relaxed);
        if !completed {
            let stderr_tail = tail.await.unwrap_or_default();
            let detail = stderr_tail.lines().rev().find(|l| !l.trim().is_empty()).map(str::trim).unwrap_or("");
            let _ = events.send(AdapterEvent::TurnComplete {
                usage: TokenUsage::default(),
                duration_ms: Some(i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX)),
                error: Some(if detail.is_empty() {
                    crate::tr!(
                        "Codex s'est arrêté (code {}).",
                        "Codex stopped (code {}).",
                        code.map_or("?".into(), |c| c.to_string())
                    )
                } else {
                    format!("Codex : {detail}")
                }),
            });
        }
        // Subscription windows: Codex writes them in its session file, not in the JSON stream.
        if let Some(id) = thread.clone() {
            if let Ok(Some(windows)) = tokio::task::spawn_blocking(move || limits::read_for_thread(&id)).await {
                let _ = events.send(AdapterEvent::RateLimits(windows));
            }
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
            remote_mcp: None,
            generic: None,
        }
    }

    #[test]
    fn turn_args_first_and_resumed() {
        let first = turn_args(&spec("manual"), None, &"-hello".into()).join(" ");
        assert_eq!(
            first,
            "exec --json --skip-git-repo-check --sandbox workspace-write -m gpt-6-luna -c model_reasoning_effort=\"high\" -- -hello"
        );
        let resumed = turn_args(&spec("plan"), Some("th-1"), &"suite".into()).join(" ");
        assert!(resumed.contains("--sandbox read-only"));
        assert!(resumed.ends_with("resume th-1 -- suite"));
        let bypass = turn_args(&spec("bypassPermissions"), None, &"x".into()).join(" ");
        let review = review_args(&spec("manual"), None).join(" ");
        assert!(review.starts_with("exec review --json") && review.ends_with("--uncommitted"));
        assert!(review_args(&spec("manual"), Some("perf")).join(" ").ends_with("-- perf"));
        let img = crate::attachments::Attachment {
            id: "1".into(),
            name: "a.png".into(),
            path: "C:/n/a.png".into(),
            mime: "image/png".into(),
            size: 3,
            is_image: true,
        };
        let doc = crate::attachments::Attachment {
            name: "b.pdf".into(),
            path: "C:/n/b.pdf".into(),
            is_image: false,
            ..img.clone()
        };
        let turn = crate::agents::UserTurn { text: "regarde".into(), attachments: vec![img, doc] };
        let with = turn_args(&spec("manual"), None, &turn);
        assert!(with.contains(&"--image=C:/n/a.png".to_string()));
        let prompt = with.last().unwrap();
        assert!(prompt.starts_with("regarde") && prompt.contains("C:/n/b.pdf") && !prompt.contains("a.png"));
        assert!(bypass.contains("--dangerously-bypass-approvals-and-sandbox") && !bypass.contains("--sandbox"));

        let mut remote = spec("bypassPermissions");
        remote.remote_mcp = Some(crate::remote::mcp::RemoteMcpLaunch::new(
            PathBuf::from("neuron"),
            std::path::Path::new("/data"),
            "th-2",
        ));
        let remote_args = turn_args(&remote, None, &"hello".into()).join(" ");
        assert!(remote_args.contains("--sandbox read-only"));
        assert!(!remote_args.contains("--dangerously-bypass-approvals-and-sandbox"));
        assert!(remote_args.contains("mcp_servers.neuron_remote.command="));
    }
}

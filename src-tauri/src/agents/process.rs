//! Shared plumbing for agents that run as one long-lived process speaking NDJSON on stdin/stdout
//! (Claude Code, Antigravity).

use std::collections::VecDeque;
use std::path::Path;
use std::process::Stdio;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

use crate::agents::{AdapterEvent, SessionCommand, SessionHandle, kill_process_tree};
use crate::error::{AppError, AppResult};

const STDERR_TAIL_BYTES: usize = 4096;

/// Build a command that never opens a console window on Windows.
pub fn command(binary: &str, args: &[String], cwd: &Path) -> Command {
    let mut cmd = Command::new(binary);
    cmd.args(args).current_dir(cwd).kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        // Own process group: `kill_process_tree` signals the agent and everything it spawned.
        cmd.process_group(0);
    }
    // Linux: the login shell's PATH (an app started from the menu doesn't have it).
    if let Some(path) = crate::env_path::path() {
        cmd.env("PATH", path);
    }
    cmd
}

pub fn spawn_error(binary: &str, err: std::io::Error) -> AppError {
    if err.kind() == std::io::ErrorKind::NotFound {
        return AppError::AgentNotInstalled(binary.to_string());
    }
    AppError::Other(crate::tr!(
        "impossible de lancer « {binary} » ({err}). Le CLI est-il installé et dans le PATH ?",
        "could not start “{binary}” ({err}). Is the CLI installed and in the PATH?"
    ))
}

/// Keep the last bytes of a stream (stderr) for diagnostics.
pub fn spawn_tail<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
    mut reader: R,
) -> tokio::sync::oneshot::Receiver<String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    tauri::async_runtime::spawn(async move {
        let mut tail: VecDeque<u8> = VecDeque::with_capacity(STDERR_TAIL_BYTES);
        let mut buf = [0u8; 1024];
        while let Ok(n) = reader.read(&mut buf).await {
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
        let _ = tx.send(String::from_utf8_lossy(&tail.into_iter().collect::<Vec<_>>()).into_owned());
    });
    rx
}

/// How a session command is delivered.
pub enum Delivery {
    /// Write this JSON line to stdin.
    Line(Value),
    /// Interrupt by killing the process tree (agent has no interrupt message).
    Kill,
    /// Nothing to send.
    Ignore,
}

/// Spawn a long-lived NDJSON agent process and wire its stdin/stdout to a [`SessionHandle`].
pub fn spawn_stream_session<E, P>(
    binary: &str,
    args: &[String],
    cwd: &Path,
    thread_id: String,
    encode: E,
    mut parse: P,
) -> AppResult<SessionHandle>
where
    E: Fn(&SessionCommand) -> Delivery + Send + 'static,
    P: FnMut(&str) -> Vec<AdapterEvent> + Send + 'static,
{
    if !cwd.is_dir() {
        return Err(AppError::Invalid(crate::tr!(
            "dossier de travail introuvable : {}",
            "working folder not found: {}",
            cwd.display()
        )));
    }
    let mut child: Child = command(binary, args, cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| spawn_error(binary, err))?;
    let pid = child.id();
    let (Some(stdin), Some(stdout), Some(stderr)) = (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        return Err(AppError::Other(crate::tr!("pipes du processus indisponibles", "process pipes unavailable")));
    };

    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();
    let (ev_tx, ev_rx) = mpsc::unbounded_channel::<AdapterEvent>();

    // stdin writer
    tauri::async_runtime::spawn(async move {
        let mut stdin = stdin;
        while let Some(command) = cmd_rx.recv().await {
            if matches!(command, SessionCommand::Shutdown) {
                break; // EOF → the agent exits
            }
            match encode(&command) {
                Delivery::Line(value) => {
                    let line = format!("{value}\n");
                    if stdin.write_all(line.as_bytes()).await.is_err() || stdin.flush().await.is_err() {
                        break;
                    }
                }
                Delivery::Kill => {
                    if let Some(pid) = pid {
                        kill_process_tree(pid);
                    }
                    break;
                }
                Delivery::Ignore => {}
            }
        }
    });

    let tail_rx = spawn_tail(stderr);

    // stdout → parser → events, then wait for exit
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    for event in parse(&line) {
                        if let AdapterEvent::Warning(w) = &event {
                            tracing::debug!(thread = %thread_id, "agent: {w}");
                            continue;
                        }
                        if ev_tx.send(event).is_err() {
                            break;
                        }
                    }
                }
                Ok(None) => break,
                Err(err) => {
                    tracing::warn!(thread = %thread_id, %err, "agent stdout read failed");
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

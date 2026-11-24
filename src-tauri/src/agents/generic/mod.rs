//! Generic CLI adapter: any command-line tool configured in Paramètres (`GenericCliProfile`).
//! One process per message (like Codex); the output is streamed as plain text (ANSI sequences stripped).
//! Two transports: pipes (default) or a pseudo-terminal for tools that refuse to run without a TTY.
//! Stateless: each message runs on its own (no resume), which the UI states.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::process::Stdio;
use std::time::Instant;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;

use crate::agents::events::{AgentKind, DeltaChannel, ThreadStatus, TokenUsage};
use crate::agents::process::{command, spawn_error, spawn_tail};
use crate::agents::{AdapterEvent, AgentAdapter, SessionCommand, SessionHandle, SessionSpec, kill_process_tree};
use crate::app_settings::{GenericCliProfile, PROMPT_PLACEHOLDER};
use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct GenericAdapter;

impl AgentAdapter for GenericAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Generic
    }

    fn start(&self, spec: &SessionSpec) -> AppResult<SessionHandle> {
        let profile = spec.generic.clone().ok_or_else(|| {
            AppError::Invalid(crate::tr!(
                "CLI générique introuvable : vérifie-le dans Paramètres › CLI génériques",
                "generic CLI not found: check it in Settings › Generic CLIs"
            ))
        })?;
        if !spec.cwd.is_dir() {
            return Err(AppError::Invalid(crate::tr!(
                "dossier de travail introuvable : {}",
                "working folder not found: {}",
                spec.cwd.display()
            )));
        }
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();
        let (ev_tx, ev_rx) = mpsc::unbounded_channel::<AdapterEvent>();
        tauri::async_runtime::spawn(session_loop(profile, spec.clone(), cmd_rx, ev_tx));
        Ok(SessionHandle { commands: cmd_tx, events: ev_rx, pid: None })
    }
}

/// Arguments with `{prompt}` substituted; `None` second value = the prompt goes to stdin.
pub fn turn_args(profile: &GenericCliProfile, prompt: &str) -> (Vec<String>, bool) {
    let uses_placeholder = profile.args.iter().any(|a| a.contains(PROMPT_PLACEHOLDER));
    let args = profile.args.iter().map(|a| a.replace(PROMPT_PLACEHOLDER, prompt)).collect();
    (args, !uses_placeholder)
}

/// Terminal output → plain text: keeps printable characters, newlines and tabs; drops escape sequences,
/// carriage returns and other controls. Keeps parser state across chunks (split sequences/UTF-8).
pub struct TextFilter {
    parser: vte::Parser,
    out: Collector,
}

#[derive(Default)]
struct Collector(String);

impl vte::Perform for Collector {
    fn print(&mut self, c: char) {
        self.0.push(c);
    }
    fn execute(&mut self, byte: u8) {
        match byte {
            b'\n' => self.0.push('\n'),
            b'\t' => self.0.push('\t'),
            _ => {}
        }
    }
}

impl Default for TextFilter {
    fn default() -> Self {
        Self { parser: vte::Parser::new(), out: Collector::default() }
    }
}

impl TextFilter {
    pub fn feed(&mut self, bytes: &[u8]) -> String {
        self.parser.advance(&mut self.out, bytes);
        std::mem::take(&mut self.out.0)
    }
}

/// Output of one turn, whichever transport produced it.
enum Chunk {
    Data(Vec<u8>),
    Exit(Option<i32>),
}

struct Turn {
    chunks: mpsc::UnboundedReceiver<Chunk>,
    kill: Box<dyn FnMut() + Send>,
    stderr: Option<tokio::sync::oneshot::Receiver<String>>,
    /// Keeps the PTY master alive until the turn ends (dropping it ends the reader on Windows).
    _keep: Option<Box<dyn Send>>,
}

fn start_pipe(profile: &GenericCliProfile, spec: &SessionSpec, prompt: &str) -> AppResult<Turn> {
    let (args, via_stdin) = turn_args(profile, prompt);
    let mut child = command(&profile.command, &args, &spec.cwd)
        .stdin(if via_stdin { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| spawn_error(&profile.command, e))?;
    let pid = child.id();
    if let Some(mut stdin) = child.stdin.take() {
        let text = format!("{prompt}\n");
        tokio::spawn(async move {
            let _ = stdin.write_all(text.as_bytes()).await;
            // Dropping stdin closes it: the tool sees EOF.
        });
    }
    let stderr = child.stderr.take().map(spawn_tail);
    let mut stdout =
        child.stdout.take().ok_or_else(|| AppError::Other(crate::tr!("stdout indisponible", "stdout unavailable")))?;
    let (tx, rx) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        let mut buf = vec![0u8; 8192];
        loop {
            match stdout.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = tx.send(Chunk::Data(buf[..n].to_vec()));
                }
            }
        }
        let code = child.wait().await.ok().and_then(|s| s.code());
        let _ = tx.send(Chunk::Exit(code));
    });
    Ok(Turn {
        chunks: rx,
        kill: Box::new(move || {
            if let Some(pid) = pid {
                kill_process_tree(pid);
            }
        }),
        stderr,
        _keep: None,
    })
}

fn start_pty(profile: &GenericCliProfile, spec: &SessionSpec, prompt: &str) -> AppResult<Turn> {
    use portable_pty::{CommandBuilder, PtySize, native_pty_system};
    let pty_err =
        |e: &dyn std::fmt::Display| AppError::Other(crate::tr!("pseudo-terminal : {e}", "pseudo-terminal: {e}"));
    let (args, via_stdin) = turn_args(profile, prompt);
    let pair = native_pty_system()
        .openpty(PtySize { rows: 40, cols: 160, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| pty_err(&e))?;
    let mut cmd = CommandBuilder::new(&profile.command);
    cmd.args(&args);
    if let Some(path) = crate::env_path::path() {
        cmd.env("PATH", path);
    }
    cmd.cwd(&spec.cwd);
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| spawn_error(&profile.command, std::io::Error::other(e.to_string())))?;
    drop(pair.slave);
    let mut killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| pty_err(&e))?;
    let writer = std::sync::Arc::new(std::sync::Mutex::new(pair.master.take_writer().map_err(|e| pty_err(&e))?));
    if via_stdin {
        // Type the message then end-of-input (Ctrl+Z on Windows, Ctrl+D elsewhere).
        let eof = if cfg!(windows) { "\x1a\r\n" } else { "\x04" };
        if let Ok(mut w) = writer.lock() {
            let _ = write!(w, "{prompt}\r\n{eof}");
            let _ = w.flush();
        }
    }
    let answer = std::sync::Arc::clone(&writer);
    let (tx, rx) = mpsc::unbounded_channel();
    let data_tx = tx.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    // ConPTY asks for the cursor position (DSR) at startup and blocks the program until a
                    // terminal answers: answer "row 1, column 1".
                    if buf[..n].windows(4).any(|w| w == b"\x1b[6n") {
                        if let Ok(mut w) = answer.lock() {
                            let _ = w.write_all(b"\x1b[1;1R");
                            let _ = w.flush();
                        }
                    }
                    if data_tx.send(Chunk::Data(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
    });
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|s| i32::try_from(s.exit_code()).unwrap_or(-1));
        let _ = tx.send(Chunk::Exit(code));
    });
    Ok(Turn {
        chunks: rx,
        kill: Box::new(move || {
            let _ = killer.kill();
        }),
        stderr: None,
        _keep: Some(Box::new((pair.master, writer))),
    })
}

async fn session_loop(
    profile: GenericCliProfile,
    spec: SessionSpec,
    mut commands: mpsc::UnboundedReceiver<SessionCommand>,
    events: mpsc::UnboundedSender<AdapterEvent>,
) {
    let _ = events.send(AdapterEvent::SessionInit {
        session_ref: format!("generic-{}", profile.id),
        model: Some(profile.id.clone()),
    });
    let mut queue: VecDeque<crate::agents::UserTurn> = VecDeque::new();
    'session: loop {
        let prompt = match queue.pop_front() {
            Some(p) => p,
            None => match commands.recv().await {
                Some(SessionCommand::Prompt(p)) => p,
                Some(SessionCommand::Shutdown) | None => break,
                Some(_) => continue,
            },
        };
        let prompt = prompt.text_with_note(|_| false);
        let started = Instant::now();
        let elapsed = || Some(i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX));
        let turn = if profile.pty { start_pty(&profile, &spec, &prompt) } else { start_pipe(&profile, &spec, &prompt) };
        let mut turn = match turn {
            Ok(t) => t,
            Err(err) => {
                let _ = events.send(AdapterEvent::TurnComplete {
                    usage: TokenUsage::default(),
                    duration_ms: elapsed(),
                    error: Some(err.to_string()),
                });
                continue;
            }
        };
        let _ = events.send(AdapterEvent::Status { status: ThreadStatus::Running, detail: Some(profile.name.clone()) });

        let item_id = uuid::Uuid::new_v4().simple().to_string();
        let mut filter = TextFilter::default();
        let mut full = String::new();
        let (mut code, mut stopped, mut shutdown) = (None, false, false);
        loop {
            tokio::select! {
                chunk = turn.chunks.recv() => match chunk {
                    Some(Chunk::Data(bytes)) => {
                        let text = filter.feed(&bytes);
                        // Leading blank output (PTY screen setup) is not worth a message.
                        let text = if full.trim().is_empty() { text.trim_start().to_string() } else { text };
                        if !text.is_empty() {
                            full.push_str(&text);
                            let _ = events.send(AdapterEvent::TextDelta { item_id: item_id.clone(), channel: DeltaChannel::Text, text });
                        }
                    }
                    Some(Chunk::Exit(c)) => {
                        code = c;
                        // Let the reader deliver what the tool wrote just before exiting.
                        let grace = tokio::time::sleep(std::time::Duration::from_millis(150));
                        tokio::pin!(grace);
                        loop {
                            tokio::select! {
                                _ = &mut grace => break,
                                more = turn.chunks.recv() => match more {
                                    Some(Chunk::Data(bytes)) => {
                                        let text = filter.feed(&bytes);
                                        if !text.is_empty() {
                                            full.push_str(&text);
                                            let _ = events.send(AdapterEvent::TextDelta { item_id: item_id.clone(), channel: DeltaChannel::Text, text });
                                        }
                                    }
                                    Some(Chunk::Exit(_)) => {}
                                    None => break,
                                },
                            }
                        }
                        break;
                    }
                    None => break,
                },
                command = commands.recv() => match command {
                    Some(SessionCommand::Prompt(p)) => queue.push_back(p),
                    Some(SessionCommand::Interrupt) => {
                        queue.clear();
                        stopped = true;
                        (turn.kill)();
                    }
                    Some(SessionCommand::Shutdown) | None => {
                        shutdown = true;
                        (turn.kill)();
                    }
                    Some(SessionCommand::Permission(_) | SessionCommand::SetMode(_)) => {}
                },
            }
            if stopped || shutdown {
                break;
            }
        }
        drop(turn._keep.take());

        let text = full.trim_end().to_string();
        if !text.is_empty() {
            let _ =
                events.send(AdapterEvent::BlockCompleted { item_id, channel: DeltaChannel::Text, text: text.clone() });
        }
        let error = if stopped || shutdown || code == Some(0) {
            None
        } else {
            let tail = match turn.stderr.take() {
                Some(h) => h.await.unwrap_or_default(),
                None => String::new(),
            };
            let detail = tail.lines().rev().find(|l| !l.trim().is_empty()).map(str::trim).unwrap_or("").to_string();
            let code_s = code.map_or("?".into(), |c| c.to_string());
            let name = &profile.name;
            Some(if detail.is_empty() {
                crate::tr!("{name} s'est arrêté (code {code_s}).", "{name} stopped (code {code_s}).")
            } else {
                format!("{} : {detail}", profile.name)
            })
        };
        let _ = events.send(AdapterEvent::TurnComplete { usage: TokenUsage::default(), duration_ms: elapsed(), error });
        if shutdown {
            break 'session;
        }
    }
    let _ = events.send(AdapterEvent::Exited { code: Some(0), stderr_tail: String::new() });
}

/// One-shot run for the "Tester" button in Paramètres (pipe or PTY, 60 s max).
pub async fn test_profile(profile: GenericCliProfile, cwd: std::path::PathBuf) -> AppResult<String> {
    let spec = SessionSpec {
        thread_id: "test".into(),
        cwd,
        model: None,
        effort: None,
        permission_mode: "manual".into(),
        resume: None,
        append_system_prompt: None,
        mcp: None,
        generic: Some(profile.clone()),
    };
    let handle = GenericAdapter.start(&spec)?;
    let mut events = handle.events;
    handle.commands.send(SessionCommand::Prompt(crate::tr!("Réponds simplement : OK", "Just answer: OK").into())).ok();
    let mut out = String::new();
    let result = tokio::time::timeout(std::time::Duration::from_secs(60), async {
        while let Some(ev) = events.recv().await {
            match ev {
                AdapterEvent::BlockCompleted { text, .. } => out = text,
                AdapterEvent::TurnComplete { error, .. } => {
                    let _ = handle.commands.send(SessionCommand::Shutdown);
                    return error;
                }
                _ => {}
            }
        }
        None
    })
    .await;
    match result {
        Ok(None) => Ok(out),
        Ok(Some(err)) => Err(AppError::Other(err)),
        Err(_) => {
            let _ = handle.commands.send(SessionCommand::Shutdown);
            Err(AppError::Other(crate::tr!("pas de réponse en 60 s", "no answer within 60 s")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_strips_ansi_across_chunks() {
        let mut f = TextFilter::default();
        let mut s = f.feed(b"\x1b[32mHel");
        s.push_str(&f.feed(b"lo\x1b[0m\r\nw\xc3"));
        s.push_str(&f.feed(b"\xa9\x1b[2"));
        s.push_str(&f.feed(b"Kx"));
        assert_eq!(s, "Hello\nwéx");
    }

    #[test]
    fn placeholder_or_stdin() {
        let p = GenericCliProfile { args: vec!["run".into(), "llama".into(), "{prompt}".into()], ..Default::default() };
        assert_eq!(turn_args(&p, "salut"), (vec!["run".into(), "llama".into(), "salut".into()], false));
        let p = GenericCliProfile { args: vec!["--quiet".into()], ..Default::default() };
        assert!(turn_args(&p, "x").1, "no placeholder → stdin");
    }

    fn echo_profile(pty: bool) -> GenericCliProfile {
        // A tool present everywhere: the shell echoing its argument.
        if cfg!(windows) {
            GenericCliProfile {
                id: "echo".into(),
                name: "Echo".into(),
                command: "cmd".into(),
                args: vec!["/C".into(), "echo {prompt}".into()],
                pty,
            }
        } else {
            GenericCliProfile {
                id: "echo".into(),
                name: "Echo".into(),
                command: "echo".into(),
                args: vec!["{prompt}".into()],
                pty,
            }
        }
    }

    #[tokio::test]
    async fn runs_a_turn_through_pipes_and_pty() {
        let cwd = std::env::temp_dir();
        let out = test_profile(echo_profile(false), cwd.clone()).await.unwrap();
        assert!(out.contains("OK"), "pipe output: {out:?}");
        let out = test_profile(echo_profile(true), cwd).await.unwrap();
        assert!(out.contains("OK"), "pty output: {out:?}");
    }
}

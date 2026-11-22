//! Running agent sessions (one per thread) and their event pumps.
//!
//! Each session runs in background tasks: opening another thread or switching project never blocks or
//! stops a running one. The pump persists adapter events to SQLite and emits normalized events.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::agents::activity::tool_activity;
use crate::agents::antigravity::AntigravityAdapter;
use crate::agents::claude::ClaudeCodeAdapter;
use crate::agents::codex::CodexAdapter;
use crate::agents::generic::GenericAdapter;
use crate::agents::events::{
    AGENT_EVENT_CHANNEL, AgentEvent, AgentEventEnvelope, AgentKind, ThreadStatus, TokenUsage,
};
use crate::agents::{
    AdapterEvent, AgentAdapter, PermissionDecision, SessionCommand, SessionSpec, kill_process_tree,
};
use crate::db::chat::{self, ToolStatus};
use crate::db::threads::{self, ThreadRuntime};
use crate::db::{Db, settings};
use crate::error::{AppError, AppResult};
use crate::util::now_ms;

/// How long a stop request may take before the process tree is killed.
const STOP_GRACE: Duration = Duration::from_secs(5);

struct ActiveSession {
    commands: mpsc::UnboundedSender<SessionCommand>,
    pid: Option<u32>,
    /// Unique per spawn, so a late `Exited` from an old process never removes a newer session.
    generation: u64,
    /// Pending permission requests: request id → tool input (echoed back on allow).
    pending: HashMap<String, Value>,
    stop_requested: bool,
    shutdown_requested: bool,
    /// Model/effort/permissions changed: restart (with --resume) before the next prompt.
    stale: bool,
    /// A turn is in progress (from the prompt until TurnComplete).
    busy: bool,
    /// Last time the session became idle (idle-shutdown reaper).
    idle_since: Instant,
}

pub struct AgentRegistry {
    sessions: Mutex<HashMap<String, ActiveSession>>,
    adapters: HashMap<AgentKind, Arc<dyn AgentAdapter>>,
    /// Serializes session spawning (avoids double spawn on fast double-send).
    spawn_lock: tokio::sync::Mutex<u64>,
    /// Neuron executable + memory paths: every session gets the memory MCP server (None in tests).
    mcp: Option<(PathBuf, crate::memory::MemoryPaths)>,
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new(None)
    }
}

fn emit(app: &AppHandle, thread_id: &str, event: AgentEvent) {
    let envelope = AgentEventEnvelope { thread_id: thread_id.to_string(), ts: now_ms(), event };
    if let Err(err) = app.emit(AGENT_EVENT_CHANNEL, envelope) {
        tracing::warn!(%err, "emit failed");
    }
}

/// "Corrige le bug de login\n…" → "Corrige le bug de login" (≤ 60 chars).
pub fn title_from_prompt(prompt: &str) -> String {
    let line = prompt.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("Nouveau thread");
    if line.chars().count() > 60 {
        format!("{}…", line.chars().take(59).collect::<String>().trim_end())
    } else {
        line.to_string()
    }
}

impl AgentRegistry {
    pub fn new(mcp: Option<(PathBuf, crate::memory::MemoryPaths)>) -> Self {
        let mut adapters: HashMap<AgentKind, Arc<dyn AgentAdapter>> = HashMap::new();
        adapters.insert(AgentKind::ClaudeCode, Arc::new(ClaudeCodeAdapter::default()));
        adapters.insert(AgentKind::Antigravity, Arc::new(AntigravityAdapter::default()));
        adapters.insert(AgentKind::Codex, Arc::new(CodexAdapter::default()));
        adapters.insert(AgentKind::Generic, Arc::new(GenericAdapter));
        Self { sessions: Mutex::new(HashMap::new()), adapters, spawn_lock: tokio::sync::Mutex::new(0), mcp }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, ActiveSession>> {
        // A poisoned map only means a panic happened while holding it; the data is still usable.
        self.sessions.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn supports(&self, agent: AgentKind) -> bool {
        self.adapters.contains_key(&agent)
    }

    pub fn is_running(&self, thread_id: &str) -> bool {
        self.lock().contains_key(thread_id)
    }

    pub fn running_ids(&self) -> Vec<String> {
        self.lock().keys().cloned().collect()
    }

    /// Send a user turn, spawning (or resuming) the session if needed.
    pub async fn send_prompt(self: &Arc<Self>, app: &AppHandle, db: &Db, thread_id: &str, text: &str) -> AppResult<()> {
        let text = text.trim().to_string();
        if text.is_empty() {
            return Err(AppError::Invalid("message vide".into()));
        }

        let runtime = {
            let id = thread_id.to_string();
            db.call(move |c| threads::runtime(c, &id)).await?
        }
        .ok_or_else(|| AppError::NotFound(format!("thread {thread_id}")))?;

        // Persist the user message first so it is never lost, even if the spawn fails.
        let first_message = {
            let (id, t, project) = (thread_id.to_string(), text.clone(), runtime.project_id.clone());
            db.call(move |c| {
                let now = now_ms();
                let first = threads::user_message_count(c, &id)? == 0;
                chat::insert_message(c, &uuid::Uuid::new_v4().to_string(), &id, "user", &t, None, now)?;
                chat::record_prompt(c, project.as_deref(), &t, now)?;
                threads::set_title_if_empty(c, &id, &title_from_prompt(&t))?;
                threads::set_status(c, &id, ThreadStatus::Starting, now)?;
                Ok(first)
            })
            .await?
        };
        // Agents without a system-prompt option get the project context in front of the first message
        // (the stored message stays what the user typed).
        let supports_system = self.adapters.get(&runtime.agent).is_some_and(|a| a.supports_system_prompt());
        let text = match (&runtime.context, first_message && !supports_system) {
            (Some(ctx), true) => crate::context::as_preamble(ctx, &text),
            _ => text,
        };
        emit(app, thread_id, AgentEvent::ThreadStatusChanged { status: ThreadStatus::Starting, detail: None });

        for attempt in 0..2 {
            let sender = self.ensure_session(app, db, &runtime).await?;
            if sender.send(SessionCommand::Prompt(text.clone())).is_ok() {
                if let Some(s) = self.lock().get_mut(thread_id) {
                    s.busy = true;
                }
                return Ok(());
            }
            // The process died between spawn and send: drop it and retry once with a fresh one.
            self.lock().remove(thread_id);
            tracing::warn!(thread = %thread_id, attempt, "session gone, respawning");
        }
        Err(AppError::Other("la session de l'agent s'est arrêtée immédiatement".into()))
    }

    async fn ensure_session(
        self: &Arc<Self>,
        app: &AppHandle,
        db: &Db,
        runtime: &ThreadRuntime,
    ) -> AppResult<mpsc::UnboundedSender<SessionCommand>> {
        let mut generation = self.spawn_lock.lock().await;
        let stale = self.lock().get(&runtime.id).map(|s| s.stale);
        match stale {
            Some(false) => {
                if let Some(s) = self.lock().get(&runtime.id) {
                    return Ok(s.commands.clone());
                }
            }
            // Settings changed since this process started: restart it, the conversation resumes.
            Some(true) => self.shutdown(&runtime.id),
            None => {}
        }
        let adapter = self
            .adapters
            .get(&runtime.agent)
            .cloned()
            .ok_or_else(|| AppError::Invalid("cet agent n'est pas encore disponible".into()))?;
        let cwd = runtime
            .cwd
            .clone()
            .map(PathBuf::from)
            .ok_or_else(|| AppError::Invalid("aucun dossier de travail pour ce thread".into()))?;
        // Generic CLIs: the chat's model is the profile id, resolved from Paramètres at each spawn.
        let generic = if runtime.agent == AgentKind::Generic {
            let wanted = runtime.model.clone().unwrap_or_default();
            db.call(|c| crate::app_settings::load(c))
                .await?
                .generic_clis
                .into_iter()
                .find(|p| p.id == wanted)
        } else {
            None
        };

        let spec = SessionSpec {
            thread_id: runtime.id.clone(),
            cwd,
            model: runtime.model.clone(),
            effort: runtime.effort.clone(),
            permission_mode: runtime.permission_mode.clone(),
            resume: runtime.session_ref.clone(),
            // Project context: system prompt when the CLI supports it (re-applied on every restart/resume).
            append_system_prompt: runtime.context.clone().filter(|_| adapter.supports_system_prompt()),
            mcp: self
                .mcp
                .as_ref()
                .map(|(exe, paths)| crate::memory::mcp::McpLaunch::new(exe.clone(), paths, runtime.agent.as_str()))
                .filter(|_| runtime.agent != AgentKind::Generic),
            generic,
        };
        let handle = adapter.start(&spec)?;
        *generation += 1;
        let gen_id = *generation;
        let commands = handle.commands.clone();
        self.lock().insert(
            runtime.id.clone(),
            ActiveSession {
                commands: handle.commands,
                pid: handle.pid,
                generation: gen_id,
                pending: HashMap::new(),
                stop_requested: false,
                shutdown_requested: false,
                stale: false,
                busy: false,
                idle_since: Instant::now(),
            },
        );
        tracing::info!(thread = %runtime.id, pid = ?handle.pid, resume = spec.resume.is_some(), "agent session started");

        let registry = Arc::clone(self);
        let (app, db, rt) = (app.clone(), db.clone(), runtime.clone());
        tauri::async_runtime::spawn(async move {
            registry.pump(app, db, rt, handle.events, gen_id).await;
        });
        Ok(commands)
    }

    pub fn respond_permission(&self, thread_id: &str, request_id: &str, allow: bool) -> AppResult<()> {
        let mut sessions = self.lock();
        let session = sessions
            .get_mut(thread_id)
            .ok_or_else(|| AppError::NotFound("aucune session active pour ce thread".into()))?;
        let input = session
            .pending
            .remove(request_id)
            .ok_or_else(|| AppError::NotFound("demande de permission expirée".into()))?;
        session
            .commands
            .send(SessionCommand::Permission(PermissionDecision {
                request_id: request_id.to_string(),
                allow,
                input,
                message: None,
            }))
            .map_err(|_| AppError::Other("la session de l'agent est arrêtée".into()))
    }

    /// Stop the current turn: interrupt, then kill the process tree if it doesn't comply in time.
    pub fn stop(self: &Arc<Self>, app: &AppHandle, db: &Db, thread_id: &str) -> AppResult<()> {
        let pid = {
            let mut sessions = self.lock();
            let Some(session) = sessions.get_mut(thread_id) else { return Ok(()) };
            session.stop_requested = true;
            // Deny pending permissions so the agent is not left waiting.
            for (request_id, input) in session.pending.drain() {
                let _ = session.commands.send(SessionCommand::Permission(PermissionDecision {
                    request_id,
                    allow: false,
                    input,
                    message: Some("Arrêt demandé par l'utilisateur.".into()),
                }));
            }
            let _ = session.commands.send(SessionCommand::Interrupt);
            session.pid
        };

        let registry = Arc::clone(self);
        let (app, db, id) = (app.clone(), db.clone(), thread_id.to_string());
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(STOP_GRACE).await;
            let still_stopping = registry.lock().get(&id).is_some_and(|s| s.stop_requested);
            if still_stopping {
                tracing::warn!(thread = %id, "interrupt ignored, killing process tree");
                if let Some(pid) = pid {
                    kill_process_tree(pid);
                }
                registry.lock().remove(&id);
                let tid = id.clone();
                let _ = db
                    .call(move |c| {
                        let now = now_ms();
                        chat::close_dangling_tools(c, &tid, now)?;
                        threads::set_status(c, &tid, ThreadStatus::Cancelled, now)
                    })
                    .await;
                emit(&app, &id, AgentEvent::ThreadStatusChanged { status: ThreadStatus::Cancelled, detail: None });
            }
        });
        Ok(())
    }

    /// The thread's settings changed: its running process (if any) restarts before the next prompt.
    pub fn mark_stale(&self, thread_id: &str) {
        if let Some(s) = self.lock().get_mut(thread_id) {
            s.stale = true;
        }
    }

    /// Terminate a thread's process (thread closed/deleted).
    pub fn shutdown(&self, thread_id: &str) {
        if let Some(mut session) = self.lock().remove(thread_id) {
            session.shutdown_requested = true;
            let _ = session.commands.send(SessionCommand::Shutdown);
            if let Some(pid) = session.pid {
                kill_process_tree(pid);
            }
        }
    }

    /// Stop sessions idle for at least `max_idle` (their chats resume on the next message). Returns their ids.
    pub fn reap_idle(&self, max_idle: Duration) -> Vec<String> {
        let ids: Vec<String> = self
            .lock()
            .iter()
            .filter(|(_, s)| !s.busy && s.pending.is_empty() && s.idle_since.elapsed() >= max_idle)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &ids {
            tracing::info!(thread = %id, "idle agent session stopped");
            self.shutdown(id);
        }
        ids
    }

    /// App exit: kill every agent process.
    pub fn shutdown_all(&self) {
        let sessions: Vec<ActiveSession> = self.lock().drain().map(|(_, s)| s).collect();
        for session in sessions {
            let _ = session.commands.send(SessionCommand::Shutdown);
            if let Some(pid) = session.pid {
                kill_process_tree(pid);
            }
        }
    }

    fn take_flags(&self, thread_id: &str, generation: u64) -> (bool, bool) {
        let mut sessions = self.lock();
        match sessions.get_mut(thread_id) {
            Some(s) if s.generation == generation => {
                let flags = (s.stop_requested, s.shutdown_requested);
                s.stop_requested = false;
                flags
            }
            _ => (false, true),
        }
    }

    async fn pump(
        self: Arc<Self>,
        app: AppHandle,
        db: Db,
        rt: ThreadRuntime,
        mut events: mpsc::UnboundedReceiver<AdapterEvent>,
        generation: u64,
    ) {
        let id = rt.id.clone();
        let mut model = rt.model.clone();
        let mut cumulative = {
            let tid = id.clone();
            db.call(move |c| chat::thread_usage(c, &tid)).await.unwrap_or_default()
        };
        let mut last_status: Option<(ThreadStatus, Option<String>)> = None;

        macro_rules! persist {
            ($body:expr) => {{
                if let Err(err) = db.call($body).await {
                    tracing::warn!(thread = %id, %err, "persist failed");
                }
            }};
        }

        let set_status = |status: ThreadStatus, detail: Option<String>, last: &mut Option<(ThreadStatus, Option<String>)>| {
            let changed = last.as_ref() != Some(&(status, detail.clone()));
            let status_changed = last.as_ref().map(|(s, _)| *s) != Some(status);
            *last = Some((status, detail.clone()));
            (changed, status_changed, detail)
        };

        while let Some(event) = events.recv().await {
            match event {
                AdapterEvent::SessionInit { session_ref, model: m } => {
                    if model.is_none() {
                        model = m.clone();
                    }
                    let tid = id.clone();
                    persist!(move |c| threads::set_session(c, &tid, &session_ref, m.as_deref()));
                }
                AdapterEvent::Status { status, detail } => {
                    let (changed, status_changed, detail) = set_status(status, detail, &mut last_status);
                    if status_changed {
                        let tid = id.clone();
                        persist!(move |c| threads::set_status(c, &tid, status, now_ms()));
                    }
                    if changed {
                        emit(&app, &id, AgentEvent::ThreadStatusChanged { status, detail });
                    }
                }
                AdapterEvent::TextDelta { item_id, channel, text } => {
                    emit(&app, &id, AgentEvent::MessageDelta { message_id: item_id, channel, text });
                }
                AdapterEvent::BlockCompleted { item_id, channel, text } => {
                    let role = match channel {
                        crate::agents::events::DeltaChannel::Text => "assistant",
                        crate::agents::events::DeltaChannel::Thinking => "thinking",
                    };
                    let (tid, mid) = (id.clone(), item_id.clone());
                    persist!(move |c| chat::insert_message(c, &mid, &tid, role, &text, None, now_ms()));
                    emit(&app, &id, AgentEvent::MessageCompleted { message_id: item_id });
                }
                AdapterEvent::ToolCallStart { id: tool_id, name, input, parent_id } => {
                    let (status, detail) = tool_activity(&name, &input);
                    {
                        let (tid, tool, n, inp) = (id.clone(), tool_id.clone(), name.clone(), input.clone());
                        persist!(move |c| chat::insert_tool_call(c, &tool, &tid, &n, &inp, now_ms()));
                    }
                    emit(
                        &app,
                        &id,
                        AgentEvent::ToolCallStart {
                            tool_call_id: tool_id,
                            name,
                            input,
                            activity: detail.clone(),
                            parent_tool_call_id: parent_id,
                        },
                    );
                    let (changed, status_changed, detail) = set_status(status, detail, &mut last_status);
                    if status_changed {
                        let tid = id.clone();
                        persist!(move |c| threads::set_status(c, &tid, status, now_ms()));
                    }
                    if changed {
                        emit(&app, &id, AgentEvent::ThreadStatusChanged { status, detail });
                    }
                }
                AdapterEvent::ToolCallResult { id: tool_id, output, is_error } => {
                    let status = if is_error { ToolStatus::Error } else { ToolStatus::Ok };
                    {
                        let (tool, out) = (tool_id.clone(), output.clone());
                        persist!(move |c| chat::finish_tool_call(c, &tool, &out, status, now_ms()));
                    }
                    emit(&app, &id, AgentEvent::ToolCallResult { tool_call_id: tool_id, output, is_error });
                }
                AdapterEvent::PermissionRequest { request_id, tool_name, description, input, .. } => {
                    if let Some(s) = self.lock().get_mut(&id) {
                        s.pending.insert(request_id.clone(), input.clone());
                    }
                    let detail = Some(tool_name.clone());
                    let (_, status_changed, detail) = set_status(ThreadStatus::AwaitingApproval, detail, &mut last_status);
                    if status_changed {
                        let tid = id.clone();
                        persist!(move |c| threads::set_status(c, &tid, ThreadStatus::AwaitingApproval, now_ms()));
                    }
                    emit(&app, &id, AgentEvent::PermissionRequest { request_id, tool_name, description, input });
                    emit(
                        &app,
                        &id,
                        AgentEvent::ThreadStatusChanged { status: ThreadStatus::AwaitingApproval, detail },
                    );
                }
                AdapterEvent::TurnComplete { usage, duration_ms, error } => {
                    let (stopped, _) = self.take_flags(&id, generation);
                    if let Some(s) = self.lock().get_mut(&id).filter(|s| s.generation == generation) {
                        s.busy = false;
                        s.idle_since = Instant::now();
                    }
                    cumulative.add(&usage);
                    {
                        let (tid, project, m, agent) = (id.clone(), rt.project_id.clone(), model.clone(), rt.agent);
                        let err = error.clone().filter(|_| !stopped);
                        persist!(move |c| {
                            let now = now_ms();
                            record_usage(c, &tid, project.as_deref(), agent, m.as_deref(), &usage, now)?;
                            if let Some(message) = &err {
                                chat::insert_message(c, &uuid::Uuid::new_v4().to_string(), &tid, "error", message, None, now)?;
                            }
                            chat::insert_message(
                                c,
                                &uuid::Uuid::new_v4().to_string(),
                                &tid,
                                "turn",
                                "",
                                Some(&json!({ "usage": usage, "durationMs": duration_ms })),
                                now,
                            )?;
                            chat::close_dangling_tools(c, &tid, now)
                        });
                    }
                    emit(&app, &id, AgentEvent::TokenUsageUpdate { delta: usage, cumulative });
                    let status = if stopped {
                        ThreadStatus::Cancelled
                    } else if let Some(message) = error {
                        emit(&app, &id, AgentEvent::ThreadError { message, fatal: false });
                        ThreadStatus::Error
                    } else {
                        ThreadStatus::Done
                    };
                    last_status = Some((status, None));
                    let tid = id.clone();
                    persist!(move |c| threads::set_status(c, &tid, status, now_ms()));
                    emit(&app, &id, AgentEvent::ThreadStatusChanged { status, detail: None });
                }
                AdapterEvent::RateLimits(windows) => {
                    if rt.agent == AgentKind::ClaudeCode {
                        let value = json!({
                            "updatedAt": now_ms(),
                            "windows": windows.iter().map(|w| json!({
                                "window": w.window, "utilization": w.utilization, "resetsAt": w.resets_at
                            })).collect::<Vec<_>>(),
                        });
                        persist!(move |c| settings::set(c, settings::CLAUDE_RATE_LIMITS, &value));
                    }
                }
                AdapterEvent::Subagent { tool_call_id, description, subagent_type, status, tool_uses, tokens, last_tool } => {
                    emit(
                        &app,
                        &id,
                        AgentEvent::SubagentUpdate {
                            tool_call_id,
                            description,
                            subagent_type,
                            status,
                            tool_uses,
                            tokens,
                            last_tool,
                        },
                    );
                }
                AdapterEvent::Warning(w) => tracing::debug!(thread = %id, "{w}"),
                AdapterEvent::Exited { code, stderr_tail } => {
                    let (stopped, shutdown) = {
                        let mut sessions = self.lock();
                        let flags = match sessions.get(&id) {
                            Some(s) if s.generation == generation => (s.stop_requested, s.shutdown_requested),
                            _ => (false, true),
                        };
                        if sessions.get(&id).is_some_and(|s| s.generation == generation) {
                            sessions.remove(&id);
                        }
                        flags
                    };
                    let was_active = last_status.as_ref().is_some_and(|(s, _)| s.is_active());
                    tracing::info!(thread = %id, ?code, was_active, "agent session exited");
                    if was_active && stopped && !shutdown {
                        // Stop on an agent without an interrupt message = kill: that's a cancellation.
                        let tid = id.clone();
                        persist!(move |c| {
                            let now = now_ms();
                            chat::close_dangling_tools(c, &tid, now)?;
                            threads::set_status(c, &tid, ThreadStatus::Cancelled, now)
                        });
                        emit(&app, &id, AgentEvent::ThreadStatusChanged { status: ThreadStatus::Cancelled, detail: None });
                    } else if was_active && !shutdown {
                        let tail = stderr_tail.trim();
                        let message = if tail.is_empty() {
                            format!("Le processus de l'agent s'est arrêté (code {}).", code.map_or("?".into(), |c| c.to_string()))
                        } else {
                            format!("Le processus de l'agent s'est arrêté : {}", tail.lines().last().unwrap_or(tail))
                        };
                        {
                            let (tid, m) = (id.clone(), message.clone());
                            persist!(move |c| {
                                let now = now_ms();
                                chat::insert_message(c, &uuid::Uuid::new_v4().to_string(), &tid, "error", &m, None, now)?;
                                chat::close_dangling_tools(c, &tid, now)?;
                                threads::set_status(c, &tid, ThreadStatus::Error, now)
                            });
                        }
                        emit(&app, &id, AgentEvent::ThreadError { message, fatal: true });
                        emit(&app, &id, AgentEvent::ThreadStatusChanged { status: ThreadStatus::Error, detail: None });
                    }
                    break;
                }
            }
        }
    }
}

fn record_usage(
    c: &rusqlite::Connection,
    thread_id: &str,
    project_id: Option<&str>,
    agent: AgentKind,
    model: Option<&str>,
    u: &TokenUsage,
    ts: i64,
) -> AppResult<()> {
    c.execute(
        "INSERT INTO token_usage (thread_id, project_id, agent, model, input_tokens, output_tokens,
                                  cache_read_tokens, cache_write_tokens, cost_usd, ts)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            thread_id,
            project_id,
            agent,
            model,
            u.input as i64,
            u.output as i64,
            u.cache_read as i64,
            u.cache_write as i64,
            u.cost_usd,
            ts
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles() {
        assert_eq!(title_from_prompt("\n  Corrige le bug\nde login"), "Corrige le bug");
        assert_eq!(title_from_prompt("   "), "Nouveau thread");
        let long = "a".repeat(80);
        assert_eq!(title_from_prompt(&long).chars().count(), 60);
    }
}

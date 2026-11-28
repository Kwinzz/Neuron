//! Running agent sessions (one per thread) and their event pumps.
//!
//! Each session runs in background tasks: opening another thread or switching project never blocks or
//! stops a running one. The pump persists adapter events to SQLite and emits normalized events.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::agents::access;
use crate::agents::activity::tool_activity;
use crate::agents::antigravity::AntigravityAdapter;
use crate::agents::claude::ClaudeCodeAdapter;
use crate::agents::codex::CodexAdapter;
use crate::agents::events::{
    AGENT_EVENT_CHANNEL, AgentEvent, AgentEventEnvelope, AgentKind, SubagentSource, SubagentStatus, ThreadStatus,
    TokenUsage,
};
use crate::agents::generic::GenericAdapter;
use crate::agents::subagents::{self, ProcAgent, SubagentTracker, TrackerUpdate};
use crate::agents::{
    AdapterEvent, AgentAdapter, PermissionDecision, SessionCommand, SessionSpec, TurnPid, kill_process_tree,
};
use crate::db::Db;
use crate::db::chat::{self, ToolStatus};
use crate::db::threads::{self, ThreadRuntime};
use crate::error::{AppError, AppResult};
use crate::events::{self, EventSink};
use crate::state::Shared;
use crate::util::now_ms;

/// How long a stop request may take before the process tree is killed.
const STOP_GRACE: Duration = Duration::from_secs(5);

struct ActiveSession {
    commands: mpsc::UnboundedSender<SessionCommand>,
    pid: Option<u32>,
    /// Current per-turn process (Codex, generic CLIs).
    turn_pid: Option<TurnPid>,
    /// Agent CLIs this session started (commands, process tree).
    subagents: SubagentTracker,
    /// Unique per spawn, so a late `Exited` from an old process never removes a newer session.
    generation: u64,
    /// Pending permission requests: request id → (tool name, tool input echoed back on allow).
    pending: HashMap<String, (String, Value)>,
    /// Events Neuron itself feeds into the pump, in order with the CLI's (status after an approval).
    inject: mpsc::UnboundedSender<AdapterEvent>,
    stop_requested: bool,
    shutdown_requested: bool,
    /// Model/effort/permissions changed: restart (with --resume) before the next prompt.
    stale: bool,
    /// A turn is in progress (from the prompt until TurnComplete).
    busy: bool,
    /// When the current turn's first prompt was sent (total time shown under the turn).
    turn_started: Option<Instant>,
    /// Last time the session became idle (idle-shutdown reaper).
    idle_since: Instant,
    /// Cross-device workspace target when this session operates on another paired device.
    workspace: Option<crate::db::threads::WorkspaceRuntime>,
    /// Current permission mode (kept in sync for remote MCP `read_only` enforcement).
    permission_mode: String,
    /// Unified diffs returned by remote `Write`/`Edit` tool calls, drained when `ToolCallResult` arrives.
    remote_changes: Vec<crate::agents::file_changes::FileChange>,
}

pub struct AgentRegistry {
    sessions: Mutex<HashMap<String, ActiveSession>>,
    adapters: HashMap<AgentKind, Arc<dyn AgentAdapter>>,
    /// Serializes session spawning (avoids double spawn on fast double-send).
    spawn_lock: tokio::sync::Mutex<u64>,
    /// Chats stopped while their process was still being started: their prompt is never sent.
    pending_stops: Mutex<std::collections::HashSet<String>>,
    /// Neuron executable + memory paths: every session gets the memory MCP server (None in tests).
    mcp: Option<(PathBuf, crate::memory::MemoryPaths)>,
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new(None)
    }
}

/// Run an Antigravity local command (`/quota`…) for a chat: its output becomes a command card.
async fn run_agy_command(
    events: Arc<dyn EventSink>,
    db: Db,
    rt: ThreadRuntime,
    name: &'static str,
    track_status: bool,
) {
    use crate::agents::antigravity::quota;
    let cwd = rt.cwd.as_deref().map(PathBuf::from).filter(|p| p.is_dir()).unwrap_or_else(std::env::temp_dir);
    let id = rt.id.clone();
    let (outcome, windows) = match quota::run(name, &cwd).await {
        Ok(result) => {
            let windows = if name == "credits" { Vec::new() } else { quota::windows(&result) };
            (Ok(quota::render(name, &result, now_ms())), windows)
        }
        Err(err) => (Err(err.to_string()), Vec::new()),
    };
    quota::store(&db, events.as_ref(), windows).await;
    let status = if outcome.is_ok() { ThreadStatus::Done } else { ThreadStatus::Error };
    let item_id = uuid::Uuid::new_v4().to_string();
    let saved = {
        let (tid, mid, outcome) = (id.clone(), item_id.clone(), outcome.clone());
        db.call(move |c| {
            let now = now_ms();
            match &outcome {
                Ok(text) => chat::insert_message(c, &mid, &tid, "command", text, Some(&json!({ "name": name })), now)?,
                Err(message) => {
                    let meta = access::error_meta(access::classify_error(message));
                    chat::insert_message(c, &mid, &tid, "error", message, meta.as_ref(), now)?
                }
            }
            if track_status {
                threads::set_status(c, &tid, status, now)?;
            }
            Ok(())
        })
        .await
    };
    if let Err(err) = saved {
        tracing::warn!(thread = %id, %err, "agy command not saved");
    }
    match outcome {
        Ok(text) => {
            emit(events.as_ref(), &id, AgentEvent::CommandOutput { message_id: item_id, name: name.to_string(), text })
        }
        Err(message) => {
            let issue = access::classify_error(&message);
            emit(events.as_ref(), &id, AgentEvent::ThreadError { message, fatal: false, issue })
        }
    }
    if track_status {
        emit(events.as_ref(), &id, AgentEvent::ThreadStatusChanged { status, detail: None });
    }
}

pub(crate) fn emit_event(events: &dyn EventSink, thread_id: &str, event: AgentEvent) {
    emit(events, thread_id, event);
}

/// A sub-agent event for an agent CLI started by the chat's agent (fields not given: unknown / unchanged).
fn cli_subagent_event(tool_call_id: String, status: SubagentStatus, source: SubagentSource) -> AgentEvent {
    AgentEvent::SubagentUpdate {
        tool_call_id,
        description: None,
        subagent_type: None,
        status,
        tool_uses: None,
        tokens: None,
        last_tool: None,
        source,
        agent: None,
        command: None,
        pid: None,
        output: None,
        parent_tool_call_id: None,
    }
}

/// Emit finished updates for any sub-agents still tracked when a turn ends or a chat stops / exits.
fn finish_subagents(
    events: &dyn EventSink,
    thread_id: &str,
    entries: Vec<(String, SubagentSource)>,
    status: SubagentStatus,
) {
    for (id, source) in entries {
        emit(events, thread_id, cli_subagent_event(id, status, source));
    }
}

/// Command lines shown in the UI are cut to this many characters.
const COMMAND_SHOWN: usize = 400;

fn shorten(text: &str) -> String {
    if text.chars().count() <= COMMAND_SHOWN {
        return text.to_string();
    }
    format!("{}…", text.chars().take(COMMAND_SHOWN - 1).collect::<String>())
}

fn emit(events: &dyn EventSink, thread_id: &str, event: AgentEvent) {
    let envelope = AgentEventEnvelope { thread_id: thread_id.to_string(), ts: now_ms(), event };
    events::emit(events, AGENT_EVENT_CHANNEL, &envelope);
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

/// Root of the chat's project (its working directory), when the chat belongs to one.
fn project_root(runtime: &ThreadRuntime) -> Option<&std::path::Path> {
    runtime.project_id.as_ref().and(runtime.cwd.as_deref()).map(std::path::Path::new)
}

impl AgentRegistry {
    /// What the agent is told about Neuron (memory, project context, remote workspace). None for generic CLIs.
    fn intro(&self, runtime: &ThreadRuntime) -> Option<String> {
        if runtime.agent == AgentKind::Generic {
            return None;
        }
        let memory_file = self.mcp.as_ref().map(|(_, paths)| paths.file_path.as_path());
        Some(crate::context::neuron_intro(
            memory_file,
            project_root(runtime),
            runtime.workspace.as_ref().map(|w| &w.target),
        ))
    }

    pub fn new(mcp: Option<(PathBuf, crate::memory::MemoryPaths)>) -> Self {
        let mut adapters: HashMap<AgentKind, Arc<dyn AgentAdapter>> = HashMap::new();
        adapters.insert(AgentKind::ClaudeCode, Arc::new(ClaudeCodeAdapter::default()));
        adapters.insert(AgentKind::Antigravity, Arc::new(AntigravityAdapter::default()));
        adapters.insert(AgentKind::Codex, Arc::new(CodexAdapter::default()));
        adapters.insert(AgentKind::Generic, Arc::new(GenericAdapter));
        Self {
            sessions: Mutex::new(HashMap::new()),
            adapters,
            spawn_lock: tokio::sync::Mutex::new(0),
            pending_stops: Mutex::new(std::collections::HashSet::new()),
            mcp,
        }
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

    /// Active cross-device workspace target + permission mode for a running thread (used by `control.rs`).
    pub fn active_workspace(&self, thread_id: &str) -> Option<(crate::db::threads::WorkspaceRuntime, String)> {
        self.lock().get(thread_id).and_then(|s| s.workspace.clone().map(|ws| (ws, s.permission_mode.clone())))
    }

    /// Records a diff produced on a remote target device so the pump attaches it to the matching `ToolCallResult`.
    pub fn push_remote_change(&self, thread_id: &str, change: crate::agents::file_changes::FileChange) {
        if let Some(s) = self.lock().get_mut(thread_id) {
            s.remote_changes.push(change);
        }
    }

    fn take_remote_changes(
        &self,
        thread_id: &str,
        hint_path: Option<&str>,
    ) -> Vec<crate::agents::file_changes::FileChange> {
        let mut sessions = self.lock();
        let Some(s) = sessions.get_mut(thread_id) else { return Vec::new() };
        if s.remote_changes.is_empty() {
            return Vec::new();
        }
        if let Some(hint) = hint_path {
            let norm = hint.replace('\\', "/");
            if let Some(pos) = s.remote_changes.iter().position(|c| c.path == norm || norm.ends_with(&c.path)) {
                return vec![s.remote_changes.remove(pos)];
            }
        }
        vec![s.remote_changes.remove(0)]
    }

    /// Send a user turn, spawning (or resuming) the session if needed.
    pub async fn send_prompt(
        self: &Arc<Self>,
        state: &Shared,
        thread_id: &str,
        text: &str,
        attachments: Vec<crate::attachments::Attachment>,
    ) -> AppResult<()> {
        let db = &state.db;
        let sink = state.events.as_ref();
        let text = text.trim().to_string();
        if text.is_empty() && attachments.is_empty() {
            return Err(AppError::Invalid(crate::tr!("message vide", "empty message")));
        }

        let runtime = {
            let id = thread_id.to_string();
            db.call(move |c| threads::runtime(c, &id)).await?
        }
        .ok_or_else(|| AppError::NotFound(format!("thread {thread_id}")))?;

        // Antigravity /quota, /usage, /credits: answered by a separate `agy --print` (refused in a session).
        let local = (runtime.agent == AgentKind::Antigravity && attachments.is_empty())
            .then(|| crate::agents::antigravity::quota::local_command(&text))
            .flatten();
        // A command typed while the agent works must not touch the turn's status.
        let busy = self.lock().get(thread_id).is_some_and(|s| s.busy);
        let track_status = local.is_none() || !busy;

        // Persist the user message first so it is never lost, even if the spawn fails.
        let message_id = uuid::Uuid::new_v4().to_string();
        let first_message = {
            let (id, mid, t, project) =
                (thread_id.to_string(), message_id.clone(), text.clone(), runtime.project_id.clone());
            let meta = (!attachments.is_empty()).then(|| json!({ "attachments": attachments }));
            let first_name = attachments.first().map(|a| a.name.clone());
            db.call(move |c| {
                let now = now_ms();
                let first = threads::user_message_count(c, &id)? == 0;
                chat::insert_message(c, &mid, &id, "user", &t, meta.as_ref(), now)?;
                if !t.is_empty() {
                    chat::record_prompt(c, project.as_deref(), &t, now)?;
                }
                let title = match (&t, first_name) {
                    (t, Some(name)) if t.is_empty() => name,
                    (t, _) => title_from_prompt(t),
                };
                threads::set_title_if_empty(c, &id, &title)?;
                if track_status {
                    threads::set_status(c, &id, ThreadStatus::Starting, now)?;
                }
                Ok(first)
            })
            .await?
        };
        emit(
            sink,
            thread_id,
            AgentEvent::UserMessage { message_id, text: text.clone(), attachments: attachments.clone() },
        );
        if let Some(name) = local {
            if track_status {
                emit(sink, thread_id, AgentEvent::ThreadStatusChanged { status: ThreadStatus::Starting, detail: None });
            }
            let (events, db, runtime) = (Arc::clone(&state.events), db.clone(), runtime.clone());
            tauri::async_runtime::spawn(async move { run_agy_command(events, db, runtime, name, track_status).await });
            return Ok(());
        }
        // Agents without a system-prompt option get the Neuron intro + project context in front of the first
        // message (the stored message stays what the user typed).
        let supports_system = self.adapters.get(&runtime.agent).is_some_and(|a| a.supports_system_prompt());
        let text = if first_message && !supports_system {
            match (self.intro(&runtime), runtime.context.as_deref()) {
                (Some(intro), ctx) => {
                    crate::context::as_preamble(&crate::context::session_instructions(&intro, ctx), &text)
                }
                (None, Some(ctx)) => crate::context::as_preamble(ctx, &text),
                (None, None) => text,
            }
        } else if !supports_system && runtime.agent != AgentKind::Generic {
            // They only saw the intro once: keep the end-of-answer summary line alive.
            format!("{text}\n\n{}", crate::context::summary_reminder())
        } else {
            text
        };
        emit(sink, thread_id, AgentEvent::ThreadStatusChanged { status: ThreadStatus::Starting, detail: None });
        // A stop from before this message must not cancel it.
        self.pending_stops.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(thread_id);

        for attempt in 0..2 {
            let sender = match self.ensure_session(state, &runtime).await {
                Ok(sender) => sender,
                // CLI missing: a chat error with the « Installer » action rather than a failed send.
                Err(err @ AppError::AgentNotInstalled(_)) => {
                    let message = err.to_string();
                    let issue = Some(access::AccessIssue::NotInstalled);
                    let (tid, m) = (thread_id.to_string(), message.clone());
                    db.call(move |c| {
                        let now = now_ms();
                        let meta = access::error_meta(issue);
                        chat::insert_message(
                            c,
                            &uuid::Uuid::new_v4().to_string(),
                            &tid,
                            "error",
                            &m,
                            meta.as_ref(),
                            now,
                        )?;
                        threads::set_status(c, &tid, ThreadStatus::Error, now)
                    })
                    .await?;
                    emit(sink, thread_id, AgentEvent::ThreadError { message, fatal: false, issue });
                    emit(
                        sink,
                        thread_id,
                        AgentEvent::ThreadStatusChanged { status: ThreadStatus::Error, detail: None },
                    );
                    return Ok(());
                }
                Err(err) => return Err(err),
            };
            // Stopped while the process was starting: keep it (the next message reuses it) but never send this one.
            if self.pending_stops.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(thread_id) {
                tracing::info!(thread = %thread_id, "prompt dropped: stopped while the agent was starting");
                return Ok(());
            }
            let turn = crate::agents::UserTurn { text: text.clone(), attachments: attachments.clone() };
            if sender.send(SessionCommand::Prompt(turn)).is_ok() {
                if let Some(s) = self.lock().get_mut(thread_id) {
                    if !s.busy {
                        s.turn_started = Some(Instant::now());
                    }
                    s.busy = true;
                }
                return Ok(());
            }
            // The process died between spawn and send: drop it and retry once with a fresh one.
            self.lock().remove(thread_id);
            tracing::warn!(thread = %thread_id, attempt, "session gone, respawning");
        }
        Err(AppError::Other(crate::tr!(
            "la session de l'agent s'est arrêtée immédiatement",
            "the agent session stopped right away"
        )))
    }

    async fn ensure_session(
        self: &Arc<Self>,
        state: &Shared,
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
        let adapter = self.adapters.get(&runtime.agent).cloned().ok_or_else(|| {
            AppError::Invalid(crate::tr!("cet agent n'est pas encore disponible", "this agent is not available yet"))
        })?;
        let mut cwd = runtime.cwd.clone().map(PathBuf::from).ok_or_else(|| {
            AppError::Invalid(crate::tr!("aucun dossier de travail pour ce thread", "no working folder for this chat"))
        })?;
        // Cross-device workspace: always isolate the CLI process in an empty local scratch folder.
        let remote_mcp = if runtime.workspace.is_some() {
            let scratch = state.paths.data_dir.join("remote-scratch").join(&runtime.id);
            std::fs::create_dir_all(&scratch)?;
            cwd = scratch;
            let exe = self
                .mcp
                .as_ref()
                .map(|(exe, _)| exe.clone())
                .or_else(|| crate::util::neuron_exe().ok())
                .ok_or_else(|| AppError::Other("neuron executable path unavailable".into()))?;
            Some(crate::remote::mcp::RemoteMcpLaunch::new(exe, &state.paths.data_dir, &runtime.id))
        } else {
            None
        };
        // Generic CLIs: the chat's model is the profile id, resolved from Paramètres at each spawn.
        let generic = if runtime.agent == AgentKind::Generic {
            let wanted = runtime.model.clone().unwrap_or_default();
            state.db.call(|c| crate::app_settings::load(c)).await?.generic_clis.into_iter().find(|p| p.id == wanted)
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
            // Neuron intro + project context: system prompt when the CLI supports it (re-applied on every
            // restart/resume).
            append_system_prompt: if adapter.supports_system_prompt() {
                match self.intro(runtime) {
                    Some(intro) => Some(crate::context::session_instructions(&intro, runtime.context.as_deref())),
                    None => runtime.context.clone(),
                }
            } else {
                None
            },
            mcp: self
                .mcp
                .as_ref()
                .map(|(exe, paths)| {
                    crate::memory::mcp::McpLaunch::new(
                        exe.clone(),
                        paths,
                        runtime.agent.as_str(),
                        project_root(runtime),
                    )
                })
                .filter(|_| runtime.agent != AgentKind::Generic),
            remote_mcp,
            generic,
        };
        let handle = adapter.start(&spec)?;
        *generation += 1;
        let gen_id = *generation;
        let commands = handle.commands.clone();
        let (inject, injected) = mpsc::unbounded_channel();
        self.lock().insert(
            runtime.id.clone(),
            ActiveSession {
                commands: handle.commands,
                pid: handle.pid,
                turn_pid: handle.turn_pid,
                subagents: SubagentTracker::default(),
                generation: gen_id,
                pending: HashMap::new(),
                inject,
                stop_requested: false,
                shutdown_requested: false,
                stale: false,
                busy: false,
                turn_started: None,
                idle_since: Instant::now(),
                workspace: runtime.workspace.clone(),
                permission_mode: runtime.permission_mode.clone(),
                remote_changes: Vec::new(),
            },
        );
        tracing::info!(thread = %runtime.id, pid = ?handle.pid, resume = spec.resume.is_some(), "agent session started");

        let registry = Arc::clone(self);
        let (state, rt) = (Arc::clone(state), runtime.clone());
        tauri::async_runtime::spawn(async move {
            registry.pump(state, rt, handle.events, injected, gen_id).await;
        });
        Ok(commands)
    }

    /// `answers`: replies to Claude's `AskUserQuestion` (question text → chosen label(s) or custom text), added to
    /// the tool input on allow — that is how Claude Code receives them.
    pub fn respond_permission(
        &self,
        thread_id: &str,
        request_id: &str,
        allow: bool,
        mode: Option<String>,
        answers: Option<HashMap<String, String>>,
    ) -> AppResult<()> {
        let mut sessions = self.lock();
        let session = sessions.get_mut(thread_id).ok_or_else(|| {
            AppError::NotFound(crate::tr!("aucune session active pour ce thread", "no active session for this chat"))
        })?;
        let (tool_name, mut input) = session.pending.remove(request_id).ok_or_else(|| {
            AppError::NotFound(crate::tr!("demande de permission expirée", "permission request expired"))
        })?;
        // Answered: the chat no longer waits on the user (the approved tool may run for a long time before the
        // CLI reports anything else). Other cards still pending keep it waiting.
        let resumed = session
            .pending
            .is_empty()
            .then(|| if allow { tool_activity(&tool_name, &input) } else { (ThreadStatus::Thinking, None) });
        if let (true, Some(answers), Some(obj)) = (allow, answers, input.as_object_mut()) {
            obj.insert("answers".into(), json!(answers));
        }
        session
            .commands
            .send(SessionCommand::Permission(PermissionDecision {
                request_id: request_id.to_string(),
                allow,
                input,
                // Plan refused from the plan card (a mode was offered): keep planning.
                message: (!allow && mode.is_some()).then(|| {
                    crate::tr!(
                        "L'utilisateur veut continuer à planifier : reste en mode Plan et attends ses précisions.",
                        "The user wants to keep planning: stay in Plan mode and wait for their details."
                    )
                }),
                mode: mode.filter(|_| allow),
            }))
            .map_err(|_| {
                AppError::Other(crate::tr!("la session de l'agent est arrêtée", "the agent session is stopped"))
            })?;
        if let Some((status, detail)) = resumed {
            let _ = session.inject.send(AdapterEvent::Status { status, detail });
        }
        Ok(())
    }

    /// Switch a running Claude Code session's permission mode without restarting it. False when there is no
    /// live session that can do it (the caller then restarts it with the new mode).
    pub fn set_mode_live(&self, thread_id: &str, agent: AgentKind, mode: &str) -> bool {
        if agent != AgentKind::ClaudeCode {
            return false;
        }
        let mut sessions = self.lock();
        match sessions.get_mut(thread_id) {
            // Cross-device chats compute `--allowedTools` from permission_mode at spawn: restart cleanly on mode switch.
            Some(s)
                if !s.stale
                    && s.workspace.is_none()
                    && s.commands.send(SessionCommand::SetMode(mode.to_string())).is_ok() =>
            {
                s.permission_mode = mode.to_string();
                true
            }
            _ => false,
        }
    }

    /// Stop the current turn: interrupt, then kill the process tree if it doesn't comply in time.
    pub fn stop(self: &Arc<Self>, events: &Arc<dyn EventSink>, db: &Db, thread_id: &str) -> AppResult<()> {
        let pid = {
            let mut sessions = self.lock();
            let Some(session) = sessions.get_mut(thread_id) else {
                // No process yet (still starting): remember the stop and end the turn now.
                drop(sessions);
                self.pending_stops
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .insert(thread_id.to_string());
                let (db, id, events) = (db.clone(), thread_id.to_string(), Arc::clone(events));
                tauri::async_runtime::spawn(async move {
                    let tid = id.clone();
                    let _ = db
                        .call(move |c| {
                            let now = now_ms();
                            chat::close_dangling_tools(c, &tid, now)?;
                            threads::set_status(c, &tid, ThreadStatus::Cancelled, now)
                        })
                        .await;
                    emit(
                        events.as_ref(),
                        &id,
                        AgentEvent::ThreadStatusChanged { status: ThreadStatus::Cancelled, detail: None },
                    );
                });
                return Ok(());
            };
            session.stop_requested = true;
            // Deny pending permissions so the agent is not left waiting.
            for (request_id, (_, input)) in session.pending.drain() {
                let _ = session.commands.send(SessionCommand::Permission(PermissionDecision {
                    request_id,
                    allow: false,
                    input,
                    message: Some(crate::tr!("Arrêt demandé par l'utilisateur.", "Stop requested by the user.")),
                    mode: None,
                }));
            }
            let _ = session.commands.send(SessionCommand::Interrupt);
            session.pid
        };

        let registry = Arc::clone(self);
        let (events, db, id) = (Arc::clone(events), db.clone(), thread_id.to_string());
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(STOP_GRACE).await;
            let still_stopping = registry.lock().get(&id).is_some_and(|s| s.stop_requested);
            if still_stopping {
                tracing::warn!(thread = %id, "interrupt ignored, killing process tree");
                if let Some(pid) = pid {
                    kill_process_tree(pid);
                }
                let dangling = registry.lock().remove(&id).map(|mut s| s.subagents.finish_all()).unwrap_or_default();
                let tid = id.clone();
                let _ = db
                    .call(move |c| {
                        let now = now_ms();
                        chat::close_dangling_tools(c, &tid, now)?;
                        threads::set_status(c, &tid, ThreadStatus::Cancelled, now)
                    })
                    .await;
                finish_subagents(events.as_ref(), &id, dangling, SubagentStatus::Failed);
                emit(
                    events.as_ref(),
                    &id,
                    AgentEvent::ThreadStatusChanged { status: ThreadStatus::Cancelled, detail: None },
                );
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

    /// Process ids under which each running session's sub-agents are looked for: `(thread, pids)`.
    pub fn process_roots(&self) -> Vec<(String, Vec<u32>)> {
        self.lock()
            .iter()
            .filter_map(|(id, s)| {
                let mut pids: Vec<u32> = s.pid.into_iter().collect();
                if let Some(turn) = &s.turn_pid {
                    let pid = turn.load(std::sync::atomic::Ordering::Relaxed);
                    if pid != 0 {
                        pids.push(pid);
                    }
                }
                (!pids.is_empty()).then(|| (id.clone(), pids))
            })
            .collect()
    }

    /// Agent processes found under each session (`proc_watch`): started / ended sub-agents are emitted.
    pub fn update_process_subagents(&self, events: &dyn EventSink, found: Vec<(String, Vec<ProcAgent>)>) {
        let now = Instant::now();
        let mut updates = Vec::new();
        {
            let mut sessions = self.lock();
            for (thread, agents) in &found {
                if let Some(session) = sessions.get_mut(thread) {
                    updates.extend(session.subagents.processes(agents, now).into_iter().map(|u| (thread.clone(), u)));
                }
            }
        }
        for (thread, update) in updates {
            let event = match update {
                TrackerUpdate::Started { id, agent, merged } => {
                    let source = if merged { SubagentSource::Command } else { SubagentSource::Process };
                    let mut event = cli_subagent_event(id, SubagentStatus::Running, source);
                    if let AgentEvent::SubagentUpdate { agent: a, command, pid, .. } = &mut event {
                        *a = Some(agent.key.to_string());
                        *pid = Some(agent.pid);
                        // A merged sub-agent keeps the command the agent wrote (more readable).
                        if !merged {
                            *command = Some(shorten(&agent.command));
                        }
                    }
                    event
                }
                TrackerUpdate::Ended { id, source } => cli_subagent_event(id, SubagentStatus::Completed, source),
            };
            emit(events, &thread, event);
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
        state: Shared,
        rt: ThreadRuntime,
        mut events: mpsc::UnboundedReceiver<AdapterEvent>,
        mut injected: mpsc::UnboundedReceiver<AdapterEvent>,
        generation: u64,
    ) {
        let db = &state.db;
        let sink = state.events.as_ref();
        let id = rt.id.clone();
        let mut model = rt.model.clone();
        let mut cumulative = {
            let tid = id.clone();
            db.call(move |c| chat::thread_usage(c, &tid)).await.unwrap_or_default()
        };
        let mut last_status: Option<(ThreadStatus, Option<String>)> = None;
        // The current turn only ran a local slash command (no model call): no end-of-turn marker.
        let mut command_turn = false;
        // Last assistant text of the current turn: its hidden summary line feeds the notification.
        let mut last_text = String::new();
        // Before/after snapshots of the files edited by tool calls → diffs shown in the chat.
        let mut files = crate::agents::file_changes::FileTracker::new(rt.cwd.as_deref().map(PathBuf::from));
        // Path hints of in-flight remote write/edit tool calls so returned remote FileChanges attach accurately.
        let mut remote_edit_tools: HashMap<String, Option<String>> = HashMap::new();

        macro_rules! persist {
            ($body:expr) => {{
                if let Err(err) = db.call($body).await {
                    tracing::warn!(thread = %id, %err, "persist failed");
                }
            }};
        }

        let set_status =
            |status: ThreadStatus, detail: Option<String>, last: &mut Option<(ThreadStatus, Option<String>)>| {
                let changed = last.as_ref() != Some(&(status, detail.clone()));
                let status_changed = last.as_ref().map(|(s, _)| *s) != Some(status);
                *last = Some((status, detail.clone()));
                (changed, status_changed, detail)
            };

        loop {
            // The CLI's channel ends the pump; Neuron's own closes with the session (branch then disabled).
            let event = tokio::select! {
                event = events.recv() => match event {
                    Some(event) => event,
                    None => break,
                },
                Some(event) = injected.recv() => event,
            };
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
                        emit(sink, &id, AgentEvent::ThreadStatusChanged { status, detail });
                    }
                }
                AdapterEvent::ModeChanged(mode) => {
                    if let Some(s) = self.lock().get_mut(&id) {
                        s.permission_mode = mode.clone();
                    }
                    let (tid, m) = (id.clone(), mode.clone());
                    persist!(move |c| threads::set_permission_mode(c, &tid, &m));
                    emit(sink, &id, AgentEvent::PermissionModeChanged { mode });
                }
                AdapterEvent::TextDelta { item_id, channel, text } => {
                    emit(sink, &id, AgentEvent::MessageDelta { message_id: item_id, channel, text });
                }
                AdapterEvent::BlockCompleted { item_id, channel, text } => {
                    let role = match channel {
                        crate::agents::events::DeltaChannel::Text => "assistant",
                        crate::agents::events::DeltaChannel::Thinking => "thinking",
                    };
                    if role == "assistant" && !text.trim().is_empty() {
                        last_text.clone_from(&text);
                    }
                    let (tid, mid) = (id.clone(), item_id.clone());
                    persist!(move |c| chat::insert_message(c, &mid, &tid, role, &text, None, now_ms()));
                    emit(sink, &id, AgentEvent::MessageCompleted { message_id: item_id });
                }
                AdapterEvent::CommandOutput { item_id, name, text } => {
                    command_turn = true;
                    {
                        let (tid, mid, n, out) = (id.clone(), item_id.clone(), name.clone(), text.clone());
                        persist!(move |c| {
                            chat::insert_message(c, &mid, &tid, "command", &out, Some(&json!({ "name": n })), now_ms())
                        });
                    }
                    emit(sink, &id, AgentEvent::CommandOutput { message_id: item_id, name, text });
                }
                AdapterEvent::ToolCallStart { id: tool_id, name, input, parent_id } => {
                    // First thing: the CLI writes the file right after announcing the call.
                    files.start(&tool_id, &name, &input).await;
                    let base = name.rsplit("__").next().unwrap_or(&name);
                    let base = base.rsplit('.').next().unwrap_or(base);
                    if matches!(base, "remote_write" | "remote_edit") {
                        let path = input.get("path").and_then(Value::as_str).map(str::to_string);
                        remote_edit_tools.insert(tool_id.clone(), path);
                    }
                    // A shell command that starts another agent CLI: a sub-agent of this chat.
                    let launched = subagents::is_shell_tool(&name)
                        .then(|| subagents::shell_command(&input))
                        .flatten()
                        .and_then(|cmd| subagents::detect_cli(cmd).map(|found| (found, shorten(cmd))));
                    let is_task_launcher = matches!(name.as_str(), "Agent" | "Task");
                    let background = input.get("run_in_background").and_then(Value::as_bool).unwrap_or(false);
                    let (status, detail) = tool_activity(&name, &input);
                    {
                        let (tid, tool, n, inp) = (id.clone(), tool_id.clone(), name.clone(), input.clone());
                        persist!(move |c| chat::insert_tool_call(c, &tool, &tid, &n, &inp, now_ms()));
                    }
                    emit(
                        sink,
                        &id,
                        AgentEvent::ToolCallStart {
                            tool_call_id: tool_id.clone(),
                            name,
                            input,
                            activity: detail.clone(),
                            parent_tool_call_id: parent_id,
                        },
                    );
                    if is_task_launcher {
                        if let Some(s) = self.lock().get_mut(&id) {
                            s.subagents.task_started(&tool_id, background);
                        }
                    } else if let Some((found, command_line)) = launched {
                        if let Some(s) = self.lock().get_mut(&id) {
                            s.subagents.command_started(&tool_id, found.key, background);
                        }
                        let mut event = cli_subagent_event(tool_id, SubagentStatus::Running, SubagentSource::Command);
                        if let AgentEvent::SubagentUpdate { description, agent, command, .. } = &mut event {
                            *description = found.prompt;
                            *agent = Some(found.key.to_string());
                            *command = Some(command_line);
                        }
                        emit(sink, &id, event);
                    }
                    let (changed, status_changed, detail) = set_status(status, detail, &mut last_status);
                    if status_changed {
                        let tid = id.clone();
                        persist!(move |c| threads::set_status(c, &tid, status, now_ms()));
                    }
                    if changed {
                        emit(sink, &id, AgentEvent::ThreadStatusChanged { status, detail });
                    }
                }
                AdapterEvent::ToolCallResult { id: tool_id, output, is_error } => {
                    // The command of a sub-agent returned: over, unless it runs in the background.
                    let returned = {
                        let mut sessions = self.lock();
                        if let Some(s) = sessions.get_mut(&id) {
                            if s.subagents.is_tracked_command(&tool_id) {
                                Some(s.subagents.command_returned(&tool_id, Instant::now()))
                            } else {
                                s.subagents.task_returned(&tool_id);
                                None
                            }
                        } else {
                            None
                        }
                    };
                    if let Some(over) = returned {
                        let status = match (over, is_error) {
                            (false, _) => SubagentStatus::Running,
                            (true, true) => SubagentStatus::Failed,
                            (true, false) => SubagentStatus::Completed,
                        };
                        let mut event = cli_subagent_event(tool_id.clone(), status, SubagentSource::Command);
                        if let AgentEvent::SubagentUpdate { output: tail, .. } = &mut event {
                            *tail = Some(subagents::output_tail(&output, 12)).filter(|t| !t.is_empty());
                        }
                        emit(sink, &id, event);
                    }
                    let status = if is_error { ToolStatus::Error } else { ToolStatus::Ok };
                    let mut changes = files.finish(&tool_id).await;
                    if let Some(path_hint) = remote_edit_tools.remove(&tool_id) {
                        if !is_error {
                            changes.extend(self.take_remote_changes(&id, path_hint.as_deref()));
                        }
                    }
                    {
                        let (tool, out, ch) = (tool_id.clone(), output.clone(), changes.clone());
                        persist!(move |c| chat::finish_tool_call(c, &tool, &out, status, &ch, now_ms()));
                    }
                    emit(sink, &id, AgentEvent::ToolCallResult { tool_call_id: tool_id, output, is_error, changes });
                }
                AdapterEvent::PermissionRequest { request_id, tool_name, description, input, .. } => {
                    if let Some(s) = self.lock().get_mut(&id) {
                        s.pending.insert(request_id.clone(), (tool_name.clone(), input.clone()));
                    }
                    let detail = Some(tool_name.clone());
                    let (_, status_changed, detail) =
                        set_status(ThreadStatus::AwaitingApproval, detail, &mut last_status);
                    if status_changed {
                        let tid = id.clone();
                        persist!(move |c| threads::set_status(c, &tid, ThreadStatus::AwaitingApproval, now_ms()));
                    }
                    emit(sink, &id, AgentEvent::PermissionRequest { request_id, tool_name, description, input });
                    emit(sink, &id, AgentEvent::ThreadStatusChanged { status: ThreadStatus::AwaitingApproval, detail });
                }
                AdapterEvent::TurnComplete { mut usage, duration_ms, error } => {
                    let (stopped, shutdown) = self.take_flags(&id, generation);
                    // Neuron ended this process itself (idle reaper, settings changed, chat deleted): agy then
                    // answers stdin's EOF with a failed `result` (« stream input cancelled: context canceled »).
                    // Not a turn of the user's — and with a restart, the new process may already be working.
                    if shutdown {
                        tracing::debug!(thread = %id, ?error, "turn end of a terminated session ignored");
                        continue;
                    }
                    // The CLI logged this turn: bring it into the dashboard now (logs are its source of truth).
                    if matches!(rt.agent, AgentKind::ClaudeCode | AgentKind::Codex) {
                        crate::usage_import::trigger(&state);
                    }
                    // Antigravity doesn't stream its quotas: ask for them after each turn (no token used).
                    if rt.agent == AgentKind::Antigravity {
                        tauri::async_runtime::spawn(crate::agents::antigravity::quota::refresh(
                            db.clone(),
                            Arc::clone(&state.events),
                        ));
                    }
                    // CLIs that only report tokens (Codex, Antigravity): price them at the public API rate.
                    if usage.cost_usd == 0.0 && rt.agent != AgentKind::ClaudeCode {
                        if let Some(cost) = model.as_deref().and_then(|m| crate::pricing::estimate(m, &usage)) {
                            usage.cost_usd = cost;
                        }
                    }
                    let mut wall_ms = None;
                    let mut dangling_subs = Vec::new();
                    if let Some(s) = self.lock().get_mut(&id).filter(|s| s.generation == generation) {
                        s.busy = false;
                        s.idle_since = Instant::now();
                        wall_ms =
                            s.turn_started.take().map(|t| i64::try_from(t.elapsed().as_millis()).unwrap_or(i64::MAX));
                        dangling_subs = s.subagents.finish_all();
                    }
                    // Total time of the request as the user lived it (send → answer, approvals included);
                    // the CLI's own figure when Neuron didn't see the start (resumed process).
                    let duration_ms = wall_ms.or(duration_ms);
                    cumulative.add(&usage);
                    let silent = std::mem::take(&mut command_turn) && usage.total() == 0 && usage.cost_usd == 0.0;
                    {
                        let (tid, project, m, agent) = (id.clone(), rt.project_id.clone(), model.clone(), rt.agent);
                        let err = error.clone().filter(|_| !stopped);
                        persist!(move |c| {
                            let now = now_ms();
                            if let Some(message) = &err {
                                let meta = access::error_meta(access::classify_error(message));
                                chat::insert_message(
                                    c,
                                    &uuid::Uuid::new_v4().to_string(),
                                    &tid,
                                    "error",
                                    message,
                                    meta.as_ref(),
                                    now,
                                )?;
                            }
                            if silent {
                                return chat::close_dangling_tools(c, &tid, now);
                            }
                            record_usage(c, &tid, project.as_deref(), agent, m.as_deref(), &usage, now)?;
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
                    emit(sink, &id, AgentEvent::TokenUsageUpdate { delta: usage, cumulative, duration_ms });
                    let text = std::mem::take(&mut last_text);
                    if !silent && !stopped {
                        use crate::agents::summary::{TurnOutcome, turn_summary};
                        let (outcome, summary) = match &error {
                            Some(message) => (TurnOutcome::Failure, turn_summary(message).1),
                            None => turn_summary(&text),
                        };
                        emit(sink, &id, AgentEvent::TurnSummary { outcome, summary });
                    }
                    let sub_status =
                        if stopped || error.is_some() { SubagentStatus::Failed } else { SubagentStatus::Completed };
                    finish_subagents(sink, &id, dangling_subs, sub_status);
                    let status = if stopped {
                        ThreadStatus::Cancelled
                    } else if let Some(message) = error {
                        let issue = access::classify_error(&message);
                        emit(sink, &id, AgentEvent::ThreadError { message, fatal: false, issue });
                        ThreadStatus::Error
                    } else {
                        ThreadStatus::Done
                    };
                    last_status = Some((status, None));
                    let tid = id.clone();
                    persist!(move |c| threads::set_status(c, &tid, status, now_ms()));
                    emit(sink, &id, AgentEvent::ThreadStatusChanged { status, detail: None });
                }
                AdapterEvent::RateLimits(windows) => {
                    let agent = rt.agent;
                    persist!(move |c| crate::db::providers::store_live_windows(c, agent, &windows, now_ms()));
                    // The bars move during the turn, not only at its end.
                    events::emit(sink, crate::agents::antigravity::quota::QUOTAS_CHANGED_EVENT, &());
                }
                AdapterEvent::Subagent {
                    tool_call_id,
                    description,
                    subagent_type,
                    status,
                    tool_uses,
                    tokens,
                    last_tool,
                    agent,
                    parent_id,
                    output,
                } => {
                    if let Some(s) = self.lock().get_mut(&id) {
                        s.subagents.task_update(&tool_call_id, status);
                    }
                    emit(
                        sink,
                        &id,
                        AgentEvent::SubagentUpdate {
                            tool_call_id,
                            description,
                            subagent_type,
                            status,
                            tool_uses,
                            tokens,
                            last_tool,
                            source: SubagentSource::Task,
                            agent,
                            command: None,
                            pid: None,
                            output,
                            parent_tool_call_id: parent_id,
                        },
                    );
                }
                AdapterEvent::Warning(w) => tracing::debug!(thread = %id, "{w}"),
                AdapterEvent::Exited { code, stderr_tail } => {
                    let (stopped, shutdown, dangling_subs) = {
                        let mut sessions = self.lock();
                        let flags = match sessions.get(&id) {
                            Some(s) if s.generation == generation => (s.stop_requested, s.shutdown_requested),
                            _ => (false, true),
                        };
                        let dangling = if sessions.get(&id).is_some_and(|s| s.generation == generation) {
                            sessions.remove(&id).map(|mut s| s.subagents.finish_all()).unwrap_or_default()
                        } else {
                            Vec::new()
                        };
                        (flags.0, flags.1, dangling)
                    };
                    if !shutdown {
                        finish_subagents(sink, &id, dangling_subs, SubagentStatus::Failed);
                    }
                    let was_active = last_status.as_ref().is_some_and(|(s, _)| s.is_active());
                    tracing::info!(thread = %id, ?code, was_active, "agent session exited");
                    if stopped && !shutdown {
                        // Stop on an agent without an interrupt message = kill: that's a cancellation — also when
                        // it was killed before reporting anything (Antigravity still starting: no status yet).
                        let tid = id.clone();
                        persist!(move |c| {
                            let now = now_ms();
                            chat::close_dangling_tools(c, &tid, now)?;
                            threads::set_status(c, &tid, ThreadStatus::Cancelled, now)
                        });
                        emit(
                            sink,
                            &id,
                            AgentEvent::ThreadStatusChanged { status: ThreadStatus::Cancelled, detail: None },
                        );
                    } else if was_active && !shutdown {
                        let tail = stderr_tail.trim();
                        let issue = access::classify_error(tail);
                        let message = if tail.is_empty() {
                            let code = code.map_or("?".into(), |c| c.to_string());
                            crate::tr!(
                                "Le processus de l'agent s'est arrêté (code {code}).",
                                "The agent process stopped (code {code})."
                            )
                        } else {
                            crate::tr!(
                                "Le processus de l'agent s'est arrêté : {}",
                                "The agent process stopped: {}",
                                tail.lines().last().unwrap_or(tail)
                            )
                        };
                        {
                            let (tid, m) = (id.clone(), message.clone());
                            persist!(move |c| {
                                let now = now_ms();
                                chat::insert_message(
                                    c,
                                    &uuid::Uuid::new_v4().to_string(),
                                    &tid,
                                    "error",
                                    &m,
                                    access::error_meta(issue).as_ref(),
                                    now,
                                )?;
                                chat::close_dangling_tools(c, &tid, now)?;
                                threads::set_status(c, &tid, ThreadStatus::Error, now)
                            });
                        }
                        emit(sink, &id, AgentEvent::ThreadError { message, fatal: true, issue });
                        emit(sink, &id, AgentEvent::ThreadStatusChanged { status: ThreadStatus::Error, detail: None });
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

    #[test]
    fn answered_approval_leaves_the_waiting_status() {
        let registry = AgentRegistry::default();
        let (commands, mut sent) = mpsc::unbounded_channel();
        let (inject, mut injected) = mpsc::unbounded_channel();
        let pending = HashMap::from([
            ("r1".to_string(), ("Bash".to_string(), json!({ "command": "cargo build" }))),
            ("r2".to_string(), ("Read".to_string(), json!({ "file_path": "/a.rs" }))),
        ]);
        registry.lock().insert(
            "t".into(),
            ActiveSession {
                commands,
                pid: None,
                turn_pid: None,
                subagents: SubagentTracker::default(),
                generation: 1,
                pending,
                inject,
                stop_requested: false,
                shutdown_requested: false,
                stale: false,
                busy: true,
                turn_started: None,
                idle_since: Instant::now(),
                workspace: None,
                permission_mode: "manual".into(),
                remote_changes: Vec::new(),
            },
        );
        // Another card still pending: the chat keeps waiting.
        registry.respond_permission("t", "r2", true, None, None).unwrap();
        assert!(matches!(sent.try_recv(), Ok(SessionCommand::Permission(d)) if d.allow && d.request_id == "r2"));
        assert!(injected.try_recv().is_err());
        // Last one approved: the approved tool's activity.
        registry.respond_permission("t", "r1", true, None, None).unwrap();
        assert!(matches!(
            injected.try_recv(),
            Ok(AdapterEvent::Status { status: ThreadStatus::Running, detail: Some(d) }) if d == "cargo build"
        ));
        assert!(registry.respond_permission("t", "r1", true, None, None).is_err());
    }
}

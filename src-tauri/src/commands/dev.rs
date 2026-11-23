//! Development helpers (debug builds only): demo data and simulated live activity, so the UI and
//! the event pipeline can be exercised before real adapters exist. All demo rows use the `demo-` id
//! prefix and are removed by `dev_clear_demo`.

use std::collections::HashMap;
use std::time::Duration;

use rusqlite::{Connection, params};
use tauri::{AppHandle, Emitter, State};

use crate::agents::events::{
    AGENT_EVENT_CHANNEL, AgentEvent, AgentEventEnvelope, AgentKind, DeltaChannel, SubagentStatus, ThreadStatus,
    TokenUsage,
};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::util::{DAY_MS, HOUR_MS, now_ms};

fn ensure_debug() -> AppResult<()> {
    if cfg!(debug_assertions) {
        Ok(())
    } else {
        Err(AppError::Invalid("dev commands are disabled in release builds".into()))
    }
}

/// Tiny deterministic PRNG (no extra dependency).
struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
    fn range(&mut self, lo: i64, hi: i64) -> i64 {
        lo + (self.next() % (hi - lo).max(1) as u64) as i64
    }
}

const PROJECTS: &[(&str, &str, &str)] = &[
    ("demo-p1", "neuron", "demo://neuron"),
    ("demo-p2", "api-gateway", "demo://api-gateway"),
    ("demo-p3", "portfolio", "demo://portfolio"),
];

const THREADS: &[(&str, AgentKind, &str, ThreadStatus)] = &[
    ("Refactor du registre de processus", AgentKind::ClaudeCode, "demo-p1", ThreadStatus::Editing),
    ("Tests d'intégration MCP", AgentKind::Codex, "demo-p1", ThreadStatus::Running),
    ("Migration auth JWT → sessions", AgentKind::ClaudeCode, "demo-p2", ThreadStatus::AwaitingApproval),
    ("Landing page hero", AgentKind::Antigravity, "demo-p3", ThreadStatus::Thinking),
    ("Rate limiter Redis", AgentKind::ClaudeCode, "demo-p2", ThreadStatus::Done),
    ("Audit accessibilité", AgentKind::Antigravity, "demo-p3", ThreadStatus::Done),
    ("Fix fuite mémoire WebSocket", AgentKind::Codex, "demo-p2", ThreadStatus::Error),
    ("Schéma SQLite v2", AgentKind::ClaudeCode, "demo-p1", ThreadStatus::Done),
    ("Script de déploiement", AgentKind::Generic, "demo-p2", ThreadStatus::Done),
    ("Palette de commandes", AgentKind::Antigravity, "demo-p1", ThreadStatus::Done),
    ("Optimisation images", AgentKind::Codex, "demo-p3", ThreadStatus::Cancelled),
    ("Revue PR #42", AgentKind::ClaudeCode, "demo-p1", ThreadStatus::Done),
];

fn model_for(agent: AgentKind) -> &'static str {
    match agent {
        AgentKind::ClaudeCode => "claude-opus-5-5",
        AgentKind::Antigravity => "gemini-3-pro",
        AgentKind::Codex => "gpt-5-codex",
        AgentKind::Generic => "custom",
    }
}

fn clear(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "DELETE FROM token_usage WHERE thread_id LIKE 'demo-%' OR project_id LIKE 'demo-%';
         DELETE FROM threads WHERE id LIKE 'demo-%';
         DELETE FROM projects WHERE id LIKE 'demo-%';",
    )
}

fn seed(conn: &mut Connection) -> AppResult<usize> {
    let tx = conn.transaction()?;
    clear(&tx)?;
    let now = now_ms();
    let mut rng = Lcg(0x5eed_cafe);

    for (i, (id, name, path)) in PROJECTS.iter().enumerate() {
        tx.execute(
            "INSERT INTO projects (id, name, path, created_at, last_opened_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, name, path, now - 40 * DAY_MS, now - i as i64 * HOUR_MS],
        )?;
    }

    let mut rows = 0;
    for (i, (title, agent, project, status)) in THREADS.iter().enumerate() {
        let id = format!("demo-t{i:02}");
        let created = now - (i as i64) * 2 * DAY_MS - rng.range(0, DAY_MS);
        let updated = if status.is_active() {
            now - rng.range(5_000, 120_000)
        } else {
            created + rng.range(HOUR_MS / 4, 3 * HOUR_MS)
        };
        let ended = (!status.is_active()).then_some(updated);
        tx.execute(
            "INSERT INTO threads (id, project_id, agent, model, title, status, created_at, updated_at, ended_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, project, agent, model_for(*agent), title, status, created, updated, ended],
        )?;
    }

    // ~30 days of usage, heavier on recent days, plus a burst in the last 5h.
    for day in 0..30_i64 {
        let turns = rng.range(2, 9) + if day < 7 { 4 } else { 0 };
        for _ in 0..turns {
            let (_, agent, project, _) = THREADS[rng.range(0, THREADS.len() as i64) as usize];
            let thread = format!("demo-t{:02}", rng.range(0, THREADS.len() as i64));
            let ts = (now - day * DAY_MS - rng.range(0, DAY_MS)).min(now);
            insert_usage(&tx, &mut rng, &thread, project, agent, ts)?;
            rows += 1;
        }
    }
    for _ in 0..8 {
        let ts = now - rng.range(0, 4 * HOUR_MS);
        insert_usage(&tx, &mut rng, "demo-t00", "demo-p1", AgentKind::ClaudeCode, ts)?;
        rows += 1;
    }
    tx.commit()?;
    Ok(rows)
}

fn insert_usage(
    conn: &Connection,
    rng: &mut Lcg,
    thread: &str,
    project: &str,
    agent: AgentKind,
    ts: i64,
) -> rusqlite::Result<()> {
    let input = rng.range(2_000, 45_000);
    let output = rng.range(400, 9_000);
    let cache_read = rng.range(10_000, 220_000);
    let cache_write = rng.range(0, 20_000);
    let cost = (input as f64 * 3.0 + output as f64 * 15.0 + cache_read as f64 * 0.3 + cache_write as f64 * 3.75) / 1e6;
    conn.execute(
        "INSERT INTO token_usage (thread_id, project_id, agent, model, input_tokens, output_tokens,
                                  cache_read_tokens, cache_write_tokens, cost_usd, ts)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![thread, project, agent, model_for(agent), input, output, cache_read, cache_write, cost, ts],
    )?;
    Ok(())
}

/// Insert demo projects, threads and 30 days of token usage. Returns the number of usage rows.
#[tauri::command]
pub async fn dev_seed_demo(state: State<'_, AppState>) -> AppResult<usize> {
    ensure_debug()?;
    state.db.call(seed).await
}

/// Remove every demo row.
#[tauri::command]
pub async fn dev_clear_demo(state: State<'_, AppState>) -> AppResult<()> {
    ensure_debug()?;
    state.db.call(|conn| Ok(clear(conn)?)).await
}

/// Simulate ~30 s of live activity on the active demo threads: status changes, deltas and token
/// usage are emitted on the real event channel and persisted like a real adapter would.
const SIM_WORDS: &[&str] = &[
    "Je regarde la structure ",
    "du module. ",
    "Le registre lance un processus par chat",
    "\nEnsuite je vérifie les tests ",
    "et je corrige l'import manquant. ",
    "\nTout compile, ",
    "je relance la suite de tests.",
];

const SIM_TOOLS: &[(&str, &str)] = &[
    ("Read", "src/agents/registry.rs"),
    ("Grep", "fn reap_idle"),
    ("Edit", "src/stores/activity.ts"),
    ("Bash", "cargo test --lib"),
    ("Glob", "src/**/*.tsx"),
    ("Bash", "npm run build"),
];

#[tauri::command]
pub async fn dev_simulate_activity(app: AppHandle, state: State<'_, AppState>) -> AppResult<usize> {
    ensure_debug()?;
    let db = state.db.clone();
    let active: Vec<(String, AgentKind, Option<String>)> = db
        .call(|conn| {
            let mut stmt = conn.prepare(&format!(
                // Ordered by id so index 2 is the seeded "awaiting approval" thread.
                "SELECT id, agent, project_id FROM threads WHERE id LIKE 'demo-%' AND status IN ({}) ORDER BY id",
                ThreadStatus::active_sql_list()
            ))?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
        .await?;
    let count = active.len();

    tauri::async_runtime::spawn(async move {
        const STEPS: &[(ThreadStatus, Option<&str>)] = &[
            (ThreadStatus::Thinking, None),
            (ThreadStatus::Reading, Some("src/lib/ipc.ts")),
            (ThreadStatus::Editing, Some("src/App.tsx")),
            (ThreadStatus::Running, Some("npm run build")),
            (ThreadStatus::Thinking, None),
            (ThreadStatus::Editing, Some("src-tauri/src/lib.rs")),
        ];
        let mut rng = Lcg(now_ms() as u64);
        let mut cumulative: HashMap<String, TokenUsage> = HashMap::new();
        let emit = |thread_id: &str, event: AgentEvent| {
            let envelope = AgentEventEnvelope { thread_id: thread_id.to_string(), ts: now_ms(), event };
            if let Err(err) = app.emit(AGENT_EVENT_CHANNEL, envelope) {
                tracing::warn!(%err, "emit failed");
            }
        };

        for tick in 0..36_usize {
            for (i, (thread_id, agent, project)) in active.iter().enumerate() {
                // Keep the approval thread waiting; stagger the others.
                let current: ThreadStatus =
                    if i == 2 { ThreadStatus::AwaitingApproval } else { STEPS[(tick + i) % STEPS.len()].0 };
                if tick % 3 == i % 3 {
                    let detail = if i == 2 { Some("Bash: cargo publish") } else { STEPS[(tick + i) % STEPS.len()].1 };
                    emit(
                        thread_id,
                        AgentEvent::ThreadStatusChanged { status: current, detail: detail.map(str::to_string) },
                    );
                    let _ = set_status(&db, thread_id, current).await;
                }
                if current == ThreadStatus::Thinking || current == ThreadStatus::Editing {
                    emit(
                        thread_id,
                        AgentEvent::MessageDelta {
                            message_id: format!("{thread_id}-m{}", tick / 6),
                            channel: DeltaChannel::Text,
                            text: SIM_WORDS[(tick * 7 + i) % SIM_WORDS.len()].into(),
                        },
                    );
                }
                // Mini-terminal activity: one tool call per tick, finished on the next one.
                if i == 2 && tick == 0 {
                    emit(
                        thread_id,
                        AgentEvent::PermissionRequest {
                            request_id: format!("{thread_id}-perm"),
                            tool_name: "Bash".into(),
                            description: "cargo publish --dry-run".into(),
                            input: serde_json::json!({ "command": "cargo publish --dry-run" }),
                        },
                    );
                }
                if i != 2 {
                    if tick > 0 {
                        emit(
                            thread_id,
                            AgentEvent::ToolCallResult {
                                tool_call_id: format!("{thread_id}-t{}", tick - 1),
                                output: "ok".into(),
                                is_error: (tick + i) % 11 == 0,
                                changes: Vec::new(),
                            },
                        );
                    }
                    let (name, input) = SIM_TOOLS[(tick + i) % SIM_TOOLS.len()];
                    // Thread 0 runs a sub-agent between ticks 4 and 14: its calls carry the launcher id.
                    let launcher = format!("{thread_id}-agent");
                    let in_sub = i == 0 && (5..14).contains(&tick);
                    emit(
                        thread_id,
                        AgentEvent::ToolCallStart {
                            tool_call_id: format!("{thread_id}-t{tick}"),
                            name: name.into(),
                            input: serde_json::json!({ "command": input, "file_path": input }),
                            activity: Some(format!("{name} {input}")),
                            parent_tool_call_id: in_sub.then(|| launcher.clone()),
                        },
                    );
                    if i == 0 && tick == 4 {
                        emit(
                            thread_id,
                            AgentEvent::ToolCallStart {
                                tool_call_id: launcher.clone(),
                                name: "Agent".into(),
                                input: serde_json::json!({ "description": "Explorer le module agents", "subagent_type": "Explore" }),
                                activity: Some("Agent Explorer le module agents".into()),
                                parent_tool_call_id: None,
                            },
                        );
                    }
                    if i == 0 && (4..14).contains(&tick) {
                        emit(
                            thread_id,
                            AgentEvent::SubagentUpdate {
                                tool_call_id: launcher.clone(),
                                description: Some("Explorer le module agents".into()),
                                subagent_type: Some("Explore".into()),
                                status: SubagentStatus::Running,
                                tool_uses: Some((tick - 4) as u64),
                                tokens: Some(((tick - 3) * 2_400) as u64),
                                last_tool: Some(name.into()),
                            },
                        );
                    }
                    if i == 0 && tick == 14 {
                        emit(
                            thread_id,
                            AgentEvent::SubagentUpdate {
                                tool_call_id: launcher.clone(),
                                description: Some("Explorer le module agents".into()),
                                subagent_type: Some("Explore".into()),
                                status: SubagentStatus::Completed,
                                tool_uses: Some(9),
                                tokens: Some(24_000),
                                last_tool: None,
                            },
                        );
                        emit(
                            thread_id,
                            AgentEvent::ToolCallResult {
                                tool_call_id: launcher.clone(),
                                output: "Le module agents contient 4 adaptateurs.".into(),
                                is_error: false,
                                changes: Vec::new(),
                            },
                        );
                    }
                }
                if i != 2 {
                    let delta = TokenUsage {
                        input: rng.range(300, 4_000) as u64,
                        output: rng.range(50, 900) as u64,
                        cache_read: rng.range(1_000, 30_000) as u64,
                        cache_write: rng.range(0, 2_000) as u64,
                        cost_usd: 0.004,
                    };
                    let total = cumulative.entry(thread_id.clone()).or_default();
                    total.add(&delta);
                    emit(
                        thread_id,
                        AgentEvent::TokenUsageUpdate { delta, cumulative: *total, duration_ms: Some(42_000) },
                    );
                    let _ = record_usage(&db, thread_id, project.clone(), *agent, delta).await;
                }
            }
            tokio::time::sleep(Duration::from_millis(850)).await;
        }

        // Finish: first thread completes, second errors, the approval one keeps waiting.
        if let Some((id, _, _)) = active.first() {
            emit(id, AgentEvent::ThreadStatusChanged { status: ThreadStatus::Done, detail: None });
            let _ = set_status(&db, id, ThreadStatus::Done).await;
        }
        if let Some((id, _, _)) = active.get(1) {
            emit(id, AgentEvent::ThreadError { message: "Process exited with code 1".into(), fatal: true });
            let _ = set_status(&db, id, ThreadStatus::Error).await;
        }
    });

    Ok(count)
}

async fn set_status(db: &crate::db::Db, thread_id: &str, status: ThreadStatus) -> AppResult<()> {
    let id = thread_id.to_string();
    db.call(move |conn| {
        let now = now_ms();
        let ended = (!status.is_active()).then_some(now);
        conn.execute(
            "UPDATE threads SET status = ?2, updated_at = ?3, ended_at = ?4 WHERE id = ?1",
            params![id, status, now, ended],
        )?;
        Ok(())
    })
    .await
}

async fn record_usage(
    db: &crate::db::Db,
    thread_id: &str,
    project: Option<String>,
    agent: AgentKind,
    d: TokenUsage,
) -> AppResult<()> {
    let id = thread_id.to_string();
    db.call(move |conn| {
        conn.execute(
            "INSERT INTO token_usage (thread_id, project_id, agent, model, input_tokens, output_tokens,
                                      cache_read_tokens, cache_write_tokens, cost_usd, ts)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                project,
                agent,
                model_for(agent),
                d.input as i64,
                d.output as i64,
                d.cache_read as i64,
                d.cache_write as i64,
                d.cost_usd,
                now_ms()
            ],
        )?;
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::db::{threads, usage};

    #[tokio::test]
    async fn seed_and_clear_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        let rows = db.call(seed).await.unwrap();
        assert!(rows > 50);
        db.call(|conn| {
            assert_eq!(threads::list_active(conn)?.len(), 4);
            let report = usage::report(conn, usage::UsageRange::Month, now_ms())?;
            assert!(report.totals.input > 0);
            clear(conn)?;
            assert!(threads::list_recent(conn, 100)?.is_empty());
            Ok(())
        })
        .await
        .unwrap();
    }
}

//! Usage recorded by the CLIs themselves, imported into `token_usage` so the dashboard shows everything the
//! subscriptions consumed (terminal, IDE, Neuron), not only the turns started from Neuron.
//!
//! - Claude Code: `~/.claude/projects/**/*.jsonl` — every assistant line carries `message.usage`; the same
//!   response can appear on several lines (one per content block) → deduplicated by `message.id` + `requestId`.
//! - Codex: `~/.codex/sessions/**/rollout-*.jsonl` — `token_count` events carry the session's running total;
//!   each increase is one response.
//!
//! Incremental: each file is read from where the previous import stopped (complete lines only). Local files
//! only, nothing leaves the machine. Antigravity keeps no readable usage log: its turns stay counted by Neuron.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::agents::RateLimitWindow;
use crate::agents::antigravity::quota::parse_rfc3339;
use crate::agents::events::{AgentKind, TokenUsage};
use crate::state::AppState;

/// Emitted after an import added usage (the dashboard reloads).
pub const USAGE_CHANGED_EVENT: &str = "usage://changed";
const PERIOD: Duration = Duration::from_secs(10 * 60);
/// Bytes read per file and pass (a first import of a huge history spreads over a few passes).
const MAX_READ: u64 = 256 * 1024 * 1024;

static RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Source {
    Claude,
    Codex,
}

impl Source {
    fn tag(self) -> &'static str {
        match self {
            Source::Claude => "claude_log",
            Source::Codex => "codex_log",
        }
    }

    fn agent(self) -> AgentKind {
        match self {
            Source::Claude => AgentKind::ClaudeCode,
            Source::Codex => AgentKind::Codex,
        }
    }
}

/// Where a file's previous import stopped, plus what a Codex rollout states once at its top.
#[derive(Debug, Clone, Default, PartialEq)]
struct FileState {
    offset: u64,
    session: Option<String>,
    cwd: Option<String>,
    model: Option<String>,
    /// Codex: last running total seen (JSON of `total_token_usage`).
    prev_total: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
struct Row {
    key: String,
    model: Option<String>,
    cwd: Option<String>,
    ts: i64,
    usage: TokenUsage,
}

fn u(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}

/// One Claude Code transcript line → a usage row (assistant responses with tokens only).
fn claude_row(line: &str) -> Option<Row> {
    if !line.contains("\"usage\"") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("type").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let message = v.get("message")?;
    let usage = message.get("usage")?;
    let model = message.get("model").and_then(Value::as_str).filter(|m| !m.starts_with('<'));
    let usage = TokenUsage {
        input: u(usage, "input_tokens"),
        output: u(usage, "output_tokens"),
        cache_read: u(usage, "cache_read_input_tokens"),
        cache_write: u(usage, "cache_creation_input_tokens"),
        cost_usd: 0.0,
    };
    if usage.input + usage.output + usage.cache_read + usage.cache_write == 0 {
        return None;
    }
    let id = message.get("id").and_then(Value::as_str).or_else(|| v.get("uuid").and_then(Value::as_str))?;
    let request = v.get("requestId").and_then(Value::as_str).unwrap_or("");
    Some(Row {
        key: format!("claude:{id}:{request}"),
        model: model.map(str::to_owned),
        cwd: v.get("cwd").and_then(Value::as_str).map(str::to_owned),
        ts: v.get("timestamp").and_then(Value::as_str).and_then(parse_rfc3339)?,
        usage,
    })
}

/// One Codex rollout line: updates the file state, returns a row for each increase of the running total.
fn codex_row(line: &str, state: &mut FileState) -> Option<Row> {
    let interesting = ["\"session_meta\"", "\"turn_context\"", "\"token_count\""];
    if !interesting.iter().any(|k| line.contains(k)) {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    let payload = v.get("payload")?;
    match v.get("type").and_then(Value::as_str) {
        Some("session_meta") => {
            state.session = payload.get("id").and_then(Value::as_str).map(str::to_owned);
            state.cwd = payload.get("cwd").and_then(Value::as_str).map(str::to_owned);
            if let Some(model) = payload.get("model").and_then(Value::as_str) {
                state.model = Some(model.to_owned());
            }
            None
        }
        Some("turn_context") => {
            if let Some(model) = payload.get("model").and_then(Value::as_str) {
                state.model = Some(model.to_owned());
            }
            None
        }
        Some("event_msg") if payload.get("type").and_then(Value::as_str) == Some("token_count") => {
            let total = payload.get("info")?.get("total_token_usage")?;
            let prev: Value =
                state.prev_total.as_deref().and_then(|p| serde_json::from_str(p).ok()).unwrap_or(Value::Null);
            let fields = ["input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens"];
            // A total that went down is a new counter (shouldn't happen): take it whole.
            let restarted = fields.iter().any(|f| u(total, f) < u(&prev, f));
            let delta = |f: &str| if restarted { u(total, f) } else { u(total, f) - u(&prev, f) };
            let (input, cached) = (delta("input_tokens"), delta("cached_input_tokens"));
            let usage = TokenUsage {
                input: input.saturating_sub(cached),
                // `output_tokens` already includes the reasoning tokens.
                output: delta("output_tokens"),
                cache_read: cached,
                cache_write: delta("cache_write_input_tokens"),
                cost_usd: 0.0,
            };
            state.prev_total = Some(total.to_string());
            if usage.input + usage.output + usage.cache_read + usage.cache_write == 0 {
                return None;
            }
            let session = state.session.clone().unwrap_or_default();
            Some(Row {
                key: format!(
                    "codex:{session}:{}",
                    u(total, "total_tokens").max(u(total, "input_tokens") + u(total, "output_tokens"))
                ),
                model: state.model.clone(),
                cwd: state.cwd.clone(),
                ts: v.get("timestamp").and_then(Value::as_str).and_then(parse_rfc3339)?,
                usage,
            })
        }
        _ => None,
    }
}

/// Subscription windows found in a log and when the CLI wrote them (Unix ms).
type Limits = (i64, Vec<RateLimitWindow>);

/// What one pass over a file found.
struct FileRead {
    rows: Vec<Row>,
    state: FileState,
    /// Codex: the newest `rate_limits` of the lines read (terminal sessions included).
    limits: Option<Limits>,
}

/// Complete lines of `path` after `state.offset` → rows and the state after them.
fn read_file(path: &Path, source: Source, mut state: FileState) -> std::io::Result<FileRead> {
    let mut file = std::fs::File::open(path)?;
    let size = file.metadata()?.len();
    if size < state.offset {
        // Rewritten from scratch: read it again (dedupe keys prevent double counting).
        state = FileState::default();
    }
    if size == state.offset {
        return Ok(FileRead { rows: Vec::new(), state, limits: None });
    }
    file.seek(SeekFrom::Start(state.offset))?;
    let mut buf = Vec::new();
    file.take(MAX_READ).read_to_end(&mut buf)?;
    // Only complete lines: a line being written is read next time.
    let Some(end) = buf.iter().rposition(|b| *b == b'\n') else {
        return Ok(FileRead { rows: Vec::new(), state, limits: None });
    };
    let text = String::from_utf8_lossy(&buf[..=end]);
    let mut rows = Vec::new();
    for line in text.lines() {
        let row = match source {
            Source::Claude => claude_row(line),
            Source::Codex => codex_row(line, &mut state),
        };
        rows.extend(row);
    }
    let limits = match source {
        Source::Codex => text.lines().rev().find_map(crate::agents::codex::limits::from_log_line),
        Source::Claude => None,
    };
    state.offset += end as u64 + 1;
    Ok(FileRead { rows, state, limits })
}

/// Keep the most recent of two reports.
fn newest(a: Option<Limits>, b: Option<Limits>) -> Option<Limits> {
    match (a, b) {
        (Some(a), Some(b)) => Some(if b.0 > a.0 { b } else { a }),
        (a, b) => a.or(b),
    }
}

fn jsonl_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            jsonl_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "jsonl") {
            out.push(path);
        }
    }
}

fn log_files(home: &Path) -> Vec<(Source, PathBuf)> {
    let mut out = Vec::new();
    for (source, dir) in
        [(Source::Claude, home.join(".claude").join("projects")), (Source::Codex, home.join(".codex").join("sessions"))]
    {
        let mut files = Vec::new();
        jsonl_files(&dir, &mut files);
        out.extend(files.into_iter().map(|f| (source, f)));
    }
    out
}

fn normalize(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Project whose folder contains `cwd` (the deepest one).
fn project_for(cwd: Option<&str>, projects: &[(String, String)]) -> Option<String> {
    let cwd = normalize(cwd?);
    projects
        .iter()
        .filter(|(_, root)| cwd == *root || cwd.starts_with(&format!("{root}/")))
        .max_by_key(|(_, root)| root.len())
        .map(|(id, _)| id.clone())
}

fn load_state(conn: &Connection, path: &str) -> rusqlite::Result<FileState> {
    conn.query_row(
        "SELECT offset, session, cwd, model, prev_total FROM usage_import_files WHERE path = ?1",
        [path],
        |r| {
            Ok(FileState {
                offset: r.get::<_, i64>(0)?.max(0) as u64,
                session: r.get(1)?,
                cwd: r.get(2)?,
                model: r.get(3)?,
                prev_total: r.get(4)?,
            })
        },
    )
    .optional()
    .map(Option::unwrap_or_default)
}

/// Stores the rows of one file and its new read position, in one transaction. Returns the rows added.
fn store(
    conn: &mut Connection,
    source: Source,
    path: &str,
    rows: &[Row],
    state: &FileState,
) -> rusqlite::Result<usize> {
    let projects: Vec<(String, String)> = {
        let mut stmt = conn.prepare_cached("SELECT id, path FROM projects")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, normalize(&r.get::<_, String>(1)?))))?;
        rows.collect::<Result<_, _>>()?
    };
    let tx = conn.transaction()?;
    let mut added = 0;
    {
        let mut insert = tx.prepare_cached(
            "INSERT OR IGNORE INTO token_usage (project_id, agent, model, input_tokens, output_tokens,
                 cache_read_tokens, cache_write_tokens, cost_usd, ts, source, dedupe_key)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )?;
        for row in rows {
            let cost = row.model.as_deref().and_then(|m| crate::pricing::estimate(m, &row.usage)).unwrap_or(0.0);
            added += insert.execute(params![
                project_for(row.cwd.as_deref(), &projects),
                source.agent(),
                row.model,
                row.usage.input as i64,
                row.usage.output as i64,
                row.usage.cache_read as i64,
                row.usage.cache_write as i64,
                cost,
                row.ts,
                source.tag(),
                row.key,
            ])?;
        }
    }
    if let Some(first) = rows.iter().map(|r| r.ts).min() {
        tx.execute(
            "INSERT INTO usage_log_start (agent, since) VALUES (?1, ?2)
             ON CONFLICT(agent) DO UPDATE SET since = MIN(since, excluded.since)",
            params![source.agent(), first],
        )?;
    }
    tx.execute(
        "INSERT INTO usage_import_files (path, offset, session, cwd, model, prev_total) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(path) DO UPDATE SET offset = excluded.offset, session = excluded.session, cwd = excluded.cwd,
             model = excluded.model, prev_total = excluded.prev_total",
        params![path, state.offset as i64, state.session, state.cwd, state.model, state.prev_total],
    )?;
    tx.commit()?;
    Ok(added)
}

/// One import pass over every log file. Returns the number of usage rows added.
async fn import_once(app: &AppHandle) -> usize {
    // Screenshots / manual tests on an isolated `NEURON_DATA_DIR`: keep the real CLI logs out.
    if std::env::var_os("NEURON_NO_CLI_LOGS").is_some() {
        return 0;
    }
    let Some(state) = app.try_state::<AppState>() else { return 0 };
    let Ok(home) = app.path().home_dir() else { return 0 };
    let files = tokio::task::spawn_blocking(move || log_files(&home)).await.unwrap_or_default();
    let mut added = 0;
    let mut codex_limits: Option<Limits> = None;
    for (source, path) in files {
        let key = path.display().to_string();
        let k = key.clone();
        let Ok(previous) = state.db.call(move |c| Ok(load_state(c, &k)?)).await else { continue };
        let before = previous.clone();
        let Ok(Ok(read)) = tokio::task::spawn_blocking(move || read_file(&path, source, previous)).await else {
            continue;
        };
        let FileRead { rows, state: next, limits } = read;
        codex_limits = newest(codex_limits, limits);
        if next == before {
            continue;
        }
        match state.db.call(move |c| Ok(store(c, source, &key, &rows, &next)?)).await {
            Ok(n) => added += n,
            Err(err) => tracing::warn!(%err, "usage import: file not stored"),
        }
    }
    if let Some((at, windows)) = codex_limits {
        store_codex_limits(&state, app, at, windows).await;
    }
    added
}

/// Codex limits read in its logs replace the stored ones when they are more recent (a Codex session run in a
/// terminal moves the dashboard's bars too).
async fn store_codex_limits(state: &AppState, app: &AppHandle, at: i64, windows: Vec<RateLimitWindow>) {
    let saved = state
        .db
        .call(move |c| {
            if crate::db::providers::live_reported_at(c, AgentKind::Codex)? >= at {
                return Ok(false);
            }
            crate::db::providers::store_live_windows(c, AgentKind::Codex, &windows, at)?;
            Ok(true)
        })
        .await;
    match saved {
        Ok(true) => {
            let _ = app.emit(crate::agents::antigravity::quota::QUOTAS_CHANGED_EVENT, ());
            crate::remote::hub::forward(crate::agents::antigravity::quota::QUOTAS_CHANGED_EVENT, &());
        }
        Ok(false) => {}
        Err(err) => tracing::warn!(%err, "codex limits not saved"),
    }
}

/// Runs an import pass unless one is already running; the dashboard is told when usage was added.
pub fn trigger(app: &AppHandle) {
    if RUNNING.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let added = import_once(&app).await;
        RUNNING.store(false, Ordering::Release);
        if added > 0 {
            tracing::info!(added, "usage imported from CLI logs");
            let _ = app.emit(USAGE_CHANGED_EVENT, ());
            crate::remote::hub::forward(USAGE_CHANGED_EVENT, &());
        }
    });
}

/// First import shortly after startup, then every 10 minutes (turns run from Neuron trigger one too).
pub fn spawn_periodic(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        loop {
            trigger(&app);
            tokio::time::sleep(PERIOD).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_lines() {
        let line = r#"{"type":"assistant","timestamp":"2026-11-23T23:23:40.423Z","requestId":"req_1","cwd":"C:\\work","message":{"id":"msg_1","model":"claude-opus-5-5","usage":{"input_tokens":2,"cache_creation_input_tokens":18576,"cache_read_input_tokens":16464,"output_tokens":347}}}"#;
        let row = claude_row(line).unwrap();
        assert_eq!(row.key, "claude:msg_1:req_1");
        assert_eq!(
            (row.usage.input, row.usage.output, row.usage.cache_read, row.usage.cache_write),
            (2, 347, 16464, 18576)
        );
        assert_eq!(row.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(row.cwd.as_deref(), Some("C:\\work"));
        // Local commands (`<synthetic>`) carry no tokens; user lines carry no usage.
        assert!(claude_row(r#"{"type":"assistant","timestamp":"2026-11-23T23:23:40Z","message":{"id":"m","model":"<synthetic>","usage":{"input_tokens":0,"output_tokens":0}}}"#).is_none());
        assert!(claude_row(r#"{"type":"user","message":{"content":"usage"}}"#).is_none());
    }

    #[test]
    fn codex_running_totals() {
        let mut state = FileState::default();
        let lines = [
            r#"{"timestamp":"2026-09-15T13:24:52.435Z","type":"session_meta","payload":{"id":"s1","cwd":"C:\\game"}}"#,
            r#"{"timestamp":"2026-09-15T13:24:53.330Z","type":"turn_context","payload":{"model":"gpt-6-astra"}}"#,
            r#"{"timestamp":"2026-09-15T13:25:11.718Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":15907,"cached_input_tokens":12032,"output_tokens":203,"total_tokens":16110}}}}"#,
            // Same total repeated: nothing new.
            r#"{"timestamp":"2026-09-15T13:25:12.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":15907,"cached_input_tokens":12032,"output_tokens":203,"total_tokens":16110}}}}"#,
            r#"{"timestamp":"2026-09-15T13:25:27.798Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":35949,"cached_input_tokens":27776,"output_tokens":444,"total_tokens":36393}}}}"#,
        ];
        let rows: Vec<Row> = lines.iter().filter_map(|l| codex_row(l, &mut state)).collect();
        assert_eq!(rows.len(), 2);
        assert_eq!((rows[0].usage.input, rows[0].usage.cache_read, rows[0].usage.output), (15907 - 12032, 12032, 203));
        assert_eq!((rows[1].usage.input, rows[1].usage.cache_read, rows[1].usage.output), (20042 - 15744, 15744, 241));
        assert_eq!(rows[1].key, "codex:s1:36393");
        assert_eq!(rows[1].model.as_deref(), Some("gpt-6-astra"));
        assert_eq!(rows[1].cwd.as_deref(), Some("C:\\game"));
    }

    #[test]
    fn projects_by_folder() {
        let projects = vec![("p1".into(), normalize("C:\\Code\\Neuron")), ("p2".into(), normalize("C:\\Code"))];
        assert_eq!(project_for(Some("C:\\Code\\Neuron\\src-tauri"), &projects).as_deref(), Some("p1"));
        assert_eq!(project_for(Some("c:/code/other"), &projects).as_deref(), Some("p2"));
        assert_eq!(project_for(Some("C:\\Codex"), &projects), None);
        assert_eq!(project_for(None, &projects), None);
    }

    #[tokio::test]
    async fn incremental_import_and_effective_usage() {
        let dir = std::env::temp_dir().join(format!("neuron-usage-import-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("s.jsonl");
        let line = |id: &str, out: u64| {
            format!(
                r#"{{"type":"assistant","timestamp":"2026-11-23T10:00:00Z","requestId":"r{id}","message":{{"id":"{id}","model":"claude-opus-5-5","usage":{{"input_tokens":1,"output_tokens":{out}}}}}}}"#
            )
        };
        std::fs::write(&file, format!("{}\n{}\n{}", line("a", 10), line("a", 10), line("b", 5))).unwrap();

        let db = crate::db::Db::open_in_memory().unwrap();
        let path = file.display().to_string();
        let (p1, p2) = (path.clone(), path.clone());
        let f1 = file.clone();
        // First pass: the duplicate line counts once, the unfinished last line waits.
        let added = db
            .call(move |c| {
                let FileRead { rows, state: next, .. } = read_file(&f1, Source::Claude, load_state(c, &p1)?).unwrap();
                Ok(store(c, Source::Claude, &p1, &rows, &next)?)
            })
            .await
            .unwrap();
        assert_eq!(added, 1);
        // The line is completed: only it is read.
        std::fs::write(&file, format!("{}\n{}\n{}\n", line("a", 10), line("a", 10), line("b", 5))).unwrap();
        let f2 = file.clone();
        let added = db
            .call(move |c| {
                let FileRead { rows, state: next, .. } = read_file(&f2, Source::Claude, load_state(c, &p2)?).unwrap();
                Ok(store(c, Source::Claude, &p2, &rows, &next)?)
            })
            .await
            .unwrap();
        assert_eq!(added, 1);

        // A Neuron row after the logs start is covered by the logs; an older one still counts.
        let since = parse_rfc3339("2026-11-23T10:00:00Z").unwrap();
        let total: i64 = db
            .call(move |c| {
                c.execute(
                    "INSERT INTO token_usage (agent, output_tokens, ts) VALUES ('claude_code', 1000, ?1), ('claude_code', 7, ?2)",
                    params![since + 1, since - 1],
                )?;
                Ok(c.query_row("SELECT SUM(output_tokens) FROM usage_effective", [], |r| r.get(0))?)
            })
            .await
            .unwrap();
        assert_eq!(total, 10 + 5 + 7);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

//! Remote workspace operations executed on the target device (read, write, edit, search, run, context).
//!
//! Security model (defense in depth):
//! - Host mode (paired client → this device): requires `AccessLevel::Full`, explicit opt-in
//!   `RemoteSettings::allow_remote_tools`, and when `remote_tools_scope == ProjectOnly`, `root_cwd` must be inside a
//!   registered Neuron project.
//! - Grant mode (AI host → this device, over reverse bi-stream or mutual pairing): requires an active, non-revoked
//!   `workspace_grants` row issued by this device for that exact `peer_node_id`, bound to `grant.root_cwd`.
//! - Every path is canonicalized and confined to `root_cwd` unless `scope == Full`.
//! - `read_only` (chat in `plan` mode) blocks `Write`, `Edit` and `Run` on the target device itself.
//! - `Run` attaches a drop guard that kills the full process tree on timeout or iroh stream cancellation.

use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
use ts_rs::TS;

use crate::agents::file_changes::{FileChange, compute as compute_diff};
use crate::agents::kill_process_tree;
use crate::context::ContextBundle;
use crate::db::projects;
use crate::db::remote::{self as store, WorkspaceScope};
use crate::error::{AppError, AppResult};
use crate::remote::{RemoteSettings, load_settings};
use crate::state::Shared;
use crate::util::now_ms;

/// Max file size accepted by `Write` (1 MiB) and `Read` without slicing.
const MAX_WRITE_BYTES: usize = 1024 * 1024;
const MAX_READ_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_READ_OUTPUT_BYTES: usize = 128 * 1024;
const MAX_DIR_ENTRIES: usize = 500;
const MAX_SEARCH_WALK: usize = 25_000;
const MAX_SEARCH_RESULTS: usize = 200;
const MAX_SEARCH_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_CMD_STREAM_BYTES: usize = 128 * 1024;
const MAX_CMD_OUTPUT_BYTES: usize = 64 * 1024;
const DEFAULT_RUN_TIMEOUT_SECS: u64 = 60;
const MAX_RUN_TIMEOUT_SECS: u64 = 300;
const MAX_MARKDOWN_CONTENT_BYTES: usize = 200 * 1024;

/// Capabilities advertised by a Neuron device over `remote_capabilities`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RemoteCapabilities {
    /// Whether paired `Full` clients may execute workspace tools on this device.
    pub workspace_tools: bool,
    pub workspace_scope: WorkspaceScope,
    /// Target OS: `"windows"`, `"linux"`, `"macos"`.
    pub os: String,
    pub version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchMode {
    Glob,
    Grep,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum WorkspaceOp {
    Read {
        #[serde(default)]
        path: String,
        offset: Option<usize>,
        limit: Option<usize>,
    },
    Write {
        path: String,
        content: String,
    },
    Edit {
        path: String,
        old_text: String,
        new_text: String,
        replace_all: Option<bool>,
    },
    Search {
        mode: SearchMode,
        pattern: String,
        path: Option<String>,
        case_insensitive: Option<bool>,
        max_results: Option<usize>,
    },
    Run {
        command: String,
        cwd: Option<String>,
        timeout_secs: Option<u64>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOpResult {
    pub text: String,
    pub is_error: bool,
    /// Unified diff computed on the target device for `Write` / `Edit`.
    pub change: Option<FileChange>,
}

pub fn current_os() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

pub fn capabilities(settings: &RemoteSettings) -> RemoteCapabilities {
    RemoteCapabilities {
        workspace_tools: settings.allow_remote_tools,
        workspace_scope: settings.remote_tools_scope,
        os: current_os().into(),
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

/// Resolves `raw` relative to `root` and enforces `ProjectOnly` confinement (blocks `..` and escaping symlinks).
pub fn resolve_confined(root: &Path, raw: &str, scope: WorkspaceScope, allow_missing_leaf: bool) -> AppResult<PathBuf> {
    let root_canon = std::fs::canonicalize(root).map_err(|_| {
        AppError::NotFound(crate::tr!(
            "dossier de travail introuvable : {}",
            "working folder not found: {}",
            root.display()
        ))
    })?;
    if !root_canon.is_dir() {
        return Err(AppError::Invalid(crate::tr!(
            "le dossier de travail n'est pas un répertoire",
            "working folder is not a directory"
        )));
    }
    let trimmed = raw.trim();
    let candidate = if trimmed.is_empty() || trimmed == "." {
        root_canon.clone()
    } else {
        let p = Path::new(trimmed);
        if p.is_absolute() { p.to_path_buf() } else { root_canon.join(p) }
    };

    let resolved = if candidate.exists() {
        std::fs::canonicalize(&candidate)?
    } else if allow_missing_leaf {
        // Canonicalize the deepest existing ancestor, then verify the remaining relative tail contains no `..`.
        let mut ancestor = candidate.as_path();
        let mut tail = Vec::new();
        while !ancestor.exists() {
            let Some(name) = ancestor.file_name() else {
                return Err(AppError::Invalid(crate::tr!("chemin invalide : {trimmed}", "invalid path: {trimmed}")));
            };
            tail.push(name.to_os_string());
            ancestor = ancestor.parent().ok_or_else(|| {
                AppError::Invalid(crate::tr!("chemin invalide : {trimmed}", "invalid path: {trimmed}"))
            })?;
        }
        let mut base = std::fs::canonicalize(ancestor)?;
        for part in tail.into_iter().rev() {
            let p = Path::new(&part);
            if p.components().any(|c| !matches!(c, Component::Normal(_))) {
                return Err(AppError::Invalid(crate::tr!("chemin invalide : {trimmed}", "invalid path: {trimmed}")));
            }
            base.push(part);
        }
        base
    } else {
        return Err(AppError::NotFound(crate::tr!("introuvable : {trimmed}", "not found: {trimmed}")));
    };

    if scope == WorkspaceScope::ProjectOnly && !resolved.starts_with(&root_canon) {
        return Err(AppError::Invalid(crate::tr!(
            "accès refusé hors du dossier autorisé : {trimmed}",
            "access denied outside the allowed folder: {trimmed}"
        )));
    }
    Ok(resolved)
}

fn display_rel(path: &Path, root_canon: &Path) -> String {
    let shown = path.strip_prefix(root_canon).unwrap_or(path);
    shown.to_string_lossy().replace('\\', "/")
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdx"))
}

/// Simple glob matcher supporting `*`, `?` and `**` (case-insensitive on Windows).
fn glob_match(pattern: &str, text: &str, case_insensitive: bool) -> bool {
    let (p, t) = if case_insensitive {
        (pattern.to_ascii_lowercase(), text.to_ascii_lowercase())
    } else {
        (pattern.to_string(), text.to_string())
    };
    let p: Vec<char> = p.replace('\\', "/").chars().collect();
    let t: Vec<char> = t.replace('\\', "/").chars().collect();
    // Standard glob DP: `*` matches within a segment unless doubled (`**` matches across `/`).
    let (m, n) = (p.len(), t.len());
    let mut dp = vec![vec![false; n + 1]; m + 1];
    dp[0][0] = true;
    for i in 1..=m {
        if p[i - 1] == '*' {
            dp[i][0] = dp[i - 1][0];
        }
    }
    for i in 1..=m {
        let is_double = p[i - 1] == '*' && ((i >= 2 && p[i - 2] == '*') || (i < m && p[i] == '*'));
        for j in 1..=n {
            dp[i][j] = match p[i - 1] {
                '*' if is_double => dp[i - 1][j] || dp[i][j - 1],
                '*' => dp[i - 1][j] || (t[j - 1] != '/' && dp[i][j - 1]),
                '?' => t[j - 1] != '/' && dp[i - 1][j - 1],
                c => c == t[j - 1] && dp[i - 1][j - 1],
            };
        }
    }
    dp[m][n]
}

fn truncate_head_tail(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }
    let head_budget = max_bytes / 3;
    let tail_budget = max_bytes.saturating_sub(head_budget + 96);
    let mut head_end = head_budget.min(text.len());
    while head_end > 0 && !text.is_char_boundary(head_end) {
        head_end -= 1;
    }
    let mut tail_start = text.len().saturating_sub(tail_budget);
    while tail_start < text.len() && !text.is_char_boundary(tail_start) {
        tail_start += 1;
    }
    let omitted = tail_start.saturating_sub(head_end);
    format!("{}\n\n[… {} octets tronqués / bytes truncated …]\n\n{}", &text[..head_end], omitted, &text[tail_start..])
}

/// Kills the spawned shell process tree if the async task is dropped (timeout or cancellation).
struct KillOnDrop {
    pid: Option<u32>,
}

impl KillOnDrop {
    fn disarm(&mut self) {
        self.pid = None;
    }
}

impl Drop for KillOnDrop {
    fn drop(&mut self) {
        if let Some(pid) = self.pid.take() {
            kill_process_tree(pid);
        }
    }
}

async fn read_capped<R: tokio::io::AsyncRead + Unpin>(mut reader: R, limit: usize) -> Vec<u8> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if buf.len() < limit {
                    let take = n.min(limit - buf.len());
                    buf.extend_from_slice(&chunk[..take]);
                }
            }
        }
    }
    buf
}

fn exec_read(
    root: &Path,
    scope: WorkspaceScope,
    path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> AppResult<WorkspaceOpResult> {
    let target = resolve_confined(root, path, scope, false)?;
    if target.is_dir() {
        let mut dirs = Vec::new();
        let mut files = Vec::new();
        for entry in std::fs::read_dir(&target)?.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let meta = entry.metadata().ok();
            if meta.as_ref().is_some_and(|m| m.is_dir()) {
                dirs.push(format!("{name}/"));
            } else {
                let size = meta.map_or(0, |m| m.len());
                files.push(format!("{name} ({size} B)"));
            }
        }
        dirs.sort();
        files.sort();
        let total = dirs.len() + files.len();
        let mut lines: Vec<String> = dirs.into_iter().chain(files).take(MAX_DIR_ENTRIES).collect();
        if total > MAX_DIR_ENTRIES {
            lines.push(format!("[… {} more entries]", total - MAX_DIR_ENTRIES));
        }
        return Ok(WorkspaceOpResult {
            text: if lines.is_empty() { "(empty directory)".into() } else { lines.join("\n") },
            is_error: false,
            change: None,
        });
    }

    let meta = std::fs::metadata(&target)?;
    if meta.len() > MAX_READ_FILE_BYTES {
        return Err(AppError::Invalid(crate::tr!(
            "fichier trop volumineux ({} octets, max {} Mo)",
            "file too large ({} bytes, max {} MB)",
            meta.len(),
            MAX_READ_FILE_BYTES / (1024 * 1024)
        )));
    }
    let bytes = std::fs::read(&target)?;
    let content = String::from_utf8(bytes).map_err(|_| {
        AppError::Invalid(crate::tr!("fichier binaire non lisible en UTF-8", "binary file (not UTF-8)"))
    })?;
    let all_lines: Vec<&str> = content.lines().collect();
    let total = all_lines.len();
    let start = offset.unwrap_or(1).saturating_sub(1).min(total);
    let count = limit.unwrap_or(400).clamp(1, 2000);
    let end = (start + count).min(total);
    let mut out = String::new();
    for (idx, line) in all_lines[start..end].iter().enumerate() {
        let formatted = format!("{}: {line}\n", start + idx + 1);
        if out.len() + formatted.len() > MAX_READ_OUTPUT_BYTES {
            out.push_str("[… output truncated]\n");
            break;
        }
        out.push_str(&formatted);
    }
    if end < total {
        out.push_str(&format!("[showing lines {}-{} of {}]", start + 1, end, total));
    }
    Ok(WorkspaceOpResult { text: out, is_error: false, change: None })
}

fn exec_write(root: &Path, scope: WorkspaceScope, path: &str, content: &str) -> AppResult<WorkspaceOpResult> {
    if content.len() > MAX_WRITE_BYTES {
        return Err(AppError::Invalid(crate::tr!(
            "contenu trop volumineux (max {} Ko)",
            "content too large (max {} KB)",
            MAX_WRITE_BYTES / 1024
        )));
    }
    let root_canon = std::fs::canonicalize(root)?;
    let target = resolve_confined(root, path, scope, true)?;
    let before = if target.is_file() { std::fs::read_to_string(&target).ok() } else { None };
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&target, content)?;
    let rel = display_rel(&target, &root_canon);
    let mut change = compute_diff(&rel, before.as_deref(), Some(content));
    if let Some(ref mut c) = change {
        if is_markdown(&target) && content.len() <= MAX_MARKDOWN_CONTENT_BYTES {
            c.content = Some(content.to_string());
        }
    }
    let lines = content.lines().count();
    Ok(WorkspaceOpResult {
        text: format!("Wrote {rel} ({lines} lines, {} bytes)", content.len()),
        is_error: false,
        change,
    })
}

fn exec_edit(
    root: &Path,
    scope: WorkspaceScope,
    path: &str,
    old_text: &str,
    new_text: &str,
    replace_all: bool,
) -> AppResult<WorkspaceOpResult> {
    if old_text.is_empty() {
        return Err(AppError::Invalid(crate::tr!("old_text ne peut pas être vide", "old_text cannot be empty")));
    }
    let root_canon = std::fs::canonicalize(root)?;
    let target = resolve_confined(root, path, scope, false)?;
    let before = std::fs::read_to_string(&target).map_err(|_| {
        AppError::Invalid(crate::tr!("impossible de lire le fichier texte", "unable to read text file"))
    })?;
    let matches = before.matches(old_text).count();
    if matches == 0 {
        return Err(AppError::Invalid(crate::tr!(
            "bloc old_text introuvable dans le fichier",
            "old_text not found in file"
        )));
    }
    if matches > 1 && !replace_all {
        return Err(AppError::Invalid(crate::tr!(
            "{matches} occurrences trouvées : fournis plus de contexte ou passe replace_all: true",
            "{matches} matches found: provide more context or set replace_all: true"
        )));
    }
    let after = if replace_all { before.replace(old_text, new_text) } else { before.replacen(old_text, new_text, 1) };
    if after.len() > MAX_WRITE_BYTES {
        return Err(AppError::Invalid(crate::tr!("fichier résultant trop volumineux", "resulting file too large")));
    }
    std::fs::write(&target, &after)?;
    let rel = display_rel(&target, &root_canon);
    let mut change = compute_diff(&rel, Some(&before), Some(&after));
    if let Some(ref mut c) = change {
        if is_markdown(&target) && after.len() <= MAX_MARKDOWN_CONTENT_BYTES {
            c.content = Some(after.clone());
        }
    }
    Ok(WorkspaceOpResult {
        text: format!(
            "Edited {rel} ({} replacement{})",
            if replace_all { matches } else { 1 },
            if replace_all && matches > 1 { "s" } else { "" }
        ),
        is_error: false,
        change,
    })
}

fn exec_search(
    root: &Path,
    scope: WorkspaceScope,
    mode: SearchMode,
    pattern: &str,
    subpath: Option<&str>,
    case_insensitive: bool,
    max_results: Option<usize>,
) -> AppResult<WorkspaceOpResult> {
    if pattern.trim().is_empty() {
        return Err(AppError::Invalid(crate::tr!("motif de recherche vide", "empty search pattern")));
    }
    let root_canon = std::fs::canonicalize(root)?;
    let base = resolve_confined(root, subpath.unwrap_or("."), scope, false)?;
    let limit = max_results.unwrap_or(100).clamp(1, MAX_SEARCH_RESULTS);
    let walker = ignore::WalkBuilder::new(&base)
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .filter_entry(|e| e.file_name() != ".git")
        .build();

    let mut out = String::new();
    let mut found = 0usize;
    let needle_lower = case_insensitive.then(|| pattern.to_ascii_lowercase());
    let effective_ci = case_insensitive || (mode == SearchMode::Glob && cfg!(windows));

    for entry in walker.flatten().take(MAX_SEARCH_WALK) {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let path = entry.path();
        let rel = display_rel(path, &root_canon);
        match mode {
            SearchMode::Glob => {
                let matched = glob_match(pattern, &rel, effective_ci)
                    || path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|name| glob_match(pattern, name, effective_ci));
                if matched {
                    out.push_str(&rel);
                    out.push('\n');
                    found += 1;
                }
            }
            SearchMode::Grep => {
                let Ok(meta) = entry.metadata() else { continue };
                if meta.len() > MAX_WRITE_BYTES as u64 {
                    continue;
                }
                let Ok(content) = std::fs::read_to_string(path) else { continue };
                for (idx, line) in content.lines().enumerate() {
                    let hit = match &needle_lower {
                        Some(lower) => line.to_ascii_lowercase().contains(lower),
                        None => line.contains(pattern),
                    };
                    if hit {
                        let snippet: String = line.chars().take(240).collect();
                        out.push_str(&format!("{rel}:{}: {snippet}\n", idx + 1));
                        found += 1;
                        if found >= limit || out.len() >= MAX_SEARCH_OUTPUT_BYTES {
                            break;
                        }
                    }
                }
            }
        }
        if found >= limit || out.len() >= MAX_SEARCH_OUTPUT_BYTES {
            out.push_str("[… results truncated]\n");
            break;
        }
    }
    if found == 0 {
        out = "No matches found.".into();
    }
    Ok(WorkspaceOpResult { text: out, is_error: false, change: None })
}

async fn exec_run(
    root: &Path,
    scope: WorkspaceScope,
    command: &str,
    sub_cwd: Option<&str>,
    timeout_secs: Option<u64>,
) -> AppResult<WorkspaceOpResult> {
    if command.trim().is_empty() {
        return Err(AppError::Invalid(crate::tr!("commande vide", "empty command")));
    }
    let workdir = resolve_confined(root, sub_cwd.unwrap_or("."), scope, false)?;
    if !workdir.is_dir() {
        return Err(AppError::Invalid(crate::tr!(
            "le dossier d'exécution n'est pas un répertoire",
            "command working directory is not a folder"
        )));
    }
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(DEFAULT_RUN_TIMEOUT_SECS).clamp(1, MAX_RUN_TIMEOUT_SECS));

    let mut cmd = if cfg!(windows) {
        let mut c = tokio::process::Command::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command", command]);
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            c.creation_flags(CREATE_NO_WINDOW);
        }
        c
    } else {
        let mut c = tokio::process::Command::new("sh");
        c.args(["-c", command]);
        #[cfg(unix)]
        c.process_group(0);
        c
    };
    cmd.current_dir(&workdir).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(path) = crate::env_path::path() {
        cmd.env("PATH", path);
    }

    let mut child = cmd.spawn().map_err(|e| AppError::Other(format!("spawn failed: {e}")))?;
    let mut guard = KillOnDrop { pid: child.id() };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let wait_all = async {
        let out_fut = async {
            match stdout {
                Some(r) => read_capped(r, MAX_CMD_STREAM_BYTES).await,
                None => Vec::new(),
            }
        };
        let err_fut = async {
            match stderr {
                Some(r) => read_capped(r, MAX_CMD_STREAM_BYTES).await,
                None => Vec::new(),
            }
        };
        let (out_bytes, err_bytes, status) = tokio::join!(out_fut, err_fut, child.wait());
        (out_bytes, err_bytes, status)
    };

    let (out_bytes, err_bytes, status) = match tokio::time::timeout(timeout, wait_all).await {
        Ok(res) => {
            guard.disarm();
            res
        }
        Err(_) => {
            drop(guard);
            let _ = child.wait().await;
            return Ok(WorkspaceOpResult {
                text: format!("Command timed out after {} s", timeout.as_secs()),
                is_error: true,
                change: None,
            });
        }
    };

    let status = status.map_err(|e| AppError::Other(format!("wait failed: {e}")))?;
    let code = status.code().unwrap_or(-1);
    let out_str = String::from_utf8_lossy(&out_bytes);
    let err_str = String::from_utf8_lossy(&err_bytes);
    let mut combined = format!("exit code: {code}\n");
    if !out_str.is_empty() {
        combined.push_str(&out_str);
        if !combined.ends_with('\n') {
            combined.push('\n');
        }
    }
    if !err_str.is_empty() {
        combined.push_str("[stderr]\n");
        combined.push_str(&err_str);
    }
    Ok(WorkspaceOpResult {
        text: truncate_head_tail(combined.trim_end(), MAX_CMD_OUTPUT_BYTES),
        is_error: !status.success(),
        change: None,
    })
}

/// Executes a single workspace operation inside `root_cwd` with `scope` and `read_only` enforcement.
pub async fn execute(
    root_cwd: &Path,
    scope: WorkspaceScope,
    read_only: bool,
    op: WorkspaceOp,
) -> AppResult<WorkspaceOpResult> {
    if read_only && matches!(op, WorkspaceOp::Write { .. } | WorkspaceOp::Edit { .. } | WorkspaceOp::Run { .. }) {
        return Err(AppError::Invalid(crate::tr!(
            "action refusée en mode lecture seule (Plan)",
            "action refused in read-only (Plan) mode"
        )));
    }
    let root = root_cwd.to_path_buf();
    match op {
        WorkspaceOp::Read { path, offset, limit } => {
            tokio::task::spawn_blocking(move || exec_read(&root, scope, &path, offset, limit)).await?
        }
        WorkspaceOp::Write { path, content } => {
            tokio::task::spawn_blocking(move || exec_write(&root, scope, &path, &content)).await?
        }
        WorkspaceOp::Edit { path, old_text, new_text, replace_all } => {
            tokio::task::spawn_blocking(move || {
                exec_edit(&root, scope, &path, &old_text, &new_text, replace_all.unwrap_or(false))
            })
            .await?
        }
        WorkspaceOp::Search { mode, pattern, path, case_insensitive, max_results } => {
            tokio::task::spawn_blocking(move || {
                exec_search(
                    &root,
                    scope,
                    mode,
                    &pattern,
                    path.as_deref(),
                    case_insensitive.unwrap_or(false),
                    max_results,
                )
            })
            .await?
        }
        WorkspaceOp::Run { command, cwd, timeout_secs } => {
            exec_run(&root, scope, &command, cwd.as_deref(), timeout_secs).await
        }
    }
}

/// Checks whether `root_cwd` is inside (or equal to) at least one registered Neuron project on this device.
async fn verify_registered_project(state: &Shared, root_cwd: &str) -> AppResult<()> {
    let target = std::fs::canonicalize(root_cwd).map_err(|_| {
        AppError::NotFound(crate::tr!(
            "dossier de travail introuvable : {root_cwd}",
            "working folder not found: {root_cwd}"
        ))
    })?;
    let projects = state.db.call(|c| projects::list(c)).await?;
    let inside = projects.iter().filter_map(|p| std::fs::canonicalize(&p.path).ok()).any(|p| target.starts_with(&p));
    if !inside {
        return Err(AppError::Invalid(crate::tr!(
            "dossier refusé : seuls les projets enregistrés dans Neuron sont autorisés sur cet appareil",
            "folder refused: only registered Neuron projects are allowed on this device"
        )));
    }
    Ok(())
}

/// Authorizes and executes a workspace op received from a paired client (Direction 1: host mode).
pub async fn execute_as_host(
    state: &Shared,
    root_cwd: &str,
    read_only: bool,
    op: WorkspaceOp,
) -> AppResult<WorkspaceOpResult> {
    let settings = state.db.call(|c| load_settings(c)).await?;
    if !settings.allow_remote_tools {
        return Err(AppError::Invalid(crate::tr!(
            "l'exécution d'outils distants est désactivée sur cet appareil (Paramètres › Appareils)",
            "remote tool execution is disabled on this device (Settings › Devices)"
        )));
    }
    if settings.remote_tools_scope == WorkspaceScope::ProjectOnly {
        verify_registered_project(state, root_cwd).await?;
    }
    execute(Path::new(root_cwd), settings.remote_tools_scope, read_only, op).await
}

/// Authorizes and executes a workspace op using an explicit grant issued by this device (Direction 2).
pub async fn execute_with_grant(
    state: &Shared,
    peer_node_id: &str,
    grant_id: &str,
    read_only: bool,
    op: WorkspaceOp,
) -> AppResult<WorkspaceOpResult> {
    let (gid, peer) = (grant_id.to_string(), peer_node_id.to_string());
    let grant = state.db.call(move |c| store::get_active_grant(c, &gid, &peer)).await?.ok_or_else(|| {
        AppError::Invalid(crate::tr!(
            "autorisation d'accès au dossier révoquée ou invalide",
            "workspace access grant revoked or invalid"
        ))
    })?;
    execute(Path::new(&grant.root_cwd), grant.scope, read_only, op).await
}

/// Builds a project `ContextBundle` on this device for a remote AI host.
pub async fn build_context(
    state: &Shared,
    root_cwd: &str,
    project_name: Option<String>,
) -> AppResult<Option<ContextBundle>> {
    let root = PathBuf::from(root_cwd);
    if !root.is_dir() {
        return Ok(None);
    }
    let opts = state.db.call(|c| crate::app_settings::load(c)).await?.context;
    let name = project_name.unwrap_or_else(|| {
        root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "project".into())
    });
    let bundle = tokio::task::spawn_blocking(move || crate::context::build(&root, &name, now_ms(), &opts)).await??;
    Ok(Some(bundle))
}

/// Context builder authorized in host mode (Direction 1).
pub async fn build_context_as_host(
    state: &Shared,
    root_cwd: &str,
    project_name: Option<String>,
) -> AppResult<Option<ContextBundle>> {
    let settings = state.db.call(|c| load_settings(c)).await?;
    if !settings.allow_remote_tools {
        return Err(AppError::Invalid(crate::tr!(
            "l'exécution d'outils distants est désactivée sur cet appareil",
            "remote tool execution is disabled on this device"
        )));
    }
    if settings.remote_tools_scope == WorkspaceScope::ProjectOnly {
        verify_registered_project(state, root_cwd).await?;
    }
    build_context(state, root_cwd, project_name).await
}

/// Context builder authorized via an explicit grant (Direction 2).
pub async fn build_context_with_grant(
    state: &Shared,
    peer_node_id: &str,
    grant_id: &str,
    project_name: Option<String>,
) -> AppResult<Option<ContextBundle>> {
    let (gid, peer) = (grant_id.to_string(), peer_node_id.to_string());
    let grant = state.db.call(move |c| store::get_active_grant(c, &gid, &peer)).await?.ok_or_else(|| {
        AppError::Invalid(crate::tr!(
            "autorisation d'accès au dossier révoquée ou invalide",
            "workspace access grant revoked or invalid"
        ))
    })?;
    build_context(state, &grant.root_cwd, project_name).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("neuron-ws-{tag}-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn confinement_blocks_parent_traversal() {
        let root = temp_dir("confine");
        let outside = temp_dir("outside");
        std::fs::write(root.join("ok.txt"), "hello").unwrap();
        std::fs::write(outside.join("secret.txt"), "nope").unwrap();

        assert!(resolve_confined(&root, "ok.txt", WorkspaceScope::ProjectOnly, false).is_ok());
        assert!(resolve_confined(&root, "sub/new.txt", WorkspaceScope::ProjectOnly, true).is_ok());
        assert!(resolve_confined(&root, "../secret.txt", WorkspaceScope::ProjectOnly, true).is_err());
        assert!(
            resolve_confined(
                &root,
                &outside.join("secret.txt").display().to_string(),
                WorkspaceScope::ProjectOnly,
                false
            )
            .is_err()
        );
        // Full scope permits paths outside root.
        assert!(
            resolve_confined(&root, &outside.join("secret.txt").display().to_string(), WorkspaceScope::Full, false)
                .is_ok()
        );

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(outside);
    }

    #[tokio::test]
    async fn read_write_edit_search_and_read_only() {
        let root = temp_dir("ops");
        // Write computes a FileChange diff.
        let res = execute(
            &root,
            WorkspaceScope::ProjectOnly,
            false,
            WorkspaceOp::Write {
                path: "src/hello.rs".into(),
                content: "fn main() {\n    println!(\"hi\");\n}\n".into(),
            },
        )
        .await
        .unwrap();
        assert!(!res.is_error);
        let change = res.change.expect("write returns FileChange");
        assert_eq!((change.path.as_str(), change.kind.as_str(), change.added), ("src/hello.rs", "add", 3));

        // Edit updates file and produces unified diff.
        let res = execute(
            &root,
            WorkspaceScope::ProjectOnly,
            false,
            WorkspaceOp::Edit {
                path: "src/hello.rs".into(),
                old_text: "println!(\"hi\");".into(),
                new_text: "println!(\"bonjour\");".into(),
                replace_all: None,
            },
        )
        .await
        .unwrap();
        let change = res.change.expect("edit returns FileChange");
        assert_eq!((change.kind.as_str(), change.added, change.removed), ("update", 1, 1));
        assert!(change.diff.contains("+    println!(\"bonjour\");"));

        // Read returns numbered lines.
        let read = execute(
            &root,
            WorkspaceScope::ProjectOnly,
            true,
            WorkspaceOp::Read { path: "src/hello.rs".into(), offset: Some(1), limit: Some(10) },
        )
        .await
        .unwrap();
        assert!(read.text.contains("2:     println!(\"bonjour\");"));

        // Search (glob + grep).
        let glob = execute(
            &root,
            WorkspaceScope::ProjectOnly,
            true,
            WorkspaceOp::Search {
                mode: SearchMode::Glob,
                pattern: "**/*.rs".into(),
                path: None,
                case_insensitive: None,
                max_results: None,
            },
        )
        .await
        .unwrap();
        assert!(glob.text.contains("src/hello.rs"));

        let grep = execute(
            &root,
            WorkspaceScope::ProjectOnly,
            true,
            WorkspaceOp::Search {
                mode: SearchMode::Grep,
                pattern: "bonjour".into(),
                path: None,
                case_insensitive: None,
                max_results: None,
            },
        )
        .await
        .unwrap();
        assert!(grep.text.contains("src/hello.rs:2:"));

        // Read-only (plan mode) refuses mutations and shell.
        for op in [
            WorkspaceOp::Write { path: "a.txt".into(), content: "x".into() },
            WorkspaceOp::Edit {
                path: "src/hello.rs".into(),
                old_text: "a".into(),
                new_text: "b".into(),
                replace_all: None,
            },
            WorkspaceOp::Run { command: "echo hi".into(), cwd: None, timeout_secs: Some(5) },
        ] {
            assert!(execute(&root, WorkspaceScope::ProjectOnly, true, op).await.is_err());
        }

        // Run executes a simple command.
        let run = execute(
            &root,
            WorkspaceScope::ProjectOnly,
            false,
            WorkspaceOp::Run { command: "echo neuron-ok".into(), cwd: None, timeout_secs: Some(10) },
        )
        .await
        .unwrap();
        assert!(!run.is_error, "{}", run.text);
        assert!(run.text.contains("neuron-ok"));

        let _ = std::fs::remove_dir_all(root);
    }
}

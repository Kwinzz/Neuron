//! Diffs of the files an agent edits, computed by Neuron for every provider.
//!
//! Antigravity (`write_file`, `edit_file`…) and Codex (`file_change`) only report the edited paths, and Claude's
//! `Write` only the new content. So the pump reads each edited file when the tool starts (the CLIs announce the
//! edit before writing it: verified for agy `ACTIVE` and Codex `item.started`) and again when it ends, then stores a
//! unified diff with the tool call.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use similar::{ChangeTag, TextDiff};
use ts_rs::TS;

/// Files above this size are not diffed.
const MAX_FILE_BYTES: u64 = 1024 * 1024;
/// Diff text kept per file.
const MAX_DIFF_BYTES: usize = 200 * 1024;

/// One file modified by a tool call.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileChange {
    /// Relative to the chat folder when inside it.
    pub path: String,
    /// `add` | `update` | `delete`.
    pub kind: String,
    /// Unified diff (`@@` hunks, 3 lines of context), without file headers.
    pub diff: String,
    pub added: u32,
    pub removed: u32,
    /// The diff was cut at 200 KB.
    pub truncated: bool,
    /// Full new content of Markdown files (plans are shown as documents), up to 200 KB.
    pub content: Option<String>,
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdx"))
}

/// Tools that write files, lower-cased (Claude, Antigravity, Codex).
const EDIT_TOOLS: &[&str] = &[
    "edit",
    "multiedit",
    "write",
    "write_file",
    "edit_file",
    "write_to_file",
    "replace_file_content",
    "multi_replace_file_content",
    "filechange",
    "apply_patch",
];

const PATH_FIELDS: &[&str] = &["file_path", "path", "Path", "TargetFile", "AbsolutePath", "filePath"];

fn resolve(raw: &str, cwd: Option<&Path>) -> PathBuf {
    let p = PathBuf::from(raw.trim());
    match cwd {
        Some(dir) if p.is_relative() => dir.join(p),
        _ => p,
    }
}

/// Files a tool call is about to modify (empty for any other tool).
pub fn edited_paths(tool: &str, input: &Value, cwd: Option<&Path>) -> Vec<PathBuf> {
    let base = tool.rsplit("__").next().unwrap_or(tool).to_ascii_lowercase();
    if !EDIT_TOOLS.contains(&base.as_str()) {
        return Vec::new();
    }
    // Codex: { changes: [{ path, kind }] }
    if let Some(changes) = input.get("changes").and_then(Value::as_array) {
        return changes
            .iter()
            .filter_map(|c| c.get("path").and_then(Value::as_str))
            .map(|p| resolve(p, cwd))
            .collect();
    }
    PATH_FIELDS
        .iter()
        .find_map(|k| input.get(*k).and_then(Value::as_str).filter(|s| !s.trim().is_empty()))
        .map(|p| vec![resolve(p, cwd)])
        .unwrap_or_default()
}

/// Text content, `None` when missing; `Err` when unreadable as text (binary, too large).
async fn read_text(path: &Path) -> Result<Option<String>, ()> {
    match tokio::fs::metadata(path).await {
        Err(_) => return Ok(None),
        Ok(m) if !m.is_file() || m.len() > MAX_FILE_BYTES => return Err(()),
        Ok(_) => {}
    }
    let bytes = tokio::fs::read(path).await.map_err(|_| ())?;
    String::from_utf8(bytes).map(Some).map_err(|_| ())
}

fn display_path(path: &Path, cwd: Option<&Path>) -> String {
    let shown = cwd.and_then(|dir| path.strip_prefix(dir).ok()).unwrap_or(path);
    shown.to_string_lossy().replace('\\', "/")
}

/// Diff between two versions of a file (`None` = absent). `None` when nothing changed.
pub fn compute(path: &str, before: Option<&str>, after: Option<&str>) -> Option<FileChange> {
    if before == after {
        return None;
    }
    let kind = match (before, after) {
        (None, _) => "add",
        (_, None) => "delete",
        _ => "update",
    };
    let (old, new) = (before.unwrap_or(""), after.unwrap_or(""));
    let diff = TextDiff::from_lines(old, new);
    let (mut added, mut removed) = (0u32, 0u32);
    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Insert => added += 1,
            ChangeTag::Delete => removed += 1,
            ChangeTag::Equal => {}
        }
    }
    let mut text = diff.unified_diff().context_radius(3).to_string();
    let truncated = text.len() > MAX_DIFF_BYTES;
    if truncated {
        let mut cut = MAX_DIFF_BYTES;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(text[..cut].rfind('\n').map_or(cut, |i| i + 1));
    }
    Some(FileChange { path: path.to_string(), kind: kind.into(), diff: text, added, removed, truncated, content: None })
}

/// Per-session snapshots of the files being edited, keyed by tool call id.
#[derive(Default)]
pub struct FileTracker {
    cwd: Option<PathBuf>,
    pending: HashMap<String, Vec<(PathBuf, Option<String>)>>,
}

impl FileTracker {
    pub fn new(cwd: Option<PathBuf>) -> Self {
        Self { cwd, pending: HashMap::new() }
    }

    /// Snapshot the files a tool is about to modify.
    pub async fn start(&mut self, tool_id: &str, tool: &str, input: &Value) {
        let paths = edited_paths(tool, input, self.cwd.as_deref());
        if paths.is_empty() {
            return;
        }
        let mut snapshots = Vec::with_capacity(paths.len());
        for path in paths {
            // Unreadable (binary, too large): no diff for this file.
            if let Ok(before) = read_text(&path).await {
                snapshots.push((path, before));
            }
        }
        self.pending.insert(tool_id.to_string(), snapshots);
    }

    /// Diffs of the files the tool modified (empty when it was not an edit or changed nothing).
    pub async fn finish(&mut self, tool_id: &str) -> Vec<FileChange> {
        let Some(snapshots) = self.pending.remove(tool_id) else { return Vec::new() };
        let mut out = Vec::new();
        for (path, before) in snapshots {
            let Ok(after) = read_text(&path).await else { continue };
            if let Some(mut change) = compute(&display_path(&path, self.cwd.as_deref()), before.as_deref(), after.as_deref()) {
                if is_markdown(&path) {
                    change.content = after.filter(|a| a.len() <= MAX_DIFF_BYTES);
                }
                out.push(change);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn paths_of_each_provider() {
        let cwd = Path::new("C:/repo");
        assert_eq!(edited_paths("Edit", &json!({"file_path": "C:/repo/a.rs"}), Some(cwd)), [PathBuf::from("C:/repo/a.rs")]);
        assert_eq!(edited_paths("write_file", &json!({"Path": "b.txt"}), Some(cwd)), [cwd.join("b.txt")]);
        assert_eq!(
            edited_paths("FileChange", &json!({"changes": [{"path": "x.rs", "kind": "update"}, {"path": "y.rs", "kind": "add"}]}), Some(cwd))
                .len(),
            2
        );
        assert!(edited_paths("Read", &json!({"file_path": "a.rs"}), Some(cwd)).is_empty());
        assert!(edited_paths("Bash", &json!({"command": "rm a"}), None).is_empty());
    }

    #[test]
    fn diff_counts_and_kinds() {
        let c = compute("a.txt", Some("one\ntwo\nthree\n"), Some("one\nTWO\nthree\n")).unwrap();
        assert_eq!((c.kind.as_str(), c.added, c.removed), ("update", 1, 1));
        assert!(c.diff.starts_with("@@ -1,3 +1,3 @@"), "{}", c.diff);
        assert!(c.diff.contains("-two\n+TWO\n"));
        let added = compute("b.txt", None, Some("hello\n")).unwrap();
        assert_eq!((added.kind.as_str(), added.added, added.removed), ("add", 1, 0));
        assert!(compute("c.txt", Some("same"), Some("same")).is_none());
    }

    #[tokio::test]
    async fn tracker_reads_before_and_after() {
        let dir = std::env::temp_dir().join(format!("neuron-fc-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), "line one\nline two\n").unwrap();
        let mut t = FileTracker::new(Some(dir.clone()));
        t.start("t1", "edit_file", &json!({"Path": dir.join("a.txt").to_string_lossy()})).await;
        std::fs::write(dir.join("a.txt"), "line one\nLINE 2\n").unwrap();
        let changes = t.finish("t1").await;
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, "a.txt");
        assert_eq!((changes[0].added, changes[0].removed), (1, 1));
        assert_eq!(changes[0].content, None);
        assert!(t.finish("t1").await.is_empty());
        // Markdown (plans): the full content is kept.
        t.start("t2", "write_file", &json!({"Path": dir.join("plan.md").to_string_lossy()})).await;
        std::fs::write(dir.join("plan.md"), "# Plan\n\n1. Fix\n").unwrap();
        let plan = t.finish("t2").await;
        assert_eq!(plan[0].kind, "add");
        assert_eq!(plan[0].content.as_deref(), Some("# Plan\n\n1. Fix\n"));
        let _ = std::fs::remove_dir_all(dir);
    }
}

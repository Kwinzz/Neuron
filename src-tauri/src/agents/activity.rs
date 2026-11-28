//! Maps a tool invocation to a granular thread status + short human detail
//! ("Édition de app.tsx", "npm run build"…). Shared by every adapter.

use serde_json::Value;

use crate::agents::events::ThreadStatus;

fn str_field<'a>(input: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| input.get(*k).and_then(Value::as_str)).filter(|s| !s.is_empty())
}

fn file_name(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

fn truncate(text: &str, max: usize) -> String {
    let line = text.lines().next().unwrap_or("").trim();
    if line.chars().count() <= max {
        line.to_string()
    } else {
        format!("{}…", line.chars().take(max).collect::<String>())
    }
}

/// Returns the status and detail to show while `tool` runs with `input`.
pub fn tool_activity(tool: &str, input: &Value) -> (ThreadStatus, Option<String>) {
    let base = tool.rsplit("__").next().unwrap_or(tool);
    let base = base.rsplit('.').next().unwrap_or(base);
    let lower = base.to_ascii_lowercase();
    let path = str_field(
        input,
        &["file_path", "path", "notebook_path", "Path", "TargetFile", "AbsolutePath", "DirectoryPath"],
    )
    .map(file_name);
    match lower.as_str() {
        "read" | "ls" | "notebookread" | "view_file" | "read_file" | "list_dir" | "view_code_item" | "remote_read" => {
            (ThreadStatus::Reading, path)
        }
        "glob" | "grep" | "grep_search" | "find_by_name" | "codebase_search" | "remote_search" => (
            ThreadStatus::Reading,
            str_field(input, &["pattern", "query", "Query", "Pattern", "SearchPath"]).map(|p| truncate(p, 48)),
        ),
        "webfetch" | "websearch" => {
            (ThreadStatus::Reading, str_field(input, &["url", "query"]).map(|p| truncate(p, 48)))
        }
        "edit"
        | "multiedit"
        | "write"
        | "notebookedit"
        | "apply_patch"
        | "write_file"
        | "write_to_file"
        | "replace_file_content"
        | "multi_replace_file_content"
        | "edit_file"
        | "remote_write"
        | "remote_edit" => (ThreadStatus::Editing, path),
        "filechange" => (
            ThreadStatus::Editing,
            input
                .get("changes")
                .and_then(Value::as_array)
                .and_then(|c| c.first())
                .and_then(|c| str_field(c, &["path"]))
                .map(file_name),
        ),
        "bash" | "powershell" | "shell" | "exec" | "run_command" | "execute_command" | "remote_run" => (
            ThreadStatus::Running,
            str_field(input, &["command", "cmd", "CommandLine", "Command"]).map(|c| truncate(c, 60)),
        ),
        "task" | "agent" => (
            ThreadStatus::Running,
            str_field(input, &["description", "prompt"]).map(|d| {
                let d = truncate(d, 48);
                crate::tr!("Sous-agent : {d}", "Sub-agent: {d}")
            }),
        ),
        _ => (ThreadStatus::Running, Some(tool.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_common_tools() {
        assert_eq!(
            tool_activity("Edit", &json!({"file_path": "C:\\repo\\src\\app.tsx"})),
            (ThreadStatus::Editing, Some("app.tsx".into()))
        );
        assert_eq!(
            tool_activity("Read", &json!({"file_path": "/repo/lib.rs"})),
            (ThreadStatus::Reading, Some("lib.rs".into()))
        );
        assert_eq!(
            tool_activity("Bash", &json!({"command": "npm run build\nnpm test"})),
            (ThreadStatus::Running, Some("npm run build".into()))
        );
        assert_eq!(
            tool_activity("mcp__neuron__memory_read", &json!({})),
            (ThreadStatus::Running, Some("mcp__neuron__memory_read".into()))
        );
        assert_eq!(
            tool_activity("write_file", &json!({"Path": r"C:\w\hi.txt"})),
            (ThreadStatus::Editing, Some("hi.txt".into()))
        );
        assert_eq!(
            tool_activity("run_command", &json!({"CommandLine": "cargo test"})),
            (ThreadStatus::Running, Some("cargo test".into()))
        );
        assert_eq!(
            tool_activity("FileChange", &json!({"changes": [{"path": "src/a.rs", "kind": "update"}]})),
            (ThreadStatus::Editing, Some("a.rs".into()))
        );
    }
}

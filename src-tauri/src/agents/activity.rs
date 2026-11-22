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
    let lower = tool.to_ascii_lowercase();
    let path = str_field(input, &["file_path", "path", "notebook_path"]).map(file_name);
    match lower.as_str() {
        "read" | "ls" | "notebookread" => (ThreadStatus::Reading, path),
        "glob" | "grep" => (
            ThreadStatus::Reading,
            str_field(input, &["pattern", "query"]).map(|p| truncate(p, 48)),
        ),
        "webfetch" | "websearch" => (
            ThreadStatus::Reading,
            str_field(input, &["url", "query"]).map(|p| truncate(p, 48)),
        ),
        "edit" | "multiedit" | "write" | "notebookedit" | "apply_patch" => (ThreadStatus::Editing, path),
        "bash" | "powershell" | "shell" | "exec" => (
            ThreadStatus::Running,
            str_field(input, &["command", "cmd"]).map(|c| truncate(c, 60)),
        ),
        "task" | "agent" => (
            ThreadStatus::Running,
            str_field(input, &["description", "prompt"]).map(|d| format!("Sous-agent : {}", truncate(d, 48))),
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
    }
}

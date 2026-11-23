//! Codex subscription limits. `codex exec --json` doesn't stream them, but Codex writes them in its session
//! file (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-…-<thread_id>.jsonl`, `token_count` events):
//! `rate_limits.primary` / `secondary` = `{ used_percent, window_minutes, resets_at (s) }`.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::agents::RateLimitWindow;

fn codex_home() -> Option<PathBuf> {
    match std::env::var_os("CODEX_HOME") {
        Some(dir) if !dir.is_empty() => Some(PathBuf::from(dir)),
        _ => std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(|h| PathBuf::from(h).join(".codex")),
    }
}

/// Window name shared with Claude's (`five_hour`, `seven_day`) plus `thirty_day` / `<n>_min`.
pub fn window_name(minutes: u64) -> String {
    match minutes {
        300 => "five_hour".into(),
        10_080 => "seven_day".into(),
        43_200 => "thirty_day".into(),
        n => format!("{n}_min"),
    }
}

/// Windows from a `rate_limits` object.
pub fn parse_rate_limits(limits: &Value) -> Vec<RateLimitWindow> {
    ["primary", "secondary"]
        .iter()
        .filter_map(|key| {
            let w = limits.get(*key)?;
            let used = w.get("used_percent")?.as_f64()?;
            let minutes = w.get("window_minutes")?.as_u64()?;
            let resets_at = w.get("resets_at").and_then(Value::as_i64).map(|s| s * 1000).or_else(|| {
                w.get("resets_in_seconds").and_then(Value::as_i64).map(|s| crate::util::now_ms() + s * 1000)
            });
            Some(RateLimitWindow {
                window: window_name(minutes),
                utilization: (used / 100.0).clamp(0.0, 1.0),
                resets_at,
                ..Default::default()
            })
        })
        .collect()
}

/// Session file of a Codex thread (newest days first; bounded walk).
fn find_session(root: &Path, thread_id: &str) -> Option<PathBuf> {
    let suffix = format!("{thread_id}.jsonl");
    let mut dirs = vec![root.to_path_buf()];
    for _depth in 0..4 {
        let mut next = Vec::new();
        for dir in dirs {
            let Ok(entries) = std::fs::read_dir(&dir) else { continue };
            let mut entries: Vec<_> = entries.flatten().collect();
            entries.sort_by_key(|e| std::cmp::Reverse(e.file_name()));
            for entry in entries.into_iter().take(400) {
                let path = entry.path();
                if path.is_dir() {
                    next.push(path);
                } else if path.file_name().is_some_and(|n| n.to_string_lossy().ends_with(&suffix)) {
                    return Some(path);
                }
            }
        }
        dirs = next;
    }
    None
}

/// Latest limits recorded for a Codex thread, if any.
pub fn read_for_thread(thread_id: &str) -> Option<Vec<RateLimitWindow>> {
    let file = find_session(&codex_home()?.join("sessions"), thread_id)?;
    let text = std::fs::read_to_string(file).ok()?;
    let line = text.lines().rev().find(|l| l.contains("\"rate_limits\""))?;
    let value: Value = serde_json::from_str(line).ok()?;
    let limits = value.pointer("/payload/rate_limits").or_else(|| value.get("rate_limits"))?;
    let windows = parse_rate_limits(limits);
    (!windows.is_empty()).then_some(windows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_primary_and_secondary() {
        let v: Value = serde_json::from_str(
            r#"{"primary":{"used_percent":42.0,"window_minutes":300,"resets_at":1800000000},
                "secondary":{"used_percent":7.5,"window_minutes":10080,"resets_at":1800500000},"credits":null}"#,
        )
        .unwrap();
        let w = parse_rate_limits(&v);
        assert_eq!(w.len(), 2);
        assert_eq!((w[0].window.as_str(), w[0].resets_at), ("five_hour", Some(1_800_000_000_000)));
        assert!((w[0].utilization - 0.42).abs() < 1e-9);
        assert_eq!(w[1].window, "seven_day");
        let free: Value = serde_json::from_str(
            r#"{"primary":{"used_percent":1.0,"window_minutes":43200,"resets_at":1},"secondary":null}"#,
        )
        .unwrap();
        assert_eq!(parse_rate_limits(&free)[0].window, "thirty_day");
    }

    #[test]
    fn finds_the_thread_file() {
        let root = std::env::temp_dir().join(format!("neuron-codex-{}", uuid::Uuid::new_v4().simple()));
        let day = root.join("2026").join("11").join("22");
        std::fs::create_dir_all(&day).unwrap();
        std::fs::write(
            day.join("rollout-2026-11-22T10-00-00-abc123.jsonl"),
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"rate_limits\":{\"primary\":{\"used_percent\":10,\"window_minutes\":300,\"resets_at\":5}}}}\n",
        )
        .unwrap();
        assert!(find_session(&root, "abc123").is_some());
        assert!(find_session(&root, "zzz").is_none());
        let _ = std::fs::remove_dir_all(root);
    }
}

//! Antigravity commands answered by the CLI itself: `/quota` (= `/usage`) and `/credits`.
//!
//! They are refused inside a stream-json session ("answered by the CLI itself … run it as its own --print
//! invocation"), so Neuron runs `agy --print /<name> --output-format json` separately: no model call, no
//! conversation, no token. `/quota` returns model groups (« Gemini Models », « Claude and GPT models »…), each with
//! a 5-hour and a weekly bucket (`remaining_fraction`, `reset_time`).

use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::agents::RateLimitWindow;
use crate::agents::events::AgentKind;
use crate::agents::process::{command, spawn_error};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::util::now_ms;

/// Emitted when an agent's subscription windows were refreshed outside a chat turn.
pub const QUOTAS_CHANGED_EVENT: &str = "quotas://changed";

/// Commands Neuron runs on its own for Antigravity chats: (name, French / English description for the « / » menu).
pub const LOCAL_COMMANDS: &[(&str, &str, &str)] = &[
    (
        "quota",
        "Quotas restants de l'abonnement (5 h et hebdomadaire, par groupe de modèles)",
        "Remaining subscription quotas (5-hour and weekly, per model group)",
    ),
    ("usage", "Alias de /quota", "Alias of /quota"),
    ("credits", "Crédits Antigravity restants", "Remaining Antigravity credits"),
];

const RUN_TIMEOUT: Duration = Duration::from_secs(30);
/// Background refreshes are skipped when the last one is more recent than this.
const MIN_REFRESH_MS: i64 = 60_000;

pub fn binary() -> String {
    std::env::var("NEURON_AGY_BIN").unwrap_or_else(|_| "agy".into())
}

/// `/quota`, `/usage`, `/credits` typed alone (arguments are not supported by agy for these).
pub fn local_command(text: &str) -> Option<&'static str> {
    let name = text.trim().strip_prefix('/')?;
    LOCAL_COMMANDS.iter().map(|(n, _, _)| *n).find(|n| *n == name)
}

/// `agy --print /<name> --output-format json` → its JSON result.
pub async fn run(name: &str, cwd: &Path) -> AppResult<Value> {
    let bin = binary();
    let args: Vec<String> =
        ["--print".to_string(), format!("/{name}"), "--output-format".into(), "json".into()].into_iter().collect();
    let child = command(&bin, &args, cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| spawn_error(&bin, e))?;
    let output = tokio::time::timeout(RUN_TIMEOUT, child.wait_with_output()).await.map_err(|_| {
        let secs = RUN_TIMEOUT.as_secs();
        AppError::Other(crate::tr!(
            "agy /{name} n'a pas répondu en {secs} s",
            "agy /{name} did not answer within {secs} s"
        ))
    })??;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let json = stdout.lines().rev().find_map(|l| serde_json::from_str::<Value>(l.trim()).ok());
    match json {
        Some(v) if v.get("status").and_then(Value::as_str) == Some("SUCCESS") => Ok(v),
        Some(v) => Err(AppError::Other(
            v.get("error")
                .and_then(Value::as_str)
                .unwrap_or(crate::i18n::pick("agy a renvoyé une erreur", "agy returned an error"))
                .to_string(),
        )),
        None => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail = stderr
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .unwrap_or(crate::i18n::pick("réponse illisible", "unreadable answer"));
            Err(AppError::Other(crate::tr!("agy /{name} : {}", "agy /{name}: {}", detail.trim())))
        }
    }
}

/// Window name shared with Claude/Codex (`five_hour`, `seven_day`).
fn window_name(window: &str) -> String {
    match window {
        "5h" => "five_hour".into(),
        "weekly" => "seven_day".into(),
        "daily" => "one_day".into(),
        other => other.to_string(),
    }
}

/// « Models within this group: A, B, C » → [A, B, C].
fn group_models(description: &str) -> Vec<String> {
    description
        .split_once("Models within this group:")
        .map(|(_, list)| {
            list.split(',').map(|m| m.trim().trim_end_matches('.').to_string()).filter(|m| !m.is_empty()).collect()
        })
        .unwrap_or_default()
}

/// Subscription windows from a `/quota` result.
pub fn windows(result: &Value) -> Vec<RateLimitWindow> {
    let Some(groups) = result.pointer("/command/data/groups").and_then(Value::as_array) else { return Vec::new() };
    let mut out = Vec::new();
    for group in groups {
        let name = group.get("name").and_then(Value::as_str).unwrap_or("").to_string();
        let mut models = group_models(group.get("description").and_then(Value::as_str).unwrap_or(""));
        if models.is_empty() && !name.is_empty() {
            models.push(name.clone()); // « Gemini 4 Argon »: the group is a single model
        }
        for bucket in group.get("buckets").and_then(Value::as_array).into_iter().flatten() {
            let (Some(window), Some(remaining)) = (
                bucket.get("window").and_then(Value::as_str),
                bucket.get("remaining_fraction").and_then(Value::as_f64),
            ) else {
                continue;
            };
            out.push(RateLimitWindow {
                window: window_name(window),
                utilization: (1.0 - remaining).clamp(0.0, 1.0),
                // An unused group reports `1970-01-01T00:00:00Z`: no window running, no reset time.
                resets_at: bucket.get("reset_time").and_then(Value::as_str).and_then(parse_rfc3339).filter(|t| *t > 0),
                group: (!name.is_empty()).then(|| name.clone()),
                models: models.clone(),
            });
        }
    }
    out
}

fn window_label(window: &str) -> &str {
    match window {
        "five_hour" => crate::i18n::pick("Limite 5 h", "5-hour limit"),
        "seven_day" => crate::i18n::pick("Limite hebdomadaire", "Weekly limit"),
        "one_day" => crate::i18n::pick("Limite quotidienne", "Daily limit"),
        other => other,
    }
}

/// « 5 j 21 h », « 4 h 58 min », « 12 min ».
fn countdown(ms: i64) -> String {
    let minutes = (ms.max(0) + 59_999) / 60_000;
    let (d, h, m) = (minutes / 1440, (minutes % 1440) / 60, minutes % 60);
    match (d, h) {
        (0, 0) => format!("{m} min"),
        (0, _) => format!("{h} h {m:02} min"),
        _ => crate::tr!("{d} j {h} h", "{d} d {h} h"),
    }
}

/// Text of the command card (meters are lines « label: N% utilisé · note », see `slashText.ts`).
pub fn render(name: &str, result: &Value, now: i64) -> String {
    if name == "credits" {
        if let Some(data) = result.pointer("/command/data") {
            let mut lines = Vec::new();
            if let Some(n) = data.get("remaining_credits") {
                lines.push(crate::tr!("Crédits restants : {n}", "Remaining credits: {n}"));
            }
            if let Some(uri) = data.get("upgrade_uri").and_then(Value::as_str) {
                lines.push(crate::tr!("Obtenir plus de crédits : {uri}", "Get more credits: {uri}"));
            }
            if !lines.is_empty() {
                return lines.join("\n");
            }
        }
    }
    let list = windows(result);
    if list.is_empty() {
        let raw = result.get("response").and_then(Value::as_str).unwrap_or("");
        return raw.replace('\t', " : ").trim().to_string();
    }
    let mut out: Vec<String> = Vec::new();
    let mut previous: Option<&str> = None;
    for w in &list {
        let group = w.group.as_deref().unwrap_or("Antigravity");
        if previous.is_some_and(|p| p != group) {
            out.push(String::new());
        }
        previous = Some(group);
        let reset = w
            .resets_at
            .map(|at| {
                let left = countdown(at - now);
                crate::tr!(" · reset dans {left}", " · resets in {left}")
            })
            .unwrap_or_default();
        let (label, percent) = (window_label(&w.window), (w.utilization * 100.0).round() as i64);
        // « N% utilisé » / « N% used »: both are read as meters by the chat (`slashText.ts`).
        out.push(crate::tr!(
            "{group} · {label}: {percent}% utilisé{reset}",
            "{group} · {label}: {percent}% used{reset}"
        ));
    }
    out.join("\n")
}

/// `2026-11-29T14:35:37Z` / `…37.123+01:00` → Unix ms.
pub fn parse_rfc3339(s: &str) -> Option<i64> {
    let s = s.trim();
    let (date, rest) = s.split_once(['T', ' '])?;
    let mut d = date.split('-');
    let (y, mo, da): (i64, i64, i64) = (d.next()?.parse().ok()?, d.next()?.parse().ok()?, d.next()?.parse().ok()?);
    let tz_at = rest.find(['Z', 'z', '+', '-']).unwrap_or(rest.len());
    let (time, tz) = rest.split_at(tz_at);
    let mut t = time.split(':');
    let (h, mi): (i64, i64) = (t.next()?.parse().ok()?, t.next()?.parse().ok()?);
    let sec: f64 = t.next().map(|x| x.parse().ok()).unwrap_or(Some(0.0))?;
    let offset_min = match tz.chars().next() {
        Some(sign @ ('+' | '-')) => {
            let (oh, om) = tz[1..].split_once(':').unwrap_or((&tz[1..], "0"));
            let m = oh.parse::<i64>().ok()? * 60 + om.parse::<i64>().ok()?;
            if sign == '-' { -m } else { m }
        }
        _ => 0,
    };
    // Days from civil (H. Hinnant).
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
    let yoe = y2 - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + da - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + h * 3600 + mi * 60 - offset_min * 60;
    Some(secs * 1000 + (sec * 1000.0).round() as i64)
}

static REFRESHING: AtomicBool = AtomicBool::new(false);
static LAST_REFRESH: AtomicI64 = AtomicI64::new(0);

/// Save `/quota` windows and tell the UI.
pub async fn store(db: &Db, app: &AppHandle, windows: Vec<RateLimitWindow>) {
    if windows.is_empty() {
        return;
    }
    LAST_REFRESH.store(now_ms(), Ordering::Relaxed);
    let saved =
        db.call(move |c| crate::db::providers::store_live_windows(c, AgentKind::Antigravity, &windows, now_ms())).await;
    match saved {
        Ok(()) => {
            let _ = app.emit(QUOTAS_CHANGED_EVENT, ());
            crate::remote::hub::forward(QUOTAS_CHANGED_EVENT, &());
        }
        Err(err) => tracing::warn!(%err, "agy quota not saved"),
    }
}

/// Background refresh (after an Antigravity turn, and periodically). Silent when agy is missing or logged out.
pub async fn refresh(db: Db, app: AppHandle) {
    if now_ms() - LAST_REFRESH.load(Ordering::Relaxed) < MIN_REFRESH_MS || REFRESHING.swap(true, Ordering::AcqRel) {
        return;
    }
    let cwd = std::env::temp_dir();
    match run("quota", &cwd).await {
        Ok(result) => store(&db, &app, windows(&result)).await,
        Err(err) => tracing::debug!(%err, "agy quota unavailable"),
    }
    REFRESHING.store(false, Ordering::Release);
}

#[cfg(test)]
mod tests {
    use super::*;

    const QUOTA: &str = include_str!("fixtures/quota.json");

    #[test]
    fn parses_groups_and_buckets() {
        let v: Value = serde_json::from_str(QUOTA).unwrap();
        let w = windows(&v);
        assert!(w.len() >= 4);
        let gemini_5h =
            w.iter().find(|w| w.group.as_deref() == Some("Gemini Models") && w.window == "five_hour").unwrap();
        assert!(gemini_5h.utilization >= 0.0 && gemini_5h.utilization <= 1.0);
        assert!(gemini_5h.models.iter().any(|m| m == "Gemini 4 Neon"));
        assert!(gemini_5h.resets_at.is_some());
        let argon = w.iter().find(|w| w.group.as_deref() == Some("Gemini 4 Argon")).unwrap();
        assert_eq!(argon.models, ["Gemini 4 Argon"]);
        let text = render("quota", &v, gemini_5h.resets_at.unwrap() - 3_600_000);
        assert!(text.contains("Gemini Models · Limite 5 h: "), "{text}");
        assert!(text.contains("% utilisé · reset dans 1 h 00 min"), "{text}");
    }

    #[test]
    fn unused_group_has_no_reset_time() {
        let v = serde_json::json!({"command":{"data":{"groups":[{"name":"Claude and GPT models","buckets":[
            {"window":"weekly","remaining_fraction":1,"reset_time":"1970-01-01T00:00:00Z"}]}]}}});
        let w = windows(&v);
        assert_eq!((w[0].window.as_str(), w[0].utilization, w[0].resets_at), ("seven_day", 0.0, None));
    }

    #[test]
    fn credits_and_detection() {
        let v = serde_json::json!({"status":"SUCCESS","command":{"name":"credits","data":{"remaining_credits":0,"upgrade_uri":"https://x"}}});
        assert_eq!(render("credits", &v, 0), "Crédits restants : 0\nObtenir plus de crédits : https://x");
        assert_eq!(local_command(" /usage "), Some("usage"));
        assert_eq!(local_command("/quota now"), None);
        assert_eq!(local_command("/goal x"), None);
    }

    #[test]
    fn rfc3339() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_rfc3339("2026-11-29T14:35:37Z"), Some(1_795_962_937_000));
        assert_eq!(parse_rfc3339("1970-01-01T01:00:00+01:00"), Some(0));
        assert_eq!(countdown(5 * 86_400_000 + 21 * 3_600_000), "5 j 21 h");
    }
}

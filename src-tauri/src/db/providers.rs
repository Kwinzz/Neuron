//! Quota / subscription cards and their usage within the configured window.

use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::agents::events::AgentKind;
use crate::error::{AppError, AppResult};
use crate::util::{DAY_MS, HOUR_MS};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum WindowKind {
    #[serde(rename = "rolling_5h")]
    Rolling5h,
    #[serde(rename = "weekly")]
    Weekly,
    #[serde(rename = "monthly")]
    Monthly,
    /// Prepaid credits: usage counted since the card was created.
    #[serde(rename = "credits")]
    Credits,
    #[serde(rename = "none")]
    None,
}

impl WindowKind {
    pub fn as_str(self) -> &'static str {
        match self {
            WindowKind::Rolling5h => "rolling_5h",
            WindowKind::Weekly => "weekly",
            WindowKind::Monthly => "monthly",
            WindowKind::Credits => "credits",
            WindowKind::None => "none",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "rolling_5h" => WindowKind::Rolling5h,
            "weekly" => WindowKind::Weekly,
            "monthly" => WindowKind::Monthly,
            "credits" => WindowKind::Credits,
            _ => WindowKind::None,
        }
    }

    /// Length of a rolling window, if any.
    pub fn duration_ms(self) -> Option<i64> {
        match self {
            WindowKind::Rolling5h => Some(5 * HOUR_MS),
            WindowKind::Weekly => Some(7 * DAY_MS),
            WindowKind::Monthly => Some(30 * DAY_MS),
            WindowKind::Credits | WindowKind::None => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum QuotaUnit {
    /// input + output tokens
    Tokens,
    /// number of agent turns
    Messages,
    Usd,
    Credits,
    Requests,
}

impl QuotaUnit {
    pub fn as_str(self) -> &'static str {
        match self {
            QuotaUnit::Tokens => "tokens",
            QuotaUnit::Messages => "messages",
            QuotaUnit::Usd => "usd",
            QuotaUnit::Credits => "credits",
            QuotaUnit::Requests => "requests",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "messages" => QuotaUnit::Messages,
            "usd" => QuotaUnit::Usd,
            "credits" => QuotaUnit::Credits,
            "requests" => QuotaUnit::Requests,
            _ => QuotaUnit::Tokens,
        }
    }
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Provider {
    pub id: String,
    pub agent: AgentKind,
    pub label: String,
    pub plan: Option<String>,
    pub window_kind: WindowKind,
    pub limit_value: Option<f64>,
    pub unit: QuotaUnit,
    /// Alert threshold as a ratio (0.8 = 80 %).
    pub alert_pct: f64,
    pub sort_order: i32,
    #[ts(type = "number")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderUsage {
    pub provider: Provider,
    /// Consumption in the provider's unit within the current window.
    pub used: f64,
    /// `used / limit`, when a limit is configured.
    pub ratio: Option<f64>,
    /// When the oldest usage leaves the rolling window (Unix ms).
    #[ts(type = "number | null")]
    pub resets_at: Option<i64>,
    /// Start of the counted window (Unix ms).
    #[ts(type = "number")]
    pub window_start: i64,
    /// Utilization reported by the provider itself (e.g. Claude subscription windows), when known.
    pub live: Option<LiveQuota>,
}

/// Provider-reported usage of a subscription window.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LiveQuota {
    /// 0–1.
    pub utilization: f64,
    #[ts(type = "number | null")]
    pub resets_at: Option<i64>,
    /// When the agent last reported it (Unix ms).
    #[ts(type = "number")]
    pub reported_at: i64,
}

/// Claude Code reports `five_hour` / `seven_day` windows in `rate_limit_event`.
/// A subscription window as last reported by an agent.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LiveWindow {
    /// `five_hour`, `seven_day`, `thirty_day`, `<n>_min`.
    pub window: String,
    /// 0–1.
    pub utilization: f64,
    #[ts(type = "number | null")]
    pub resets_at: Option<i64>,
    /// Quota group when the provider has several (Antigravity: « Gemini Models », « Claude and GPT models »…).
    pub group: Option<String>,
    /// Model names sharing this group's quota (match a model label by prefix).
    pub models: Vec<String>,
}

/// Save the windows an agent just reported (replaces the previous report).
pub fn store_live_windows(
    conn: &Connection,
    agent: AgentKind,
    windows: &[crate::agents::RateLimitWindow],
    now: i64,
) -> AppResult<()> {
    let value = serde_json::json!({
        "updatedAt": now,
        "windows": windows.iter().map(|w| serde_json::json!({
            "window": w.window, "utilization": w.utilization, "resetsAt": w.resets_at,
            "group": w.group, "models": w.models,
        })).collect::<Vec<_>>(),
    });
    crate::db::settings::set(conn, &crate::db::settings::rate_limits_key(agent), &value)
}

/// Every window an agent reported (chat header: 5 h and weekly quotas of the current provider).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AgentLiveQuotas {
    pub agent: AgentKind,
    #[ts(type = "number")]
    pub reported_at: i64,
    pub windows: Vec<LiveWindow>,
}

pub fn live_quotas(conn: &Connection) -> AppResult<Vec<AgentLiveQuotas>> {
    let mut out = Vec::new();
    for agent in [AgentKind::ClaudeCode, AgentKind::Codex, AgentKind::Antigravity] {
        let Some(stored) = crate::db::settings::get(conn, &crate::db::settings::rate_limits_key(agent))? else {
            continue;
        };
        let windows: Vec<LiveWindow> = stored
            .get("windows")
            .and_then(serde_json::Value::as_array)
            .map(|ws| {
                ws.iter()
                    .filter_map(|w| {
                        Some(LiveWindow {
                            window: w.get("window")?.as_str()?.to_string(),
                            utilization: w.get("utilization")?.as_f64()?,
                            resets_at: w.get("resetsAt").and_then(serde_json::Value::as_i64),
                            group: w.get("group").and_then(serde_json::Value::as_str).map(str::to_string),
                            models: w
                                .get("models")
                                .and_then(serde_json::Value::as_array)
                                .map(|ms| ms.iter().filter_map(|m| m.as_str().map(str::to_string)).collect())
                                .unwrap_or_default(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        if !windows.is_empty() {
            let reported_at = stored.get("updatedAt").and_then(serde_json::Value::as_i64).unwrap_or(0);
            out.push(AgentLiveQuotas { agent, reported_at, windows });
        }
    }
    Ok(out)
}

fn live_quota(conn: &Connection, provider: &Provider) -> AppResult<Option<LiveQuota>> {
    let window = match provider.window_kind {
        WindowKind::Rolling5h => "five_hour",
        WindowKind::Weekly => "seven_day",
        WindowKind::Monthly => "thirty_day",
        _ => return Ok(None),
    };
    let Some(stored) = crate::db::settings::get(conn, &crate::db::settings::rate_limits_key(provider.agent))? else {
        return Ok(None);
    };
    let reported_at = stored.get("updatedAt").and_then(serde_json::Value::as_i64).unwrap_or(0);
    // Several quota groups (Antigravity): the most used one is the binding constraint.
    Ok(stored
        .get("windows")
        .and_then(serde_json::Value::as_array)
        .and_then(|ws| {
            ws.iter()
                .filter(|w| w.get("window").and_then(serde_json::Value::as_str) == Some(window))
                .max_by(|a, b| {
                    let u = |w: &serde_json::Value| w.get("utilization").and_then(serde_json::Value::as_f64).unwrap_or(0.0);
                    u(a).total_cmp(&u(b))
                })
        })
        .and_then(|w| {
            Some(LiveQuota {
                utilization: w.get("utilization")?.as_f64()?,
                resets_at: w.get("resetsAt").and_then(serde_json::Value::as_i64),
                reported_at,
            })
        }))
}

/// Editable fields of a provider card.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderUpdate {
    pub id: String,
    pub label: String,
    pub plan: Option<String>,
    pub window_kind: WindowKind,
    pub limit_value: Option<f64>,
    pub unit: QuotaUnit,
    pub alert_pct: f64,
}

const SELECT: &str = "SELECT id, agent, label, plan, window_kind, limit_value, unit, alert_pct, sort_order, created_at
                      FROM providers";

fn from_row(row: &Row<'_>) -> rusqlite::Result<Provider> {
    Ok(Provider {
        id: row.get(0)?,
        agent: row.get(1)?,
        label: row.get(2)?,
        plan: row.get(3)?,
        window_kind: WindowKind::parse(&row.get::<_, String>(4)?),
        limit_value: row.get(5)?,
        unit: QuotaUnit::parse(&row.get::<_, String>(6)?),
        alert_pct: row.get(7)?,
        sort_order: row.get(8)?,
        created_at: row.get(9)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Provider>> {
    let mut stmt = conn.prepare_cached(&format!("{SELECT} ORDER BY sort_order, label"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Option<Provider>> {
    let mut stmt = conn.prepare_cached(&format!("{SELECT} WHERE id = ?1"))?;
    Ok(stmt.query_row([id], from_row).optional()?)
}

pub fn usage(conn: &Connection, provider: Provider, now: i64) -> AppResult<ProviderUsage> {
    let window_start = match provider.window_kind.duration_ms() {
        Some(len) => now - len,
        None if provider.window_kind == WindowKind::Credits => provider.created_at,
        None => 0,
    };

    let mut stmt = conn.prepare_cached(
        "SELECT COALESCE(SUM(input_tokens + output_tokens), 0),
                COALESCE(SUM(cost_usd), 0.0),
                COUNT(*),
                MIN(ts)
         FROM token_usage
         WHERE agent = ?1 AND ts >= ?2",
    )?;
    let (tokens, cost, turns, oldest): (i64, f64, i64, Option<i64>) = stmt
        .query_row(params![provider.agent, window_start], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?;

    let used = match provider.unit {
        QuotaUnit::Tokens => tokens as f64,
        QuotaUnit::Usd | QuotaUnit::Credits => cost,
        QuotaUnit::Messages | QuotaUnit::Requests => turns as f64,
    };
    let ratio = provider
        .limit_value
        .filter(|limit| *limit > 0.0)
        .map(|limit| used / limit);
    let resets_at = match (provider.window_kind.duration_ms(), oldest) {
        (Some(len), Some(oldest)) => Some(oldest + len),
        _ => None,
    };

    let live = live_quota(conn, &provider)?;
    Ok(ProviderUsage {
        provider,
        used,
        ratio,
        resets_at,
        window_start,
        live,
    })
}

pub fn list_with_usage(conn: &Connection, now: i64) -> AppResult<Vec<ProviderUsage>> {
    list(conn)?
        .into_iter()
        .map(|p| usage(conn, p, now))
        .collect()
}

pub fn update(conn: &Connection, input: &ProviderUpdate, now: i64) -> AppResult<()> {
    if input.label.trim().is_empty() {
        return Err(AppError::Invalid("le nom est requis".into()));
    }
    if !(0.0..=1.0).contains(&input.alert_pct) {
        return Err(AppError::Invalid("le seuil d'alerte doit être entre 0 et 100 %".into()));
    }
    if input.limit_value.is_some_and(|l| !l.is_finite() || l < 0.0) {
        return Err(AppError::Invalid("la limite doit être positive".into()));
    }
    let changed = conn.execute(
        "UPDATE providers
         SET label = ?2, plan = ?3, window_kind = ?4, limit_value = ?5, unit = ?6, alert_pct = ?7, updated_at = ?8
         WHERE id = ?1",
        params![
            input.id,
            input.label.trim(),
            input.plan.as_deref().map(str::trim).filter(|p| !p.is_empty()),
            input.window_kind.as_str(),
            input.limit_value,
            input.unit.as_str(),
            input.alert_pct,
            now,
        ],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("provider {}", input.id)));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn insert_usage(conn: &Connection, agent: &str, input: i64, output: i64, ts: i64) {
        conn.execute(
            "INSERT INTO token_usage (agent, input_tokens, output_tokens, cost_usd, ts) VALUES (?1, ?2, ?3, 0.5, ?4)",
            params![agent, input, output, ts],
        )
        .unwrap();
    }

    #[tokio::test]
    async fn default_cards_and_rolling_window() {
        let db = Db::open_in_memory().unwrap();
        db.call(|conn| {
            let now = 100 * DAY_MS;
            insert_usage(conn, "claude_code", 1000, 500, now - HOUR_MS); // in 5h window
            insert_usage(conn, "claude_code", 4000, 0, now - 6 * HOUR_MS); // weekly only
            insert_usage(conn, "codex", 99, 1, now - HOUR_MS); // other agent

            let cards = list_with_usage(conn, now)?;
            assert_eq!(cards.len(), 4);
            let five_h = cards.iter().find(|c| c.provider.id == "claude-5h").unwrap();
            assert_eq!(five_h.used, 1500.0);
            assert_eq!(five_h.ratio, None, "no limit configured yet");
            assert_eq!(five_h.resets_at, Some(now - HOUR_MS + 5 * HOUR_MS));
            let weekly = cards.iter().find(|c| c.provider.id == "claude-weekly").unwrap();
            assert_eq!(weekly.used, 5500.0);

            update(
                conn,
                &ProviderUpdate {
                    id: "claude-5h".into(),
                    label: "Claude Max".into(),
                    plan: Some("Max 5x".into()),
                    window_kind: WindowKind::Rolling5h,
                    limit_value: Some(3000.0),
                    unit: QuotaUnit::Tokens,
                    alert_pct: 0.8,
                },
                now,
            )?;
            let card = usage(conn, get(conn, "claude-5h")?.unwrap(), now)?;
            assert_eq!(card.ratio, Some(0.5));
            assert_eq!(card.provider.label, "Claude Max");

            let messages = ProviderUpdate {
                id: "codex".into(),
                label: "Codex".into(),
                plan: None,
                window_kind: WindowKind::Weekly,
                limit_value: Some(10.0),
                unit: QuotaUnit::Messages,
                alert_pct: 0.9,
            };
            update(conn, &messages, now)?;
            assert_eq!(usage(conn, get(conn, "codex")?.unwrap(), now)?.used, 1.0);

            let bad = ProviderUpdate { alert_pct: 2.0, ..messages };
            assert!(update(conn, &bad, now).is_err());

            assert!(usage(conn, get(conn, "claude-weekly")?.unwrap(), now)?.live.is_none());
            crate::db::settings::set(
                conn,
                crate::db::settings::CLAUDE_RATE_LIMITS,
                &serde_json::json!({"updatedAt": 5, "windows": [
                    {"window": "five_hour", "utilization": 0.55, "resetsAt": 99},
                    {"window": "seven_day", "utilization": 0.15, "resetsAt": null}
                ]}),
            )?;
            let weekly = usage(conn, get(conn, "claude-weekly")?.unwrap(), now)?.live.unwrap();
            assert_eq!((weekly.utilization, weekly.resets_at, weekly.reported_at), (0.15, None, 5));
            assert!(usage(conn, get(conn, "codex")?.unwrap(), now)?.live.is_none());
            let all = live_quotas(conn)?;
            assert_eq!(all.len(), 1);
            assert_eq!(all[0].windows.len(), 2);
            Ok(())
        })
        .await
        .unwrap();
    }
}

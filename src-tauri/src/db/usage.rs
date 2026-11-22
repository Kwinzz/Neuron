//! Token usage aggregation for Mission Control (buckets in *local* time, computed by SQLite).

use rusqlite::{Connection, Row, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::agents::events::AgentKind;
use crate::error::AppResult;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum UsageRange {
    /// Today, hourly buckets.
    Day,
    /// Last 7 days, daily buckets.
    Week,
    /// Last 30 days, daily buckets.
    Month,
}

impl UsageRange {
    fn bucket_count(self) -> i64 {
        match self {
            UsageRange::Day => 24,
            UsageRange::Week => 7,
            UsageRange::Month => 30,
        }
    }

    /// strftime format of a bucket key.
    fn key_format(self) -> &'static str {
        match self {
            UsageRange::Day => "%Y-%m-%d %H",
            UsageRange::Week | UsageRange::Month => "%Y-%m-%d",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UsageSums {
    #[ts(type = "number")]
    pub input: i64,
    #[ts(type = "number")]
    pub output: i64,
    #[ts(type = "number")]
    pub cache_read: i64,
    #[ts(type = "number")]
    pub cache_write: i64,
    pub cost_usd: f64,
    /// Number of usage reports (≈ agent turns).
    #[ts(type = "number")]
    pub turns: i64,
}

impl UsageSums {
    fn add(&mut self, o: &UsageSums) {
        self.input += o.input;
        self.output += o.output;
        self.cache_read += o.cache_read;
        self.cache_write += o.cache_write;
        self.cost_usd += o.cost_usd;
        self.turns += o.turns;
    }

    /// Reads the 6 aggregate columns produced by [`SUMS_SQL`] starting at `offset`.
    fn from_row(row: &Row<'_>, offset: usize) -> rusqlite::Result<Self> {
        Ok(Self {
            input: row.get(offset)?,
            output: row.get(offset + 1)?,
            cache_read: row.get(offset + 2)?,
            cache_write: row.get(offset + 3)?,
            cost_usd: row.get(offset + 4)?,
            turns: row.get(offset + 5)?,
        })
    }
}

const SUMS_SQL: &str = "COALESCE(SUM(u.input_tokens),0), COALESCE(SUM(u.output_tokens),0),
     COALESCE(SUM(u.cache_read_tokens),0), COALESCE(SUM(u.cache_write_tokens),0),
     COALESCE(SUM(u.cost_usd),0.0), COUNT(u.id)";

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AgentUsage {
    pub agent: AgentKind,
    pub sums: UsageSums,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UsageBucket {
    /// Local-time key: `YYYY-MM-DD HH` (day range) or `YYYY-MM-DD`.
    pub key: String,
    /// One entry per agent with usage in this bucket, in [`AgentKind::ALL`] order.
    pub by_agent: Vec<AgentUsage>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectUsage {
    pub project_id: Option<String>,
    pub name: String,
    pub sums: UsageSums,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UsageReport {
    pub range: UsageRange,
    /// Start of the range (Unix ms, local midnight).
    #[ts(type = "number")]
    pub since: i64,
    pub buckets: Vec<UsageBucket>,
    /// Totals per agent, in [`AgentKind::ALL`] order (agents without usage omitted).
    pub by_agent: Vec<AgentUsage>,
    /// Top projects by input+output tokens (max 8).
    pub by_project: Vec<ProjectUsage>,
    pub totals: UsageSums,
    /// Same elapsed duration in the previous period (e.g. yesterday 00:00 → same time), for deltas.
    pub previous: UsageSums,
}

fn agent_order(agent: AgentKind) -> usize {
    AgentKind::ALL.iter().position(|a| *a == agent).unwrap_or(usize::MAX)
}

pub fn report(conn: &Connection, range: UsageRange, now: i64) -> AppResult<UsageReport> {
    let count = range.bucket_count();
    let now_s = now / 1000;

    // Start of the range = local midnight (count-1) days ago (today for Day), converted back to UTC.
    let back_days = if range == UsageRange::Day { 0 } else { count - 1 };
    let since: i64 = conn.query_row(
        "SELECT CAST(strftime('%s', ?1, 'unixepoch', 'localtime', 'start of day', ?2, 'utc') AS INTEGER) * 1000",
        params![now_s, format!("-{back_days} days")],
        |r| r.get(0),
    )?;

    // Expected bucket keys, oldest first, so empty buckets are still present.
    let keys: Vec<String> = {
        let sql = match range {
            UsageRange::Day => {
                "WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < ?2 - 1)
                 SELECT strftime(?3, ?1, 'unixepoch', 'localtime', 'start of day', '+' || n || ' hours') FROM seq"
            }
            UsageRange::Week | UsageRange::Month => {
                "WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < ?2 - 1)
                 SELECT strftime(?3, ?1, 'unixepoch', 'localtime', 'start of day', '-' || (?2 - 1 - n) || ' days') FROM seq"
            }
        };
        let mut stmt = conn.prepare_cached(sql)?;
        let rows = stmt.query_map(params![now_s, count, range.key_format()], |r| r.get(0))?;
        rows.collect::<Result<_, _>>()?
    };

    let mut buckets: Vec<UsageBucket> = keys
        .into_iter()
        .map(|key| UsageBucket { key, by_agent: Vec::new() })
        .collect();

    {
        let sql = format!(
            "SELECT strftime(?2, u.ts / 1000, 'unixepoch', 'localtime') AS k, u.agent, {SUMS_SQL}
             FROM token_usage u WHERE u.ts >= ?1
             GROUP BY k, u.agent"
        );
        let mut stmt = conn.prepare_cached(&sql)?;
        let rows = stmt.query_map(params![since, range.key_format()], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, AgentKind>(1)?, UsageSums::from_row(r, 2)?))
        })?;
        for row in rows {
            let (key, agent, sums) = row?;
            if let Some(bucket) = buckets.iter_mut().find(|b| b.key == key) {
                match bucket.by_agent.iter_mut().find(|a| a.agent == agent) {
                    Some(existing) => existing.sums.add(&sums),
                    None => bucket.by_agent.push(AgentUsage { agent, sums }),
                }
            }
        }
    }
    for bucket in &mut buckets {
        bucket.by_agent.sort_by_key(|a| agent_order(a.agent));
    }

    let mut by_agent: Vec<AgentUsage> = Vec::new();
    for bucket in &buckets {
        for slice in &bucket.by_agent {
            match by_agent.iter_mut().find(|a| a.agent == slice.agent) {
                Some(total) => total.sums.add(&slice.sums),
                None => by_agent.push(slice.clone()),
            }
        }
    }
    by_agent.sort_by_key(|a| agent_order(a.agent));

    let mut totals = UsageSums::default();
    for a in &by_agent {
        totals.add(&a.sums);
    }

    let by_project = {
        let sql = format!(
            "SELECT u.project_id, COALESCE(p.name, 'Hors projet'), {SUMS_SQL}
             FROM token_usage u LEFT JOIN projects p ON p.id = u.project_id
             WHERE u.ts >= ?1
             GROUP BY u.project_id
             ORDER BY SUM(u.input_tokens + u.output_tokens) DESC
             LIMIT 8"
        );
        let mut stmt = conn.prepare_cached(&sql)?;
        let rows = stmt.query_map([since], |r| {
            Ok(ProjectUsage {
                project_id: r.get(0)?,
                name: r.get(1)?,
                sums: UsageSums::from_row(r, 2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    // Previous period: starts `count` days (or 1 day for Day) before `since`, local calendar,
    // and covers the same elapsed duration as the current one.
    let previous = {
        let period_days = if range == UsageRange::Day { 1 } else { count };
        let prev_since: i64 = conn.query_row(
            "SELECT CAST(strftime('%s', ?1 / 1000, 'unixepoch', 'localtime', ?2, 'utc') AS INTEGER) * 1000",
            params![since, format!("-{period_days} days")],
            |r| r.get(0),
        )?;
        let prev_until = prev_since + (now - since).max(0);
        let sql = format!("SELECT {SUMS_SQL} FROM token_usage u WHERE u.ts >= ?1 AND u.ts < ?2");
        let mut stmt = conn.prepare_cached(&sql)?;
        stmt.query_row(params![prev_since, prev_until], |r| UsageSums::from_row(r, 0))?
    };

    Ok(UsageReport {
        range,
        since,
        buckets,
        by_agent,
        by_project,
        totals,
        previous,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::util::{DAY_MS, HOUR_MS, now_ms};

    #[tokio::test]
    async fn buckets_are_complete_and_sum_correctly() {
        let db = Db::open_in_memory().unwrap();
        db.call(|conn| {
            let now = now_ms();
            conn.execute(
                "INSERT INTO projects (id, name, path, created_at) VALUES ('p1', 'Neuron', '/tmp/neuron', 0)",
                [],
            )?;
            let ins = |agent: &str, project: Option<&str>, input: i64, ts: i64| {
                conn.execute(
                    "INSERT INTO token_usage (agent, project_id, input_tokens, output_tokens, cost_usd, ts)
                     VALUES (?1, ?2, ?3, 10, 0.25, ?4)",
                    params![agent, project, input, ts],
                )
            };
            ins("claude_code", Some("p1"), 100, now)?;
            ins("codex", None, 50, now)?;
            ins("claude_code", Some("p1"), 1000, now - 3 * DAY_MS)?;
            ins("claude_code", Some("p1"), 7, now - 40 * DAY_MS)?; // outside every range

            let week = report(conn, UsageRange::Week, now)?;
            assert_eq!(week.buckets.len(), 7);
            assert!(week.since <= now && week.since > now - 7 * DAY_MS - HOUR_MS);
            assert_eq!(week.totals.input, 1150);
            assert_eq!(week.totals.turns, 3);
            assert_eq!(week.by_agent[0].agent, AgentKind::ClaudeCode, "fixed agent order");
            assert_eq!(week.by_agent[0].sums.input, 1100);
            assert_eq!(week.by_project[0].name, "Neuron");
            assert_eq!(week.by_project[1].name, "Hors projet");
            let today = week.buckets.last().unwrap();
            assert_eq!(today.by_agent.len(), 2);

            let day = report(conn, UsageRange::Day, now)?;
            assert_eq!(day.buckets.len(), 24);
            assert_eq!(day.totals.input, 150);

            let month = report(conn, UsageRange::Month, now)?;
            assert_eq!(month.buckets.len(), 30);
            assert_eq!(month.totals.input, 1150);
            assert_eq!(month.previous.input, 7, "row 40 days ago falls in the previous 30-day window");
            assert_eq!(week.previous.input, 0);
            Ok(())
        })
        .await
        .unwrap();
    }
}

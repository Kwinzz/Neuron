//! Public API prices, to show a dollar cost for every request even when the CLI reports none
//! (Codex and Antigravity only report tokens; usage is covered by the user's subscription).
//! Claude Code reports its own cost (`total_cost_usd`), which is kept as is.
//!
//! Sources (checked 2026-11-22): Anthropic pricing page (official) for Claude; OpenAI and Gemini figures from
//! several concordant third-party listings (official pages not reachable at the time) — estimates only.

use rusqlite::Connection;

use crate::agents::events::TokenUsage;
use crate::db::settings;
use crate::error::AppResult;

/// Dollars per million tokens.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelPrice {
    pub input: f64,
    pub cached_input: f64,
    pub cache_write: f64,
    pub output: f64,
}

const fn p(input: f64, cached_input: f64, cache_write: f64, output: f64) -> ModelPrice {
    ModelPrice { input, cached_input, cache_write, output }
}

/// Model family prefix → price. Longest matching prefix wins (after removing the reasoning suffix).
const TABLE: &[(&str, ModelPrice)] = &[
    // OpenAI (Codex)
    ("gpt-6-luna", p(0.10, 0.01, 0.10, 0.50)),
    ("gpt-5.6-terra", p(2.00, 0.20, 2.00, 12.00)),
    ("gpt-5.6-luna", p(0.20, 0.02, 0.20, 1.20)),
    // Google (Antigravity) — Argon is announced at 4 / 20 from 2026-12-01.
    ("gemini-4-neon", p(3.00, 0.15, 3.00, 15.00)),
    ("gemini-4-argon", p(2.00, 0.10, 2.00, 10.00)),
    ("gemini-4-hydrogen", p(1.50, 0.075, 1.50, 7.50)),
    ("gemini-3.8-flash", p(0.75, 0.075, 0.75, 3.75)),
    // Anthropic (official; also offered by Antigravity)
    ("claude-fable-5-2", p(8.00, 0.20, 10.00, 40.00)),
    ("claude-opus-5-5", p(4.00, 0.20, 5.00, 20.00)),
    ("claude-sonnet-5-5", p(2.00, 0.10, 2.50, 10.00)),
    ("claude-haiku-5-5", p(0.10, 0.01, 0.125, 0.50)),
];

/// Reasoning-level suffixes used in model ids (`gemini-4-neon-high`, `claude-opus-5-5-low`).
const LEVELS: &[&str] = &["-minimal", "-low", "-medium", "-high", "-xhigh", "-max", "-ultra"];

fn family(model: &str) -> &str {
    let model = model.trim();
    LEVELS.iter().find_map(|s| model.strip_suffix(s)).unwrap_or(model)
}

pub fn price_of(model: &str) -> Option<ModelPrice> {
    let fam = family(model).to_ascii_lowercase();
    TABLE
        .iter()
        .filter(|(prefix, _)| fam.starts_with(prefix))
        .max_by_key(|(prefix, _)| prefix.len())
        .map(|(_, price)| *price)
}

/// Estimated cost of a usage (tokens are already split: `input` excludes cache reads).
pub fn estimate(model: &str, u: &TokenUsage) -> Option<f64> {
    let price = price_of(model)?;
    let per = |tokens: u64, dollars: f64| tokens as f64 * dollars / 1_000_000.0;
    Some(
        per(u.input, price.input)
            + per(u.cache_read, price.cached_input)
            + per(u.cache_write, price.cache_write)
            + per(u.output, price.output),
    )
}

const BACKFILL_KEY: &str = "pricing.backfill_v1";

/// One-time: price the past Codex/Antigravity requests recorded at $0. Returns the rows updated.
pub fn backfill(conn: &Connection) -> AppResult<usize> {
    if settings::get(conn, BACKFILL_KEY)?.is_some() {
        return Ok(0);
    }
    let rows: Vec<(i64, Option<String>, TokenUsage)> = {
        let mut stmt = conn.prepare(
            "SELECT rowid, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
             FROM token_usage WHERE cost_usd = 0 AND agent IN ('codex', 'antigravity')",
        )?;
        let mapped = stmt.query_map([], |r| {
            let n = |i: usize| r.get::<_, i64>(i).map(|v| u64::try_from(v).unwrap_or(0));
            Ok((
                r.get(0)?,
                r.get(1)?,
                TokenUsage { input: n(2)?, output: n(3)?, cache_read: n(4)?, cache_write: n(5)?, cost_usd: 0.0 },
            ))
        })?;
        mapped.collect::<Result<_, _>>()?
    };
    let mut updated = 0;
    for (rowid, model, usage) in rows {
        if let Some(cost) = model.as_deref().and_then(|m| estimate(m, &usage)) {
            conn.execute("UPDATE token_usage SET cost_usd = ?1 WHERE rowid = ?2", rusqlite::params![cost, rowid])?;
            updated += 1;
        }
    }
    settings::set(conn, BACKFILL_KEY, &serde_json::Value::Bool(true))?;
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn families_and_estimates() {
        assert_eq!(price_of("gemini-4-neon-high"), price_of("gemini-4-neon"));
        assert_eq!(price_of("claude-opus-5-5-low").map(|p| p.output), Some(20.0));
        assert_eq!(price_of("gpt-6-luna").map(|p| p.input), Some(0.10));
        assert!(price_of("gpt-oss-120b-medium").is_none(), "unknown models stay unpriced");

        let u = TokenUsage { input: 1_000_000, output: 100_000, cache_read: 2_000_000, cache_write: 0, cost_usd: 0.0 };
        // 3.00 + 0.15 × 2 + 15 × 0.1 = 4.80
        let cost = estimate("gemini-4-neon-medium", &u).unwrap();
        assert!((cost - 4.80).abs() < 1e-9, "{cost}");
    }

    #[tokio::test]
    async fn backfills_once() {
        let db = crate::db::Db::open_in_memory().unwrap();
        db.call(|c| {
            c.execute(
                "INSERT INTO token_usage (thread_id, agent, model, input_tokens, output_tokens, cache_read_tokens,
                                          cache_write_tokens, cost_usd, ts)
                 VALUES (NULL, 'codex', 'gpt-5.6-terra', 1000000, 0, 0, 0, 0, 1),
                        (NULL, 'claude_code', 'claude-opus-5-5', 1000000, 0, 0, 0, 0, 1)",
                [],
            )?;
            assert_eq!(backfill(c)?, 1, "only the Codex row");
            assert_eq!(backfill(c)?, 0, "once");
            let cost: f64 = c.query_row("SELECT cost_usd FROM token_usage WHERE agent = 'codex'", [], |r| r.get(0))?;
            assert!((cost - 2.0).abs() < 1e-9);
            Ok(())
        })
        .await
        .unwrap();
    }
}

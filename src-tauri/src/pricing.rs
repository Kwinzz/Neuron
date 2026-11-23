//! Public API prices, to show a dollar cost for every request even when the CLI reports none
//! (Codex and Antigravity only report tokens; usage is covered by the user's subscription).
//! Claude Code reports its own cost (`total_cost_usd`), which is kept as is.
//!
//! Sources, in order:
//! 1. LiteLLM's public price list (GitHub), downloaded at most once a day and cached in the data directory —
//!    new models are priced as soon as LiteLLM lists them. Only first-party entries are used (OpenAI,
//!    Anthropic, Google), never resellers.
//! 2. The built-in table below (offline, or a model LiteLLM doesn't list). Checked 2026-11-22: Anthropic's
//!    official page for Claude; OpenAI/Gemini from concordant listings, which match LiteLLM.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::Duration;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::agents::events::TokenUsage;
use crate::error::{AppError, AppResult};

pub const LITELLM_URL: &str =
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
/// Downloaded at most this often.
const MAX_AGE_MS: i64 = 24 * 3600 * 1000;
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);
const CACHE_FILE: &str = "prices.json";

/// Dollars per million tokens.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ModelPrice {
    pub input: f64,
    pub cached_input: f64,
    pub cache_write: f64,
    pub output: f64,
}

const fn p(input: f64, cached_input: f64, cache_write: f64, output: f64) -> ModelPrice {
    ModelPrice { input, cached_input, cache_write, output }
}

/// Built-in fallback: model family prefix → price. Longest matching prefix wins.
const TABLE: &[(&str, ModelPrice)] = &[
    // OpenAI (Codex)
    ("gpt-6-luna", p(0.10, 0.01, 0.125, 0.50)),
    ("gpt-5.6-terra", p(2.00, 0.20, 2.50, 12.00)),
    ("gpt-5.6-luna", p(0.20, 0.02, 0.25, 1.20)),
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

fn family(model: &str) -> String {
    let model = model.trim().to_ascii_lowercase();
    LEVELS.iter().find_map(|s| model.strip_suffix(s)).map(str::to_string).unwrap_or(model)
}

// ---- LiteLLM ---------------------------------------------------------------------------------------

/// First-party providers, by preference (LiteLLM's `litellm_provider`).
const FIRST_PARTY: &[&str] = &["openai", "anthropic", "gemini", "vertex_ai-language-models", "vertex_ai"];

/// Prices extracted from LiteLLM, cached on disk.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RemotePrices {
    pub fetched_at: i64,
    /// Bare model name → first-party price.
    pub models: HashMap<String, ModelPrice>,
}

#[derive(Deserialize)]
struct LiteEntry {
    litellm_provider: Option<String>,
    input_cost_per_token: Option<f64>,
    output_cost_per_token: Option<f64>,
    cache_read_input_token_cost: Option<f64>,
    cache_creation_input_token_cost: Option<f64>,
}

/// Keep one first-party price per bare model name (`gemini/gemini-4-neon` → `gemini-4-neon`).
pub fn parse_litellm(json: &str, fetched_at: i64) -> AppResult<RemotePrices> {
    let raw: HashMap<String, serde_json::Value> = serde_json::from_str(json)?;
    let mut best: HashMap<String, (usize, ModelPrice)> = HashMap::new();
    for (key, value) in raw {
        let Ok(entry) = serde_json::from_value::<LiteEntry>(value) else { continue };
        let Some(provider) = entry.litellm_provider.as_deref() else { continue };
        let Some(rank) = FIRST_PARTY.iter().position(|p| *p == provider) else { continue };
        let (Some(input), Some(output)) = (entry.input_cost_per_token, entry.output_cost_per_token) else { continue };
        // Bare name: `gemini-4-neon`, `gemini/gemini-4-neon`, `vertex_ai/gemini-4-neon` — not regional variants.
        let bare = match key.split_once('/') {
            None => key.as_str(),
            Some((prefix, rest))
                if matches!(prefix, "gemini" | "vertex_ai" | "openai" | "anthropic") && !rest.contains('/') =>
            {
                rest
            }
            _ => continue,
        };
        let m = 1_000_000.0;
        let price = ModelPrice {
            input: input * m,
            cached_input: entry.cache_read_input_token_cost.unwrap_or(input * 0.1) * m,
            cache_write: entry.cache_creation_input_token_cost.unwrap_or(input) * m,
            output: output * m,
        };
        let slot = best.entry(bare.to_ascii_lowercase()).or_insert((rank, price));
        if rank < slot.0 {
            *slot = (rank, price);
        }
    }
    if best.is_empty() {
        return Err(AppError::Other("liste de prix LiteLLM vide ou illisible".into()));
    }
    Ok(RemotePrices { fetched_at, models: best.into_iter().map(|(k, (_, p))| (k, p)).collect() })
}

static REMOTE: RwLock<Option<RemotePrices>> = RwLock::new(None);

fn remote_price(fam: &str) -> Option<ModelPrice> {
    let guard = REMOTE.read().ok()?;
    let models = &guard.as_ref()?.models;
    models.get(fam).copied()
}

/// Price of a model: LiteLLM first, then the built-in table.
pub fn price_of(model: &str) -> Option<ModelPrice> {
    let fam = family(model);
    remote_price(&fam).or_else(|| {
        TABLE
            .iter()
            .filter(|(prefix, _)| fam.starts_with(prefix))
            .max_by_key(|(prefix, _)| prefix.len())
            .map(|(_, price)| *price)
    })
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

/// Where the prices currently come from (Paramètres).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PricingStatus {
    /// "litellm" or "builtin".
    pub source: String,
    /// Last successful download (Unix ms), if any.
    #[ts(type = "number | null")]
    pub fetched_at: Option<i64>,
    /// Models priced by the current source.
    #[ts(type = "number")]
    pub model_count: usize,
    /// Last refresh error, if the download failed.
    pub error: Option<String>,
}

static LAST_ERROR: RwLock<Option<String>> = RwLock::new(None);

pub fn status() -> PricingStatus {
    let remote = REMOTE.read().ok().and_then(|g| g.as_ref().map(|r| (r.fetched_at, r.models.len())));
    let error = LAST_ERROR.read().ok().and_then(|g| g.clone());
    match remote {
        Some((at, n)) => PricingStatus { source: "litellm".into(), fetched_at: Some(at), model_count: n, error },
        None => PricingStatus { source: "builtin".into(), fetched_at: None, model_count: TABLE.len(), error },
    }
}

fn cache_path(data_dir: &Path) -> PathBuf {
    data_dir.join(CACHE_FILE)
}

fn install(prices: RemotePrices) {
    if let Ok(mut guard) = REMOTE.write() {
        *guard = Some(prices);
    }
}

/// Load the cached list (instant, offline). Returns its age check: true when a download is due.
pub fn load_cache(data_dir: &Path, now_ms: i64) -> bool {
    let cached =
        std::fs::read_to_string(cache_path(data_dir)).ok().and_then(|s| serde_json::from_str::<RemotePrices>(&s).ok());
    match cached {
        Some(prices) => {
            let due = now_ms - prices.fetched_at > MAX_AGE_MS;
            install(prices);
            due
        }
        None => true,
    }
}

/// Download LiteLLM's list, cache it and use it. Keeps the previous prices on failure.
pub async fn refresh(data_dir: &Path, now_ms: i64) -> AppResult<PricingStatus> {
    let result: AppResult<RemotePrices> = async {
        let client = reqwest::Client::builder()
            .timeout(FETCH_TIMEOUT)
            .user_agent("neuron-desktop")
            .build()
            .map_err(|e| AppError::Other(format!("client HTTP : {e}")))?;
        let response = client
            .get(LITELLM_URL)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|e| AppError::Other(format!("téléchargement des tarifs impossible : {e}")))?;
        let body = response.text().await.map_err(|e| AppError::Other(format!("lecture des tarifs : {e}")))?;
        let prices = tokio::task::spawn_blocking(move || parse_litellm(&body, now_ms)).await??;
        let json = serde_json::to_string(&prices)?;
        let path = cache_path(data_dir);
        tokio::task::spawn_blocking(move || std::fs::write(path, json)).await??;
        Ok(prices)
    }
    .await;
    match result {
        Ok(prices) => {
            tracing::info!(models = prices.models.len(), "prices updated from LiteLLM");
            install(prices);
            if let Ok(mut e) = LAST_ERROR.write() {
                *e = None;
            }
            Ok(status())
        }
        Err(err) => {
            tracing::warn!(%err, "price refresh failed");
            if let Ok(mut e) = LAST_ERROR.write() {
                *e = Some(err.to_string());
            }
            Err(err)
        }
    }
}

/// Price the past Codex/Antigravity requests still at $0 (models newly priced included). Returns rows updated.
pub fn backfill(conn: &Connection) -> AppResult<usize> {
    let rows: Vec<(i64, Option<String>, TokenUsage)> = {
        let mut stmt = conn.prepare(
            "SELECT rowid, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
             FROM token_usage WHERE cost_usd = 0 AND agent IN ('codex', 'antigravity')
               AND input_tokens + output_tokens + cache_read_tokens > 0",
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
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_families_and_estimates() {
        assert_eq!(price_of("claude-opus-5-5-low").map(|p| p.output), Some(20.0));
        let u = TokenUsage { input: 1_000_000, output: 100_000, cache_read: 2_000_000, cache_write: 0, cost_usd: 0.0 };
        // 3.00 + 0.15 × 2 + 15 × 0.1 = 4.80
        let cost = estimate("gemini-4-neon-medium", &u).unwrap();
        assert!((cost - 4.80).abs() < 1e-9, "{cost}");
    }

    #[test]
    fn litellm_keeps_first_party_prices_only() {
        let json = r#"{
            "sample_spec": { "litellm_provider": "openai" },
            "gpt-9-nova": { "litellm_provider": "openai", "input_cost_per_token": 1e-06, "output_cost_per_token": 4e-06,
                            "cache_read_input_token_cost": 1e-07 },
            "azure/gpt-9-nova": { "litellm_provider": "azure", "input_cost_per_token": 9e-06, "output_cost_per_token": 9e-06 },
            "gemini/gemini-9-flash": { "litellm_provider": "gemini", "input_cost_per_token": 5e-07, "output_cost_per_token": 2e-06 },
            "vertex_ai/gemini-9-flash": { "litellm_provider": "vertex_ai", "input_cost_per_token": 6e-07, "output_cost_per_token": 3e-06 },
            "kyma/gemini-9-flash": { "litellm_provider": "kyma", "input_cost_per_token": 5e-06, "output_cost_per_token": 5e-06 }
        }"#;
        let prices = parse_litellm(json, 1).unwrap();
        let nova = prices.models["gpt-9-nova"];
        let close = |a: f64, b: f64| (a - b).abs() < 1e-9;
        assert!(close(nova.input, 1.0) && close(nova.output, 4.0) && close(nova.cached_input, 0.1), "{nova:?}");
        let flash = prices.models["gemini-9-flash"];
        assert!((flash.input - 0.5).abs() < 1e-9, "gemini/ preferred over vertex_ai/ and resellers");
        assert!((flash.cached_input - 0.05).abs() < 1e-9, "missing cache price → 10 % of input");
        assert!(!prices.models.contains_key("azure/gpt-9-nova"));

        install(prices);
        assert_eq!(price_of("gpt-9-nova-high").map(|p| p.output), Some(4.0), "new model priced, suffix ignored");
        assert_eq!(status().source, "litellm");
    }

    #[tokio::test]
    async fn backfills_unpriced_rows() {
        let db = crate::db::Db::open_in_memory().unwrap();
        db.call(|c| {
            c.execute(
                "INSERT INTO token_usage (thread_id, agent, model, input_tokens, output_tokens, cache_read_tokens,
                                          cache_write_tokens, cost_usd, ts)
                 VALUES (NULL, 'codex', 'gpt-5.6-terra', 1000000, 0, 0, 0, 0, 1),
                        (NULL, 'codex', 'mystery-model', 1000000, 0, 0, 0, 0, 1),
                        (NULL, 'claude_code', 'claude-opus-5-5', 1000000, 0, 0, 0, 0, 1)",
                [],
            )?;
            assert_eq!(backfill(c)?, 1, "only the priced Codex row");
            assert_eq!(backfill(c)?, 0, "already priced");
            let cost: f64 =
                c.query_row("SELECT cost_usd FROM token_usage WHERE model = 'gpt-5.6-terra'", [], |r| r.get(0))?;
            assert!((cost - 2.0).abs() < 1e-9);
            Ok(())
        })
        .await
        .unwrap();
    }
}

/// Manual check against a downloaded LiteLLM file:
/// `NEURON_LITELLM_FILE=<path> cargo test --lib real_litellm -- --ignored --nocapture`
#[cfg(test)]
#[test]
#[ignore]
fn real_litellm_file() {
    let path = std::env::var("NEURON_LITELLM_FILE").expect("NEURON_LITELLM_FILE");
    let prices = parse_litellm(&std::fs::read_to_string(path).unwrap(), 0).unwrap();
    println!("first-party models: {}", prices.models.len());
    install(prices);
    for m in [
        "gpt-6-luna",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gemini-4-neon-high",
        "gemini-4-argon-low",
        "gemini-4-hydrogen-xhigh",
        "gemini-3.8-flash-medium",
        "claude-opus-5-5-high",
        "claude-sonnet-5-5-low",
        "gpt-oss-120b-medium",
        "gemini-pro-orchestrator-neon",
    ] {
        println!("{m:32} {:?}", price_of(m).map(|p| (p.input, p.cached_input, p.output)));
    }
}

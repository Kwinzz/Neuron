//! Models available per agent, read from the installed CLIs (cached), with static fallbacks.

use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

use crate::agents::events::AgentKind;
use crate::agents::process::command;

const CACHE_TTL: Duration = Duration::from_secs(600);
const CLI_TIMEOUT: Duration = Duration::from_secs(25);

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ModelInfo {
    /// Exact id passed to the CLI (`--model` / `-m`).
    pub id: String,
    pub label: String,
    pub hint: Option<String>,
    /// Model vendor for the logo: anthropic | openai | google | other.
    pub vendor: String,
    /// Reasoning levels this model accepts (empty = no reasoning control).
    pub efforts: Vec<String>,
    pub default_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderCatalog {
    pub agent: AgentKind,
    pub label: String,
    /// The CLI is installed and answered.
    pub available: bool,
    pub models: Vec<ModelInfo>,
    /// Limitations worth showing (e.g. no interactive approvals).
    pub note: Option<String>,
}

static CACHE: Mutex<Option<(Instant, Vec<ProviderCatalog>)>> = Mutex::new(None);

fn strings(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

fn vendor_of(id: &str) -> &'static str {
    if id.starts_with("claude") {
        "anthropic"
    } else if id.starts_with("gpt") || id.starts_with("o") || id.starts_with("codex") {
        "openai"
    } else if id.starts_with("gemini") {
        "google"
    } else {
        "other"
    }
}

fn model(id: &str, label: &str, hint: Option<&str>, efforts: &[&str], default_effort: Option<&str>) -> ModelInfo {
    ModelInfo {
        id: id.into(),
        label: label.into(),
        hint: hint.map(str::to_string),
        vendor: vendor_of(id).into(),
        efforts: strings(efforts),
        default_effort: default_effort.map(str::to_string),
    }
}

/// Run `binary args…` and return stdout when it succeeds in time.
async fn run_cli(binary: &str, args: &[&str]) -> Option<String> {
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let child = command(binary, &args, &std::env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    match tokio::time::timeout(CLI_TIMEOUT, child).await {
        Ok(Ok(out)) if out.status.success() => Some(String::from_utf8_lossy(&out.stdout).into_owned()),
        _ => None,
    }
}

const CLAUDE_EFFORTS: &[&str] = crate::agents::claude::EFFORT_LEVELS;

async fn claude() -> ProviderCatalog {
    let available = run_cli("claude", &["--version"]).await.is_some();
    ProviderCatalog {
        agent: AgentKind::ClaudeCode,
        label: "Claude Code".into(),
        available,
        models: vec![
            model("claude-opus-5-5", "Claude Opus 5.5", Some("Le plus capable"), CLAUDE_EFFORTS, None),
            model("claude-sonnet-5-5", "Claude Sonnet 5.5", Some("Équilibré"), CLAUDE_EFFORTS, None),
            model("claude-haiku-5-5", "Claude Haiku 5.5", Some("Rapide et économique"), CLAUDE_EFFORTS, None),
            model("claude-fable-5-2", "Claude Fable 5.2", Some("Génération précédente"), CLAUDE_EFFORTS, None),
        ],
        note: None,
    }
}

/// Parse `codex debug models` (JSON catalog): keep listed models.
pub fn parse_codex_models(raw: &str) -> Vec<ModelInfo> {
    let Ok(v) = serde_json::from_str::<Value>(raw) else { return Vec::new() };
    v.get("models")
        .and_then(Value::as_array)
        .map(|models| {
            models
                .iter()
                .filter(|m| m.get("visibility").and_then(Value::as_str) == Some("list"))
                .filter_map(|m| {
                    let id = m.get("slug").and_then(Value::as_str)?;
                    let efforts: Vec<String> = m
                        .get("supported_reasoning_levels")
                        .and_then(Value::as_array)
                        .map(|l| l.iter().filter_map(|r| r.get("effort")?.as_str().map(str::to_string)).collect())
                        .unwrap_or_default();
                    Some(ModelInfo {
                        id: id.into(),
                        label: m.get("display_name").and_then(Value::as_str).unwrap_or(id).into(),
                        hint: m.get("description").and_then(Value::as_str).map(str::to_string),
                        vendor: "openai".into(),
                        efforts,
                        default_effort: m.get("default_reasoning_level").and_then(Value::as_str).map(str::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

async fn codex() -> ProviderCatalog {
    let models = match run_cli("codex", &["debug", "models"]).await {
        Some(raw) => parse_codex_models(&raw),
        None => Vec::new(),
    };
    let available = !models.is_empty() || run_cli("codex", &["--version"]).await.is_some();
    ProviderCatalog {
        agent: AgentKind::Codex,
        label: "Codex".into(),
        available,
        models,
        note: Some("Pas d'approbation interactive : la sandbox de Codex décide (lecture seule en mode Plan).".into()),
    }
}

/// Parse `agy models` (`id<TAB>Label` lines).
pub fn parse_agy_models(raw: &str) -> Vec<ModelInfo> {
    const EFFORTS: &[&str] = crate::agents::antigravity::EFFORT_LEVELS;
    raw.lines()
        .filter_map(|line| {
            let (id, label) = line.split_once('\t')?;
            let (id, label) = (id.trim(), label.trim());
            if id.is_empty() || id.contains(' ') {
                return None;
            }
            let hint = match vendor_of(id) {
                "anthropic" => Some("Anthropic via Antigravity"),
                "google" => Some("Google"),
                _ => None,
            };
            Some(model(id, label, hint, EFFORTS, None))
        })
        .collect()
}

async fn antigravity() -> ProviderCatalog {
    let models = run_cli("agy", &["models"]).await.map(|raw| parse_agy_models(&raw)).unwrap_or_default();
    ProviderCatalog {
        agent: AgentKind::Antigravity,
        label: "Antigravity".into(),
        available: !models.is_empty(),
        models,
        note: Some("Pas d'approbation interactive : le mode d'Antigravity s'applique.".into()),
    }
}

/// All providers (cached for 10 min unless `refresh`).
pub async fn catalog(refresh: bool) -> Vec<ProviderCatalog> {
    if !refresh {
        if let Ok(guard) = CACHE.lock() {
            if let Some((at, list)) = guard.as_ref() {
                if at.elapsed() < CACHE_TTL {
                    return list.clone();
                }
            }
        }
    }
    let (c, x, a) = tokio::join!(claude(), codex(), antigravity());
    let list = vec![c, x, a];
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some((Instant::now(), list.clone()));
    }
    list
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cli_listings() {
        let codex = parse_codex_models(
            r#"{"models":[
                {"slug":"gpt-x","display_name":"GPT-X","visibility":"list","default_reasoning_level":"medium",
                 "supported_reasoning_levels":[{"effort":"low"},{"effort":"high"}],"description":"Rapide"},
                {"slug":"hidden","visibility":"hide"}]}"#,
        );
        assert_eq!(codex.len(), 1);
        assert_eq!(codex[0].efforts, ["low", "high"]);
        assert_eq!(codex[0].vendor, "openai");

        let agy = parse_agy_models("Fetching available models...\ngemini-4-neon-high\tGemini 4 Neon (High)\nclaude-opus-5-5-low\tClaude Opus 5.5 (Low)\n");
        assert_eq!(agy.len(), 2);
        assert_eq!(agy[0].vendor, "google");
        assert_eq!(agy[1].vendor, "anthropic");
        assert_eq!(agy[1].label, "Claude Opus 5.5 (Low)");
    }
}

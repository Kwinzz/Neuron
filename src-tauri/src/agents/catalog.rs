//! Models available per agent, read from the installed CLIs (cached), with static fallbacks.

use std::collections::BTreeMap;
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
    /// Model families whose reasoning level is a separate model id (Antigravity: `gemini-4-neon-high`):
    /// effort -> concrete model id. The picker shows the family once and the level picks the variant.
    pub effort_models: Option<BTreeMap<String, String>>,
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
        effort_models: None,
    }
}

/// Run `binary args…` and return stdout when it succeeds in time.
pub(crate) async fn run_cli(binary: &str, args: &[&str]) -> Option<String> {
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
            model("claude-fable-5-2", "Claude Fable 5.2", None, CLAUDE_EFFORTS, None),
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
                        effort_models: None,
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

/// Effort suffixes used by Antigravity model ids, weakest first.
const AGY_LEVELS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

/// `gemini-4-neon-high` -> (`gemini-4-neon`, `high`); ids without a level suffix -> None.
fn split_level(id: &str) -> Option<(&str, &str)> {
    let (base, level) = id.rsplit_once('-')?;
    AGY_LEVELS.contains(&level).then_some((base, level))
}

/// "Gemini 4 Neon (High)" -> "Gemini 4 Neon".
fn strip_level_label(label: &str) -> String {
    match label.rsplit_once(" (") {
        Some((name, rest)) if rest.ends_with(')') => name.to_string(),
        _ => label.to_string(),
    }
}

/// Parse `agy models` (`id<TAB>Label` lines) and fold per-level variants into one family each:
/// `gemini-4-neon-{low,medium,high,xhigh}` -> "Gemini 4 Neon" with 4 reasoning levels.
pub fn parse_agy_models(raw: &str) -> Vec<ModelInfo> {
    const EFFORTS: &[&str] = crate::agents::antigravity::EFFORT_LEVELS;
    let mut families: Vec<ModelInfo> = Vec::new();
    for line in raw.lines() {
        let Some((id, label)) = line.split_once('\t') else { continue };
        let (id, label) = (id.trim(), label.trim());
        if id.is_empty() || id.contains(' ') {
            continue;
        }
        let hint = match vendor_of(id) {
            "anthropic" => Some("Anthropic via Antigravity"),
            "google" => Some("Google"),
            "openai" => Some("OpenAI via Antigravity"),
            _ => None,
        };
        match split_level(id) {
            Some((base, level)) => {
                let idx = match families.iter().position(|f| f.id == base) {
                    Some(i) => i,
                    None => {
                        let mut family = model(base, &strip_level_label(label), hint, &[], None);
                        family.effort_models = Some(BTreeMap::new());
                        families.push(family);
                        families.len() - 1
                    }
                };
                if let Some(map) = families[idx].effort_models.as_mut() {
                    map.insert(level.to_string(), id.to_string());
                }
            }
            // No level in the id: a single model; reasoning goes through `--effort`.
            None => families.push(model(id, label, hint, EFFORTS, None)),
        }
    }
    for family in &mut families {
        if let Some(map) = &family.effort_models {
            family.efforts = AGY_LEVELS.iter().filter(|l| map.contains_key(**l)).map(|l| l.to_string()).collect();
            family.default_effort =
                ["medium", "high", "low", "xhigh", "max"].iter().find(|l| map.contains_key(**l)).map(|l| l.to_string());
        }
    }
    families
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
/// The "Generic" provider: one model per CLI configured in Paramètres.
pub fn generic_provider(profiles: &[crate::app_settings::GenericCliProfile]) -> ProviderCatalog {
    ProviderCatalog {
        agent: AgentKind::Generic,
        label: "CLI génériques".into(),
        available: true,
        models: profiles
            .iter()
            .map(|p| ModelInfo {
                id: p.id.clone(),
                label: p.name.clone(),
                hint: Some(format!("{}{}", p.command, if p.pty { " · PTY" } else { "" })),
                vendor: "other".into(),
                efforts: Vec::new(),
                default_effort: None,
                effort_models: None,
            })
            .collect(),
        note: Some(
            "CLI générique : un processus par message, sans mémoire entre les messages ni demande d'autorisation."
                .into(),
        ),
    }
}

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

        let agy = parse_agy_models(concat!(
            "Fetching available models...\n",
            "gemini-4-neon-high\tGemini 4 Neon (High)\n",
            "gemini-4-neon-low\tGemini 4 Neon (Low)\n",
            "gemini-4-neon-xhigh\tGemini 4 Neon (XHigh)\n",
            "gemini-pro-orchestrator-neon\tOrchestrator (Neon)\n",
            "claude-opus-5-5-low\tClaude Opus 5.5 (Low)\n",
            "claude-opus-5-5-high\tClaude Opus 5.5 (High)\n",
        ));
        assert_eq!(agy.len(), 3, "variants folded into families");
        let neon = &agy[0];
        assert_eq!(
            (neon.id.as_str(), neon.label.as_str(), neon.vendor.as_str()),
            ("gemini-4-neon", "Gemini 4 Neon", "google")
        );
        assert_eq!(neon.efforts, ["low", "high", "xhigh"], "ordered weakest first");
        assert_eq!(neon.default_effort.as_deref(), Some("high"));
        assert_eq!(neon.effort_models.as_ref().unwrap()["xhigh"], "gemini-4-neon-xhigh");
        let orchestrator = &agy[1];
        assert!(orchestrator.effort_models.is_none() && !orchestrator.efforts.is_empty());
        assert_eq!(agy[2].label, "Claude Opus 5.5");
        assert_eq!(agy[2].vendor, "anthropic");
    }
}

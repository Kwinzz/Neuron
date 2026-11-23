//! Slash commands of each provider, for the « / » menu of the message box.
//!
//! - Claude Code: `initialize` control request → `commands` (built-ins, skills, plugins) with descriptions. Sent
//!   as-is in the prompt (`/compact`, `/context`, `/<skill>`…), Claude expands them itself.
//! - Antigravity: `agy acp` → `available_commands_update` (built-ins + skills). Sent as-is: agy expands slash
//!   commands in print mode. Plus `/quota`, `/usage`, `/credits`, run by Neuron (`antigravity::quota`).
//! - Codex: `codex exec` has no slash commands. Neuron offers `/review` (→ `codex exec review`) and the Codex
//!   skills (`~/.codex/skills`, `~/.agents/skills`, `<cwd>/.agents/skills`, `<cwd>/.codex/skills`), rewritten into
//!   an explicit instruction pointing at the skill file.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use ts_rs::TS;

use crate::agents::events::AgentKind;
use crate::agents::process::command;

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SlashCommand {
    /// Without the leading slash.
    pub name: String,
    pub description: String,
    pub argument_hint: Option<String>,
}

const LIST_TIMEOUT: Duration = Duration::from_secs(25);
const TTL: Duration = Duration::from_secs(15 * 60);

type CacheKey = (AgentKind, String);
type CacheMap = HashMap<CacheKey, (Instant, Vec<SlashCommand>)>;
static CACHE: Mutex<Option<CacheMap>> = Mutex::new(None);

fn first_line(s: &str, max: usize) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > max { format!("{}…", flat.chars().take(max - 1).collect::<String>()) } else { flat }
}

/// Commands for an agent in a working directory (cached 15 min). Empty when the CLI can't tell.
pub async fn list(agent: AgentKind, cwd: &Path) -> Vec<SlashCommand> {
    let key = (agent, cwd.display().to_string());
    if let Ok(guard) = CACHE.lock() {
        if let Some((at, list)) = guard.as_ref().and_then(|m| m.get(&key)) {
            if at.elapsed() < TTL {
                return list.clone();
            }
        }
    }
    let result = match agent {
        AgentKind::ClaudeCode => tokio::time::timeout(LIST_TIMEOUT, claude(cwd)).await.ok().flatten(),
        AgentKind::Antigravity => {
            tokio::time::timeout(LIST_TIMEOUT, antigravity(cwd)).await.ok().flatten().map(|mut list| {
                // Answered by the CLI itself (not listed by ACP): Neuron runs them with `agy --print`.
                list.extend(crate::agents::antigravity::quota::LOCAL_COMMANDS.iter().map(|(name, description)| {
                    SlashCommand { name: (*name).into(), description: (*description).into(), argument_hint: None }
                }));
                list
            })
        }
        AgentKind::Codex => Some(codex(cwd)),
        AgentKind::Generic => Some(Vec::new()),
    };
    let Some(mut list) = result else {
        tracing::warn!(?agent, "slash commands unavailable");
        return Vec::new();
    };
    list.sort_by(|a, b| a.name.cmp(&b.name));
    list.dedup_by(|a, b| a.name == b.name);
    if let Ok(mut guard) = CACHE.lock() {
        guard.get_or_insert_with(HashMap::new).insert(key, (Instant::now(), list.clone()));
    }
    list
}

// ---- Claude Code ------------------------------------------------------------------------------------

async fn claude(cwd: &Path) -> Option<Vec<SlashCommand>> {
    let binary = std::env::var("NEURON_CLAUDE_BIN").unwrap_or_else(|_| "claude".into());
    let args: Vec<String> = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let mut child =
        command(&binary, &args, cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut stdin = child.stdin.take()?;
    let request =
        json!({ "type": "control_request", "request_id": "neuron-slash", "request": { "subtype": "initialize" } });
    stdin.write_all(format!("{request}\n").as_bytes()).await.ok()?;
    stdin.flush().await.ok()?;
    let mut lines = BufReader::new(child.stdout.take()?).lines();
    let mut found = None;
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if v.get("type").and_then(Value::as_str) != Some("control_response") {
            continue;
        }
        let response = v.pointer("/response/response").or_else(|| v.get("response"));
        found = response.and_then(|r| r.get("commands")).and_then(Value::as_array).map(|cmds| parse_claude(cmds));
        break;
    }
    drop(stdin);
    let _ = child.kill().await;
    found
}

fn parse_claude(cmds: &[Value]) -> Vec<SlashCommand> {
    cmds.iter()
        .filter_map(|c| {
            let name = c.get("name")?.as_str()?.trim_start_matches('/').to_string();
            // Internal entries (`__remote-workflow`) are not meant for users.
            if name.starts_with("__") {
                return None;
            }
            Some(SlashCommand {
                name,
                description: first_line(c.get("description").and_then(Value::as_str).unwrap_or(""), 160),
                argument_hint: c
                    .get("argumentHint")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string),
            })
        })
        .collect()
}

// ---- Antigravity (ACP) ------------------------------------------------------------------------------

async fn antigravity(cwd: &Path) -> Option<Vec<SlashCommand>> {
    let binary = std::env::var("NEURON_AGY_BIN").unwrap_or_else(|_| "agy".into());
    let mut child = command(&binary, &["acp".to_string()], cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdin = child.stdin.take()?;
    let mut lines = BufReader::new(child.stdout.take()?).lines();
    let send = |v: Value| format!("{v}\n");
    let init = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": 1,
        "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false }, "terminal": false },
    }});
    stdin.write_all(send(init).as_bytes()).await.ok()?;
    stdin.flush().await.ok()?;
    let mut found = None;
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if v.get("id").and_then(Value::as_i64) == Some(1) {
            let new = json!({ "jsonrpc": "2.0", "id": 2, "method": "session/new", "params": {
                "cwd": cwd.display().to_string(), "mcpServers": [],
            }});
            stdin.write_all(send(new).as_bytes()).await.ok()?;
            stdin.flush().await.ok()?;
            continue;
        }
        let update = v.pointer("/params/update");
        if update.and_then(|u| u.get("sessionUpdate")).and_then(Value::as_str) == Some("available_commands_update") {
            found =
                update.and_then(|u| u.get("availableCommands")).and_then(Value::as_array).map(|cmds| parse_acp(cmds));
            break;
        }
    }
    drop(stdin);
    let _ = child.kill().await;
    found
}

fn parse_acp(cmds: &[Value]) -> Vec<SlashCommand> {
    cmds.iter()
        .filter_map(|c| {
            Some(SlashCommand {
                name: c.get("name")?.as_str()?.trim_start_matches('/').to_string(),
                description: first_line(c.get("description").and_then(Value::as_str).unwrap_or(""), 160),
                argument_hint: c.pointer("/input/hint").and_then(Value::as_str).map(str::to_string),
            })
        })
        .collect()
}

// ---- Codex --------------------------------------------------------------------------------------

/// A Codex skill folder (`<dir>/<skill>/SKILL.md`).
#[derive(Debug, Clone, PartialEq)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub file: PathBuf,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

/// `name` / `description` from a SKILL.md front matter (`key: value`, or folded `key: >-` + indented lines).
pub fn front_matter(text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut lines = text.lines();
    if lines.next().map(str::trim) != Some("---") {
        return out;
    }
    let mut current: Option<String> = None;
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        if let Some(key) = &current {
            if line.starts_with(' ') || line.starts_with('\t') {
                let entry = out.entry(key.clone()).or_insert_with(String::new);
                if !entry.is_empty() {
                    entry.push(' ');
                }
                entry.push_str(line.trim());
                continue;
            }
            current = None;
        }
        if let Some((k, v)) = line.split_once(':') {
            let (k, v) = (k.trim().to_string(), v.trim());
            if matches!(v, ">" | ">-" | "|" | "|-") {
                current = Some(k);
            } else {
                out.insert(k, v.trim_matches('"').trim_matches('\'').to_string());
            }
        }
    }
    out
}

pub fn codex_skills(cwd: &Path) -> Vec<Skill> {
    let mut dirs = vec![cwd.join(".agents").join("skills"), cwd.join(".codex").join("skills")];
    if let Some(h) = home() {
        dirs.push(h.join(".codex").join("skills"));
        dirs.push(h.join(".agents").join("skills"));
    }
    let mut out: Vec<Skill> = Vec::new();
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let file = entry.path().join("SKILL.md");
            let Ok(text) = std::fs::read_to_string(&file) else { continue };
            let fm = front_matter(&text);
            let name = fm.get("name").cloned().unwrap_or_else(|| entry.file_name().to_string_lossy().into_owned());
            if out.iter().any(|s| s.name == name) {
                continue; // project skills win over user ones (listed first)
            }
            out.push(Skill { name, description: fm.get("description").cloned().unwrap_or_default(), file });
        }
    }
    out
}

fn codex(cwd: &Path) -> Vec<SlashCommand> {
    let mut list = vec![SlashCommand {
        name: "review".into(),
        description: "Revue de code des modifications non commitées (codex exec review), ou selon tes instructions"
            .into(),
        argument_hint: Some("[instructions]".into()),
    }];
    list.extend(codex_skills(cwd).into_iter().map(|s| SlashCommand {
        description: first_line(&s.description, 160),
        name: s.name,
        argument_hint: None,
    }));
    list
}

/// What a Codex turn starting with « / » becomes.
#[derive(Debug, Clone, PartialEq)]
pub enum CodexSlash {
    /// `/review [instructions]` → `codex exec review`.
    Review(Option<String>),
    /// `/<skill> args` → explicit instruction to apply the skill.
    Prompt(String),
}

pub fn codex_rewrite(cwd: &Path, text: &str) -> Option<CodexSlash> {
    let rest = text.trim_start().strip_prefix('/')?;
    let (name, args) = rest.split_once(char::is_whitespace).map_or((rest, ""), |(n, a)| (n, a.trim()));
    if name == "review" {
        return Some(CodexSlash::Review((!args.is_empty()).then(|| args.to_string())));
    }
    let skill = codex_skills(cwd).into_iter().find(|s| s.name == name)?;
    let task = if args.is_empty() { "la tâche en cours".to_string() } else { args.to_string() };
    Some(CodexSlash::Prompt(format!(
        "${name} — Applique le skill « {name} » (instructions : {}) pour : {task}",
        skill.file.display()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_front_matter() {
        let fm = front_matter(
            "---\nname: run-workflow\ndescription: >-\n  How to write\n  a workflow.\nother: x\n---\n# Body",
        );
        assert_eq!(fm["name"], "run-workflow");
        assert_eq!(fm["description"], "How to write a workflow.");
        assert_eq!(fm["other"], "x");
        assert!(front_matter("# no front matter").is_empty());
    }

    #[test]
    fn claude_and_acp_lists() {
        let c: Vec<Value> = serde_json::from_str(
            r#"[{"name":"compact","description":"Clear history\n but keep a summary","argumentHint":"<instructions>"},
                {"name":"__remote-workflow","description":"internal"}]"#,
        )
        .unwrap();
        let list = parse_claude(&c);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].description, "Clear history but keep a summary");
        assert_eq!(list[0].argument_hint.as_deref(), Some("<instructions>"));
        let a: Vec<Value> =
            serde_json::from_str(r#"[{"name":"goal","description":"Run until done","input":{"hint":"objectif"}}]"#)
                .unwrap();
        assert_eq!(parse_acp(&a)[0].argument_hint.as_deref(), Some("objectif"));
    }

    #[test]
    fn codex_review_and_skills() {
        let cwd = std::env::temp_dir().join(format!("neuron-slash-{}", uuid::Uuid::new_v4().simple()));
        let skill = cwd.join(".agents").join("skills").join("lint-fix");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(skill.join("SKILL.md"), "---\nname: lint-fix\ndescription: Fix lint errors\n---\n").unwrap();

        assert_eq!(codex_rewrite(&cwd, "/review"), Some(CodexSlash::Review(None)));
        assert_eq!(codex_rewrite(&cwd, "/review  focus perf"), Some(CodexSlash::Review(Some("focus perf".into()))));
        match codex_rewrite(&cwd, "/lint-fix src/main.rs") {
            Some(CodexSlash::Prompt(p)) => {
                assert!(p.starts_with("$lint-fix") && p.contains("SKILL.md") && p.ends_with("src/main.rs"))
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(codex_rewrite(&cwd, "/unknown x"), None);
        assert_eq!(codex_rewrite(&cwd, "pas une commande"), None);
        assert!(codex(&cwd).iter().any(|c| c.name == "lint-fix"));
        let _ = std::fs::remove_dir_all(cwd);
    }
}

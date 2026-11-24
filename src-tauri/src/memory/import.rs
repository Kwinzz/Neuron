//! Importing memories from elsewhere: text copied from claude.ai / ChatGPT / Gemini, or the instruction files of
//! the agent CLIs (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`).
//!
//! The text is split into one memory per item with a guessed category (pure functions below), shown in an
//! editable preview, and optionally rewritten by an agent ([`reformulation_prompt`] / [`parse_reformulated`]).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::memory::MemoryCategory;

/// Max size read from an import file.
pub const MAX_IMPORT_BYTES: u64 = 200 * 1024;

/// Where imported memories come from (stored as `source = "import:<origin>"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MemoryImportOrigin {
    ClaudeAi,
    Chatgpt,
    Gemini,
    ClaudeCode,
    Codex,
    GeminiCli,
    Other,
}

impl MemoryImportOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            MemoryImportOrigin::ClaudeAi => "claude_ai",
            MemoryImportOrigin::Chatgpt => "chatgpt",
            MemoryImportOrigin::Gemini => "gemini",
            MemoryImportOrigin::ClaudeCode => "claude_code",
            MemoryImportOrigin::Codex => "codex",
            MemoryImportOrigin::GeminiCli => "gemini_cli",
            MemoryImportOrigin::Other => "other",
        }
    }
}

/// One memory of the import preview.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportedMemory {
    pub category: MemoryCategory,
    pub content: String,
}

/// An agent CLI instruction file found (or not) on this computer.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LocalMemorySource {
    pub origin: MemoryImportOrigin,
    pub label: String,
    pub path: String,
    pub exists: bool,
    #[ts(type = "number")]
    pub bytes: u64,
}

/// The instruction files of Claude Code, Codex and Gemini CLI under `home`.
pub fn local_sources(home: &Path) -> Vec<LocalMemorySource> {
    let codex_home = std::env::var_os("CODEX_HOME").filter(|d| !d.is_empty()).map(PathBuf::from);
    let candidates = [
        (MemoryImportOrigin::ClaudeCode, "Claude Code", home.join(".claude").join("CLAUDE.md")),
        (MemoryImportOrigin::Codex, "Codex", codex_home.unwrap_or_else(|| home.join(".codex")).join("AGENTS.md")),
        (MemoryImportOrigin::GeminiCli, "Gemini CLI", home.join(".gemini").join("GEMINI.md")),
    ];
    candidates
        .into_iter()
        .map(|(origin, label, path)| {
            let meta = std::fs::metadata(&path).ok().filter(|m| m.is_file());
            LocalMemorySource {
                origin,
                label: label.into(),
                path: path.display().to_string(),
                exists: meta.is_some(),
                bytes: meta.map_or(0, |m| m.len()),
            }
        })
        .collect()
}

/// Lowercase without accents, for keyword matching and duplicate detection.
pub fn normalize(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            '’' => '\'',
            c => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Best guess of the category of a memory, from keywords (FR / EN). The user fixes it in the preview.
pub fn guess_category(content: &str) -> MemoryCategory {
    let text = format!(" {} ", normalize(content));
    let has = |words: &[&str]| words.iter().any(|w| text.contains(w));
    if has(&[
        " toujours ",
        " jamais ",
        " ne jamais",
        " ne pas ",
        " interdit",
        " obligatoire",
        " always ",
        " never ",
        " must ",
        " do not ",
        " don't ",
    ]) {
        MemoryCategory::StrictRules
    } else if has(&[
        "nommage",
        "indent",
        "camelcase",
        "snake_case",
        "commentaire",
        "naming",
        "formatting",
        " format",
        "code style",
        "style de code",
        "lint",
        "prettier",
        "rustfmt",
    ]) {
        MemoryCategory::CodeStyle
    } else if has(&[
        " je suis ",
        " je m'appelle",
        " mon nom ",
        " j'habite",
        " je vis ",
        " je travaille",
        " i am ",
        " i'm ",
        " my name ",
        " lives in",
        " works as",
        " works at",
        " user is ",
        " the user ",
        " l'utilisateur ",
    ]) {
        MemoryCategory::Profile
    } else if has(&[
        " prefere",
        " prefer",
        " utilise ",
        " uses ",
        " stack",
        " framework",
        " langage",
        " language",
        " typescript",
        " rust",
        " python",
        " react",
        " windows",
        " linux",
        " editeur",
        " editor",
    ]) {
        MemoryCategory::TechPreferences
    } else {
        MemoryCategory::Other
    }
}

fn item(content: &str, category: Option<MemoryCategory>) -> Option<ImportedMemory> {
    let content = content.trim();
    if content.is_empty() {
        return None;
    }
    Some(ImportedMemory { category: category.unwrap_or_else(|| guess_category(content)), content: content.into() })
}

/// JSON exports: an array of strings, or of objects with `content` / `text` / `memory` (+ optional `category`).
fn split_json(text: &str) -> Option<Vec<ImportedMemory>> {
    let value: Value = serde_json::from_str(text.trim()).ok()?;
    let list = match &value {
        Value::Array(list) => list.clone(),
        Value::Object(map) => ["memories", "items", "data"].iter().find_map(|k| map.get(*k)?.as_array().cloned())?,
        _ => return None,
    };
    Some(
        list.iter()
            .filter_map(|entry| match entry {
                Value::String(s) => item(s, None),
                Value::Object(map) => {
                    let content = ["content", "text", "memory", "value"].iter().find_map(|k| map.get(*k)?.as_str())?;
                    let category =
                        map.get("category").and_then(Value::as_str).map(MemoryCategory::from_heading).filter(|c| {
                            *c != MemoryCategory::Other
                                || map.get("category").and_then(Value::as_str).is_some_and(|s| s == "other")
                        });
                    item(content, category)
                }
                _ => None,
            })
            .collect(),
    )
}

/// `- x`, `* x`, `• x`, `1. x`, `1) x` → `x`.
fn strip_bullet(line: &str) -> Option<&str> {
    for prefix in ["- [ ] ", "- [x] ", "- ", "* ", "• ", "– ", "+ "] {
        if let Some(rest) = line.strip_prefix(prefix) {
            return Some(rest);
        }
    }
    let digits = line.find(|c: char| !c.is_ascii_digit())?;
    if digits == 0 {
        return None;
    }
    let rest = &line[digits..];
    rest.strip_prefix(". ").or_else(|| rest.strip_prefix(") "))
}

/// Split pasted text or a file into memories (JSON, Markdown with headings and bullets, or one line per memory).
pub fn split_memories(text: &str) -> Vec<ImportedMemory> {
    if let Some(items) = split_json(text) {
        return items;
    }
    let mut out: Vec<ImportedMemory> = Vec::new();
    // Category given by the current `##` heading, when it names one of Neuron's.
    let mut section: Option<MemoryCategory> = None;
    let mut fence: Option<String> = None;
    // The last item can take indented continuation lines.
    let mut open = false;
    let mut in_frontmatter = false;

    for (n, raw) in text.lines().enumerate() {
        let line = raw.trim_end();
        let trimmed = line.trim_start();
        if n == 0 && trimmed == "---" {
            in_frontmatter = true;
            continue;
        }
        if in_frontmatter {
            in_frontmatter = trimmed != "---";
            continue;
        }
        if let Some(block) = fence.as_mut() {
            block.push('\n');
            block.push_str(line);
            if trimmed.starts_with("```") {
                let block = std::mem::take(block);
                fence = None;
                match out.last_mut().filter(|_| open) {
                    Some(last) => {
                        last.content.push('\n');
                        last.content.push_str(&block);
                    }
                    None => out.extend(item(&block, section)),
                }
                open = false;
            }
            continue;
        }
        if trimmed.starts_with("```") {
            fence = Some(line.to_string());
            continue;
        }
        if trimmed.is_empty() {
            open = false;
            continue;
        }
        if let Some(heading) = trimmed.strip_prefix('#') {
            let heading = heading.trim_start_matches('#').trim();
            let category = MemoryCategory::from_heading(heading);
            section = (category != MemoryCategory::Other).then_some(category);
            open = false;
            continue;
        }
        // `@file` includes (CLAUDE.md), separators, quotes of the Neuron header.
        if trimmed.starts_with('@') && !trimmed.contains(' ') || trimmed.chars().all(|c| matches!(c, '-' | '=' | '*')) {
            continue;
        }
        let indented = line.len() - trimmed.len() >= 2;
        match strip_bullet(trimmed) {
            Some(rest) if !(indented && open) => {
                out.extend(item(rest, section));
                open = true;
            }
            _ if indented && open => {
                if let Some(last) = out.last_mut() {
                    last.content.push('\n');
                    last.content.push_str(trimmed);
                }
            }
            _ => {
                // Plain line: an intro like « Voici ce que je sais de toi : » is not a memory.
                if trimmed.ends_with(':') && trimmed.len() < 80 {
                    open = false;
                    continue;
                }
                out.extend(item(trimmed, section));
                open = true;
            }
        }
    }
    if let Some(block) = fence {
        out.extend(item(&block, section));
    }
    out
}

/// Prompt asking an agent to rewrite raw memories into clean, categorized ones (JSON only).
pub fn reformulation_prompt(text: &str) -> String {
    let text = text.trim();
    crate::tr!(
        "Tu reçois des souvenirs bruts sur un utilisateur (copiés depuis un assistant IA ou un fichier d'instructions). \
Réécris-les en souvenirs durables pour sa mémoire globale :\n\
- un fait ou une règle par souvenir, phrase courte et autonome, en français, à la 2e personne évitée \
(ex. « Préfère TypeScript strict », « Ne jamais pousser sans demande ») ;\n\
- fusionne les doublons, retire ce qui est temporaire, vague ou sans intérêt ;\n\
- garde le sens exact, n'invente rien ;\n\
- catégorie parmi : \"profile\" (qui il est), \"tech_preferences\" (outils, langages, environnement), \
\"code_style\" (façon d'écrire le code), \"strict_rules\" (règles à toujours respecter), \"other\".\n\
N'utilise aucun outil. Réponds UNIQUEMENT avec un tableau JSON, sans texte autour : \
[{{\"category\": \"...\", \"content\": \"...\"}}]\n\n\
Souvenirs bruts :\n<<<\n{text}\n>>>",
        "You receive raw memories about a user (copied from an AI assistant or an instructions file). \
Rewrite them as lasting memories for their global memory:\n\
- one fact or rule per memory, short and self-contained sentence, in English, avoiding the second person \
(e.g. “Prefers strict TypeScript”, “Never push without being asked”);\n\
- merge duplicates, drop what is temporary, vague or of no interest;\n\
- keep the exact meaning, invent nothing;\n\
- category among: \"profile\" (who they are), \"tech_preferences\" (tools, languages, environment), \
\"code_style\" (how they write code), \"strict_rules\" (rules to always follow), \"other\".\n\
Use no tool. Answer ONLY with a JSON array, no text around it: \
[{{\"category\": \"...\", \"content\": \"...\"}}]\n\n\
Raw memories:\n<<<\n{text}\n>>>"
    )
}

/// The JSON array of an agent's answer (it may be wrapped in text or a ``` block).
pub fn parse_reformulated(output: &str) -> Option<Vec<ImportedMemory>> {
    let (start, end) = (output.find('[')?, output.rfind(']')?);
    if start >= end {
        return None;
    }
    let list: Vec<Value> = serde_json::from_str(&output[start..=end]).ok()?;
    let items: Vec<ImportedMemory> = list
        .iter()
        .filter_map(|v| {
            let content = v.get("content").and_then(Value::as_str)?;
            let category =
                v.get("category").and_then(Value::as_str).map_or(MemoryCategory::Other, MemoryCategory::from_db);
            item(content, Some(category))
        })
        .collect();
    (!items.is_empty()).then_some(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contents(items: &[ImportedMemory]) -> Vec<&str> {
        items.iter().map(|i| i.content.as_str()).collect()
    }

    #[test]
    fn splits_pasted_lists() {
        let chatgpt = "Voici ce que je sais de toi :\n\n1. Prefers TypeScript in strict mode.\n2. Lives in Lyon.\n\n\
- Never commits without asking.\n";
        let items = split_memories(chatgpt);
        assert_eq!(
            contents(&items),
            ["Prefers TypeScript in strict mode.", "Lives in Lyon.", "Never commits without asking."]
        );
        assert_eq!(items[2].category, MemoryCategory::StrictRules);

        let plain = "Je m'appelle Alex\nJ'utilise Windows 11 et Arch Linux\n";
        let items = split_memories(plain);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].category, MemoryCategory::Profile);
        assert_eq!(items[1].category, MemoryCategory::TechPreferences);
    }

    #[test]
    fn splits_markdown_files() {
        let md = "---\nname: x\n---\n# Projet\n\n@RTK.md\n\n## Règles strictes\n\n- Pas de unwrap()\n  hors des tests\n\
- Toujours cargo fmt\n\n## Divers\n\nTexte libre.\n\n```bash\nnpm run build\n```\n";
        let items = split_memories(md);
        assert_eq!(items[0].content, "Pas de unwrap()\nhors des tests");
        assert_eq!(items[0].category, MemoryCategory::StrictRules);
        assert_eq!(items[1].category, MemoryCategory::StrictRules);
        assert!(items.iter().all(|i| !i.content.contains("@RTK") && !i.content.contains("name: x")));
        assert_eq!(items[2].content, "Texte libre.");
        assert!(
            items[3].content.starts_with(
                "```bash
npm run build"
            ),
            "a code block stays whole"
        );
    }

    #[test]
    fn splits_json_exports() {
        let items = split_memories(
            r#"["Aime Rust", {"content": "Toujours répondre en français", "category": "strict_rules"}]"#,
        );
        assert_eq!(contents(&items), ["Aime Rust", "Toujours répondre en français"]);
        assert_eq!(items[1].category, MemoryCategory::StrictRules);
        let items = split_memories(r#"{"memories": [{"text": "Utilise Neovim"}]}"#);
        assert_eq!(contents(&items), ["Utilise Neovim"]);
    }

    #[test]
    fn reads_agent_reformulation() {
        let out = "Voici :\n```json\n[{\"category\": \"code_style\", \"content\": \"Indentation 2 espaces\"},\
{\"category\": \"bogus\", \"content\": \"Autre chose\"}, {\"content\": \"\"}]\n```";
        let items = parse_reformulated(out).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].category, MemoryCategory::CodeStyle);
        assert_eq!(items[1].category, MemoryCategory::Other);
        assert!(parse_reformulated("désolé, impossible").is_none());
        assert!(parse_reformulated("[]").is_none());
    }

    /// Real agent: `NEURON_ONESHOT_AGENT=claude_code cargo test live_reformulation -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn live_reformulation() {
        let agent = match std::env::var("NEURON_ONESHOT_AGENT").as_deref() {
            Ok("codex") => crate::agents::events::AgentKind::Codex,
            Ok("antigravity") => crate::agents::events::AgentKind::Antigravity,
            _ => crate::agents::events::AgentKind::ClaudeCode,
        };
        let raw = "1. User prefers TypeScript strict
2. user likes typescript in strict mode
3. Never push without asking";
        let answer = crate::agents::oneshot::run(agent, &reformulation_prompt(raw)).await.unwrap();
        println!("{answer}");
        println!("{:?}", parse_reformulated(&answer));
    }

    #[test]
    fn normalizes_for_duplicates() {
        assert_eq!(normalize("  Préfère   TypeScript "), normalize("prefere typescript"));
    }
}

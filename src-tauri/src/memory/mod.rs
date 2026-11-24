//! Global memory: SQLite `memories` (source of truth for the app) mirrored to an editable
//! `~/.neuron/memory.md`. Edits made in the file are imported; every change in the app (or by an agent
//! through the MCP server) re-exports the file. Both the app and the MCP process share the same rules,
//! with the hash of the last synchronized file stored in `settings` so either side can detect edits.

pub mod import;
pub mod mcp;

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::context::{ContextSource, ContextSourceKind};
use crate::db::{memories, settings};
use crate::error::AppResult;

/// Settings key: FNV-1a hash of the last `memory.md` content written or imported.
const FILE_HASH_KEY: &str = "memory.file_hash";
/// Max characters of memory injected into a new chat.
const MAX_INJECTED_CHARS: usize = 12_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MemoryCategory {
    Profile,
    TechPreferences,
    CodeStyle,
    StrictRules,
    Other,
}

impl MemoryCategory {
    pub const ALL: [MemoryCategory; 5] = [
        MemoryCategory::Profile,
        MemoryCategory::TechPreferences,
        MemoryCategory::CodeStyle,
        MemoryCategory::StrictRules,
        MemoryCategory::Other,
    ];

    pub fn as_db(self) -> &'static str {
        match self {
            MemoryCategory::Profile => "profile",
            MemoryCategory::TechPreferences => "tech_preferences",
            MemoryCategory::CodeStyle => "code_style",
            MemoryCategory::StrictRules => "strict_rules",
            MemoryCategory::Other => "other",
        }
    }

    pub fn from_db(s: &str) -> Self {
        Self::ALL.into_iter().find(|c| c.as_db() == s).unwrap_or(MemoryCategory::Other)
    }

    /// Heading used in `memory.md`.
    /// Heading in the current language.
    pub fn label(self) -> &'static str {
        let (fr, en) = self.labels();
        crate::i18n::pick(fr, en)
    }

    /// (French, English) headings — both are recognized when `memory.md` is read back.
    fn labels(self) -> (&'static str, &'static str) {
        match self {
            MemoryCategory::Profile => ("Profil", "Profile"),
            MemoryCategory::TechPreferences => ("Préférences techniques", "Tech preferences"),
            MemoryCategory::CodeStyle => ("Style de code", "Code style"),
            MemoryCategory::StrictRules => ("Règles strictes", "Strict rules"),
            MemoryCategory::Other => ("Autres", "Other"),
        }
    }

    pub fn rank(self) -> usize {
        Self::ALL.iter().position(|c| *c == self).unwrap_or(Self::ALL.len())
    }

    /// Lenient match of a `##` heading (case/accents/plural-insensitive) or a category id.
    pub fn from_heading(heading: &str) -> Self {
        let norm = normalize(heading);
        Self::ALL
            .into_iter()
            .find(|c| {
                let (fr, en) = c.labels();
                normalize(fr) == norm || normalize(en) == norm || normalize(c.as_db()) == norm
            })
            .or_else(|| {
                // Loose prefixes: "Règles", "Style", "Préférences", "Profil".
                let first = norm.split(' ').next().unwrap_or_default();
                match first {
                    "profil" | "profile" => Some(MemoryCategory::Profile),
                    "preference" | "preferences" | "tech" => Some(MemoryCategory::TechPreferences),
                    "style" | "code" => Some(MemoryCategory::CodeStyle),
                    "regle" | "regles" | "rules" | "strict" => Some(MemoryCategory::StrictRules),
                    _ => None,
                }
            })
            .unwrap_or(MemoryCategory::Other)
    }
}

fn normalize(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            '_' | '-' => ' ',
            c => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Memory {
    pub id: String,
    pub category: MemoryCategory,
    pub content: String,
    /// `user`, `file` (edited in memory.md) or `agent:<kind>` (saved through MCP).
    pub source: String,
    #[ts(type = "number")]
    pub created_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MemoryHit {
    pub memory: Memory,
    /// Higher = more relevant.
    pub score: f64,
}

/// Where the memory lives (for the UI).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MemoryInfo {
    /// Absolute path of `memory.md`.
    pub file_path: String,
    /// The MCP server is offered to agents (Claude Code, Codex, Antigravity).
    pub mcp_enabled: bool,
    /// Command line agents run to reach the MCP server.
    pub mcp_command: String,
}

/// Paths both processes need.
#[derive(Debug, Clone)]
pub struct MemoryPaths {
    pub db_path: PathBuf,
    pub file_path: PathBuf,
}

const FILE_HEADER_EN: &str = "# Neuron memory\n\n\
> Global memory shared by all your agents (Claude Code, Codex, Antigravity…) through Neuron.\n\
> Edit it here or in the app: one \"-\" bullet per memory, under the right category. Continuation\n\
> lines are indented by 2 spaces. Neuron rewrites this file.\n";
const FILE_HEADER_FR: &str = "# Mémoire Neuron\n\n\
> Mémoire globale partagée par tous tes agents (Claude Code, Codex, Antigravity…) via Neuron.\n\
> Modifiable ici ou dans l'app : une puce « - » par souvenir, sous la bonne catégorie. Les lignes\n\
> de continuation sont indentées de 2 espaces. Ce fichier est réécrit par Neuron.\n";

/// Render all memories as `memory.md`.
pub fn render_file(items: &[Memory]) -> String {
    let mut out = String::from(crate::i18n::pick(FILE_HEADER_FR, FILE_HEADER_EN));
    for category in MemoryCategory::ALL {
        let in_cat: Vec<&Memory> = items.iter().filter(|m| m.category == category).collect();
        if category == MemoryCategory::Other && in_cat.is_empty() {
            continue;
        }
        out.push_str(&format!("\n## {}\n\n", category.label()));
        for m in in_cat {
            let mut lines = m.content.lines();
            out.push_str(&format!("- {}\n", lines.next().unwrap_or_default()));
            for line in lines {
                out.push_str(&format!("  {line}\n"));
            }
        }
    }
    out
}

/// Parse `memory.md` into (category, content) lines. Lines outside a `##` section and the header
/// blockquote are ignored; continuation lines (indented) extend the previous bullet.
pub fn parse_file(text: &str) -> Vec<(MemoryCategory, String)> {
    let mut out: Vec<(MemoryCategory, String)> = Vec::new();
    let mut category: Option<MemoryCategory> = None;
    let mut open = false; // the last pushed item can take continuation lines
    for raw in text.lines() {
        let line = raw.trim_end();
        if let Some(h) = line.strip_prefix("## ") {
            category = Some(MemoryCategory::from_heading(h));
            open = false;
            continue;
        }
        if line.starts_with('#') {
            category = None;
            open = false;
            continue;
        }
        let Some(cat) = category else { continue };
        let trimmed = line.trim_start();
        let bullet = trimmed.strip_prefix("- ").or_else(|| trimmed.strip_prefix("* "));
        let indented = line.len() - trimmed.len() >= 2;
        match bullet {
            Some(item) if !indented || !open => {
                let item = item.trim();
                if !item.is_empty() {
                    out.push((cat, item.to_string()));
                    open = true;
                }
            }
            _ if indented && open && !trimmed.is_empty() => {
                if let Some(last) = out.last_mut() {
                    last.1.push('\n');
                    last.1.push_str(trimmed);
                }
            }
            _ if trimmed.is_empty() => {}
            _ => {
                // A plain paragraph line in a section: keep it as its own memory.
                out.push((cat, trimmed.to_string()));
                open = true;
            }
        }
    }
    out
}

/// Stable 64-bit FNV-1a (stored across app versions).
fn fnv1a(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

fn stored_hash(conn: &Connection) -> AppResult<Option<String>> {
    Ok(settings::get(conn, FILE_HASH_KEY)?.and_then(|v| v.as_str().map(str::to_string)))
}

/// Rewrite `memory.md` from the database (no write when unchanged).
pub fn export(conn: &Connection, path: &Path) -> AppResult<()> {
    let content = render_file(&memories::list(conn)?);
    let current = std::fs::read(path).ok();
    if current.as_deref() != Some(content.as_bytes()) {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        // Write then rename: an editor or the other process never reads a half-written file.
        let tmp = path.with_extension("md.tmp");
        std::fs::write(&tmp, &content)?;
        std::fs::rename(&tmp, path)?;
    }
    settings::set(conn, FILE_HASH_KEY, &serde_json::Value::String(fnv1a(content.as_bytes())))?;
    Ok(())
}

/// Import `memory.md` when it was edited outside Neuron. Creates the file when missing.
/// Returns true when the database changed.
pub fn import_if_changed(conn: &mut Connection, path: &Path, now: i64) -> AppResult<bool> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            export(conn, path)?;
            return Ok(false);
        }
        Err(err) => return Err(err.into()),
    };
    let hash = fnv1a(&bytes);
    if stored_hash(conn)?.as_deref() == Some(hash.as_str()) {
        return Ok(false);
    }
    let text = String::from_utf8_lossy(&bytes);
    let desired = parse_file(&text);
    let (inserted, deleted) = memories::replace_all(conn, &desired, "file", now)?;
    // Remember this exact file so it isn't re-imported; it is normalized on the next export.
    settings::set(conn, FILE_HASH_KEY, &serde_json::Value::String(hash))?;
    if inserted + deleted > 0 {
        tracing::info!(inserted, deleted, "memory.md imported");
    }
    Ok(inserted + deleted > 0)
}

/// Memory block injected into a new chat (strict rules first). None when the memory is empty.
pub fn context_section(items: &[Memory]) -> Option<(String, ContextSource)> {
    if items.is_empty() {
        return None;
    }
    let order = [
        MemoryCategory::StrictRules,
        MemoryCategory::Profile,
        MemoryCategory::TechPreferences,
        MemoryCategory::CodeStyle,
        MemoryCategory::Other,
    ];
    let mut md = crate::tr!("\n## Mémoire globale de l'utilisateur\n", "\n## User's global memory\n");
    for category in order {
        let in_cat: Vec<&Memory> = items.iter().filter(|m| m.category == category).collect();
        if in_cat.is_empty() {
            continue;
        }
        let suffix = if category == MemoryCategory::StrictRules {
            crate::i18n::pick(" (à respecter impérativement)", " (must be followed)")
        } else {
            ""
        };
        md.push_str(&format!("\n### {}{suffix}\n\n", category.label()));
        for m in in_cat {
            md.push_str(&format!("- {}\n", m.content.replace('\n', "\n  ")));
        }
    }
    if md.chars().count() > MAX_INJECTED_CHARS {
        md = md.chars().take(MAX_INJECTED_CHARS).collect();
        md.push_str(&crate::tr!(
            "\n[… tronqué — utilise neuron_memory_search pour le reste]\n",
            "\n[… truncated — use neuron_memory_search for the rest]\n"
        ));
    }
    md.push_str(
        "\nCette mémoire est aussi accessible via les outils MCP `neuron_memory_read`, `neuron_memory_search` \
         et `neuron_memory_save` (n'enregistre que des préférences durables, quand l'utilisateur le demande ou \
         l'exprime clairement).\n",
    );
    let source = ContextSource {
        kind: ContextSourceKind::Memory,
        label: crate::tr!("Mémoire globale", "Global memory"),
        detail: Some(crate::tr!("{} souvenir(s)", "{} memory(ies)", items.len())),
    };
    Some((md, source))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn mem(category: MemoryCategory, content: &str) -> Memory {
        Memory {
            id: content.into(),
            category,
            content: content.into(),
            source: "user".into(),
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn render_parse_roundtrip() {
        let items = vec![
            mem(MemoryCategory::Profile, "Développeur Rust"),
            mem(MemoryCategory::StrictRules, "Jamais de push\nsans demande explicite"),
            mem(MemoryCategory::Other, "Divers"),
        ];
        let text = render_file(&items);
        assert!(text.contains("## Règles strictes\n\n- Jamais de push\n  sans demande explicite\n"));
        let parsed = parse_file(&text);
        assert_eq!(
            parsed,
            vec![
                (MemoryCategory::Profile, "Développeur Rust".to_string()),
                (MemoryCategory::StrictRules, "Jamais de push\nsans demande explicite".to_string()),
                (MemoryCategory::Other, "Divers".to_string()),
            ]
        );
    }

    #[test]
    fn lenient_parsing() {
        let text = "# Titre\n> intro ignorée\n\n## regles STRICTES\n* une\n\n## Préférence technique\n- deux\nparagraphe\n## Inconnue\n- trois\n";
        let parsed = parse_file(text);
        assert_eq!(parsed[0], (MemoryCategory::StrictRules, "une".into()));
        assert_eq!(parsed[1], (MemoryCategory::TechPreferences, "deux".into()));
        assert_eq!(parsed[2], (MemoryCategory::TechPreferences, "paragraphe".into()));
        assert_eq!(parsed[3], (MemoryCategory::Other, "trois".into()));
    }

    #[tokio::test]
    async fn file_sync_both_ways() {
        let dir = std::env::temp_dir().join(format!("neuron-mem-{}", uuid::Uuid::new_v4().simple()));
        let path = dir.join("memory.md");
        let db = Db::open_in_memory().unwrap();
        let p = path.clone();
        db.call(move |c| {
            // Missing file → created, nothing imported.
            assert!(!import_if_changed(c, &p, 1)?);
            assert!(p.is_file());
            // App change → exported; not re-imported.
            memories::insert(c, MemoryCategory::CodeStyle, "Early returns", "user", 2)?;
            export(c, &p)?;
            assert!(!import_if_changed(c, &p, 3)?);
            // Edit in the file → imported.
            let edited = std::fs::read_to_string(&p)?.replace("- Early returns", "- Early returns\n- Pas de unwrap");
            std::fs::write(&p, edited)?;
            assert!(import_if_changed(c, &p, 4)?);
            let all = memories::list(c)?;
            assert_eq!(all.len(), 2);
            assert_eq!(all[1].source, "file");
            // Same file again → no-op.
            assert!(!import_if_changed(c, &p, 5)?);
            let (section, source) = context_section(&all).expect("non-empty");
            assert!(section.contains("Pas de unwrap") && source.kind == ContextSourceKind::Memory);
            Ok(())
        })
        .await
        .unwrap();
        let _ = std::fs::remove_dir_all(dir);
        assert!(context_section(&[]).is_none());
    }
}

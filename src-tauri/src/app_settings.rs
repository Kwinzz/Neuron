//! User settings (Paramètres), stored as one JSON document in `settings` (`app.settings`).
//! Unknown/missing fields fall back to defaults, so adding a setting never breaks an existing install.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::settings;
use crate::error::{AppError, AppResult};

const KEY: &str = "app.settings";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct AppSettings {
    /// Agent processes idle for this long are stopped (resumed transparently on the next message). 0 = never.
    pub idle_shutdown_minutes: u32,
    pub notifications: NotificationSettings,
    pub context: ContextSettings,
    /// User-defined CLIs usable as the "Generic" agent (each one appears as a model).
    pub generic_clis: Vec<GenericCliProfile>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            idle_shutdown_minutes: 15,
            notifications: NotificationSettings::default(),
            context: ContextSettings::default(),
            generic_clis: Vec::new(),
        }
    }
}

/// Native notifications, only shown while the Neuron window is not focused.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct NotificationSettings {
    pub enabled: bool,
    /// An agent asks for a permission.
    pub on_permission: bool,
    /// A turn finished.
    pub on_finished: bool,
    pub on_error: bool,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self { enabled: true, on_permission: true, on_finished: true, on_error: true }
    }
}

/// What goes into the context injected at the start of a new chat.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct ContextSettings {
    pub inject_memory: bool,
    pub git_snapshot: bool,
    pub recent_files: bool,
}

impl Default for ContextSettings {
    fn default() -> Self {
        Self { inject_memory: true, git_snapshot: true, recent_files: true }
    }
}

/// A command-line tool driven as an agent: one process per message, output streamed as text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct GenericCliProfile {
    /// Stable id (stored as the chat's model).
    pub id: String,
    pub name: String,
    /// Executable (in PATH or absolute).
    pub command: String,
    /// Arguments; `{prompt}` is replaced by the message. Without it, the message is written to stdin.
    pub args: Vec<String>,
    /// Run in a pseudo-terminal (for tools that refuse to work without a TTY). ANSI codes are stripped.
    pub pty: bool,
}

impl Default for GenericCliProfile {
    fn default() -> Self {
        Self { id: String::new(), name: String::new(), command: String::new(), args: vec!["{prompt}".into()], pty: false }
    }
}

pub const PROMPT_PLACEHOLDER: &str = "{prompt}";

pub fn load(conn: &Connection) -> AppResult<AppSettings> {
    Ok(settings::get(conn, KEY)?
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

/// Validate + normalize, then store. Returns what was stored.
pub fn save(conn: &Connection, mut next: AppSettings) -> AppResult<AppSettings> {
    next.idle_shutdown_minutes = next.idle_shutdown_minutes.min(24 * 60);
    let mut seen = std::collections::HashSet::new();
    for p in &mut next.generic_clis {
        p.name = p.name.trim().to_string();
        p.command = p.command.trim().to_string();
        p.args.retain(|a| !a.is_empty());
        if p.name.is_empty() || p.command.is_empty() {
            return Err(AppError::Invalid("chaque CLI générique a besoin d'un nom et d'une commande".into()));
        }
        if p.id.trim().is_empty() {
            p.id = slug(&p.name);
        }
        p.id = slug(&p.id);
        if p.id.is_empty() {
            p.id = format!("cli-{}", seen.len() + 1);
        }
        let base = p.id.clone();
        let mut n = 2;
        while !seen.insert(p.id.clone()) {
            p.id = format!("{base}-{n}");
            n += 1;
        }
    }
    settings::set(conn, KEY, &serde_json::to_value(&next)?)?;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[tokio::test]
    async fn defaults_roundtrip_and_validation() {
        let db = Db::open_in_memory().unwrap();
        db.call(|c| {
            assert_eq!(load(c)?, AppSettings::default());
            // Partial/old documents fill the gaps with defaults.
            settings::set(c, KEY, &serde_json::json!({ "idleShutdownMinutes": 5 }))?;
            let s = load(c)?;
            assert_eq!(s.idle_shutdown_minutes, 5);
            assert!(s.notifications.enabled && s.context.inject_memory);

            let mut next = s.clone();
            next.generic_clis = vec![
                GenericCliProfile { name: "Ollama Llama".into(), command: "ollama".into(), ..Default::default() },
                GenericCliProfile { name: "Ollama Llama".into(), command: " ollama ".into(), ..Default::default() },
            ];
            let saved = save(c, next)?;
            assert_eq!(saved.generic_clis[0].id, "ollama-llama");
            assert_eq!(saved.generic_clis[1].id, "ollama-llama-2");
            assert_eq!(saved.generic_clis[1].command, "ollama");
            assert_eq!(load(c)?, saved);

            let mut bad = saved.clone();
            bad.generic_clis[0].command = "  ".into();
            assert!(save(c, bad).is_err());
            Ok(())
        })
        .await
        .unwrap();
    }
}

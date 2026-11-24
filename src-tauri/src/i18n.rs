//! Language of the text Neuron writes itself: errors shown in the app, terminal scripts, tray menu, `memory.md`
//! headings, instructions given to the agents. The interface strings live in the frontend (`src/i18n`).
//!
//! `tr!("Texte {x}", "Text {x}")` picks the current language (format arguments and inline captures work like
//! `format!`); `pick("…", "…")` does the same for `&'static str`.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Language {
    Fr,
    En,
}

impl Language {
    pub fn code(self) -> &'static str {
        match self {
            Language::Fr => "fr",
            Language::En => "en",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        let s = s.trim().to_lowercase();
        if s.starts_with("fr") {
            Some(Language::Fr)
        } else if s.starts_with("en") {
            Some(Language::En)
        } else {
            None
        }
    }
}

static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn set(lang: Language) {
    ENGLISH.store(lang == Language::En, Ordering::Relaxed);
}

pub fn current() -> Language {
    if is_en() { Language::En } else { Language::Fr }
}

pub fn is_en() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

/// The `&'static str` of the current language.
pub fn pick(fr: &'static str, en: &'static str) -> &'static str {
    if is_en() { en } else { fr }
}

/// `format!` in the current language: `tr!("Bonjour {name}", "Hello {name}")`.
#[macro_export]
macro_rules! tr {
    ($fr:literal, $en:literal $(, $arg:expr)* $(,)?) => {
        if $crate::i18n::is_en() { format!($en $(, $arg)*) } else { format!($fr $(, $arg)*) }
    };
}

/// First launch: the language chosen in the installer, else the system's (French if it is French, else English).
pub fn detect() -> Language {
    installer_choice()
        .or_else(|| sys_locale::get_locale().as_deref().and_then(Language::parse))
        .map(|l| if l == Language::Fr { Language::Fr } else { Language::En })
        .unwrap_or(Language::En)
}

/// Windows: `HKCU\Software\Neuron\Language`, written by the NSIS installer.
#[cfg(windows)]
fn installer_choice() -> Option<Language> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    let value: String =
        RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Neuron").ok()?.get_value("Language").ok()?;
    Language::parse(&value)
}

/// Linux: `$XDG_CONFIG_HOME/neuron/language` (or `~/.config/...`), written by `install.sh`.
#[cfg(not(windows))]
fn installer_choice() -> Option<Language> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|d| !d.is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".config")))?;
    Language::parse(&std::fs::read_to_string(base.join("neuron").join("language")).ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_codes_and_formats() {
        assert_eq!(Language::parse("fr_FR.UTF-8"), Some(Language::Fr));
        assert_eq!(Language::parse("en-US"), Some(Language::En));
        assert_eq!(Language::parse("de"), None);
        // The global language is never changed in tests (they run in parallel): default = French.
        let n = 3;
        assert_eq!(tr!("{n} chats ouverts", "{n} open chats"), "3 chats ouverts");
        assert_eq!(tr!("{} fichier", "{} file", 1), "1 fichier");
        assert_eq!(pick("Oui", "Yes"), "Oui");
    }
}

//! End-of-turn summary written by the agent itself.
//!
//! Every agent is asked (Neuron intro) to end its final answer with a hidden line
//! `<!-- neuron: ok | One-sentence summary -->` (`ok` / `partiel` / `échec`). Neuron reads it for the
//! notification and hides it in the chat. Without the line, the first sentence of the answer is used.

use serde::Serialize;
use ts_rs::TS;

/// How the agent judged its own work.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TurnOutcome {
    Success,
    Partial,
    Failure,
    /// No summary line: nothing said about success.
    Unknown,
}

/// Longest summary kept (a notification shows ~2 lines).
const MAX_CHARS: usize = 180;

fn outcome_of(word: &str) -> Option<TurnOutcome> {
    match word.trim().to_lowercase().as_str() {
        "ok" | "succès" | "succes" | "success" | "done" | "réussi" => Some(TurnOutcome::Success),
        "partiel" | "partial" | "partielle" => Some(TurnOutcome::Partial),
        "échec" | "echec" | "fail" | "failed" | "failure" | "erreur" | "error" => Some(TurnOutcome::Failure),
        _ => None,
    }
}

fn shorten(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= MAX_CHARS {
        return flat;
    }
    let cut: String = flat.chars().take(MAX_CHARS - 1).collect();
    format!("{}…", cut.trim_end())
}

/// The agent's `<!-- neuron: … -->` line (the last one), if any.
fn marker(text: &str) -> Option<(TurnOutcome, String)> {
    let mut rest = text;
    let mut found = None;
    while let Some(start) = rest.find("<!--") {
        let after = &rest[start + 4..];
        let Some(end) = after.find("-->") else { break };
        let body = after[..end].trim();
        if let Some(inner) = body.strip_prefix("neuron").and_then(|b| b.trim_start().strip_prefix(':')) {
            let (word, summary) = inner.split_once('|').unwrap_or((inner, ""));
            if let Some(outcome) = outcome_of(word) {
                found = Some((outcome, shorten(summary)));
            }
        }
        rest = &after[end + 3..];
    }
    found
}

/// First sentence of the visible answer (markdown noise removed), for agents that skipped the summary line.
fn first_sentence(text: &str) -> String {
    let visible: String = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("```") && !l.starts_with("<!--") && !l.starts_with('|'))
        .map(|l| l.trim_start_matches(['#', '>', '-', '*', ' ']).to_string())
        .collect::<Vec<_>>()
        .join(" ");
    let visible = visible.replace("**", "").replace('`', "");
    let end = visible
        .char_indices()
        .find(|&(i, c)| matches!(c, '.' | '!' | '?') && visible[i + c.len_utf8()..].starts_with(' '))
        .map_or(visible.len(), |(i, c)| i + c.len_utf8());
    shorten(&visible[..end])
}

/// Summary of a finished turn from the agent's last message.
pub fn turn_summary(last_text: &str) -> (TurnOutcome, String) {
    match marker(last_text) {
        Some((outcome, summary)) if !summary.is_empty() => (outcome, summary),
        Some((outcome, _)) => (outcome, first_sentence(last_text)),
        None => (TurnOutcome::Unknown, first_sentence(last_text)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_agent_summary_line() {
        let text = "J'ai corrigé le bug.\n\nDétails…\n\n<!-- neuron: ok | Bug de connexion corrigé, tests verts -->";
        assert_eq!(turn_summary(text), (TurnOutcome::Success, "Bug de connexion corrigé, tests verts".into()));
        let text = "<!-- neuron: échec | Impossible d'installer la dépendance (réseau) -->";
        assert_eq!(turn_summary(text).0, TurnOutcome::Failure);
        let text = "<!--neuron:partiel|Deux fichiers sur trois migrés-->";
        assert_eq!(turn_summary(text), (TurnOutcome::Partial, "Deux fichiers sur trois migrés".into()));
    }

    #[test]
    fn falls_back_to_the_first_sentence() {
        let text = "## Résultat\n**Le fichier** `a.rs` est prêt. Ensuite il faudra tester.";
        assert_eq!(turn_summary(text), (TurnOutcome::Unknown, "Résultat Le fichier a.rs est prêt.".into()));
        assert_eq!(turn_summary("").1, "");
        let long = "mot ".repeat(100);
        assert!(turn_summary(&long).1.chars().count() <= MAX_CHARS);
    }

    #[test]
    fn other_html_comments_are_ignored() {
        let text = "Voilà.\n<!-- note interne -->";
        assert_eq!(turn_summary(text), (TurnOutcome::Unknown, "Voilà.".into()));
    }
}

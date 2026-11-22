//! Project context injected into new chats: `.neuron/context.md` + a light git snapshot + recently
//! modified files. Built once when a chat is created and frozen with it.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppResult;

/// Location of the editable context file, relative to the project root.
pub const CONTEXT_REL: &str = ".neuron/context.md";

const MAX_CONTEXT_CHARS: usize = 20_000;
const RECENT_FILES: usize = 12;
const RECENT_WINDOW: Duration = Duration::from_secs(7 * 24 * 3600);
const MAX_WALK_ENTRIES: usize = 20_000;
const GIT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ContextSourceKind {
    File,
    Git,
    Recent,
    Memory,
}

/// One ingredient of the injected context (for the UI indicator).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ContextSource {
    pub kind: ContextSourceKind,
    pub label: String,
    pub detail: Option<String>,
}

/// Assembled context: what the agent receives, and where it came from.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ContextBundle {
    pub markdown: String,
    pub sources: Vec<ContextSource>,
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GitSnapshot {
    pub branch: Option<String>,
    /// `git status --porcelain` lines (max 30).
    pub changed: Vec<String>,
    /// `git log --oneline -5`.
    pub recent_commits: Vec<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RecentFile {
    pub path: String,
    /// Unix ms.
    #[ts(type = "number")]
    pub modified_at: i64,
}

pub fn context_path(root: &Path) -> PathBuf {
    root.join(CONTEXT_REL)
}

pub fn template(project_name: &str) -> String {
    format!(
        "# Contexte du projet {project_name}\n\n\
         > Ce fichier est injecté automatiquement au début de chaque nouveau chat de ce projet dans Neuron.\n\
         > Décris ici ce que tout agent doit savoir avant de travailler.\n\n\
         ## Objectif\n\n\
         ## Architecture\n\n\
         ## Conventions & règles\n\n\
         ## Commandes utiles\n"
    )
}

/// Never create `.neuron/` in a folder that doesn't exist (moved project, demo data).
fn require_dir(root: &Path) -> AppResult<()> {
    if root.is_dir() {
        return Ok(());
    }
    let message = if root.to_string_lossy().starts_with("demo:") {
        "projet de démonstration : il n'a pas de vrai dossier. Ajoute un vrai projet (« Ajouter un projet ») pour          utiliser le contexte."
            .to_string()
    } else {
        format!("dossier du projet introuvable : {} (déplacé ou supprimé ?)", root.display())
    };
    Err(crate::error::AppError::NotFound(message))
}

/// Create `.neuron/context.md` with a template when it doesn't exist. Returns (path, created).
pub fn ensure_context_file(root: &Path, project_name: &str) -> AppResult<(PathBuf, bool)> {
    require_dir(root)?;
    let path = context_path(root);
    if path.is_file() {
        return Ok((path, false));
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&path, template(project_name))?;
    Ok((path, true))
}

pub fn read_context(root: &Path) -> AppResult<Option<String>> {
    match std::fs::read_to_string(context_path(root)) {
        Ok(s) => Ok(Some(s)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

pub fn write_context(root: &Path, content: &str) -> AppResult<()> {
    require_dir(root)?;
    let path = context_path(root);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, content)?;
    Ok(())
}

/// Run `git args…` in `root` (no console window), stdout on success.
fn git(root: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = std::process::Command::new("git");
    cmd.args(args).current_dir(root).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().ok()?;
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return None,
            Ok(None) if started.elapsed() > GIT_TIMEOUT => {
                let _ = child.kill();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(15)),
            Err(_) => return None,
        }
    }
    let mut out = String::new();
    use std::io::Read;
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    Some(out)
}

pub fn git_snapshot(root: &Path) -> Option<GitSnapshot> {
    let branch = git(root, &["rev-parse", "--abbrev-ref", "HEAD"])?.trim().to_string();
    let changed = git(root, &["status", "--porcelain"])
        .map(|s| s.lines().take(30).map(|l| l.trim_end().to_string()).collect())
        .unwrap_or_default();
    let recent_commits = git(root, &["log", "--oneline", "-5"])
        .map(|s| s.lines().map(str::to_string).collect())
        .unwrap_or_default();
    Some(GitSnapshot { branch: (!branch.is_empty()).then_some(branch), changed, recent_commits })
}

/// Files modified in the last 7 days (respects .gitignore; skips `.neuron/`), newest first.
pub fn recent_files(root: &Path) -> Vec<RecentFile> {
    let now = SystemTime::now();
    let mut files: Vec<(SystemTime, String)> = Vec::new();
    let walker = ignore::WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .max_depth(Some(8))
        .filter_entry(|e| e.file_name() != ".neuron" && e.file_name() != ".git")
        .build();
    for entry in walker.flatten().take(MAX_WALK_ENTRIES) {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let Some(modified) = entry.metadata().ok().and_then(|m| m.modified().ok()) else { continue };
        if now.duration_since(modified).is_ok_and(|age| age > RECENT_WINDOW) {
            continue;
        }
        let rel = entry.path().strip_prefix(root).unwrap_or(entry.path()).to_string_lossy().replace('\\', "/");
        files.push((modified, rel));
    }
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    files
        .into_iter()
        .take(RECENT_FILES)
        .map(|(t, path)| RecentFile {
            path,
            modified_at: t
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
                .unwrap_or(0),
        })
        .collect()
}

fn ago(ms: i64, now_ms: i64) -> String {
    let mins = (now_ms - ms).max(0) / 60_000;
    match mins {
        0 => "à l'instant".into(),
        1..=59 => format!("il y a {mins} min"),
        60..=1439 => format!("il y a {} h", mins / 60),
        _ => format!("il y a {} j", mins / 1440),
    }
}

/// Assemble the context injected into a new chat of the project at `root`.
pub fn build(
    root: &Path,
    project_name: &str,
    now_ms: i64,
    opts: &crate::app_settings::ContextSettings,
) -> AppResult<ContextBundle> {
    let mut md = format!(
        "# Contexte Neuron — projet « {project_name} »\n\
         Dossier du projet : {}\n\
         (Contexte fourni automatiquement par Neuron au démarrage de ce chat.)\n",
        root.display()
    );
    let mut sources = Vec::new();

    if let Some(content) = read_context(root)?.filter(|c| !c.trim().is_empty()) {
        let mut text: String = content.chars().take(MAX_CONTEXT_CHARS).collect();
        if content.chars().count() > MAX_CONTEXT_CHARS {
            text.push_str("\n\n[… tronqué]");
        }
        md.push_str("\n## Contexte du projet (.neuron/context.md)\n\n");
        md.push_str(text.trim());
        md.push('\n');
        sources.push(ContextSource {
            kind: ContextSourceKind::File,
            label: CONTEXT_REL.into(),
            detail: Some(format!("{} lignes", content.lines().count())),
        });
    }

    if let Some(snapshot) = git_snapshot(root).filter(|_| opts.git_snapshot) {
        md.push_str("\n## Git\n\n");
        if let Some(branch) = &snapshot.branch {
            md.push_str(&format!("Branche courante : `{branch}`\n"));
        }
        if snapshot.changed.is_empty() {
            md.push_str("Arbre de travail propre.\n");
        } else {
            md.push_str("Modifications non commitées :\n");
            for line in &snapshot.changed {
                md.push_str(&format!("- `{line}`\n"));
            }
        }
        if !snapshot.recent_commits.is_empty() {
            md.push_str("Derniers commits :\n");
            for line in &snapshot.recent_commits {
                md.push_str(&format!("- {line}\n"));
            }
        }
        sources.push(ContextSource {
            kind: ContextSourceKind::Git,
            label: snapshot.branch.clone().map_or_else(|| "Git".into(), |b| format!("branche {b}")),
            detail: Some(format!("{} fichier(s) modifié(s)", snapshot.changed.len())),
        });
    }

    let recent = if opts.recent_files { recent_files(root) } else { Vec::new() };
    if !recent.is_empty() {
        md.push_str("\n## Fichiers modifiés récemment\n\n");
        for f in &recent {
            md.push_str(&format!("- `{}` ({})\n", f.path, ago(f.modified_at, now_ms)));
        }
        sources.push(ContextSource {
            kind: ContextSourceKind::Recent,
            label: "Fichiers récents".into(),
            detail: Some(format!("{} fichier(s)", recent.len())),
        });
    }

    Ok(ContextBundle { markdown: md, sources })
}

/// Add the global memory to a (possibly absent) project bundle. Chats outside a project get a bundle
/// with only the memory; None when there is nothing to inject.
pub fn with_memory(
    bundle: Option<ContextBundle>,
    memory: Option<(String, ContextSource)>,
) -> Option<ContextBundle> {
    match (bundle, memory) {
        (bundle, None) => bundle,
        (Some(mut b), Some((md, source))) => {
            b.markdown.push_str(&md);
            b.sources.push(source);
            Some(b)
        }
        (None, Some((md, source))) => Some(ContextBundle {
            markdown: format!(
                "# Contexte Neuron\n(Contexte fourni automatiquement par Neuron au démarrage de ce chat.)\n{md}"
            ),
            sources: vec![source],
        }),
    }
}

/// Preamble for agents without a system-prompt option (Codex, Antigravity): sent before the first message.
pub fn as_preamble(context: &str, prompt: &str) -> String {
    format!("<contexte_neuron>\n{context}\n</contexte_neuron>\n\n{prompt}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("neuron-ctx-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn creates_template_once_and_builds_bundle() {
        let root = tmp();
        let (path, created) = ensure_context_file(&root, "demo").unwrap();
        assert!(created && path.ends_with("context.md"));
        assert!(!ensure_context_file(&root, "demo").unwrap().1, "never overwritten");

        write_context(&root, "# Règles\nToujours écrire des tests.").unwrap();
        std::fs::write(root.join("main.rs"), "fn main() {}").unwrap();

        let bundle = build(&root, "demo", crate::util::now_ms(), &Default::default()).unwrap();
        assert!(bundle.markdown.contains("Toujours écrire des tests."));
        assert!(bundle.markdown.contains("`main.rs`"), "recent files listed");
        assert!(!bundle.markdown.contains("context.md` ("), ".neuron/ is not listed as a recent file");
        assert!(bundle.sources.iter().any(|s| s.kind == ContextSourceKind::File));
        assert!(bundle.sources.iter().any(|s| s.kind == ContextSourceKind::Recent));

        assert!(as_preamble("CTX", "salut").ends_with("salut"));
        assert!(ensure_context_file(&root.join("absent"), "x").is_err(), "no .neuron in a missing folder");
        assert!(!root.join("absent").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn git_snapshot_on_this_repo() {
        // The test runs inside the Neuron repo (src-tauri): a branch must be found.
        let snapshot = git_snapshot(Path::new(env!("CARGO_MANIFEST_DIR"))).expect("git available");
        assert!(snapshot.branch.is_some());
    }
}

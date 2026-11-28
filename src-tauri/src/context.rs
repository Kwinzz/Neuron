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
    crate::tr!(
        "# Contexte du projet {project_name}\n\n\
         > Ce fichier est injecté automatiquement au début de chaque nouveau chat de ce projet dans Neuron.\n\
         > Décris ici ce que tout agent doit savoir avant de travailler.\n\n\
         ## Objectif\n\n\
         ## Architecture\n\n\
         ## Conventions & règles\n\n\
         ## Commandes utiles\n",
        "# Project context: {project_name}\n\n\
         > This file is injected automatically at the start of every new chat of this project in Neuron.\n\
         > Describe here what any agent must know before working.\n\n\
         ## Goal\n\n\
         ## Architecture\n\n\
         ## Conventions & rules\n\n\
         ## Useful commands\n"
    )
}

/// Never create `.neuron/` in a folder that doesn't exist (moved project, demo data).
fn require_dir(root: &Path) -> AppResult<()> {
    if root.is_dir() {
        return Ok(());
    }
    let message = if root.to_string_lossy().starts_with("demo:") {
        crate::tr!(
            "projet de démonstration : il n'a pas de vrai dossier. Ajoute un vrai projet (« Ajouter un projet ») pour \
             utiliser le contexte.",
            "demo project: it has no real folder. Add a real project (“Add a project”) to use the context."
        )
    } else {
        let dir = root.display();
        crate::tr!(
            "dossier du projet introuvable : {dir} (déplacé ou supprimé ?)",
            "project folder not found: {dir} (moved or deleted?)"
        )
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
    let recent_commits =
        git(root, &["log", "--oneline", "-5"]).map(|s| s.lines().map(str::to_string).collect()).unwrap_or_default();
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
        0 => crate::tr!("à l'instant", "just now"),
        1..=59 => crate::tr!("il y a {mins} min", "{mins} min ago"),
        60..=1439 => {
            let h = mins / 60;
            crate::tr!("il y a {h} h", "{h} h ago")
        }
        _ => {
            let d = mins / 1440;
            crate::tr!("il y a {d} j", "{d} d ago")
        }
    }
}

/// Assemble the context injected into a new chat of the project at `root`.
pub fn build(
    root: &Path,
    project_name: &str,
    now_ms: i64,
    opts: &crate::app_settings::ContextSettings,
) -> AppResult<ContextBundle> {
    let dir = root.display();
    let mut md = crate::tr!(
        "# Contexte Neuron — projet « {project_name} »\n\
         Dossier du projet : {dir}\n\
         (Contexte fourni automatiquement par Neuron au démarrage de ce chat.)\n",
        "# Neuron context — project “{project_name}”\n\
         Project folder: {dir}\n\
         (Context given automatically by Neuron when this chat started.)\n"
    );
    let mut sources = Vec::new();

    if let Some(content) = read_context(root)?.filter(|c| !c.trim().is_empty()) {
        let mut text: String = content.chars().take(MAX_CONTEXT_CHARS).collect();
        if content.chars().count() > MAX_CONTEXT_CHARS {
            text.push_str(&crate::tr!("\n\n[… tronqué]", "\n\n[… truncated]"));
        }
        md.push_str(&crate::tr!(
            "\n## Contexte du projet (.neuron/context.md)\n\n",
            "\n## Project context (.neuron/context.md)\n\n"
        ));
        md.push_str(text.trim());
        md.push('\n');
        sources.push(ContextSource {
            kind: ContextSourceKind::File,
            label: CONTEXT_REL.into(),
            detail: Some(crate::tr!("{} lignes", "{} lines", content.lines().count())),
        });
    }

    if let Some(snapshot) = git_snapshot(root).filter(|_| opts.git_snapshot) {
        md.push_str("\n## Git\n\n");
        if let Some(branch) = &snapshot.branch {
            md.push_str(&crate::tr!("Branche courante : `{branch}`\n", "Current branch: `{branch}`\n"));
        }
        if snapshot.changed.is_empty() {
            md.push_str(&crate::tr!("Arbre de travail propre.\n", "Clean working tree.\n"));
        } else {
            md.push_str(&crate::tr!("Modifications non commitées :\n", "Uncommitted changes:\n"));
            for line in &snapshot.changed {
                md.push_str(&format!("- `{line}`\n"));
            }
        }
        if !snapshot.recent_commits.is_empty() {
            md.push_str(&crate::tr!("Derniers commits :\n", "Latest commits:\n"));
            for line in &snapshot.recent_commits {
                md.push_str(&format!("- {line}\n"));
            }
        }
        sources.push(ContextSource {
            kind: ContextSourceKind::Git,
            label: snapshot.branch.clone().map_or_else(|| "Git".into(), |b| crate::tr!("branche {b}", "branch {b}")),
            detail: Some(crate::tr!("{} fichier(s) modifié(s)", "{} changed file(s)", snapshot.changed.len())),
        });
    }

    let recent = if opts.recent_files { recent_files(root) } else { Vec::new() };
    if !recent.is_empty() {
        md.push_str(&crate::tr!("\n## Fichiers modifiés récemment\n\n", "\n## Recently changed files\n\n"));
        for f in &recent {
            md.push_str(&format!("- `{}` ({})\n", f.path, ago(f.modified_at, now_ms)));
        }
        sources.push(ContextSource {
            kind: ContextSourceKind::Recent,
            label: crate::tr!("Fichiers récents", "Recent files"),
            detail: Some(crate::tr!("{} fichier(s)", "{} file(s)", recent.len())),
        });
    }

    Ok(ContextBundle { markdown: md, sources })
}

/// Add the global memory to a (possibly absent) project bundle. Chats outside a project get a bundle
/// with only the memory; None when there is nothing to inject.
pub fn with_memory(bundle: Option<ContextBundle>, memory: Option<(String, ContextSource)>) -> Option<ContextBundle> {
    match (bundle, memory) {
        (bundle, None) => bundle,
        (Some(mut b), Some((md, source))) => {
            b.markdown.push_str(&md);
            b.sources.push(source);
            Some(b)
        }
        (None, Some((md, source))) => Some(ContextBundle {
            markdown: crate::tr!(
                "# Contexte Neuron\n(Contexte fourni automatiquement par Neuron au démarrage de ce chat.)\n{md}",
                "# Neuron context\n(Context given automatically by Neuron when this chat started.)\n{md}"
            ),
            sources: vec![source],
        }),
    }
}

/// What every agent is told about Neuron: where it runs, the global memory it can read and edit, and the
/// project context file it can maintain. Given at each session start (not frozen with the chat).
/// Appended to later messages of agents without a system prompt (they saw the intro only once).
/// The status words `ok|partiel|échec` are the protocol read by `agents/summary.rs`: same in both languages.
pub fn summary_reminder() -> &'static str {
    crate::i18n::pick(
        "(Neuron : termine ta réponse par la ligne `<!-- neuron: ok|partiel|échec | résumé en une phrase -->`.)",
        "(Neuron: end your answer with the line `<!-- neuron: ok|partiel|échec | one-sentence summary -->`.)",
    )
}

pub fn neuron_intro(
    memory_file: Option<&Path>,
    project: Option<&Path>,
    remote_workspace: Option<&crate::db::threads::WorkspaceTarget>,
) -> String {
    let mut md = crate::tr!(
        "# Neuron\n\
         Tu es lancé par **Neuron**, l'application de bureau de l'utilisateur qui pilote ses agents IA (Claude Code, \
         Codex, Antigravity…) dans une interface graphique. Il lit tes réponses dans le chat de Neuron : Markdown \
         rendu, et les fichiers que tu modifies y apparaissent automatiquement sous forme de diff. Pour montrer \
         une image (png, jpg, webp, gif, svg…) que tu as créée ou trouvée, cite son chemin dans ta réponse \
         (absolu, ou relatif au dossier du chat) : Neuron l'affiche sous ton message.\n\n\
         ## Résumé de fin de réponse\n\
         Termine **chaque** réponse par une dernière ligne seule, invisible dans le chat : \
         `<!-- neuron: ok | résumé -->`. Statut : `ok` (demande accomplie), `partiel` (en partie) ou `échec` \
         (pas faite, bloquée, erreur) ; résumé : une phrase de moins de 120 caractères, en français, qui dit ce \
         que tu as fait ou pourquoi ça a échoué. Neuron s'en sert pour la notification envoyée à l'utilisateur.\n\n\
         ## Mémoire globale\n\
         Neuron tient une mémoire partagée par tous les agents de l'utilisateur — profil, préférences techniques, \
         style de code, règles strictes —, comme la mémoire d'un assistant web. Elle t'est donnée au démarrage du \
         chat quand elle n'est pas vide, et tu y accèdes avec l'outil MCP `neuron_memory` (actions read, search, \
         save, update, delete).\n\
         Quand l'utilisateur te demande de retenir, corriger ou oublier quelque chose, fais-le avec cet outil et \
         dis-le-lui en une phrase. Enregistre aussi de toi-même une préférence ou une règle permanente qu'il exprime \
         clairement ; jamais d'information passagère ni de secret.\n",
        "# Neuron\n\
         You are run by **Neuron**, the user's desktop app that drives their AI agents (Claude Code, Codex, \
         Antigravity…) in a graphical interface. They read your answers in Neuron's chat: Markdown is rendered, \
         and the files you change show up there automatically as diffs. To show an image (png, jpg, webp, gif, \
         svg…) you created or found, mention its path in your answer (absolute, or relative to the chat's folder): \
         Neuron displays it under your message.\n\n\
         ## End-of-answer summary\n\
         End **every** answer with one last line on its own, invisible in the chat: \
         `<!-- neuron: ok | summary -->`. Status (keep these exact words): `ok` (request done), `partiel` \
         (partly done) or `échec` (not done, blocked, error); summary: one sentence under 120 characters, in \
         English, saying what you did or why it failed. Neuron uses it for the notification sent to the user.\n\n\
         ## Global memory\n\
         Neuron keeps a memory shared by all the user's agents — profile, tech preferences, code style, strict \
         rules —, like a web assistant's memory. It is given to you when the chat starts if it isn't empty, and \
         you reach it with the MCP tool `neuron_memory` (actions read, search, save, update, delete).\n\
         When the user asks you to remember, correct or forget something, do it with this tool and tell them in \
         one sentence. Also save on your own a lasting preference or rule they state clearly; never passing \
         information nor secrets.\n"
    );
    if let Some(file) = memory_file {
        let file = file.display();
        md.push_str(&crate::tr!(
            "Si ces outils ne sont pas disponibles, modifie directement le fichier `{file}` (une puce par souvenir sous \
             la bonne section) : Neuron reprend ses modifications.\n",
            "If these tools are not available, edit the file `{file}` directly (one bullet per memory under the \
             right section): Neuron picks up the changes.\n"
        ));
    }
    if let Some(root) = project {
        let root = root.display();
        md.push_str(&crate::tr!(
            "\n## Contexte du projet\n\
             Ce chat appartient à un projet Neuron. Son fichier de contexte `{CONTEXT_REL}` (dans `{root}`) est injecté \
             dans chaque nouveau chat du projet. Tiens-le à jour quand tu apprends ou décides quelque chose de durable : \
             objectif, architecture, décisions, conventions, commandes utiles. Utilise \
             l'outil `neuron_project_context` (ou tes outils de fichiers). Lis-le \
             avant de le modifier, garde ce qui reste vrai et reste concis.\n",
            "\n## Project context\n\
             This chat belongs to a Neuron project. Its context file `{CONTEXT_REL}` (in `{root}`) is injected into \
             every new chat of the project. Keep it up to date when you learn or decide something lasting: goal, \
             architecture, decisions, conventions, useful commands. Use the \
             `neuron_project_context` tool (or your file tools). Read it before changing it, keep what is still \
             true and stay concise.\n"
        ));
    }
    if let Some(ws) = remote_workspace {
        let device = if ws.device_name.is_empty() { ws.device_id.as_str() } else { ws.device_name.as_str() };
        let os_note = match ws.os.as_deref() {
            Some("windows") => crate::tr!("Windows (PowerShell)", "Windows (PowerShell)"),
            Some("macos") => crate::tr!("macOS (sh)", "macOS (sh)"),
            Some("linux") => crate::tr!("Linux (sh)", "Linux (sh)"),
            _ => crate::tr!("système distant", "remote OS"),
        };
        let cwd = &ws.cwd;
        md.push_str(&crate::tr!(
            "\n## Espace de travail distant (appareil cible : {device})\n\
             Ce chat utilise l'IA sur cet appareil pour travailler sur **un autre appareil** : **{device}** \
             ({os_note}), dans le dossier `{cwd}`.\n\
             Utilise **exclusivement** les outils MCP `remote_read`, `remote_write`, `remote_edit`, `remote_search` \
             et `remote_run` pour lire/modifier des fichiers et lancer des commandes sur **{device}**. N'utilise \
             **jamais** d'outils locaux de fichiers ou de terminal : le dossier local de ce processus est vide.\n\
             Les chemins relatifs sont résolus depuis `{cwd}` sur **{device}**. Pour mettre à jour `{CONTEXT_REL}` \
             sur le projet distant, utilise `remote_read` / `remote_edit` / `remote_write`.\n",
            "\n## Remote workspace (target device: {device})\n\
             This chat uses the AI on this device to work on **another device**: **{device}** \
             ({os_note}), in folder `{cwd}`.\n\
             Use **exclusively** the MCP tools `remote_read`, `remote_write`, `remote_edit`, `remote_search` \
             and `remote_run` to read/edit files and run commands on **{device}**. **Never** use local file or \
             shell tools: this process's local directory is an empty scratch folder.\n\
             Relative paths resolve from `{cwd}` on **{device}**. To update `{CONTEXT_REL}` on the remote project, \
             use `remote_read` / `remote_edit` / `remote_write`.\n"
        ));
    }
    md
}

/// System prompt / preamble of a session: Neuron intro + the context frozen with the chat.
pub fn session_instructions(intro: &str, frozen: Option<&str>) -> String {
    match frozen.filter(|c| !c.trim().is_empty()) {
        Some(ctx) => format!("{intro}\n{ctx}"),
        None => intro.to_string(),
    }
}

/// Preamble for agents without a system-prompt option (Codex, Antigravity): sent before the first message.
pub fn as_preamble(context: &str, prompt: &str) -> String {
    crate::tr!(
        "<contexte_neuron>\n{context}\n</contexte_neuron>\n\n{prompt}",
        "<neuron_context>\n{context}\n</neuron_context>\n\n{prompt}"
    )
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

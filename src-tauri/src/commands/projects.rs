//! Project context: `.neuron/context.md` editing, injected-context preview, per-chat context. New projects: folder
//! browsing (also for a paired device, which has no native folder picker) and new project folders.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::context::{self, ContextBundle, GitSnapshot, RecentFile};
use crate::db::{projects, threads};
use crate::error::{AppError, AppResult};
use crate::state::{AppState, Shared};
use crate::util::now_ms;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectContextFile {
    pub project_id: String,
    pub project_name: String,
    /// Absolute path of `.neuron/context.md`.
    pub path: String,
    pub content: String,
    /// The file did not exist and was just created from the template.
    pub created: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectOverview {
    pub git: Option<GitSnapshot>,
    pub recent_files: Vec<RecentFile>,
    /// Exactly what a new chat of this project would receive.
    pub preview: ContextBundle,
}

async fn project(state: &AppState, project_id: &str) -> AppResult<projects::ProjectSummary> {
    let id = project_id.to_string();
    state
        .db
        .call(move |c| projects::get(c, &id))
        .await?
        .ok_or_else(|| AppError::NotFound(crate::tr!("projet {project_id}", "project {project_id}")))
}

pub(crate) async fn project_context_inner(state: &AppState, project_id: String) -> AppResult<ProjectContextFile> {
    let p = project(state, &project_id).await?;
    tokio::task::spawn_blocking(move || {
        let root = PathBuf::from(&p.path);
        let (path, created) = context::ensure_context_file(&root, &p.name)?;
        let content = context::read_context(&root)?.unwrap_or_default();
        Ok(ProjectContextFile {
            project_id: p.id,
            project_name: p.name,
            path: path.display().to_string(),
            content,
            created,
        })
    })
    .await?
}

/// Read `.neuron/context.md` (created from the template when missing).
#[tauri::command]
pub async fn project_context(state: State<'_, Shared>, project_id: String) -> AppResult<ProjectContextFile> {
    project_context_inner(&state, project_id).await
}

pub(crate) async fn save_project_context_inner(state: &AppState, project_id: String, content: String) -> AppResult<()> {
    let p = project(state, &project_id).await?;
    tokio::task::spawn_blocking(move || context::write_context(&PathBuf::from(&p.path), &content)).await?
}

#[tauri::command]
pub async fn save_project_context(state: State<'_, Shared>, project_id: String, content: String) -> AppResult<()> {
    save_project_context_inner(&state, project_id, content).await
}

pub(crate) async fn project_overview_inner(state: &AppState, project_id: String) -> AppResult<ProjectOverview> {
    let p = project(state, &project_id).await?;
    let memory_items = state.db.call(|c| crate::db::memories::list(c)).await?;
    let opts = state.db.call(|c| crate::app_settings::load(c)).await?.context;
    tokio::task::spawn_blocking(move || {
        let root = PathBuf::from(&p.path);
        let preview = context::build(&root, &p.name, now_ms(), &opts)?;
        let memory = crate::memory::context_section(&memory_items).filter(|_| opts.inject_memory);
        let preview = context::with_memory(Some(preview), memory)
            .unwrap_or_else(|| ContextBundle { markdown: String::new(), sources: Vec::new() });
        Ok(ProjectOverview { git: context::git_snapshot(&root), recent_files: context::recent_files(&root), preview })
    })
    .await?
}

/// Git snapshot, recent files and the context a new chat would get right now.
#[tauri::command]
pub async fn project_overview(state: State<'_, Shared>, project_id: String) -> AppResult<ProjectOverview> {
    project_overview_inner(&state, project_id).await
}

pub(crate) async fn thread_context_inner(state: &AppState, thread_id: String) -> AppResult<Option<ContextBundle>> {
    state.db.call(move |c| threads::context(c, &thread_id)).await
}

/// Context injected into a chat when it was created (None for chats outside a project).
#[tauri::command]
pub async fn thread_context(state: State<'_, Shared>, thread_id: String) -> AppResult<Option<ContextBundle>> {
    thread_context_inner(&state, thread_id).await
}

/// One sub-folder in a [`DirListing`].
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
}

/// Sub-folders of a folder (files and hidden folders left out), to choose where a project lives.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DirListing {
    pub path: String,
    /// `None` at the root of a drive / of the file system.
    pub parent: Option<String>,
    /// The user's home folder (starting point).
    pub home: String,
    /// Drives on Windows (`C:\`…), `/` elsewhere.
    pub roots: Vec<String>,
    pub entries: Vec<DirEntry>,
}

/// Folders listed at most (a huge folder stays usable).
const MAX_ENTRIES: usize = 2000;

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "C:\\" } else { "/" }))
}

fn roots() -> Vec<String> {
    if cfg!(windows) {
        (b'A'..=b'Z').map(|d| format!("{}:\\", d as char)).filter(|r| Path::new(r).is_dir()).collect()
    } else {
        vec!["/".to_string()]
    }
}

fn is_hidden(name: &str, meta: &std::fs::Metadata) -> bool {
    if name.starts_with('.') {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const HIDDEN: u32 = 0x2;
        const SYSTEM: u32 = 0x4;
        if meta.file_attributes() & (HIDDEN | SYSTEM) != 0 {
            return true;
        }
    }
    #[cfg(not(windows))]
    let _ = meta;
    false
}

/// Sub-folders of `path` (the home folder when `None`).
pub fn list_dir(path: Option<&Path>) -> AppResult<DirListing> {
    let dir = path.map(Path::to_path_buf).unwrap_or_else(home_dir);
    if !dir.is_dir() {
        let shown = dir.display();
        return Err(AppError::NotFound(crate::tr!("dossier introuvable : {shown}", "folder not found: {shown}")));
    }
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&dir)?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        // Symlinks to folders count as folders (metadata follows them).
        let Ok(meta) = std::fs::metadata(entry.path()) else { continue };
        if !meta.is_dir() || is_hidden(&name, &meta) {
            continue;
        }
        entries.push(DirEntry { name, path: entry.path().display().to_string() });
    }
    entries.sort_by_key(|e| e.name.to_lowercase());
    entries.truncate(MAX_ENTRIES);
    Ok(DirListing {
        path: dir.display().to_string(),
        parent: dir.parent().map(|p| p.display().to_string()),
        home: home_dir().display().to_string(),
        roots: roots(),
        entries,
    })
}

/// Name of a new project folder, checked so that it is one folder (no path) valid on every system.
pub fn validate_folder_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    let invalid = |why: String| Err(AppError::Invalid(why));
    if name.is_empty() || name == "." || name == ".." {
        return invalid(crate::tr!("donne un nom au dossier", "give the folder a name"));
    }
    if name.chars().count() > 120 {
        return invalid(crate::tr!("nom trop long (120 caractères au plus)", "name too long (120 characters at most)"));
    }
    if let Some(c) = name.chars().find(|c| "/\\:*?\"<>|".contains(*c) || c.is_control()) {
        return invalid(crate::tr!("caractère interdit dans le nom : {c}", "character not allowed in the name: {c}"));
    }
    if name.ends_with('.') {
        return invalid(crate::tr!("le nom ne peut pas finir par un point", "the name can't end with a dot"));
    }
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    let numbered = stem.len() == 4
        && (stem.starts_with("COM") || stem.starts_with("LPT"))
        && matches!(stem.as_bytes()[3], b'1'..=b'9');
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") || numbered {
        return invalid(crate::tr!("nom réservé par Windows : {name}", "name reserved by Windows: {name}"));
    }
    Ok(name.to_string())
}

pub(crate) async fn list_directory_inner(path: Option<String>) -> AppResult<DirListing> {
    let path = path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).map(PathBuf::from);
    tokio::task::spawn_blocking(move || list_dir(path.as_deref())).await?
}

/// Sub-folders of a folder (home folder by default): where to create or find a project.
#[tauri::command]
pub async fn list_directory(path: Option<String>) -> AppResult<DirListing> {
    list_directory_inner(path).await
}

pub(crate) async fn create_project_folder_inner(
    state: &AppState,
    parent: String,
    name: String,
) -> AppResult<Vec<projects::ProjectSummary>> {
    let name = validate_folder_name(&name)?;
    let parent = PathBuf::from(parent.trim());
    let dir = parent.join(&name);
    let target = dir.clone();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        if !parent.is_dir() {
            let shown = parent.display();
            return Err(AppError::NotFound(crate::tr!("dossier introuvable : {shown}", "folder not found: {shown}")));
        }
        if target.exists() {
            let shown = target.display();
            return Err(AppError::Invalid(crate::tr!(
                "{shown} existe déjà : ouvre-le plutôt comme dossier existant",
                "{shown} already exists: open it as an existing folder instead"
            )));
        }
        std::fs::create_dir(&target)?;
        Ok(())
    })
    .await??;
    crate::commands::threads::create_project_inner(state, dir.display().to_string(), Some(name)).await
}

/// Create a new folder `parent/name` and register it as a project. Returns the refreshed project list.
#[tauri::command]
pub async fn create_project_folder(
    state: State<'_, Shared>,
    parent: String,
    name: String,
) -> AppResult<Vec<projects::ProjectSummary>> {
    create_project_folder_inner(&state, parent, name).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_names() {
        assert_eq!(validate_folder_name("  Mon projet ").unwrap(), "Mon projet");
        assert_eq!(validate_folder_name("site.v2").unwrap(), "site.v2");
        assert_eq!(validate_folder_name("COM0").unwrap(), "COM0");
        for bad in ["", "  ", ".", "..", "a/b", "a\\b", "x:y", "what?", "end.", "CON", "nul.txt", "com1", "LPT9"] {
            assert!(validate_folder_name(bad).is_err(), "{bad:?} should be refused");
        }
    }

    #[test]
    fn lists_visible_folders_only() {
        let root = std::env::temp_dir().join(format!("neuron-ls-{}", uuid::Uuid::new_v4().simple()));
        for d in ["beta", "Alpha", ".git"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        std::fs::write(root.join("file.txt"), "x").unwrap();
        let listing = list_dir(Some(&root)).unwrap();
        let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["Alpha", "beta"]);
        assert_eq!(listing.parent, root.parent().map(|p| p.display().to_string()));
        assert!(!listing.roots.is_empty());
        assert!(list_dir(Some(&root.join("missing"))).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }
}

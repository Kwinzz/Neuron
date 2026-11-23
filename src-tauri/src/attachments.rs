//! Files attached to a message (« + » button or pasted images). Every attachment is copied into
//! `<data_dir>/attachments/<id>/<name>`: the agent reads a stable copy, and the chat history keeps its thumbnails.

use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{AppError, AppResult};

/// Largest file accepted (copy + agent input).
pub const MAX_BYTES: u64 = 50 * 1024 * 1024;
/// Largest image sent inline to Claude (base64 adds a third; the API caps images at ~5 MB).
pub const MAX_INLINE_IMAGE: u64 = 3_700_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Attachment {
    pub id: String,
    /// Original file name.
    pub name: String,
    /// Absolute path of Neuron's copy.
    pub path: String,
    pub mime: String,
    #[ts(type = "number")]
    pub size: u64,
    pub is_image: bool,
}

pub fn root(data_dir: &Path) -> PathBuf {
    data_dir.join("attachments")
}

fn mime_of(name: &str) -> &'static str {
    let ext = Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        "json" => "application/json",
        "md" | "markdown" => "text/markdown",
        "txt" | "log" | "csv" | "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "toml" | "yaml" | "yml" | "html" | "css" => {
            "text/plain"
        }
        _ => "application/octet-stream",
    }
}

/// Images every agent can look at (Claude inline, Codex `--image`, Antigravity through its file tool).
fn is_image_mime(mime: &str) -> bool {
    matches!(mime, "image/png" | "image/jpeg" | "image/gif" | "image/webp")
}

/// Largest image file an agent can show in the chat.
const MAX_AGENT_IMAGE: u64 = 40 * 1024 * 1024;

/// Image formats the chat can display (an `<img>` never runs an SVG's scripts).
fn is_displayable_image(mime: &str) -> bool {
    is_image_mime(mime) || matches!(mime, "image/bmp" | "image/svg+xml" | "image/avif")
}

/// An image file an agent mentioned (`path` absolute or relative to `cwd`), described like an attachment so the
/// chat reuses its thumbnails and viewer. `None` unless it is an existing image file of a sane size.
pub fn local_image(path: &str, cwd: Option<&Path>) -> Option<Attachment> {
    let raw = path.trim().trim_matches(|c| c == '"' || c == '\'' || c == '<' || c == '>');
    let raw = raw.strip_prefix("file:///").unwrap_or(raw);
    if raw.is_empty() || raw.contains("://") {
        return None;
    }
    let mut full = PathBuf::from(raw);
    if full.is_relative() {
        full = cwd?.join(full);
    }
    let name = full.file_name()?.to_str()?.to_string();
    let mime = mime_of(&name);
    if !is_displayable_image(mime) {
        return None;
    }
    let meta = std::fs::metadata(&full).ok().filter(|m| m.is_file() && m.len() <= MAX_AGENT_IMAGE)?;
    let path = full.display().to_string();
    Some(Attachment { id: path.clone(), name, path, mime: mime.to_string(), size: meta.len(), is_image: true })
}

/// Keep a readable, filesystem-safe file name.
fn safe_name(name: &str) -> String {
    let base = Path::new(name).file_name().and_then(|n| n.to_str()).unwrap_or("fichier");
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() { "fichier".into() } else { cleaned.chars().take(120).collect() }
}

fn store(root: &Path, name: &str, mime: Option<&str>, write: impl FnOnce(&Path) -> std::io::Result<u64>) -> AppResult<Attachment> {
    let id = uuid::Uuid::new_v4().simple().to_string();
    let name = safe_name(name);
    let dir = root.join(&id);
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(&name);
    let size = write(&path)?;
    let mime = mime.filter(|m| !m.is_empty()).unwrap_or_else(|| mime_of(&name)).to_string();
    Ok(Attachment { id, is_image: is_image_mime(&mime), name, path: path.display().to_string(), mime, size })
}

/// Copy a file picked by the user.
pub fn import_file(root: &Path, source: &Path) -> AppResult<Attachment> {
    let meta = std::fs::metadata(source).map_err(|e| AppError::Invalid(format!("{} : {e}", source.display())))?;
    if !meta.is_file() {
        return Err(AppError::Invalid(format!("pas un fichier : {}", source.display())));
    }
    if meta.len() > MAX_BYTES {
        return Err(AppError::Invalid(format!("fichier trop lourd (max {} Mo) : {}", MAX_BYTES / 1_048_576, source.display())));
    }
    let name = source.file_name().and_then(|n| n.to_str()).unwrap_or("fichier").to_string();
    store(root, &name, None, |dest| std::fs::copy(source, dest))
}

/// Save pasted bytes (base64) — clipboard images.
pub fn save_base64(root: &Path, name: &str, mime: &str, data: &str) -> AppResult<Attachment> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|e| AppError::Invalid(format!("image collée illisible : {e}")))?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(AppError::Invalid("image trop lourde".into()));
    }
    store(root, name, Some(mime), |dest| std::fs::write(dest, &bytes).map(|()| bytes.len() as u64))
}

/// Attachments coming back from the frontend must be Neuron's own copies (never arbitrary paths).
pub fn validate(root: &Path, list: &[Attachment]) -> AppResult<Vec<Attachment>> {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    list.iter()
        .map(|a| {
            let path = Path::new(&a.path)
                .canonicalize()
                .map_err(|_| AppError::Invalid(format!("pièce jointe introuvable : {}", a.name)))?;
            if !path.starts_with(&root) {
                return Err(AppError::Invalid(format!("pièce jointe refusée : {}", a.name)));
            }
            Ok(a.clone())
        })
        .collect()
}

/// Base64 content of an image small enough to be sent inline.
pub fn inline_base64(a: &Attachment) -> Option<String> {
    if !a.is_image || a.size > MAX_INLINE_IMAGE {
        return None;
    }
    std::fs::read(&a.path).ok().map(|b| base64::engine::general_purpose::STANDARD.encode(b))
}

/// Text telling the agent where the attached files are (those not sent natively).
pub fn note(list: &[&Attachment]) -> String {
    if list.is_empty() {
        return String::new();
    }
    let mut out = String::from("\n\nPièces jointes (fichiers locaux, à lire avec tes outils) :\n");
    for a in list {
        out.push_str(&format!("- {} — {}\n", a.name, a.path));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_paste_validate() {
        let dir = std::env::temp_dir().join(format!("neuron-att-{}", uuid::Uuid::new_v4().simple()));
        let root = root(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("notes de réunion.md");
        std::fs::write(&src, "# hello").unwrap();

        let file = import_file(&root, &src).unwrap();
        assert_eq!((file.name.as_str(), file.mime.as_str(), file.size, file.is_image), ("notes de réunion.md", "text/markdown", 7, false));
        assert!(Path::new(&file.path).starts_with(&root));

        let png = base64::engine::general_purpose::STANDARD.encode([0x89, b'P', b'N', b'G']);
        let image = save_base64(&root, "image collée.png", "image/png", &png).unwrap();
        assert!(image.is_image && image.size == 4);
        assert!(inline_base64(&image).is_some());

        assert_eq!(validate(&root, &[file.clone(), image.clone()]).unwrap().len(), 2);
        let outside = Attachment { path: src.display().to_string(), ..file.clone() };
        assert!(validate(&root, &[outside]).is_err(), "only Neuron's copies");
        assert_eq!(safe_name("../../a:b?.txt"), "a_b_.txt");
        assert!(note(&[&file]).contains(&file.path));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn local_images_mentioned_by_agents() {
        let dir = std::env::temp_dir().join(format!("neuron-local-image-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("fox.png"), b"png").unwrap();
        std::fs::write(dir.join("notes.txt"), b"txt").unwrap();

        let found = local_image("fox.png", Some(&dir)).unwrap();
        assert_eq!((found.name.as_str(), found.mime.as_str(), found.size, found.is_image), ("fox.png", "image/png", 3, true));
        let absolute = dir.join("fox.png").display().to_string();
        assert!(local_image(&format!("`{absolute}`").replace('`', "\""), None).is_some());
        assert!(local_image("notes.txt", Some(&dir)).is_none(), "not an image");
        assert!(local_image("missing.png", Some(&dir)).is_none(), "missing file");
        assert!(local_image("fox.png", None).is_none(), "relative path without a folder");
        assert!(local_image("https://example.com/a.png", Some(&dir)).is_none(), "remote");
        std::fs::remove_dir_all(&dir).unwrap();
    }

}

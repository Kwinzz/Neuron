//! New versions of Neuron: checked on GitHub's latest release, installed by the Windows installer (passive update
//! mode) or by `install.sh` on Linux. Used by the app (background check, Paramètres → Mises à jour) and by
//! `neuron update`. Besides model prices, this is the app's only network call (none when the check is turned off).

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::error::{AppError, AppResult};
use crate::state::Shared;
use crate::util::now_ms;

const RELEASES_API: &str = "https://api.github.com/repos/Kwinzz/Neuron/releases/latest";
const RAW_INSTALL_SH: &str = "https://raw.githubusercontent.com/Kwinzz/Neuron/main/install.sh";
/// A newer version was found (payload: [`UpdateInfo`]); emitted once per version.
pub const UPDATE_AVAILABLE_EVENT: &str = "update://available";
/// Download of the installer (payload: [`UpdateProgress`]).
pub const UPDATE_PROGRESS_EVENT: &str = "update://progress";
const CACHE_KEY: &str = "update.last";
const NOTIFIED_KEY: &str = "update.notified";
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
const CHECK_EVERY: Duration = Duration::from_secs(12 * 3600);
const FETCH_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateInfo {
    /// Version running now.
    pub current: String,
    /// Latest published version.
    pub latest: String,
    pub available: bool,
    /// Release page (notes).
    pub page_url: String,
    /// Windows installer of the release (`…_x64-setup.exe`).
    pub asset_url: Option<String>,
    pub asset_name: Option<String>,
    #[ts(type = "number")]
    pub checked_at: i64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateProgress {
    #[ts(type = "number")]
    pub downloaded: u64,
    #[ts(type = "number | null")]
    pub total: Option<u64>,
}

pub fn current_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// `v1.2.3` / `1.2.3-beta.1` → `(1, 2, 3)` (pre-release suffixes are ignored).
pub fn parse_version(tag: &str) -> Option<(u64, u64, u64)> {
    let core = tag.trim().trim_start_matches(['v', 'V']);
    let core = core.split(['-', '+']).next()?;
    let mut parts = core.split('.').map(|p| p.parse::<u64>().ok());
    let version = (parts.next()??, parts.next().unwrap_or(Some(0))?, parts.next().unwrap_or(Some(0))?);
    Some(version)
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

/// [`UpdateInfo`] from GitHub's `releases/latest` answer.
pub fn parse_release(release: &Value, current: &str, now: i64) -> AppResult<UpdateInfo> {
    let tag = release
        .get("tag_name")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Other(crate::tr!("réponse de GitHub inattendue", "unexpected answer from GitHub")))?;
    let latest = tag.trim_start_matches(['v', 'V']).to_string();
    let page_url = release
        .get("html_url")
        .and_then(Value::as_str)
        .unwrap_or("https://github.com/Kwinzz/Neuron/releases/latest")
        .to_string();
    let asset = release.get("assets").and_then(Value::as_array).and_then(|assets| {
        assets.iter().find(|a| a.get("name").and_then(Value::as_str).is_some_and(|n| n.ends_with("_x64-setup.exe")))
    });
    let asset_name = asset.and_then(|a| a.get("name")).and_then(Value::as_str).map(String::from);
    let asset_url = asset.and_then(|a| a.get("browser_download_url")).and_then(Value::as_str).map(String::from);
    Ok(UpdateInfo {
        current: current.to_string(),
        available: is_newer(&latest, current),
        latest,
        page_url,
        asset_url,
        asset_name,
        checked_at: now,
    })
}

fn client(timeout: Option<Duration>) -> AppResult<reqwest::Client> {
    let mut builder = reqwest::Client::builder().user_agent("Neuron");
    if let Some(timeout) = timeout {
        builder = builder.timeout(timeout);
    }
    builder.build().map_err(|e| AppError::Other(format!("http: {e}")))
}

fn network_error(e: reqwest::Error) -> AppError {
    AppError::Other(crate::tr!("impossible de joindre GitHub ({e})", "could not reach GitHub ({e})"))
}

/// Asks GitHub for the latest release (no state: usable by the command line).
pub async fn fetch_latest() -> AppResult<UpdateInfo> {
    let response = client(Some(FETCH_TIMEOUT))?
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(network_error)?
        .error_for_status()
        .map_err(network_error)?;
    let body = response.bytes().await.map_err(network_error)?;
    let release: Value = serde_json::from_slice(&body)?;
    parse_release(&release, current_version(), now_ms())
}

/// Checks now and remembers the answer.
pub async fn check(state: &Shared) -> AppResult<UpdateInfo> {
    let info = fetch_latest().await?;
    let to_save = serde_json::to_value(&info)?;
    state.db.call(move |c| crate::db::settings::set(c, CACHE_KEY, &to_save)).await?;
    Ok(info)
}

/// Last known answer (availability recomputed: the app may have been updated since).
pub async fn cached(state: &Shared) -> AppResult<Option<UpdateInfo>> {
    let stored = state.db.call(|c| crate::db::settings::get(c, CACHE_KEY)).await?;
    Ok(stored.and_then(|v| serde_json::from_value::<UpdateInfo>(v).ok()).map(|mut info| {
        info.current = current_version().to_string();
        info.available = is_newer(&info.latest, &info.current);
        info
    }))
}

/// 30 s after the start then every 12 h, when the automatic check is on: a version not announced yet is
/// announced once ([`UPDATE_AVAILABLE_EVENT`], the app shows a notification and a badge).
pub fn spawn_periodic(state: &Shared) {
    let state = std::sync::Arc::clone(state);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            let auto = state.db.call(|c| crate::app_settings::load(c)).await.map(|s| s.updates.auto_check);
            if auto.unwrap_or(true) {
                match check(&state).await {
                    Ok(info) if info.available => announce_once(&state, info).await,
                    Ok(_) => {}
                    Err(err) => tracing::info!(%err, "update check failed"),
                }
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

async fn announce_once(state: &Shared, info: UpdateInfo) {
    let latest = info.latest.clone();
    let already = state
        .db
        .call(|c| crate::db::settings::get(c, NOTIFIED_KEY))
        .await
        .ok()
        .flatten()
        .is_some_and(|v| v.as_str() == Some(latest.as_str()));
    if already {
        return;
    }
    let value = Value::String(latest.clone());
    if let Err(err) = state.db.call(move |c| crate::db::settings::set(c, NOTIFIED_KEY, &value)).await {
        tracing::warn!(%err, "update notification not recorded");
    }
    tracing::info!(version = %latest, "update available");
    crate::events::emit_local(state.events.as_ref(), UPDATE_AVAILABLE_EVENT, &info);
}

/// Downloads the Windows installer of `info` into `%TEMP%\neuron-update\`, reporting progress.
pub async fn download_installer(info: &UpdateInfo, mut progress: impl FnMut(UpdateProgress)) -> AppResult<PathBuf> {
    let (Some(url), Some(name)) = (&info.asset_url, &info.asset_name) else {
        return Err(AppError::NotFound(crate::tr!(
            "pas d'installateur Windows dans la version {}",
            "no Windows installer in version {}",
            info.latest
        )));
    };
    let dir = std::env::temp_dir().join("neuron-update");
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join(crate::attachments::safe_name(name));
    let partial = path.with_extension("part");
    let mut response =
        client(None)?.get(url).send().await.map_err(network_error)?.error_for_status().map_err(network_error)?;
    let total = response.content_length();
    let mut file = tokio::fs::File::create(&partial).await?;
    let mut downloaded = 0u64;
    let mut last_report = 0u64;
    while let Some(chunk) = tokio::time::timeout(Duration::from_secs(60), response.chunk())
        .await
        .map_err(|_| AppError::Other(crate::tr!("téléchargement interrompu", "download interrupted")))?
        .map_err(network_error)?
    {
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await?;
        downloaded += chunk.len() as u64;
        if downloaded - last_report >= 256 * 1024 || Some(downloaded) == total {
            last_report = downloaded;
            progress(UpdateProgress { downloaded, total });
        }
    }
    tokio::io::AsyncWriteExt::flush(&mut file).await?;
    drop(file);
    if total.is_some_and(|t| t != downloaded) {
        return Err(AppError::Other(crate::tr!("téléchargement incomplet", "incomplete download")));
    }
    tokio::fs::rename(&partial, &path).await?;
    Ok(path)
}

/// Starts the downloaded installer in passive update mode (progress bar only, no question, previous choices kept);
/// `relaunch`: it starts Neuron again at the end. The caller then quits (the installer replaces the exe).
pub fn launch_installer(path: &Path, relaunch: bool) -> AppResult<()> {
    let mut cmd = std::process::Command::new(path);
    cmd.args(["/P", "/UPDATE"]);
    if relaunch {
        cmd.arg("/R");
    }
    cmd.spawn().map_err(|e| {
        AppError::Other(crate::tr!("impossible de lancer l'installateur ({e})", "could not start the installer ({e})"))
    })?;
    Ok(())
}

/// Linux: the update command (`install.sh` from the local sources if they are there, else downloaded).
pub fn linux_update_command() -> String {
    let src = std::env::var_os("NEURON_SRC_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::data_dir().map(|d| d.join("neuron-src")))
        .map(|d| d.join("install.sh"));
    match src.filter(|p| p.is_file()) {
        Some(script) => format!("bash '{}' --update --yes", script.display().to_string().replace('\'', "")),
        None => format!("curl -fsSL {RAW_INSTALL_SH} | bash -s -- --update --yes"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn versions() {
        assert_eq!(parse_version("v0.2.1"), Some((0, 2, 1)));
        assert_eq!(parse_version("1.10"), Some((1, 10, 0)));
        assert_eq!(parse_version("v2.0.0-beta.1"), Some((2, 0, 0)));
        assert_eq!(parse_version("latest"), None);
        assert!(is_newer("v0.10.0", "0.9.9"));
        assert!(is_newer("0.2.2", "0.2.1"));
        assert!(!is_newer("v0.2.1", "0.2.1"));
        assert!(!is_newer("0.2.0", "0.2.1"));
        assert!(!is_newer("nonsense", "0.2.1"));
    }

    #[test]
    fn github_release() {
        // Trimmed shape of `GET /repos/{owner}/{repo}/releases/latest`.
        let release = json!({
            "tag_name": "v0.3.0",
            "html_url": "https://github.com/Kwinzz/Neuron/releases/tag/v0.3.0",
            "assets": [
                { "name": "Neuron_0.3.0_x64-setup.exe.sig", "browser_download_url": "https://x/sig" },
                { "name": "Neuron_0.3.0_x64-setup.exe", "browser_download_url": "https://x/setup.exe" },
                { "name": "neuron_0.3.0_amd64.deb", "browser_download_url": "https://x/deb" }
            ]
        });
        let info = parse_release(&release, "0.2.1", 42).unwrap();
        assert_eq!(info.latest, "0.3.0");
        assert!(info.available);
        assert_eq!(info.asset_url.as_deref(), Some("https://x/setup.exe"));
        assert_eq!(info.asset_name.as_deref(), Some("Neuron_0.3.0_x64-setup.exe"));
        assert_eq!(info.checked_at, 42);

        let same = parse_release(&json!({ "tag_name": "v0.2.1", "assets": [] }), "0.2.1", 0).unwrap();
        assert!(!same.available);
        assert!(same.asset_url.is_none());
        assert!(parse_release(&json!({ "message": "Not Found" }), "0.2.1", 0).is_err());
    }
}

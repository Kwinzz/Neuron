//! New versions of Neuron. Updates only ever deliver what is on `main`:
//! - Windows (and any install without `install.sh`): GitHub's latest release, installed by the Windows installer
//!   (passive update mode);
//! - Linux, installed by `install.sh` (`~/.config/neuron/install`: `commit=…`, `method=prebuilt|source`): the
//!   installed commit against the package GitHub built for `main` (`main-build` pre-release, `build-info.txt`), or
//!   against the head of `main` for a build from source. The app installs `main`'s package by itself (download,
//!   `pkexec` for the package manager, restart: [`install_linux_prebuilt`]); a build from source and `neuron
//!   update` go through `install.sh --update`.
//!
//! Used by the app (background check, Paramètres → Mises à jour) and by `neuron update`. Besides model prices, this
//! is the app's only network call (none when the check is turned off).

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::error::{AppError, AppResult};
use crate::state::Shared;
use crate::util::now_ms;

const RELEASES_API: &str = "https://api.github.com/repos/Kwinzz/Neuron/releases/latest";
const MAIN_HEAD_API: &str = "https://api.github.com/repos/Kwinzz/Neuron/commits/main";
const RAW_FILES: &str = "https://raw.githubusercontent.com/Kwinzz/Neuron";
const REPO_URL: &str = "https://github.com/Kwinzz/Neuron";
const RAW_INSTALL_SH: &str = "https://raw.githubusercontent.com/Kwinzz/Neuron/main/install.sh";
/// Written last by `.github/workflows/linux-main.yml` once the packages of that commit are uploaded.
const PREBUILT_INFO: &str = "https://github.com/Kwinzz/Neuron/releases/download/main-build/build-info.txt";
/// Packages of `main` (same names as `install.sh`'s `prebuilt_asset`).
const PREBUILT_URL: &str = "https://github.com/Kwinzz/Neuron/releases/download/main-build";
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
    /// Linux build from source: commit installed and head of `main` (`current` / `latest` then read
    /// `<version>+<short commit>`). `None` for a release install.
    #[serde(default)]
    pub installed_commit: Option<String>,
    #[serde(default)]
    pub latest_commit: Option<String>,
    /// Linux: `main`'s package is installed by the app itself (no terminal), then Neuron restarts.
    #[serde(default)]
    pub in_app_install: bool,
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
        installed_commit: None,
        latest_commit: None,
        in_app_install: false,
    })
}

fn short(commit: &str) -> &str {
    commit.get(..7).unwrap_or(commit)
}

/// [`UpdateInfo`] of a Linux install: available as soon as `main` moved past the installed commit.
pub fn source_info(version: &str, installed: &str, latest_version: &str, latest: &str, now: i64) -> UpdateInfo {
    UpdateInfo {
        current: format!("{version}+{}", short(installed)),
        latest: format!("{latest_version}+{}", short(latest)),
        available: installed != latest,
        page_url: format!("{REPO_URL}/compare/{installed}...{latest}"),
        asset_url: None,
        asset_name: None,
        checked_at: now,
        installed_commit: Some(installed.to_string()),
        latest_commit: Some(latest.to_string()),
        in_app_install: false,
    }
}

/// `key=value` lines (`install.sh`'s state file, the workflow's `build-info.txt`).
fn key_value<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.lines()
        .find_map(|line| line.trim().strip_prefix(key)?.strip_prefix('='))
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

/// What `install.sh` installed on this Linux machine.
#[derive(Debug, Clone, PartialEq)]
pub struct LinuxInstall {
    pub commit: String,
    /// Package downloaded from GitHub (`false`: built from source).
    pub prebuilt: bool,
}

pub fn parse_install_state(text: &str) -> Option<LinuxInstall> {
    Some(LinuxInstall {
        commit: key_value(text, "commit")?.to_string(),
        prebuilt: key_value(text, "method") != Some("source"),
    })
}

/// `None` on Windows / macOS, and on Linux when Neuron was not installed by `install.sh`.
pub async fn linux_install() -> Option<LinuxInstall> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    let state = dirs::config_dir()?.join("neuron").join("install");
    if let Ok(text) = tokio::fs::read_to_string(&state).await {
        return parse_install_state(&text);
    }
    // install.sh of 2026-11-26 (before the state file): commit in the sources' git config.
    let src = std::env::var_os("NEURON_SRC_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::data_dir().map(|d| d.join("neuron-src")))
        .filter(|d| d.join(".git").exists())?;
    let out = tokio::process::Command::new("git")
        .arg("-C")
        .arg(&src)
        .args(["config", "--get", "neuron.installed"])
        .output()
        .await
        .ok()?;
    let commit = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !commit.is_empty()).then_some(LinuxInstall { commit, prebuilt: false })
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

async fn get_json(http: &reqwest::Client, url: &str) -> AppResult<Value> {
    let response = http
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(network_error)?
        .error_for_status()
        .map_err(network_error)?;
    let body = response.bytes().await.map_err(network_error)?;
    Ok(serde_json::from_slice(&body)?)
}

async fn get_text(http: &reqwest::Client, url: &str) -> AppResult<String> {
    let response = http.get(url).send().await.map_err(network_error)?.error_for_status().map_err(network_error)?;
    response.text().await.map_err(network_error)
}

fn unexpected_answer() -> AppError {
    AppError::Other(crate::tr!("réponse de GitHub inattendue", "unexpected answer from GitHub"))
}

/// Asks GitHub what the latest version is (no state: usable by the command line). Linux install by `install.sh`:
/// the package built for `main` (prebuilt) or the head of `main` (from source); otherwise the latest release.
pub async fn fetch_latest() -> AppResult<UpdateInfo> {
    let http = client(Some(FETCH_TIMEOUT))?;
    let Some(install) = linux_install().await else {
        return parse_release(&get_json(&http, RELEASES_API).await?, current_version(), now_ms());
    };
    let installed = install.commit;
    if install.prebuilt {
        let info = get_text(&http, PREBUILT_INFO).await?;
        let latest = key_value(&info, "commit").ok_or_else(unexpected_answer)?;
        let latest_version = key_value(&info, "version").unwrap_or("?");
        let mut info = source_info(current_version(), &installed, latest_version, latest, now_ms());
        info.in_app_install = linux_package().is_some();
        return Ok(info);
    }
    let head = get_json(&http, MAIN_HEAD_API).await?;
    let latest = head.get("sha").and_then(Value::as_str).ok_or_else(unexpected_answer)?;
    // Version number on `main` (display only: the commit decides).
    let conf = get_json(&http, &format!("{RAW_FILES}/{latest}/src-tauri/tauri.conf.json")).await.ok();
    let latest_version = conf.as_ref().and_then(|c| c.get("version")).and_then(Value::as_str).unwrap_or("?");
    Ok(source_info(current_version(), &installed, latest_version, latest, now_ms()))
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
    let Some(mut info) = stored.and_then(|v| serde_json::from_value::<UpdateInfo>(v).ok()) else { return Ok(None) };
    let install = linux_install().await;
    info.in_app_install = install.as_ref().is_some_and(|i| i.prebuilt) && linux_package().is_some();
    match (info.latest_commit.clone(), install.map(|i| i.commit)) {
        (Some(latest), Some(installed)) => {
            info.current = format!("{}+{}", current_version(), short(&installed));
            info.available = installed != latest;
            info.installed_commit = Some(installed);
        }
        _ => {
            info.current = current_version().to_string();
            info.available = info.latest_commit.is_none() && is_newer(&info.latest, &info.current);
        }
    }
    Ok(Some(info))
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
    download(url, &path, &mut progress).await?;
    Ok(path)
}

/// Downloads `url` into `path` (through `<path>.part`), reporting progress.
async fn download(url: &str, path: &Path, progress: &mut impl FnMut(UpdateProgress)) -> AppResult<()> {
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
    tokio::fs::rename(&partial, path).await?;
    Ok(())
}

/// Starts the downloaded installer in passive update mode (progress bar only, no question, previous choices kept);
/// `relaunch`: it starts Neuron again at the end. The caller then quits (the installer replaces the exe).
/// Windows: the per-machine installer needs administrator rights, which `CreateProcess` (`std::process::Command`)
/// cannot request (os error 740): it goes through `ShellExecuteW` with the `runas` verb, which shows the UAC prompt.
/// It waits while the prompt is shown, hence `spawn_blocking`.
pub async fn launch_installer(path: &Path, relaunch: bool) -> AppResult<()> {
    let args = if relaunch { "/P /UPDATE /R" } else { "/P /UPDATE" };
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        {
            shell_execute_elevated(&path, args)
        }
        #[cfg(not(windows))]
        {
            std::process::Command::new(&path).args(args.split(' ')).spawn().map_err(|e| {
                AppError::Other(crate::tr!(
                    "impossible de lancer l'installateur ({e})",
                    "could not start the installer ({e})"
                ))
            })?;
            Ok(())
        }
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?
}

#[cfg(windows)]
fn shell_execute_elevated(path: &Path, args: &str) -> AppResult<()> {
    use std::os::windows::ffi::OsStrExt;
    const SW_SHOWNORMAL: i32 = 1;
    const SE_ERR_ACCESSDENIED: isize = 5;
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: isize,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show_cmd: i32,
        ) -> isize;
    }
    let wide = |s: &std::ffi::OsStr| -> Vec<u16> { s.encode_wide().chain(std::iter::once(0)).collect() };
    let verb = wide("runas".as_ref());
    let file = wide(path.as_os_str());
    let params = wide(args.as_ref());
    // SAFETY: every pointer is a NUL-terminated UTF-16 string alive for the whole (synchronous) call; a null
    // directory means the current one.
    let code =
        unsafe { ShellExecuteW(0, verb.as_ptr(), file.as_ptr(), params.as_ptr(), std::ptr::null(), SW_SHOWNORMAL) };
    match code {
        c if c > 32 => Ok(()),
        // Also what a dismissed UAC prompt returns.
        SE_ERR_ACCESSDENIED => Err(AppError::Other(crate::tr!(
            "installateur non lancé : autorisation administrateur refusée",
            "installer not started: administrator permission refused"
        ))),
        c => Err(AppError::Other(crate::tr!(
            "impossible de lancer l'installateur (code {c})",
            "could not start the installer (code {c})"
        ))),
    }
}

/// Package manager of a Linux machine (the families `install.sh` supports).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinuxFamily {
    Arch,
    Debian,
    Fedora,
}

/// Name of `main`'s package for a family and a CPU (`std::env::consts::ARCH`); none when GitHub doesn't build it.
pub fn prebuilt_asset(family: LinuxFamily, arch: &str) -> Option<&'static str> {
    Some(match (family, arch) {
        (LinuxFamily::Arch, "x86_64") => "neuron-x86_64.pkg.tar.zst",
        (LinuxFamily::Debian, "x86_64") => "neuron-x86_64.deb",
        (LinuxFamily::Debian, "aarch64") => "neuron-aarch64.deb",
        (LinuxFamily::Fedora, "x86_64") => "neuron-x86_64.rpm",
        (LinuxFamily::Fedora, "aarch64") => "neuron-aarch64.rpm",
        _ => return None,
    })
}

/// This machine's family and package of `main`, when the app can install it itself (`pkexec` present).
fn linux_package() -> Option<(LinuxFamily, &'static str)> {
    use crate::env_path::find_program;
    if !cfg!(target_os = "linux") || find_program("pkexec").is_none() {
        return None;
    }
    let family = if find_program("pacman").is_some() {
        LinuxFamily::Arch
    } else if find_program("apt-get").is_some() {
        LinuxFamily::Debian
    } else if find_program("dnf").is_some() {
        LinuxFamily::Fedora
    } else {
        return None;
    };
    Some((family, prebuilt_asset(family, std::env::consts::ARCH)?))
}

/// Package manager command installing `file`, its dependencies included (run through `pkexec`). `reinstall`: the
/// same version is installed already (an update of `main` often keeps the version number; pacman and apt reinstall
/// it anyway).
pub fn install_command(family: LinuxFamily, file: &Path, reinstall: bool) -> (&'static str, Vec<String>) {
    let file = file.display().to_string();
    match family {
        LinuxFamily::Arch => ("pacman", vec!["-U".into(), "--noconfirm".into(), file]),
        LinuxFamily::Debian => {
            ("apt-get", vec!["install".into(), "-y".into(), "--reinstall".into(), "--allow-downgrades".into(), file])
        }
        LinuxFamily::Fedora => ("dnf", vec![if reinstall { "reinstall" } else { "install" }.into(), "-y".into(), file]),
    }
}

/// Fedora: `dnf install` of the version already installed does nothing, `dnf reinstall` is needed.
async fn same_rpm_installed(file: &Path) -> bool {
    let query = |args: Vec<std::ffi::OsString>| async move {
        let out = tokio::process::Command::new("rpm").args(args).output().await.ok()?;
        let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (out.status.success() && !version.is_empty()).then_some(version)
    };
    let format = "%{VERSION}-%{RELEASE}";
    let installed = query(vec!["-q".into(), "--qf".into(), format.into(), "neuron".into()]).await;
    let offered = query(vec!["-qp".into(), "--qf".into(), format.into(), file.into()]).await;
    installed.is_some() && installed == offered
}

/// Linux, installed by `install.sh` from `main`'s package: downloads the package GitHub built for `main`, installs
/// it with the package manager through `pkexec` (the desktop asks for the password) and records the installed
/// commit, as `install.sh --update` does. `None`: not possible here (build from source, no package for this
/// machine, no `pkexec`), the caller falls back on `install.sh` in a terminal. The running app is not stopped: the
/// caller restarts it ([`relaunch_when_closed`]).
pub async fn install_linux_prebuilt(mut progress: impl FnMut(UpdateProgress)) -> AppResult<Option<String>> {
    let Some((family, asset)) = linux_package() else { return Ok(None) };
    if !linux_install().await.is_some_and(|i| i.prebuilt) {
        return Ok(None);
    }
    let http = client(Some(FETCH_TIMEOUT))?;
    let build = get_text(&http, PREBUILT_INFO).await?;
    let commit = key_value(&build, "commit").ok_or_else(unexpected_answer)?.to_string();

    let dir = std::env::temp_dir().join(format!("neuron-update-{}", uuid::Uuid::new_v4().simple()));
    tokio::fs::create_dir_all(&dir).await?;
    let result = async {
        // apt reads the package as its own user.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).await?;
        }
        let file = dir.join(asset);
        download(&format!("{PREBUILT_URL}/{asset}"), &file, &mut progress).await?;
        let reinstall = family == LinuxFamily::Fedora && same_rpm_installed(&file).await;
        let (program, args) = install_command(family, &file, reinstall);
        let program = crate::env_path::find_program(program).unwrap_or_else(|| PathBuf::from(program));
        let pkexec = crate::env_path::find_program("pkexec").unwrap_or_else(|| PathBuf::from("pkexec"));
        let out = tokio::process::Command::new(pkexec)
            .arg(&program)
            .args(&args)
            .stdin(std::process::Stdio::null())
            .output()
            .await
            .map_err(|e| {
                AppError::Other(crate::tr!("impossible de lancer pkexec ({e})", "could not start pkexec ({e})"))
            })?;
        match out.status.code() {
            Some(0) => Ok(()),
            // pkexec: the password dialog was dismissed, or the user is not allowed.
            Some(126 | 127) => Err(AppError::Invalid(crate::tr!(
                "installation annulée : autorisation administrateur refusée",
                "installation cancelled: administrator permission denied"
            ))),
            _ => {
                let log = String::from_utf8_lossy(&out.stderr);
                let tail = crate::agents::subagents::output_tail(&log, 3);
                Err(AppError::Other(crate::tr!(
                    "{} n'a pas pu installer la mise à jour : {tail}\nDans un terminal : {}",
                    "{} could not install the update: {tail}\nIn a terminal: {}",
                    program.display(),
                    linux_update_command()
                )))
            }
        }
    }
    .await;
    let _ = tokio::fs::remove_dir_all(&dir).await;
    result?;

    if let Some(state) = dirs::config_dir().map(|d| d.join("neuron").join("install")) {
        tokio::fs::write(&state, format!("commit={commit}\nmethod=prebuilt\n")).await?;
    }
    // `neuron service install` was used and the server is running: it restarts on the new version.
    let _ = tokio::process::Command::new("systemctl")
        .args(["--user", "try-restart", "neuron.service"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;
    Ok(Some(commit))
}

/// Linux: starts Neuron again once this process has ended (a detached `sh` waits for it). The installed binary,
/// not `current_exe`: the package replaced it.
#[cfg(unix)]
pub fn relaunch_when_closed() -> AppResult<()> {
    use std::os::unix::process::CommandExt;
    let program = crate::env_path::find_program("neuron").unwrap_or_else(|| PathBuf::from("/usr/bin/neuron"));
    std::process::Command::new("sh")
        .args(["-c", r#"while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; exec "$2""#, "sh"])
        .arg(std::process::id().to_string())
        .arg(program)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        // Its own process group: not stopped with the app's.
        .process_group(0)
        .spawn()
        .map_err(|e| {
            AppError::Other(crate::tr!("impossible de relancer Neuron ({e})", "could not restart Neuron ({e})"))
        })?;
    Ok(())
}

/// Linux: the update command (always the `install.sh` of `main`: it knows how the packages are published today).
pub fn linux_update_command() -> String {
    format!("curl -fsSL {RAW_INSTALL_SH} | bash -s -- --update --yes")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn linux_packages() {
        assert_eq!(prebuilt_asset(LinuxFamily::Arch, "x86_64"), Some("neuron-x86_64.pkg.tar.zst"));
        assert_eq!(prebuilt_asset(LinuxFamily::Arch, "aarch64"), None);
        assert_eq!(prebuilt_asset(LinuxFamily::Debian, "aarch64"), Some("neuron-aarch64.deb"));
        assert_eq!(prebuilt_asset(LinuxFamily::Fedora, "riscv64"), None);
        let file = Path::new("/tmp/neuron-update-x/neuron-x86_64.rpm");
        assert_eq!(install_command(LinuxFamily::Fedora, file, true).1[0], "reinstall");
        assert_eq!(install_command(LinuxFamily::Fedora, file, false).1[0], "install");
        let (program, args) = install_command(LinuxFamily::Arch, Path::new("/tmp/a/neuron-x86_64.pkg.tar.zst"), false);
        assert_eq!((program, args.join(" ").as_str()), ("pacman", "-U --noconfirm /tmp/a/neuron-x86_64.pkg.tar.zst"));
    }

    /// This machine's package of `main` exists: `cargo test main_package -- --ignored` (Linux, network).
    #[test]
    #[ignore]
    fn main_package_is_published() {
        let (_, asset) = linux_package().expect("no package of main for this machine (or no pkexec)");
        let response = tauri::async_runtime::block_on(async {
            client(Some(FETCH_TIMEOUT)).unwrap().head(format!("{PREBUILT_URL}/{asset}")).send().await.unwrap()
        });
        assert!(response.status().is_success(), "{asset}: {}", response.status());
    }

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

    #[test]
    fn build_from_source_follows_main() {
        let installed = "8ff9f92aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let head = "9a2c798bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let info = source_info("0.2.1", installed, "0.2.1", head, 7);
        assert!(info.available, "same version number, new commits on main");
        assert_eq!(info.current, "0.2.1+8ff9f92");
        assert_eq!(info.latest, "0.2.1+9a2c798");
        assert_eq!(info.page_url, format!("https://github.com/Kwinzz/Neuron/compare/{installed}...{head}"));
        assert!(!source_info("0.2.1", head, "0.2.1", head, 7).available);
        // Older caches (no commit fields) still read.
        let old: UpdateInfo = serde_json::from_value(json!({
            "current": "0.2.1", "latest": "0.2.1", "available": false, "pageUrl": "x",
            "assetUrl": null, "assetName": null, "checkedAt": 1
        }))
        .unwrap();
        assert!(old.latest_commit.is_none());
    }

    #[test]
    fn install_state_and_build_info() {
        let state = parse_install_state("commit=9a2c798bbb\nmethod=prebuilt\n").unwrap();
        assert_eq!(state, LinuxInstall { commit: "9a2c798bbb".into(), prebuilt: true });
        assert!(!parse_install_state("method=source\ncommit=abc\n").unwrap().prebuilt);
        assert!(parse_install_state("method=prebuilt\ncommit=\n").is_none());
        let info = "commit=0123456789abcdef\nversion=0.2.2\n";
        assert_eq!(key_value(info, "commit"), Some("0123456789abcdef"));
        assert_eq!(key_value(info, "version"), Some("0.2.2"));
        assert_eq!(key_value(info, "missing"), None);
        assert_eq!(key_value("commitx=1\n", "commit"), None);
    }
}

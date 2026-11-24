//! The PATH agent CLIs are searched in.
//!
//! - Windows: a CLI installed while Neuron runs is not in its PATH yet → [`refresh_path`] re-reads the user and
//!   machine PATH from the registry, adds the official installers' folders, and updates the process environment
//!   (every child inherits it).
//! - Linux: an app started from the menu doesn't get the shell's PATH (`~/.local/bin`, nvm, npm global…) →
//!   the login shell's PATH is read once in the background ([`probe_login_shell`]), merged with the installers'
//!   folders, and given explicitly to every child ([`path`]): the process environment is never modified there
//!   (`set_var` races with libc readers on Unix).

#[cfg(unix)]
use std::ffi::OsString;
#[cfg(unix)]
use std::path::PathBuf;

/// Re-read the PATH (registry on Windows; installers' folders + login shell on Linux).
#[cfg(windows)]
pub fn refresh_path() {
    use std::ffi::OsString;
    use std::path::PathBuf;
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    fn expand(raw: &str) -> String {
        let mut out = String::new();
        let mut rest = raw;
        while let Some(start) = rest.find('%') {
            let Some(len) = rest[start + 1..].find('%') else { break };
            let name = &rest[start + 1..start + 1 + len];
            out.push_str(&rest[..start]);
            match std::env::var(name) {
                Ok(value) => out.push_str(&value),
                Err(_) => out.push_str(&rest[start..start + len + 2]),
            }
            rest = &rest[start + len + 2..];
        }
        out.push_str(rest);
        out
    }
    let read = |root, key: &str| -> Option<String> {
        RegKey::predef(root).open_subkey(key).ok()?.get_value::<String, _>("Path").ok()
    };

    let mut dirs: Vec<PathBuf> =
        std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    let registry = [
        read(HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
        read(HKEY_CURRENT_USER, "Environment"),
    ];
    for raw in registry.into_iter().flatten() {
        dirs.extend(std::env::split_paths(&expand(&raw)));
    }
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let roaming = std::env::var_os("APPDATA").map(PathBuf::from);
    let known = [
        home.map(|h| h.join(".local").join("bin")),
        local.as_ref().map(|l| l.join("Programs").join("OpenAI").join("Codex").join("bin")),
        local.map(|l| l.join("agy").join("bin")),
        roaming.map(|r| r.join("npm")),
    ];
    dirs.extend(known.into_iter().flatten().filter(|d| d.is_dir()));

    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| {
        !d.as_os_str().is_empty() && seen.insert(d.to_string_lossy().trim_end_matches('\\').to_lowercase())
    });
    let Ok(joined) = std::env::join_paths(&dirs) else { return };
    if std::env::var_os("PATH").as_deref() == Some(joined.as_os_str()) {
        return;
    }
    let joined: OsString = joined;
    // SAFETY: on Windows the process environment is guarded by the OS (and std's own lock); the races that make
    // `set_var` unsafe concern libc `getenv` readers on Unix.
    unsafe { std::env::set_var("PATH", joined) };
}

/// Windows: the process PATH itself is kept up to date, children inherit it.
#[cfg(windows)]
pub fn path() -> Option<std::ffi::OsString> {
    None
}

/// Windows: nothing to probe (the registry is read by [`refresh_path`]).
#[cfg(windows)]
pub fn probe_login_shell() {}

#[cfg(unix)]
static AUGMENTED: std::sync::RwLock<Option<OsString>> = std::sync::RwLock::new(None);
#[cfg(unix)]
static SHELL_PATH: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();

/// PATH to give to children (None until computed: they then inherit Neuron's).
#[cfg(unix)]
pub fn path() -> Option<OsString> {
    AUGMENTED.read().ok()?.clone()
}

#[cfg(unix)]
pub fn refresh_path() {
    let mut dirs: Vec<PathBuf> =
        std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if let Some(Some(shell)) = SHELL_PATH.get() {
        dirs.extend(std::env::split_paths(shell));
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        let known = [
            home.join(".local").join("bin"),
            home.join(".npm-global").join("bin"),
            home.join(".bun").join("bin"),
            home.join(".cargo").join("bin"),
            home.join(".codex").join("bin"),
        ];
        dirs.extend(known.into_iter().filter(|d| d.is_dir()));
    }
    dirs.extend(["/usr/local/bin", "/usr/bin", "/bin"].map(PathBuf::from));
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| !d.as_os_str().is_empty() && seen.insert(d.clone()));
    if let (Ok(joined), Ok(mut slot)) = (std::env::join_paths(&dirs), AUGMENTED.write()) {
        *slot = Some(joined);
    }
}

/// Read the login shell's PATH once (in the background: a slow shell must not delay the window).
#[cfg(unix)]
pub fn probe_login_shell() {
    refresh_path();
    std::thread::spawn(|| {
        let found = login_shell_path();
        tracing::info!(found = found.is_some(), "login shell PATH");
        let _ = SHELL_PATH.set(found);
        refresh_path();
    });
}

/// `$SHELL -ilc 'printf …$PATH'` (fish: `-lc` + `string join`), 3 s max. Markers skip greetings printed by rc files.
#[cfg(unix)]
fn login_shell_path() -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/bash".into());
    let fish = shell.ends_with("fish");
    let script = if fish {
        "printf '__NEURON_PATH__%s__END__' (string join : $PATH)"
    } else {
        "printf '__NEURON_PATH__%s__END__' \"$PATH\""
    };
    let mut child = Command::new(&shell)
        .args([if fish { "-lc" } else { "-ilc" }, script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() > Duration::from_secs(3) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => return None,
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    extract_marked(&out)
}

/// The value between `__NEURON_PATH__` and `__END__`.
pub fn extract_marked(out: &str) -> Option<String> {
    let start = out.find("__NEURON_PATH__")? + "__NEURON_PATH__".len();
    let len = out[start..].find("__END__")?;
    let value = out[start..start + len].trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// First `name` found in the children's PATH.
pub fn find_program(name: &str) -> Option<std::path::PathBuf> {
    let path = path().or_else(|| std::env::var_os("PATH"))?;
    std::env::split_paths(&path).map(|d| d.join(name)).find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_marked_path() {
        assert_eq!(
            extract_marked("Welcome to fish!\n__NEURON_PATH__/home/k/.local/bin:/usr/bin__END__").as_deref(),
            Some("/home/k/.local/bin:/usr/bin")
        );
        assert_eq!(extract_marked("no marker"), None);
        assert_eq!(extract_marked("__NEURON_PATH____END__"), None);
    }
}

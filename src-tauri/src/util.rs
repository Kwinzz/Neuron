//! Small shared helpers.

use std::time::{SystemTime, UNIX_EPOCH};

/// Current time as Unix milliseconds.
pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX)).unwrap_or(0)
}

pub const HOUR_MS: i64 = 3_600_000;
pub const DAY_MS: i64 = 24 * HOUR_MS;

/// Path of Neuron's own executable, as agents must launch it (memory MCP server). An AppImage runs from a
/// temporary mount that changes at each launch: its stable path is `$APPIMAGE`.
pub fn neuron_exe() -> std::io::Result<std::path::PathBuf> {
    if let Some(appimage) = std::env::var_os("APPIMAGE").filter(|p| !p.is_empty()) {
        return Ok(std::path::PathBuf::from(appimage));
    }
    std::env::current_exe()
}

/// Open a file or folder with the system's default application (Explorer, Finder, file manager).
pub fn open_with_system(path: &std::path::Path) -> std::io::Result<()> {
    let opener = if cfg!(windows) {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    std::process::Command::new(opener).arg(path).spawn().map(|_| ())
}

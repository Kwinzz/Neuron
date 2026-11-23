//! Native notifications.
//!
//! On Windows the notification plugin falls back to PowerShell's identity (name and icon) whenever the exe
//! runs from `target/debug` or `target/release`, and an exe launched by hand has no registered identity at
//! all. Neuron therefore registers its own AppUserModelID under `HKCU\Software\Classes\AppUserModelId`
//! (display name + icon, no installer needed) and sends its toasts under it. Other platforms use the plugin.

use std::path::Path;

use tauri::{AppHandle, Emitter, Manager};

use crate::error::{AppError, AppResult};

/// Emitted when the user clicks a notification; payload = the chat to open (or null).
pub const CLICKED_EVENT: &str = "notification://clicked";

/// Brings the main window to the front and tells the frontend which chat was clicked.
fn on_click(app: &AppHandle, thread_id: Option<String>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Err(err) = app.emit(CLICKED_EVENT, thread_id) {
        tracing::warn!(%err, "notification click not forwarded");
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use tauri_winrt_notification::{Sound, Toast};
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    /// 256 px app icon shown on every toast.
    const ICON: &[u8] = include_bytes!("../icons/128x128@2x.png");

    pub fn register(app_id: &str, display_name: &str, data_dir: &Path) -> std::io::Result<()> {
        let icon = data_dir.join("notification-icon.png");
        if std::fs::read(&icon).ok().as_deref() != Some(ICON) {
            std::fs::write(&icon, ICON)?;
        }
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(format!(r"Software\Classes\AppUserModelId\{app_id}"))?;
        key.set_value("DisplayName", &display_name)?;
        key.set_value("IconUri", &icon.to_string_lossy().into_owned())?;
        Ok(())
    }

    pub fn show(app: &AppHandle, title: &str, body: &str, thread_id: Option<String>) -> AppResult<()> {
        let handle = app.clone();
        Toast::new(&app.config().identifier)
            .title(title)
            .text1(body)
            .sound(Some(Sound::Default))
            .on_activated(move |_| {
                on_click(&handle, thread_id.clone());
                Ok(())
            })
            .show()
            .map_err(|e| AppError::Other(format!("notification: {e}")))
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    use tauri_plugin_notification::NotificationExt;

    pub fn register(_app_id: &str, _display_name: &str, _data_dir: &Path) -> std::io::Result<()> {
        Ok(())
    }

    pub fn show(app: &AppHandle, title: &str, body: &str, _thread_id: Option<String>) -> AppResult<()> {
        let _ = on_click; // clicks are handled by the OS (focuses the app) outside Windows
        app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|e| AppError::Other(format!("notification: {e}")))
    }
}

/// Registers Neuron's notification identity (Windows; no-op elsewhere). Called once at startup, off the main thread.
pub fn register(app: &AppHandle, data_dir: &Path) {
    let config = app.config();
    let name = config.product_name.clone().unwrap_or_else(|| "Neuron".to_owned());
    if let Err(err) = platform::register(&config.identifier, &name, data_dir) {
        tracing::warn!(%err, "notification identity not registered");
    }
}

/// Shows one notification (blocking: run it off the async runtime).
pub fn show(app: &AppHandle, title: &str, body: &str, thread_id: Option<String>) -> AppResult<()> {
    platform::show(app, title, body, thread_id)
}

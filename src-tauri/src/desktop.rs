//! Desktop integration: system tray, close-to-tray, start with Windows, and the global shortcut that
//! opens the quick prompt window (`quick`) from anywhere.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Window, WindowEvent};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::app_settings::AppSettings;

/// Argument given to the autostart entry: start hidden in the tray.
pub const BACKGROUND_ARG: &str = "--background";
/// `neuron --quick`: open the quick prompt (a desktop shortcut on Wayland, where global shortcuts don't exist).
pub const QUICK_ARG: &str = "--quick";
/// Emitted to the quick window each time it is shown (reset + refresh the recent chats).
pub const QUICK_OPENED_EVENT: &str = "quick://opened";
const MAIN: &str = "main";
const QUICK: &str = "quick";

/// Desktop settings mirrored in memory (read from window events, which can't wait on SQLite).
#[derive(Default)]
pub struct Desktop {
    close_to_tray: AtomicBool,
    /// Global shortcut currently registered for the quick prompt.
    shortcut: Mutex<Option<Shortcut>>,
    /// Told the user once that closing keeps Neuron running.
    told_background: AtomicBool,
}

/// Brings the main window back (tray, notification click, second launch).
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Shows the quick prompt on the monitor under the cursor, or hides it when already open.
pub fn toggle_quick(app: &AppHandle) {
    let Some(window) = app.get_webview_window(QUICK) else { return };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    // Centered horizontally, in the upper third, on the monitor where the user is (Spotlight-like).
    if let (Ok(cursor), Ok(size)) = (app.cursor_position(), window.outer_size()) {
        if let Ok(Some(monitor)) = app.monitor_from_point(cursor.x, cursor.y) {
            let (origin, area) = (monitor.position(), monitor.size());
            let x = origin.x + (i32::try_from(area.width).unwrap_or(0) - i32::try_from(size.width).unwrap_or(0)) / 2;
            let y = origin.y + i32::try_from(area.height).unwrap_or(0) / 5;
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit_to(QUICK, QUICK_OPENED_EVENT, ());
}

/// Tray menu in the current language.
fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    use crate::i18n::pick;
    let open = MenuItem::with_id(app, "open", pick("Ouvrir Neuron", "Open Neuron"), true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", pick("Demande rapide…", "Quick prompt…"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", pick("Quitter Neuron", "Quit Neuron"), true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&open, &quick, &separator, &quit])
}

/// After a language change.
pub fn refresh_tray_menu(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("neuron"), tray_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

/// Tray icon: click = open Neuron; menu = open, quick prompt, quit.
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = tray_menu(app)?;

    let mut builder = TrayIconBuilder::with_id("neuron")
        .tooltip(if crate::state::isolated_dev() { "Neuron (dev)" } else { "Neuron" })
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quick" => toggle_quick(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Registers (or replaces) the global shortcut of the quick prompt. Errors are returned for the UI.
fn apply_shortcut(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let desktop = app.state::<Desktop>();
    let mut current = desktop.shortcut.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(old) = current.take() {
        let _ = app.global_shortcut().unregister(old);
    }
    let quick = &settings.quick_launcher;
    if !quick.enabled {
        return Ok(());
    }
    let shortcut: Shortcut = quick
        .shortcut
        .parse()
        .map_err(|e| crate::tr!("raccourci « {} » invalide : {e}", "invalid shortcut “{}”: {e}", quick.shortcut))?;
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                toggle_quick(app);
            }
        })
        .map_err(|e| {
            if cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_some() {
                let shortcut = &quick.shortcut;
                crate::tr!(
                    "raccourci global indisponible sous Wayland : lie la commande « neuron --quick » à {shortcut} dans \
                     les raccourcis de ton bureau",
                    "global shortcuts are not available under Wayland: bind the command “neuron --quick” to {shortcut} \
                     in your desktop's shortcuts"
                )
            } else {
                crate::tr!(
                    "raccourci « {} » indisponible (déjà pris par une autre app ?) : {e}",
                    "shortcut “{}” unavailable (already taken by another app?): {e}",
                    quick.shortcut
                )
            }
        })?;
    *current = Some(shortcut);
    Ok(())
}

/// Start with Windows: keep the OS entry in line with the setting. Installed builds only: a dev build must
/// never point the login entry at `target/debug`.
fn apply_autostart(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    let manager = app.autolaunch();
    let wanted = settings.background.launch_at_login;
    if manager.is_enabled().unwrap_or(!wanted) == wanted {
        return Ok(());
    }
    let result = if wanted { manager.enable() } else { manager.disable() };
    result.map_err(|e| crate::tr!("démarrage avec Windows : {e}", "launch with Windows: {e}"))
}

/// At startup the OS entry is the truth: it may have been set by the installer (« Lancer Neuron avec Windows ? »)
/// or turned off in the Task Manager. The setting follows it; an enabled entry is rewritten so it points at
/// this exe (path changed after a reinstall elsewhere).
fn sync_autostart_setting(app: &AppHandle, settings: &AppSettings) -> AppSettings {
    let mut settings = settings.clone();
    if cfg!(debug_assertions) {
        return settings;
    }
    let manager = app.autolaunch();
    let Ok(enabled) = manager.is_enabled() else { return settings };
    if enabled {
        if let Err(err) = manager.enable() {
            tracing::warn!(%err, "autostart entry not refreshed");
        }
    }
    if enabled != settings.background.launch_at_login {
        settings.background.launch_at_login = enabled;
        let state = app.state::<crate::state::Shared>();
        let next = settings.clone();
        if let Err(err) = tauri::async_runtime::block_on(state.db.call(move |c| crate::app_settings::save(c, next))) {
            tracing::warn!(%err, "autostart setting not synced");
        }
    }
    settings
}

/// Applies the desktop part of the settings (startup and after each save). Returns the problems to show.
pub fn apply(app: &AppHandle, settings: &AppSettings) -> Vec<String> {
    app.state::<Desktop>().close_to_tray.store(settings.background.close_to_tray, Ordering::Relaxed);
    [apply_shortcut(app, settings), apply_autostart(app, settings)]
        .into_iter()
        .filter_map(Result::err)
        .inspect(|err| tracing::warn!(%err, "desktop setting not applied"))
        .collect()
}

/// Setup: tray, settings, and the main window shown unless started in the background (autostart).
pub fn setup(app: &AppHandle, settings: &AppSettings) {
    app.manage(Desktop::default());
    if let Err(err) = build_tray(app) {
        tracing::warn!(%err, "tray icon not created");
    }
    let settings = sync_autostart_setting(app, settings);
    apply(app, &settings);
    let quick = std::env::args().any(|a| a == QUICK_ARG);
    let background = quick || std::env::args().any(|a| a == BACKGROUND_ARG);
    if !background {
        show_main(app);
    }
    if quick {
        toggle_quick(app);
    }
}

/// Main window: closing it hides it in the tray (when enabled). Quick window: hidden when it loses focus.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let app = window.app_handle();
    match (window.label(), event) {
        (MAIN, WindowEvent::CloseRequested { api, .. }) => {
            let Some(desktop) = app.try_state::<Desktop>() else { return };
            if !desktop.close_to_tray.load(Ordering::Relaxed) {
                return;
            }
            api.prevent_close();
            let _ = window.hide();
            if !desktop.told_background.swap(true, Ordering::Relaxed) {
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = crate::notifications::show(
                        &app,
                        crate::i18n::pick("Neuron tourne en arrière-plan", "Neuron is running in the background"),
                        crate::i18n::pick(
                            "Tes agents continuent. Rouvre Neuron depuis l'icône près de l'horloge, ou fais ta demande avec le raccourci global.",
                            "Your agents keep going. Reopen Neuron from the icon near the clock, or send a request with the global shortcut.",
                        ),
                        None,
                    );
                });
            }
        }
        (QUICK, WindowEvent::Focused(false)) => {
            let _ = window.hide();
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shortcut_parses() {
        let parsed: Result<Shortcut, _> = crate::app_settings::DEFAULT_QUICK_SHORTCUT.parse();
        assert!(parsed.is_ok());
        assert!("Ctrl+Alt+KeyK".parse::<Shortcut>().is_ok());
        assert!("Ctrl+Shift+F1".parse::<Shortcut>().is_ok());
        assert!("pas un raccourci".parse::<Shortcut>().is_err());
    }
}

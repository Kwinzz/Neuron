//! New versions of Neuron (see `crate::update`): Paramètres → Mises à jour and the sidebar badge.

use std::time::Duration;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::events;
use crate::state::Shared;
use crate::update::{self, UPDATE_PROGRESS_EVENT, UpdateInfo, UpdateResult};

/// Last known answer (no network).
#[tauri::command]
pub async fn update_status(state: State<'_, Shared>) -> AppResult<Option<UpdateInfo>> {
    update::cached(&state).await
}

/// Asks GitHub now.
#[tauri::command]
pub async fn update_check(state: State<'_, Shared>) -> AppResult<UpdateInfo> {
    update::check(&state).await
}

/// Result of a silent Windows update launched just before this startup, if any (consumed once).
#[tauri::command]
pub async fn take_update_result(state: State<'_, Shared>) -> AppResult<Option<UpdateResult>> {
    let data_dir = state.paths.data_dir.clone();
    tokio::task::spawn_blocking(move || update::take_pending_result(&data_dir))
        .await
        .map_err(|e| AppError::Other(e.to_string()))
}

/// Installs the latest version. Windows: downloads the installer (`update://progress`), starts it in silent update
/// mode (Neuron restarts by itself) and quits. Linux: downloads `main`'s package (`update://progress`), installs it
/// through `pkexec`, restarts Neuron; a build from source runs `install.sh --update` in a terminal window.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle, state: State<'_, Shared>) -> AppResult<()> {
    let info = match update::cached(&state).await? {
        Some(info) if info.available => info,
        _ => update::check(&state).await?,
    };
    if !info.available {
        return Err(AppError::Invalid(crate::tr!(
            "Neuron est déjà à jour ({})",
            "Neuron is already up to date ({})",
            info.current
        )));
    }
    if cfg!(windows) {
        let sink = state.events.clone();
        let path = update::download_installer(&info, |p| {
            events::emit_local(sink.as_ref(), UPDATE_PROGRESS_EVENT, &p);
        })
        .await?;
        let data_dir = state.paths.data_dir.clone();
        let target = info.latest.clone();
        let _ = tokio::task::spawn_blocking(move || update::record_pending(&data_dir, &target)).await;
        if let Err(err) = update::launch_installer(&path, true).await {
            let data_dir = state.paths.data_dir.clone();
            let _ = tokio::task::spawn_blocking(move || update::clear_pending(&data_dir)).await;
            return Err(err);
        }
        // Let the answer reach the window, then leave the installer a free exe to replace.
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(600)).await;
            app.exit(0);
        });
        Ok(())
    } else if cfg!(target_os = "linux") {
        // `main`'s package: installed here (password asked by the desktop), then Neuron restarts by itself.
        let sink = state.events.clone();
        let installed = update::install_linux_prebuilt(|p| {
            events::emit_local(sink.as_ref(), UPDATE_PROGRESS_EVENT, &p);
        })
        .await?;
        if installed.is_some() {
            #[cfg(unix)]
            update::relaunch_when_closed()?;
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(600)).await;
                app.exit(0);
            });
            return Ok(());
        }
        // A build from source (or no package for this machine): install.sh in a terminal.
        let script = update_script(&info.latest, &update::linux_update_command());
        crate::agents::access::open_terminal(&crate::tr!("Neuron — mise à jour", "Neuron — update"), &script)
    } else {
        crate::util::open_with_system(std::path::Path::new(&info.page_url))?;
        Ok(())
    }
}

/// Bash run in a terminal window by [`update_install`] on Linux. Escapes are doubled (`\\033`, `\\n`): printf reads
/// them; a Rust `\0` would put a NUL byte in the argument and the terminal could not be started.
fn update_script(latest: &str, cmd: &str) -> String {
    crate::tr!(
        "set -o pipefail; printf '\\033[36m%s\\033[0m\\n\\n' 'Mise à jour de Neuron vers {latest}'; \
         if {cmd}; then printf '\\n\\033[32m%s\\033[0m\\n' 'Neuron est à jour : relance-le depuis le menu des applications.'; \
         read -r -p 'Entrée pour fermer… ' _; exit 0; fi; \
         printf '\\n\\033[31m%s\\033[0m\\n' 'Échec de la mise à jour.'; read -r -p 'Entrée pour fermer… ' _",
        "set -o pipefail; printf '\\033[36m%s\\033[0m\\n\\n' 'Updating Neuron to {latest}'; \
         if {cmd}; then printf '\\n\\033[32m%s\\033[0m\\n' 'Neuron is up to date: start it again from the applications menu.'; \
         read -r -p 'Press Enter to close… ' _; exit 0; fi; \
         printf '\\n\\033[31m%s\\033[0m\\n' 'Update failed.'; read -r -p 'Press Enter to close… ' _"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_script_is_a_valid_argument() {
        let script = update_script("0.2.3+4e2eeec", "bash '/tmp/install.sh' --update --yes");
        assert!(!script.contains('\0'), "NUL byte in {script:?}");
        assert!(!script.contains('\n'), "raw newline in {script:?}");
        assert!(script.starts_with(r"set -o pipefail; printf '\033[36m%s\033[0m\n\n' '"));
        assert!(script.contains("0.2.3+4e2eeec") && script.contains("if bash '/tmp/install.sh' --update --yes; then"));
    }
}

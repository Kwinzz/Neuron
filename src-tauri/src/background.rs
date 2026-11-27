//! Non-GUI background tasks shared by the desktop app and headless processes.

use crate::state::Shared;

/// Starts every background task that does not depend on a desktop window: memory file watcher, idle agent reaper,
/// deleted-thread purge, model price cache refresh, Antigravity quota refresh, periodic CLI usage import, sub-agent
/// process watch and the remote endpoint.
pub fn start(state: &Shared) {
    crate::commands::memory::spawn_memory_watcher(state);
    crate::commands::settings::spawn_idle_reaper(state);
    crate::commands::threads::spawn_deleted_purge(state);
    crate::commands::pricing::spawn_price_refresh(state);
    crate::commands::pricing::spawn_agy_quota_refresh(state);
    crate::usage_import::spawn_periodic(state);
    crate::agents::proc_watch::spawn(state);
    crate::remote::spawn_start(state);
}

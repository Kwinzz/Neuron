//! Neuron — backend entry point.

pub mod agents;
pub mod commands;
pub mod db;
pub mod error;
pub mod state;
pub mod util;

use std::time::Instant;

use tauri::{Manager, RunEvent};
use tracing_subscriber::EnvFilter;

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let started = Instant::now();
    init_tracing();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let state = AppState::init(app.handle(), started)?;
            tracing::info!(
                setup_ms = state.setup_ms,
                db_open_us = state.db_open_us,
                db = %state.paths.db_path.display(),
                "neuron ready"
            );
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::app_info,
            commands::system::frontend_log,
            commands::dashboard::dashboard_snapshot,
            commands::dashboard::usage_report,
            commands::dashboard::update_provider,
            commands::dashboard::list_projects,
            commands::dashboard::list_threads,
            commands::dashboard::get_thread,
            commands::threads::create_thread,
            commands::threads::send_message,
            commands::threads::respond_permission,
            commands::threads::stop_thread,
            commands::threads::get_thread_history,
            commands::threads::rename_thread,
            commands::threads::delete_thread,
            commands::threads::running_threads,
            commands::threads::prompt_history,
            commands::threads::default_cwd,
            commands::dev::dev_seed_demo,
            commands::dev::dev_clear_demo,
            commands::dev::dev_simulate_activity,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Neuron");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            // Never leave orphan agent processes behind.
            if let Some(state) = handle.try_state::<AppState>() {
                state.agents.shutdown_all();
            }
        }
    });
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("warn,neuron_lib=info,frontend=info"));
    // `try_init` so tests or re-entrant calls never panic.
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}

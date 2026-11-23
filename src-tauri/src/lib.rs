//! Neuron — backend entry point.

pub mod agents;
pub mod app_settings;
pub mod attachments;
pub mod commands;
pub mod context;
pub mod db;
pub mod desktop;
pub mod error;
pub mod memory;
pub mod notifications;
pub mod pricing;
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
        // First: a second launch (shortcut, autostart while running) just brings the window back.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| desktop::show_main(app)))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![desktop::BACKGROUND_ARG]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            let state = AppState::init(app.handle(), started)?;
            tracing::info!(
                setup_ms = state.setup_ms,
                db_open_us = state.db_open_us,
                db = %state.paths.db_path.display(),
                "neuron ready"
            );
            // Thumbnails of attachments are served through the asset protocol, limited to their folder.
            let attachments_dir = attachments::root(&state.paths.data_dir);
            if let Err(err) = std::fs::create_dir_all(&attachments_dir)
                .map_err(|e| e.to_string())
                .and_then(|()| app.asset_protocol_scope().allow_directory(&attachments_dir, true).map_err(|e| e.to_string()))
            {
                tracing::warn!(%err, "attachments folder not served");
            }
            {
                let handle = app.handle().clone();
                let data_dir = state.paths.data_dir.clone();
                std::thread::spawn(move || notifications::register(&handle, &data_dir));
            }
            let settings = tauri::async_runtime::block_on(state.db.call(|c| app_settings::load(c))).unwrap_or_default();
            app.manage(state);
            // Tray, global shortcut, start with Windows; shows the main window unless started in the background.
            desktop::setup(app.handle(), &settings);
            commands::memory::spawn_memory_watcher(app.handle());
            commands::settings::spawn_idle_reaper(app.handle());
            commands::pricing::spawn_price_refresh(app.handle());
            commands::pricing::spawn_agy_quota_refresh(app.handle());
            Ok(())
        })
        .on_window_event(desktop::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::system::app_info,
            commands::system::frontend_log,
            commands::system::send_notification,
            commands::system::show_thread,
            commands::system::show_new_chat,
            commands::dashboard::dashboard_snapshot,
            commands::dashboard::usage_report,
            commands::dashboard::update_provider,
            commands::dashboard::list_projects,
            commands::dashboard::list_threads,
            commands::dashboard::get_thread,
            commands::threads::create_thread,
            commands::threads::send_message,
            commands::threads::import_attachments,
            commands::threads::list_slash_commands,
            commands::threads::agent_images,
            commands::threads::paste_attachment,
            commands::threads::respond_permission,
            commands::threads::stop_thread,
            commands::threads::get_thread_history,
            commands::threads::rename_thread,
            commands::threads::delete_thread,
            commands::threads::running_threads,
            commands::threads::prompt_history,
            commands::threads::default_cwd,
            commands::threads::update_thread_settings,
            commands::threads::list_models,
            commands::projects::project_context,
            commands::projects::save_project_context,
            commands::projects::project_overview,
            commands::projects::thread_context,
            commands::settings::get_app_settings,
            commands::settings::update_app_settings,
            commands::settings::test_generic_cli,
            commands::pricing::pricing_status,
            commands::pricing::refresh_prices,
            commands::memory::list_memories,
            commands::memory::create_memory,
            commands::memory::update_memory,
            commands::memory::delete_memory,
            commands::memory::search_memories,
            commands::memory::memory_info,
            commands::memory::open_memory_file,
            commands::memory::antigravity_mcp_status,
            commands::memory::connect_antigravity_mcp,
            commands::memory::disconnect_antigravity_mcp,
            commands::threads::create_project,
            commands::threads::delete_project,
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

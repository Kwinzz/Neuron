//! Neuron — backend entry point.

pub mod agents;
pub mod app_settings;
pub mod attachments;
pub mod background;
pub mod commands;
pub mod context;
pub mod db;
pub mod desktop;
pub mod env_path;
pub mod error;
pub mod events;
pub mod i18n;
pub mod memory;
pub mod notifications;
pub mod pricing;
pub mod remote;
pub mod state;
pub mod usage_import;
pub mod util;

use std::sync::Arc;
use std::time::Instant;

use tauri::{Manager, RunEvent};
use tracing_subscriber::EnvFilter;

use crate::events::{EventSink, TauriSink};
use crate::state::{AppPaths, AppState, Shared};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let started = Instant::now();
    init_tracing();

    let app = tauri::Builder::default()
        // First: a second launch (shortcut, autostart while running) just brings the window back.
        // `neuron --quick` (bound to a desktop shortcut, Wayland) opens the quick prompt of the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|a| a == desktop::QUICK_ARG) {
                desktop::toggle_quick(app);
            } else {
                desktop::show_main(app);
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![desktop::BACKGROUND_ARG]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            // CLIs installed since the session started (or in the installers' folders) are found right away.
            env_path::probe_login_shell();
            env_path::refresh_path();
            let paths = AppPaths::resolve()?;
            let events: Arc<dyn EventSink> = Arc::new(TauriSink(app.handle().clone()));
            let state: Shared = Arc::new(AppState::open(paths, events, started)?);
            tracing::info!(
                setup_ms = state.setup_ms,
                db_open_us = state.db_open_us,
                db = %state.paths.db_path.display(),
                "neuron ready"
            );
            // Thumbnails of attachments are served through the asset protocol, limited to their folder.
            let attachments_dir = attachments::root(&state.paths.data_dir);
            if let Err(err) = std::fs::create_dir_all(&attachments_dir).map_err(|e| e.to_string()).and_then(|()| {
                app.asset_protocol_scope().allow_directory(&attachments_dir, true).map_err(|e| e.to_string())
            }) {
                tracing::warn!(%err, "attachments folder not served");
            }
            {
                let handle = app.handle().clone();
                let data_dir = state.paths.data_dir.clone();
                std::thread::spawn(move || notifications::register(&handle, &data_dir));
            }
            let mut settings =
                tauri::async_runtime::block_on(state.db.call(|c| app_settings::load(c))).unwrap_or_default();
            // First launch: language chosen in the installer, else the system's; then it is a normal setting.
            if settings.language.is_none() {
                settings.language = Some(i18n::detect());
                let to_save = settings.clone();
                if let Err(err) = tauri::async_runtime::block_on(state.db.call(move |c| app_settings::save(c, to_save)))
                {
                    tracing::warn!(%err, "language not saved");
                }
            }
            i18n::set(settings.language.unwrap_or(i18n::Language::En));
            app.manage(Arc::clone(&state));
            // Tray, global shortcut, start with Windows; shows the main window unless started in the background.
            desktop::setup(app.handle(), &settings);
            background::start(&state);
            Ok(())
        })
        .on_window_event(desktop::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::system::open_folder,
            commands::system::app_info,
            commands::system::frontend_log,
            commands::system::send_notification,
            commands::system::show_thread,
            commands::system::show_new_chat,
            commands::dashboard::dashboard_snapshot,
            commands::dashboard::usage_report,
            commands::dashboard::refresh_quotas,
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
            commands::access::agent_access,
            commands::access::check_agent_access,
            commands::access::install_agent,
            commands::access::login_agent,
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
            commands::memory::memory_import_sources,
            commands::memory::read_memory_import_file,
            commands::memory::split_memory_import,
            commands::memory::reformulate_memory_import,
            commands::memory::import_memories,
            commands::memory::antigravity_mcp_status,
            commands::memory::connect_antigravity_mcp,
            commands::memory::disconnect_antigravity_mcp,
            commands::threads::create_project,
            commands::threads::delete_project,
            commands::remote::remote_status,
            commands::remote::remote_set_enabled,
            commands::remote::remote_set_device_name,
            commands::remote::remote_set_internet,
            commands::remote::remote_start_pairing,
            commands::remote::remote_cancel_pairing,
            commands::remote::remote_nearby,
            commands::remote::remote_pair,
            commands::remote::remote_devices,
            commands::remote::remote_set_level,
            commands::remote::remote_revoke,
            commands::remote::remote_forget,
            commands::remote::remote_call,
            commands::remote::remote_upload_attachments,
            commands::remote::remote_fetch_attachments,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Neuron");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            // Never leave orphan agent processes behind.
            if let Some(state) = handle.try_state::<Shared>() {
                state.agents.shutdown_all();
                // Tell the connected devices we are leaving (bounded: never hold the exit).
                let remote = state.remote.clone();
                tauri::async_runtime::block_on(async move {
                    let _ = tokio::time::timeout(std::time::Duration::from_secs(1), remote.shutdown()).await;
                });
            }
        }
    });
}

fn init_tracing() {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn,neuron_lib=info,frontend=info"));
    // `try_init` so tests or re-entrant calls never panic.
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}

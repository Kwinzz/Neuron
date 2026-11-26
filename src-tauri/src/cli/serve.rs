//! `neuron serve`: the host without a window — agents, remote endpoint, background tasks, control channel.
//! Logs go to stderr (journald under systemd). Stops on Ctrl+C, SIGTERM, or `shutdown` on the control channel
//! (the desktop app taking over).

use std::sync::Arc;
use std::time::{Duration, Instant};

use super::EXIT_ALREADY_RUNNING;
use crate::control::{self, Control, InstanceMode};
use crate::error::AppError;
use crate::events::HeadlessSink;
use crate::state::{AppPaths, AppState, Shared};

pub fn run(paths: AppPaths) -> i32 {
    let started = Instant::now();
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn,neuron_lib=info"));
    // Colours only in a terminal (journald and log files get plain text).
    let ansi = std::io::IsTerminal::is_terminal(&std::io::stderr());
    let _ = tracing_subscriber::fmt().with_writer(std::io::stderr).with_ansi(ansi).with_env_filter(filter).try_init();
    // The agents' CLIs must be found as in the app (login shell PATH, installers' folders).
    crate::env_path::probe_login_shell();
    crate::env_path::refresh_path();
    tauri::async_runtime::block_on(serve(paths, started))
}

async fn serve(paths: AppPaths, started: Instant) -> i32 {
    // The lock first: never reset the chats or touch memory.md of a running instance.
    let listener = match control::bind(&paths.data_dir).await {
        Ok(listener) => listener,
        Err(AppError::AlreadyRunning) => {
            eprintln!("neuron: {}", AppError::AlreadyRunning);
            return EXIT_ALREADY_RUNNING;
        }
        Err(err) => {
            eprintln!(
                "neuron: {}",
                crate::tr!(
                    "canal de contrôle indisponible ({}) : {err}",
                    "control channel unavailable ({}): {err}",
                    control::address(&paths.data_dir)
                )
            );
            return 1;
        }
    };
    let data_dir = paths.data_dir.clone();
    let state: Shared = match AppState::open(paths, Arc::new(HeadlessSink), started) {
        Ok(state) => Arc::new(state),
        Err(err) => {
            eprintln!("neuron: {err}");
            return 1;
        }
    };
    apply_language(&state).await;

    let (stop_tx, mut stop_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let on_shutdown = Box::new(move || {
        let _ = stop_tx.send(());
    });
    control::spawn(listener, Control { state: Arc::clone(&state), mode: InstanceMode::Serve, on_shutdown });
    crate::background::start(&state);
    tracing::info!(data = %data_dir.display(), control = %control::address(&data_dir), "neuron serve ready");
    eprintln!(
        "{}",
        crate::tr!(
            "Neuron {} tourne sans fenêtre (Ctrl+C pour arrêter). Réglages : `neuron remote …`, état : `neuron status`.",
            "Neuron {} is running without a window (Ctrl+C to stop). Settings: `neuron remote …`, state: `neuron status`.",
            env!("CARGO_PKG_VERSION")
        )
    );

    tokio::select! {
        _ = tokio::signal::ctrl_c() => tracing::info!("interrupted"),
        _ = terminated() => tracing::info!("terminated"),
        _ = stop_rx.recv() => tracing::info!("stopped by another Neuron instance"),
    }

    state.agents.shutdown_all();
    let _ = tokio::time::timeout(Duration::from_secs(2), state.remote.shutdown()).await;
    control::cleanup(&data_dir);
    0
}

/// Same language as the app; the first start without the app saves the detected one (like the app does).
async fn apply_language(state: &Shared) {
    let mut settings = state.db.call(|c| crate::app_settings::load(c)).await.unwrap_or_default();
    if settings.language.is_none() {
        settings.language = Some(crate::i18n::detect());
        let to_save = settings.clone();
        if let Err(err) = state.db.call(move |c| crate::app_settings::save(c, to_save)).await {
            tracing::warn!(%err, "language not saved");
        }
    }
    crate::i18n::set(settings.language.unwrap_or(crate::i18n::Language::En));
}

/// SIGTERM (systemd stop) on Unix, console closed on Windows.
async fn terminated() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        match signal(SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    }
    #[cfg(windows)]
    {
        match tokio::signal::windows::ctrl_close() {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    }
}

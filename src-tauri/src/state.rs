//! Shared application state, managed by Tauri.

use std::path::PathBuf;
use std::time::Instant;

use tauri::{AppHandle, Manager};

use crate::db::Db;
use crate::error::AppResult;

/// Filesystem locations used by Neuron.
#[derive(Debug, Clone)]
pub struct AppPaths {
    /// OS app-data directory (e.g. `%APPDATA%/dev.neuron.app`).
    pub data_dir: PathBuf,
    /// SQLite database file.
    pub db_path: PathBuf,
    /// User-facing Neuron home (`~/.neuron`) holding `memory.md`. Created lazily.
    pub neuron_home: PathBuf,
}

pub struct AppState {
    pub db: Db,
    pub paths: AppPaths,
    /// Time from process start to the end of `setup` (includes window/WebView creation), in ms.
    pub setup_ms: u64,
    /// Time spent opening SQLite and applying migrations, in microseconds.
    pub db_open_us: u64,
}

fn as_u64(value: u128) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

impl AppState {
    /// Resolve paths, open the database and apply migrations. Local only, no network.
    pub fn init(app: &AppHandle, started: Instant) -> AppResult<Self> {
        // NEURON_DATA_DIR lets dev/test runs use an isolated database.
        let data_dir = match std::env::var_os("NEURON_DATA_DIR") {
            Some(dir) if !dir.is_empty() => PathBuf::from(dir),
            _ => app.path().app_data_dir()?,
        };
        std::fs::create_dir_all(&data_dir)?;
        let db_path = data_dir.join("neuron.db");
        let neuron_home = app.path().home_dir()?.join(".neuron");

        let db_started = Instant::now();
        let db = Db::open(&db_path)?;
        let db_open_us = as_u64(db_started.elapsed().as_micros());

        Ok(Self {
            db,
            paths: AppPaths {
                data_dir,
                db_path,
                neuron_home,
            },
            setup_ms: as_u64(started.elapsed().as_millis()),
            db_open_us,
        })
    }
}

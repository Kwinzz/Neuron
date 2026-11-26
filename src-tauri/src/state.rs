//! Shared application state, used by both the Tauri desktop app and headless processes.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use crate::agents::registry::AgentRegistry;
use crate::db::{Db, threads};
use crate::error::{AppError, AppResult};
use crate::events::EventSink;
use crate::util::now_ms;

/// Application identifier shared with `tauri.conf.json` (used to locate the OS app-data folder).
const APP_IDENTIFIER: &str = "dev.neuron.app";

/// Filesystem locations used by Neuron.
#[derive(Debug, Clone)]
pub struct AppPaths {
    /// OS app-data directory (e.g. `%APPDATA%/dev.neuron.app`).
    pub data_dir: PathBuf,
    /// SQLite database file.
    pub db_path: PathBuf,
    /// User-facing Neuron home (`~/.neuron`) holding `memory.md`. Created lazily.
    pub neuron_home: PathBuf,
    /// Global memory mirror (`<neuron_home>/memory.md`).
    pub memory_file: PathBuf,
}

impl AppPaths {
    /// Resolve Neuron's data and home directories without needing a Tauri `AppHandle`.
    pub fn resolve() -> AppResult<Self> {
        let env_data_dir = std::env::var_os("NEURON_DATA_DIR").filter(|d| !d.is_empty()).map(PathBuf::from);
        let isolated = env_data_dir.is_some();
        // NEURON_DATA_DIR lets dev/test runs use an isolated database.
        let data_dir = match env_data_dir {
            Some(dir) => dir,
            None => dirs::data_dir()
                .ok_or_else(|| {
                    AppError::Other(crate::tr!(
                        "dossier de données introuvable",
                        "application data directory not found"
                    ))
                })?
                .join(APP_IDENTIFIER),
        };
        let db_path = data_dir.join("neuron.db");
        // Isolated runs (NEURON_DATA_DIR) never touch the real ~/.neuron.
        let neuron_home = if isolated {
            data_dir.join(".neuron")
        } else {
            dirs::home_dir()
                .ok_or_else(|| {
                    AppError::Other(crate::tr!("dossier personnel introuvable", "home directory not found"))
                })?
                .join(".neuron")
        };
        let memory_file = neuron_home.join("memory.md");
        Ok(Self { data_dir, db_path, neuron_home, memory_file })
    }
}

pub struct AppState {
    pub db: Db,
    /// Running agent sessions (one process per active thread).
    pub agents: Arc<AgentRegistry>,
    /// Other devices: pairing, hosting paired clients, controlling paired hosts (see `crate::remote`).
    pub remote: Arc<crate::remote::Remote>,
    /// Event destination (desktop WebView + remote hub, or remote hub only when headless).
    pub events: Arc<dyn EventSink>,
    pub paths: AppPaths,
    /// Time from process start to the end of `open` (includes window/WebView creation in desktop mode), in ms.
    pub setup_ms: u64,
    /// Time spent opening SQLite and applying migrations, in microseconds.
    pub db_open_us: u64,
}

/// Shared handle to [`AppState`], managed by Tauri and passed to background tasks and remote dispatch.
pub type Shared = Arc<AppState>;

fn as_u64(value: u128) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

impl AppState {
    /// Open the database, apply migrations and prepare shared state. Local only, no network.
    pub fn open(paths: AppPaths, events: Arc<dyn EventSink>, started: Instant) -> AppResult<Self> {
        std::fs::create_dir_all(&paths.data_dir)?;

        let db_started = Instant::now();
        let db = Db::open(&paths.db_path)?;
        let db_open_us = as_u64(db_started.elapsed().as_micros());

        // No agent process survives a restart: threads left active become idle.
        let reset = db.blocking(|c| threads::reset_stale_active(c, now_ms()))?;
        if reset > 0 {
            tracing::info!(reset, "stale active threads reset");
        }
        // memory.md ⇄ SQLite: import edits made while Neuron was closed, (re)create the file.
        {
            let file = paths.memory_file.clone();
            if let Err(err) = db.blocking(|c| {
                crate::memory::import_if_changed(c, &file, now_ms())?;
                crate::memory::export(c, &file)
            }) {
                tracing::warn!(%err, "memory.md sync failed");
            }
        }
        let memory_paths =
            crate::memory::MemoryPaths { db_path: paths.db_path.clone(), file_path: paths.memory_file.clone() };
        let mcp = match crate::util::neuron_exe() {
            Ok(exe) => Some((exe, memory_paths)),
            Err(err) => {
                tracing::warn!(%err, "no executable path: memory MCP server disabled");
                None
            }
        };
        let remote = Arc::new(crate::remote::Remote::new(paths.data_dir.clone()));

        Ok(Self {
            db,
            agents: Arc::new(AgentRegistry::new(mcp)),
            remote,
            events,
            paths,
            setup_ms: as_u64(started.elapsed().as_millis()),
            db_open_us,
        })
    }
}

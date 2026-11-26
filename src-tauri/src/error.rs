//! Application error type, serialized to the frontend as [`IpcError`].

use serde::{Deserialize, Serialize, Serializer};
use ts_rs::TS;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("tauri error: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("background task failed: {0}")]
    Join(#[from] tokio::task::JoinError),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    Invalid(String),
    /// An agent CLI could not be started because it does not exist (not installed / not in the PATH).
    #[error("{}", not_installed_message(.0))]
    AgentNotInstalled(String),
    /// No Neuron instance is listening on the local control channel.
    #[error("{}", not_running_message())]
    NotRunning,
    /// Another Neuron instance is already listening on the local control channel.
    #[error("{}", already_running_message())]
    AlreadyRunning,
    #[error("{0}")]
    Other(String),
}

/// Message of [`AppError::AgentNotInstalled`] in the current language (`access::classify_error` recognizes both).
fn not_installed_message(binary: &str) -> String {
    crate::tr!(
        "« {binary} » est introuvable : le CLI n'est pas installé (ou pas dans le PATH).",
        "“{binary}” was not found: the CLI is not installed (or not in the PATH)."
    )
}

fn not_running_message() -> String {
    crate::tr!("Neuron n'est pas en cours d'exécution", "Neuron is not running")
}

fn already_running_message() -> String {
    crate::tr!("une instance de Neuron tourne déjà", "another Neuron instance is already running")
}

impl AppError {
    /// The message without the category prefix (« not found: », « invalid input: »), for people to read.
    pub fn plain_message(&self) -> String {
        match self {
            AppError::NotFound(m) | AppError::Invalid(m) | AppError::Other(m) => m.clone(),
            other => other.to_string(),
        }
    }

    pub fn kind(&self) -> IpcErrorKind {
        match self {
            AppError::Db(_) => IpcErrorKind::Db,
            AppError::Io(_) => IpcErrorKind::Io,
            AppError::Tauri(_) | AppError::Join(_) | AppError::Other(_) => IpcErrorKind::Internal,
            AppError::Json(_) | AppError::Invalid(_) | AppError::AlreadyRunning => IpcErrorKind::Invalid,
            AppError::NotFound(_) | AppError::AgentNotInstalled(_) | AppError::NotRunning => IpcErrorKind::NotFound,
        }
    }
}

/// Error category exposed to the frontend.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum IpcErrorKind {
    Db,
    Io,
    Invalid,
    NotFound,
    Internal,
}

/// Shape of every rejected `invoke()` promise on the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct IpcError {
    pub kind: IpcErrorKind,
    pub message: String,
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        IpcError { kind: self.kind(), message: self.to_string() }.serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;

//! Application error type, serialized to the frontend as [`IpcError`].

use serde::{Serialize, Serializer};
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

impl AppError {
    pub fn kind(&self) -> IpcErrorKind {
        match self {
            AppError::Db(_) => IpcErrorKind::Db,
            AppError::Io(_) => IpcErrorKind::Io,
            AppError::Tauri(_) | AppError::Join(_) | AppError::Other(_) => IpcErrorKind::Internal,
            AppError::Json(_) | AppError::Invalid(_) => IpcErrorKind::Invalid,
            AppError::NotFound(_) | AppError::AgentNotInstalled(_) => IpcErrorKind::NotFound,
        }
    }
}

/// Error category exposed to the frontend.
#[derive(Debug, Clone, Copy, Serialize, TS)]
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
#[derive(Debug, Clone, Serialize, TS)]
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

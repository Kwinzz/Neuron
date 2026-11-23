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
    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn kind(&self) -> IpcErrorKind {
        match self {
            AppError::Db(_) => IpcErrorKind::Db,
            AppError::Io(_) => IpcErrorKind::Io,
            AppError::Tauri(_) | AppError::Join(_) | AppError::Other(_) => IpcErrorKind::Internal,
            AppError::Json(_) | AppError::Invalid(_) => IpcErrorKind::Invalid,
            AppError::NotFound(_) => IpcErrorKind::NotFound,
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

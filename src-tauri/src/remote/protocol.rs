//! What two Neuron instances say to each other over iroh (QUIC).
//!
//! - `neuron/pair/1`: one bidirectional stream carrying the pairing exchange (length-prefixed JSON frames).
//! - `neuron/rpc/1`: one bidirectional stream per request (the client writes an [`RpcRequest`] and finishes, the
//!   host answers one [`RpcResponse`] and finishes), plus one unidirectional stream host → client carrying the
//!   host's events as length-prefixed [`WireEvent`] frames.

use iroh::endpoint::{RecvStream, SendStream};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};

pub const PAIR_ALPN: &[u8] = b"neuron/pair/1";
pub const RPC_ALPN: &[u8] = b"neuron/rpc/1";

/// Largest request / response / event accepted (chat histories with pasted images can be big).
pub const MAX_MESSAGE: usize = 32 * 1024 * 1024;

/// Network / protocol failure as an [`AppError`] (shown to the user as is).
pub fn net_err(err: impl std::fmt::Display) -> AppError {
    AppError::Other(crate::tr!("connexion à l'appareil : {err}", "device connection: {err}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcRequest {
    /// Name of the Tauri command (`send_message`, `list_threads`…).
    pub method: String,
    /// Its arguments, exactly as the frontend passes them to `invoke` (camelCase keys).
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum RpcResponse {
    Ok {
        value: Value,
    },
    /// `kind` = the host's `IpcErrorKind` (`not_found`, `invalid`…).
    Err {
        kind: String,
        message: String,
    },
}

impl RpcResponse {
    pub fn from_result(result: AppResult<Value>) -> Self {
        match result {
            Ok(value) => RpcResponse::Ok { value },
            Err(err) => {
                let kind = serde_json::to_value(err.kind()).ok().and_then(|v| v.as_str().map(str::to_string));
                RpcResponse::Err { kind: kind.unwrap_or_else(|| "internal".into()), message: err.to_string() }
            }
        }
    }

    /// Back to an [`AppError`] of the same kind on the calling device.
    pub fn into_result(self) -> AppResult<Value> {
        match self {
            RpcResponse::Ok { value } => Ok(value),
            RpcResponse::Err { kind, message } => Err(match kind.as_str() {
                "not_found" => AppError::NotFound(message),
                "invalid" => AppError::Invalid(message),
                _ => AppError::Other(message),
            }),
        }
    }
}

/// One host event (`agent://event`, `memory://changed`…) forwarded to its paired clients.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WireEvent {
    pub channel: String,
    pub payload: Value,
}

/// Pairing, client → host: who I am and my SPAKE2 message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairHello {
    pub name: String,
    pub spake: Vec<u8>,
}

/// Pairing, host → client: its name, its SPAKE2 message and its key confirmation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PairReply {
    Continue {
        name: String,
        spake: Vec<u8>,
        confirm: Vec<u8>,
    },
    /// No pairing open on the host, or too many attempts.
    Refused {
        reason: String,
    },
}

/// Pairing, client → host: the client's key confirmation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairConfirm {
    pub confirm: Vec<u8>,
}

/// Pairing, host → client: final outcome.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairOutcome {
    pub ok: bool,
    pub reason: Option<String>,
}

/// Writes one length-prefixed JSON frame.
pub async fn write_frame<T: Serialize>(send: &mut SendStream, value: &T) -> AppResult<()> {
    let bytes = serde_json::to_vec(value)?;
    let len = u32::try_from(bytes.len()).map_err(|_| AppError::Invalid("frame too large".into()))?;
    send.write_all(&len.to_be_bytes()).await.map_err(net_err)?;
    send.write_all(&bytes).await.map_err(net_err)?;
    Ok(())
}

/// Reads one length-prefixed JSON frame.
pub async fn read_frame<T: DeserializeOwned>(recv: &mut RecvStream) -> AppResult<T> {
    let mut len = [0u8; 4];
    recv.read_exact(&mut len).await.map_err(net_err)?;
    let len = u32::from_be_bytes(len) as usize;
    if len > MAX_MESSAGE {
        return Err(AppError::Invalid(format!("frame too large ({len} bytes)")));
    }
    let mut buf = vec![0u8; len];
    recv.read_exact(&mut buf).await.map_err(net_err)?;
    Ok(serde_json::from_slice(&buf)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn responses_keep_the_error_kind() {
        let err = RpcResponse::from_result(Err(AppError::NotFound("thread x".into())));
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["status"], "err");
        assert_eq!(json["kind"], "not_found");
        assert!(matches!(err.into_result(), Err(AppError::NotFound(m)) if m.contains("thread x")));
        let ok = RpcResponse::from_result(Ok(serde_json::json!([1, 2])));
        assert_eq!(ok.into_result().unwrap(), serde_json::json!([1, 2]));
    }
}

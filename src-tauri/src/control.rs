//! Local control channel: the `neuron` command line talks to the running instance (desktop app or `neuron serve`).
//!
//! One request per connection, one JSON line each way: `{"method", "args"}` → `{"ok": …}` or `{"error": IpcError}`.
//! Transport: a named pipe that refuses remote clients on Windows (`\\.\pipe\neuron-<hash of the data folder>`), a
//! Unix socket readable by the user only elsewhere (`<data_dir>/neuron.sock`). The channel is also the instance
//! lock: one listener per data folder, so `neuron serve` refuses to start while an instance answers.
//!
//! Allow-list only ([`dispatch`]): instance status, the `remote_*` settings and pairing, the CLIs' state. Chats are
//! never driven from here (that is what paired devices are for).

use std::path::Path;
#[cfg(any(unix, test))]
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};

use crate::commands::remote as rc;
use crate::error::{AppError, AppResult, IpcError};
use crate::remote::dispatch::{arg, json};
use crate::state::Shared;

/// Longest request or response accepted (workspace tool calls may carry file contents / command output).
const MAX_LINE: u64 = 8 * 1024 * 1024;
/// A request that takes longer is given up by the client.
const CLIENT_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlRequest {
    pub method: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ControlResponse {
    Ok(Value),
    Error(IpcError),
}

/// What kind of process answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InstanceMode {
    /// The desktop app (window, tray).
    App,
    /// `neuron serve` (no window).
    Serve,
}

/// Answer of the `status` method.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceInfo {
    pub version: String,
    pub mode: InstanceMode,
    pub pid: u32,
    pub data_dir: String,
}

/// What the server needs to answer requests.
pub struct Control {
    pub state: Shared,
    pub mode: InstanceMode,
    /// Called once the reply to `shutdown` is sent (exits the app / stops `serve`).
    pub on_shutdown: Box<dyn Fn() + Send + Sync>,
}

/// Runs one allowed method. `shutdown` only answers here: the caller acts once the reply is sent.
pub async fn dispatch(ctl: &Control, method: &str, args: Value) -> AppResult<Value> {
    let state = &ctl.state;
    match method {
        "ping" | "shutdown" => Ok(Value::Bool(true)),
        "status" => json(InstanceInfo {
            version: env!("CARGO_PKG_VERSION").into(),
            mode: ctl.mode,
            pid: std::process::id(),
            data_dir: state.paths.data_dir.display().to_string(),
        }),
        "remote_status" => json(rc::remote_status_inner(state).await?),
        "remote_set_enabled" => json(rc::remote_set_enabled_inner(state, arg(&args, "enabled")?).await?),
        "remote_set_internet" => json(rc::remote_set_internet_inner(state, arg(&args, "enabled")?).await?),
        "remote_set_device_name" => json(rc::remote_set_device_name_inner(state, arg(&args, "name")?).await?),
        "remote_start_pairing" => json(rc::remote_start_pairing_inner(state).await?),
        "remote_cancel_pairing" => json(rc::remote_cancel_pairing_inner(state).await?),
        "remote_devices" => json(rc::remote_devices_inner(state).await?),
        "remote_set_level" => {
            json(rc::remote_set_level_inner(state, arg(&args, "nodeId")?, arg(&args, "level")?).await?)
        }
        "remote_set_tools" => {
            json(rc::remote_set_tools_inner(state, arg(&args, "enabled")?, arg(&args, "scope")?).await?)
        }
        "remote_revoke" => json(rc::remote_revoke_inner(state, arg(&args, "nodeId")?).await?),
        "remote_forget" => json(rc::remote_forget_inner(state, arg(&args, "nodeId")?).await?),
        "remote_workspace_op" => {
            let thread_id: String = arg(&args, "threadId")?;
            let op: crate::remote::workspace::WorkspaceOp = arg(&args, "op")?;
            let res = rc::execute_remote_workspace_op(state, &thread_id, op).await?;
            json(res)
        }
        "agent_access" => {
            let refresh: Option<bool> = arg(&args, "refresh")?;
            json(crate::agents::access::list(refresh.unwrap_or(false)).await)
        }
        _ => Err(AppError::Invalid(crate::tr!("méthode inconnue : {method}", "unknown method: {method}"))),
    }
}

/// Reads one request, answers it, then runs `shutdown` if it was asked for.
async fn handle<S: AsyncRead + AsyncWrite + Unpin>(stream: S, ctl: &Control) {
    let (read, mut write) = tokio::io::split(stream);
    let mut line = String::new();
    if let Err(err) = BufReader::new(read.take(MAX_LINE)).read_line(&mut line).await {
        tracing::debug!(%err, "control: unreadable request");
        return;
    }
    let (method, response) = match serde_json::from_str::<ControlRequest>(&line) {
        Ok(req) => {
            let res = dispatch(ctl, &req.method, req.args).await;
            (req.method, res)
        }
        Err(err) => (String::new(), Err(AppError::Invalid(err.to_string()))),
    };
    let response = match response {
        Ok(value) => ControlResponse::Ok(value),
        Err(err) => ControlResponse::Error(IpcError { kind: err.kind(), message: err.plain_message() }),
    };
    let mut out = serde_json::to_vec(&response).unwrap_or_default();
    out.push(b'\n');
    let _ = write.write_all(&out).await;
    let _ = write.flush().await;
    let _ = write.shutdown().await;
    if method == "shutdown" {
        tracing::info!("control: shutdown requested");
        (ctl.on_shutdown)();
    }
}

/// Sends one request and reads the answer.
async fn exchange<S: AsyncRead + AsyncWrite + Unpin>(stream: S, method: &str, args: Value) -> AppResult<Value> {
    let (read, mut write) = tokio::io::split(stream);
    let mut out = serde_json::to_vec(&ControlRequest { method: method.into(), args })?;
    out.push(b'\n');
    write.write_all(&out).await?;
    write.flush().await?;
    let mut line = String::new();
    BufReader::new(read.take(MAX_LINE)).read_line(&mut line).await?;
    if line.trim().is_empty() {
        return Err(AppError::Other(crate::tr!("réponse vide de Neuron", "empty answer from Neuron")));
    }
    match serde_json::from_str::<ControlResponse>(&line)? {
        ControlResponse::Ok(value) => Ok(value),
        ControlResponse::Error(err) => Err(AppError::Other(err.message)),
    }
}

/// Calls `method` on the instance using `data_dir` with a custom timeout. [`AppError::NotRunning`] when none answers.
pub async fn request_with_timeout(data_dir: &Path, method: &str, args: Value, timeout: Duration) -> AppResult<Value> {
    let stream = transport::connect(data_dir).await?;
    tokio::time::timeout(timeout, exchange(stream, method, args))
        .await
        .map_err(|_| AppError::Other(crate::tr!("Neuron ne répond pas", "Neuron is not answering")))?
}

/// Calls `method` on the instance using `data_dir`. [`AppError::NotRunning`] when none answers.
pub async fn request(data_dir: &Path, method: &str, args: Value) -> AppResult<Value> {
    request_with_timeout(data_dir, method, args, CLIENT_TIMEOUT).await
}

/// Same as [`request`], deserialized.
pub async fn call<T: serde::de::DeserializeOwned>(data_dir: &Path, method: &str, args: Value) -> AppResult<T> {
    Ok(serde_json::from_value(request(data_dir, method, args).await?)?)
}

/// The running instance, if any.
pub async fn probe(data_dir: &Path) -> Option<InstanceInfo> {
    let fut = call::<InstanceInfo>(data_dir, "status", Value::Null);
    tokio::time::timeout(Duration::from_secs(3), fut).await.ok()?.ok()
}

/// Desktop app starting while `neuron serve` runs on the same data: the server is asked to stop (agents, endpoint)
/// and the app takes over. Waits up to 8 s for the channel to be free.
pub async fn take_over(data_dir: &Path) {
    let Some(info) = probe(data_dir).await else { return };
    if info.mode != InstanceMode::Serve {
        return;
    }
    tracing::info!(pid = info.pid, "control: stopping `neuron serve` to take over");
    if let Err(err) = request(data_dir, "shutdown", json!({})).await {
        tracing::warn!(%err, "control: `neuron serve` did not accept to stop");
        return;
    }
    for _ in 0..80 {
        if probe(data_dir).await.is_none() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    tracing::warn!("control: `neuron serve` still answers");
}

/// The listener of this instance (bound: no other instance can bind the same data folder).
pub struct Listener(transport::Listener);

/// Binds the channel. [`AppError::AlreadyRunning`] when another instance answers on it.
pub async fn bind(data_dir: &Path) -> AppResult<Listener> {
    match transport::bind(data_dir).await {
        Ok(listener) => Ok(Listener(listener)),
        Err(err) => {
            if probe(data_dir).await.is_some() {
                Err(AppError::AlreadyRunning)
            } else {
                Err(err)
            }
        }
    }
}

/// Serves requests until the process ends.
pub fn spawn(listener: Listener, ctl: Control) {
    let ctl = Arc::new(ctl);
    tauri::async_runtime::spawn(async move {
        if let Err(err) = transport::serve(listener.0, ctl).await {
            tracing::warn!(%err, "control: channel closed");
        }
    });
}

/// Address of the channel, for messages and logs.
pub fn address(data_dir: &Path) -> String {
    transport::address(data_dir)
}

#[cfg(windows)]
mod transport {
    use super::*;
    use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeServer, ServerOptions};

    /// All pipe instances busy: retry for a short while.
    const ERROR_PIPE_BUSY: i32 = 231;

    pub struct Listener {
        name: String,
        first: NamedPipeServer,
    }

    pub fn address(data_dir: &Path) -> String {
        let hash = blake3::hash(data_dir.to_string_lossy().to_lowercase().as_bytes()).to_hex();
        format!(r"\\.\pipe\neuron-{}", &hash.as_str()[..16])
    }

    fn create(name: &str, first: bool) -> std::io::Result<NamedPipeServer> {
        ServerOptions::new().first_pipe_instance(first).reject_remote_clients(true).create(name)
    }

    pub async fn bind(data_dir: &Path) -> AppResult<Listener> {
        let name = address(data_dir);
        let first = create(&name, true)?;
        Ok(Listener { name, first })
    }

    pub async fn serve(listener: Listener, ctl: Arc<Control>) -> AppResult<()> {
        let Listener { name, first } = listener;
        let mut server = first;
        loop {
            server.connect().await?;
            let conn = std::mem::replace(&mut server, create(&name, false)?);
            let ctl = Arc::clone(&ctl);
            tauri::async_runtime::spawn(async move { handle(conn, &ctl).await });
        }
    }

    pub async fn connect(data_dir: &Path) -> AppResult<impl AsyncRead + AsyncWrite + Unpin> {
        let name = address(data_dir);
        for _ in 0..50 {
            match ClientOptions::new().open(&name) {
                Ok(client) => return Ok(client),
                Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) => {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                Err(_) => return Err(AppError::NotRunning),
            }
        }
        Err(AppError::NotRunning)
    }
}

#[cfg(unix)]
mod transport {
    use super::*;
    use tokio::net::{UnixListener, UnixStream};

    pub struct Listener(UnixListener);

    fn socket_path(data_dir: &Path) -> PathBuf {
        data_dir.join("neuron.sock")
    }

    pub fn address(data_dir: &Path) -> String {
        socket_path(data_dir).display().to_string()
    }

    pub async fn bind(data_dir: &Path) -> AppResult<Listener> {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(data_dir)?;
        let path = socket_path(data_dir);
        if path.exists() {
            if UnixStream::connect(&path).await.is_ok() {
                return Err(AppError::AlreadyRunning);
            }
            // Left by an instance that did not stop cleanly: nobody answers on it.
            std::fs::remove_file(&path)?;
        }
        let inner = UnixListener::bind(&path)?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        Ok(Listener(inner))
    }

    pub async fn serve(listener: Listener, ctl: Arc<Control>) -> AppResult<()> {
        loop {
            let (stream, _) = listener.0.accept().await?;
            let ctl = Arc::clone(&ctl);
            tauri::async_runtime::spawn(async move { handle(stream, &ctl).await });
        }
    }

    pub async fn connect(data_dir: &Path) -> AppResult<UnixStream> {
        UnixStream::connect(socket_path(data_dir)).await.map_err(|_| AppError::NotRunning)
    }
}

/// Removes the socket file of a stopping instance (Unix; nothing to do for a named pipe).
pub fn cleanup(data_dir: &Path) {
    #[cfg(unix)]
    let _ = std::fs::remove_file(data_dir.join("neuron.sock"));
    #[cfg(not(unix))]
    let _ = data_dir;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::HeadlessSink;
    use crate::state::{AppPaths, AppState};
    use std::sync::atomic::{AtomicBool, Ordering};

    fn temp_state() -> (PathBuf, Shared) {
        let dir = std::env::temp_dir().join(format!("neuron-control-{}", uuid::Uuid::new_v4().simple()));
        let paths = AppPaths {
            data_dir: dir.clone(),
            db_path: dir.join("neuron.db"),
            neuron_home: dir.join(".neuron"),
            memory_file: dir.join(".neuron").join("memory.md"),
        };
        let state = AppState::open(paths, Arc::new(HeadlessSink), std::time::Instant::now()).unwrap();
        (dir, Arc::new(state))
    }

    #[test]
    fn round_trip_lock_and_shutdown() {
        tauri::async_runtime::block_on(async {
            let (dir, state) = temp_state();
            assert!(matches!(request(&dir, "ping", Value::Null).await, Err(AppError::NotRunning)));

            let stopped = Arc::new(AtomicBool::new(false));
            let flag = Arc::clone(&stopped);
            let listener = bind(&dir).await.unwrap();
            let on_shutdown = Box::new(move || flag.store(true, Ordering::SeqCst));
            spawn(listener, Control { state, mode: InstanceMode::Serve, on_shutdown });

            let info = probe(&dir).await.unwrap();
            assert_eq!(info.mode, InstanceMode::Serve);
            assert_eq!(info.pid, std::process::id());
            // The channel is the instance lock.
            assert!(matches!(bind(&dir).await, Err(AppError::AlreadyRunning)));

            let status: rc::RemoteStatus = call(&dir, "remote_status", Value::Null).await.unwrap();
            assert!(!status.settings.enabled);
            let renamed: rc::RemoteStatus =
                call(&dir, "remote_set_device_name", json!({ "name": " Serveur " })).await.unwrap();
            assert_eq!(renamed.settings.device_name, "Serveur");
            let err = request(&dir, "send_message", json!({})).await.unwrap_err();
            assert!(err.to_string().contains("send_message"));
            assert!(request(&dir, "remote_set_level", json!({})).await.is_err());

            request(&dir, "shutdown", Value::Null).await.unwrap();
            for _ in 0..50 {
                if stopped.load(Ordering::SeqCst) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            assert!(stopped.load(Ordering::SeqCst));
            let _ = std::fs::remove_dir_all(&dir);
        });
    }
}

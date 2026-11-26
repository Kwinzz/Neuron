//! `neuron <command>`: the command line (headless host, remote access settings, status).
//!
//! Intercepted in `main.rs` before Tauri starts, like `--mcp-memory`: only a known subcommand as first argument
//! takes this path ([`args::parse`]); the desktop launches (`--background`, `--quick`, no argument) never do.
//! Every command but `serve` talks to the running instance over the local control channel ([`crate::control`]).

pub mod args;
mod client;
pub mod output;
mod serve;
pub mod service;

use crate::error::AppError;
use crate::state::AppPaths;
use args::Command;

/// Exit code of `neuron serve` when another instance already runs (systemd: `RestartPreventExitStatus`).
pub const EXIT_ALREADY_RUNNING: i32 = 3;

/// Runs the command line if the arguments ask for it; returns the process exit code.
pub fn entry_from_args() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let parsed = args::parse(&args)?;
    console::attach();
    let paths = match AppPaths::resolve() {
        Ok(paths) => paths,
        Err(err) => {
            eprintln!("neuron: {err}");
            return Some(1);
        }
    };
    set_language(&paths);
    let code = match parsed {
        Err(message) => {
            eprintln!("neuron: {message}\n");
            eprintln!("{}", args::help());
            2
        }
        Ok(Command::Version) => {
            println!("neuron {}", env!("CARGO_PKG_VERSION"));
            0
        }
        Ok(Command::Help) => {
            println!("{}", args::help());
            0
        }
        Ok(Command::Serve) => serve::run(paths),
        Ok(Command::Service(cmd)) => service::run(cmd),
        Ok(cmd) => {
            let result = tauri::async_runtime::block_on(client::run(cmd, &paths));
            match result {
                Ok(code) => code,
                Err(err) => {
                    report(&err);
                    1
                }
            }
        }
    };
    Some(code)
}

/// Prints an error, with what to do when no instance runs.
fn report(err: &AppError) {
    eprintln!("neuron: {}", err.plain_message());
    if matches!(err, AppError::NotRunning) {
        eprintln!(
            "{}",
            if cfg!(target_os = "linux") {
                crate::tr!(
                    "→ lance `neuron serve`, ou `neuron service install` pour le démarrer avec la machine, ou ouvre l'application.",
                    "→ run `neuron serve`, or `neuron service install` to start it with the machine, or open the app."
                )
            } else {
                crate::tr!(
                    "→ ouvre l'application Neuron ou lance `neuron serve`.",
                    "→ open the Neuron app or run `neuron serve`."
                )
            }
        );
    }
}

/// Same language as the app (its setting), else the system's.
fn set_language(paths: &AppPaths) {
    let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let saved = rusqlite::Connection::open_with_flags(&paths.db_path, flags)
        .ok()
        .and_then(|conn| crate::app_settings::load(&conn).ok())
        .and_then(|settings| settings.language);
    crate::i18n::set(saved.unwrap_or_else(crate::i18n::detect));
}

mod console {
    /// Windows release builds are GUI programs (no console): writing to the terminal that started the command
    /// needs to attach to it. Skipped when the output is already redirected (`neuron status > file`, pipes).
    #[cfg(windows)]
    pub fn attach() {
        use std::ffi::c_void;
        const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
        const STD_OUTPUT_HANDLE: u32 = 0xFFFF_FFF5; // (DWORD)-11
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn AttachConsole(process_id: u32) -> i32;
            fn GetStdHandle(std_handle: u32) -> *mut c_void;
        }
        // SAFETY: plain Win32 calls, no pointer is passed in; the handle is only compared.
        unsafe {
            let out = GetStdHandle(STD_OUTPUT_HANDLE);
            if out.is_null() || out as isize == -1 {
                AttachConsole(ATTACH_PARENT_PROCESS);
            }
        }
    }

    #[cfg(not(windows))]
    pub fn attach() {}
}

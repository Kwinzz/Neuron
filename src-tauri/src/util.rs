//! Small shared helpers.

use std::time::{SystemTime, UNIX_EPOCH};

/// Current time as Unix milliseconds.
pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX)).unwrap_or(0)
}

pub const HOUR_MS: i64 = 3_600_000;
pub const DAY_MS: i64 = 24 * HOUR_MS;

/// Path of Neuron's own executable, as agents must launch it (memory MCP server). An AppImage runs from a
/// temporary mount that changes at each launch: its stable path is `$APPIMAGE`.
pub fn neuron_exe() -> std::io::Result<std::path::PathBuf> {
    if let Some(appimage) = std::env::var_os("APPIMAGE").filter(|p| !p.is_empty()) {
        return Ok(std::path::PathBuf::from(appimage));
    }
    std::env::current_exe()
}

/// Open a file or folder with the system's default application (Explorer, Finder, file manager).
pub fn open_with_system(path: &std::path::Path) -> std::io::Result<()> {
    open_target(path.as_os_str())
}

/// Open a web/mail URL with the system's default handler (browser / mail client).
pub fn open_url(url: &str) -> std::io::Result<()> {
    open_target(std::ffi::OsStr::new(url))
}

#[cfg(windows)]
fn to_wide_nul(target: &std::ffi::OsStr) -> std::io::Result<Vec<u16>> {
    use std::os::windows::ffi::OsStrExt;
    let mut wide: Vec<u16> = target.encode_wide().collect();
    if wide.contains(&0) {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "target contains NUL byte"));
    }
    wide.push(0);
    Ok(wide)
}

/// On Windows, `explorer.exe` misparses URLs containing characters such as `:`, `...`, `?`, `=` or `&` and falls
/// back to opening a File Explorer window. `ShellExecuteW` hands both URLs and local paths directly to the Shell
/// without command-line parsing or a console window.
#[cfg(windows)]
fn open_target(target: &std::ffi::OsStr) -> std::io::Result<()> {
    use core::ffi::c_void;
    use std::ptr;

    #[link(name = "ole32")]
    unsafe extern "system" {
        fn CoInitializeEx(pv_reserved: *const c_void, dw_co_init: u32) -> i32;
        fn CoUninitialize();
    }

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: isize,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show_cmd: i32,
        ) -> isize;
    }

    const COINIT_APARTMENTTHREADED: u32 = 0x2;
    const COINIT_DISABLE_OLE1DDE: u32 = 0x4;
    const SW_SHOWNORMAL: i32 = 1;

    let wide = to_wide_nul(target)?;
    // Run on a short-lived STA thread so we never alter the COM apartment mode of a Tokio worker thread.
    std::thread::spawn(move || {
        let op: Vec<u16> = "open\0".encode_utf16().collect();
        // Safety: FFI calls with valid NUL-terminated UTF-16 buffers; CoUninitialize runs only if CoInitializeEx succeeded.
        unsafe {
            let hr = CoInitializeEx(ptr::null(), COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
            let res = ShellExecuteW(0, op.as_ptr(), wide.as_ptr(), ptr::null(), ptr::null(), SW_SHOWNORMAL);
            if hr >= 0 {
                CoUninitialize();
            }
            if res > 32 {
                Ok(())
            } else {
                Err(std::io::Error::other(format!("ShellExecuteW failed (code {res})")))
            }
        }
    })
    .join()
    .map_err(|_| std::io::Error::other("ShellExecuteW worker panicked"))?
}

#[cfg(not(windows))]
fn open_target(target: &std::ffi::OsStr) -> std::io::Result<()> {
    let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    std::process::Command::new(opener).arg(target).spawn().map(|_| ())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn wide_nul_preserves_complex_urls_and_rejects_interior_nul() {
        let url = "https://github.com/Kwinzz/Neuron/compare/main...FoxCraft67:Neuron:fix/composer-resize?expand=1&foo=bar#top";
        let wide = to_wide_nul(std::ffi::OsStr::new(url)).unwrap();
        assert_eq!(wide.last(), Some(&0));
        assert_eq!(String::from_utf16(&wide[..wide.len() - 1]).unwrap(), url);

        let with_nul = std::ffi::OsStr::new("https://example.com/\0bad");
        assert!(to_wide_nul(with_nul).is_err());
    }
}

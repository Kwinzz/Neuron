//! `neuron --cli-path add|remove` (Windows, run by the installer): puts `<install>\bin` (which holds the `neuron.cmd`
//! shim) in the user's PATH, or takes it out. Done here rather than in NSIS, whose 1024-character strings would
//! truncate a long PATH.

/// `current` (a `;`-separated PATH) with `dir` added at the end or removed; `None` when nothing changes.
/// Entries compare without case nor trailing backslash.
pub fn edit_path(current: &str, dir: &str, add: bool) -> Option<String> {
    let norm = |s: &str| s.trim().trim_end_matches(['\\', '/']).to_lowercase();
    let target = norm(dir);
    let entries: Vec<&str> = current.split(';').filter(|e| !e.trim().is_empty()).collect();
    let present = entries.iter().any(|e| norm(e) == target);
    match (add, present) {
        (true, true) | (false, false) => None,
        (true, false) => {
            let mut next = entries;
            next.push(dir);
            Some(next.join(";"))
        }
        (false, true) => Some(entries.into_iter().filter(|e| norm(e) != target).collect::<Vec<_>>().join(";")),
    }
}

pub fn run(add: bool) -> i32 {
    match apply(add) {
        Ok(()) => 0,
        Err(err) => {
            eprintln!("neuron: {err}");
            1
        }
    }
}

#[cfg(windows)]
fn apply(add: bool) -> std::io::Result<()> {
    use std::borrow::Cow;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, RegType};
    use winreg::{RegKey, RegValue};

    let exe = crate::util::neuron_exe()?;
    let Some(bin) = exe.parent().map(|d| d.join("bin")) else { return Ok(()) };
    let bin = bin.display().to_string();
    let env = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags("Environment", KEY_READ | KEY_WRITE)?;
    // Raw value: keeps REG_EXPAND_SZ (entries like %USERPROFILE%\…) as it is.
    let (current, vtype) = match env.get_raw_value("Path") {
        Ok(raw) => {
            let units: Vec<u16> = raw.bytes.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect();
            let text = String::from_utf16_lossy(&units).trim_end_matches('\0').to_string();
            (text, raw.vtype)
        }
        Err(_) => (String::new(), RegType::REG_EXPAND_SZ),
    };
    let Some(next) = edit_path(&current, &bin, add) else { return Ok(()) };
    let bytes: Vec<u8> = next.encode_utf16().chain(std::iter::once(0)).flat_map(u16::to_le_bytes).collect();
    env.set_raw_value("Path", &RegValue { bytes: Cow::Owned(bytes), vtype })?;
    broadcast_environment_change();
    Ok(())
}

/// Tells Explorer (and the terminals it starts from now on) that the environment changed.
#[cfg(windows)]
fn broadcast_environment_change() {
    const HWND_BROADCAST: isize = 0xffff;
    const WM_SETTINGCHANGE: u32 = 0x001A;
    const SMTO_ABORTIFHUNG: u32 = 0x0002;
    #[link(name = "user32")]
    unsafe extern "system" {
        fn SendMessageTimeoutW(
            hwnd: isize,
            msg: u32,
            wparam: usize,
            lparam: isize,
            flags: u32,
            timeout_ms: u32,
            result: *mut usize,
        ) -> isize;
    }
    let what: Vec<u16> = "Environment".encode_utf16().chain(std::iter::once(0)).collect();
    let mut result = 0usize;
    // SAFETY: `what` is a NUL-terminated UTF-16 string alive for the whole (synchronous, bounded) call; `result`
    // is a valid out pointer.
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            what.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            2000,
            &mut result,
        );
    }
}

#[cfg(not(windows))]
fn apply(_add: bool) -> std::io::Result<()> {
    Err(std::io::Error::other(crate::tr!(
        "réservé à Windows (ailleurs, le paquet installe déjà la commande neuron)",
        "Windows only (elsewhere, the package already installs the neuron command)"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_once_and_removes_every_spelling() {
        let dir = r"C:\Program Files\Neuron\bin";
        assert_eq!(edit_path("", dir, true).as_deref(), Some(dir));
        assert_eq!(edit_path(r"C:\a;%USERPROFILE%\b;", dir, true).unwrap(), format!(r"C:\a;%USERPROFILE%\b;{dir}"));
        assert_eq!(edit_path(r"c:\program files\neuron\bin\;C:\a", dir, true), None);
        assert_eq!(edit_path(r"C:\a;C:\PROGRAM FILES\Neuron\bin;C:\b", dir, false).unwrap(), r"C:\a;C:\b");
        assert_eq!(edit_path(r"C:\a", dir, false), None);
    }
}

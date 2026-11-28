//! `neuron service install|uninstall|restart|status`: `neuron serve` as a systemd user service (Linux), restarted if
//! it stops and started at boot without an open session (linger).

use std::path::PathBuf;
use std::process::Command;

use super::EXIT_ALREADY_RUNNING;

const UNIT: &str = "neuron.service";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceCmd {
    Install,
    Uninstall,
    Restart,
    Status,
}

pub fn run(cmd: ServiceCmd) -> i32 {
    if !cfg!(target_os = "linux") {
        eprintln!(
            "neuron: {}",
            crate::tr!(
                "le service n'existe que sous Linux (systemd). Ailleurs, ouvre l'application ou lance `neuron serve`.",
                "the service only exists on Linux (systemd). Elsewhere, open the app or run `neuron serve`."
            )
        );
        return 1;
    }
    match cmd {
        ServiceCmd::Install => install(),
        ServiceCmd::Uninstall => uninstall(),
        ServiceCmd::Restart => restart(),
        ServiceCmd::Status => systemctl(&["status", UNIT, "--no-pager"]).unwrap_or(1),
    }
}

/// Text of the unit. Exit code 3 (another instance runs, e.g. the desktop app took over) is not restarted.
pub fn unit_file(exe: &str) -> String {
    let exe = exe.replace('\\', "\\\\").replace('"', "\\\"");
    format!(
        "[Unit]
Description=Neuron (headless host for AI agent CLIs)

[Service]
ExecStart=\"{exe}\" serve
Restart=always
RestartSec=3
RestartPreventExitStatus={EXIT_ALREADY_RUNNING}

[Install]
WantedBy=default.target
"
    )
}

fn unit_path() -> Option<PathBuf> {
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".config")))?;
    Some(config.join("systemd").join("user").join(UNIT))
}

/// Runs `systemctl --user …` in this terminal; its exit code (`None` if it could not start).
fn systemctl(args: &[&str]) -> Option<i32> {
    let status = Command::new("systemctl").arg("--user").args(args).status().ok()?;
    Some(status.code().unwrap_or(1))
}

fn install() -> i32 {
    let exe = match crate::util::neuron_exe() {
        Ok(exe) => exe,
        Err(err) => {
            eprintln!("neuron: {err}");
            return 1;
        }
    };
    let Some(path) = unit_path() else {
        eprintln!("neuron: {}", crate::tr!("dossier personnel introuvable", "home directory not found"));
        return 1;
    };
    let written = path
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| std::fs::write(&path, unit_file(&exe.display().to_string())));
    if let Err(err) = written {
        eprintln!("neuron: {}: {err}", path.display());
        return 1;
    }
    println!("{}", crate::tr!("✓ Service écrit : {}", "✓ Service written: {}", path.display()));

    if systemctl(&["daemon-reload"]) != Some(0) || systemctl(&["enable", "--now", UNIT]) != Some(0) {
        eprintln!(
            "{}",
            crate::tr!(
                "systemd utilisateur indisponible ? Essaie : systemctl --user enable --now neuron",
                "user systemd not available? Try: systemctl --user enable --now neuron"
            )
        );
        return 1;
    }
    println!("{}", crate::tr!("✓ Service activé et démarré.", "✓ Service enabled and started."));

    // Linger: the user's services start at boot and keep running after logging out (SSH, VPS).
    let user = std::env::var("USER").unwrap_or_default();
    let linger = Command::new("loginctl").arg("enable-linger").arg(&user).status();
    if linger.is_ok_and(|s| s.success()) {
        println!(
            "{}",
            crate::tr!(
                "✓ Démarre avec la machine, même sans session ouverte.",
                "✓ Starts with the machine, even without an open session."
            )
        );
    } else {
        eprintln!(
            "{}",
            crate::tr!(
                "! Démarrage sans session non activé : sudo loginctl enable-linger {user}",
                "! Start without a session not enabled: sudo loginctl enable-linger {user}"
            )
        );
    }
    println!(
        "{}",
        crate::tr!(
            "Ensuite : `neuron remote enable --internet` puis `neuron remote code`. Journaux : journalctl --user -u neuron -f",
            "Next: `neuron remote enable --internet` then `neuron remote code`. Logs: journalctl --user -u neuron -f"
        )
    );
    0
}

fn restart() -> i32 {
    match systemctl(&["restart", UNIT]) {
        Some(0) => {
            println!("{}", crate::tr!("✓ Service redémarré.", "✓ Service restarted."));
            0
        }
        Some(code) => code,
        None => {
            eprintln!("neuron: {}", crate::tr!("systemctl introuvable", "systemctl not found"));
            1
        }
    }
}

fn uninstall() -> i32 {
    let _ = systemctl(&["disable", "--now", UNIT]);
    if let Some(path) = unit_path().filter(|p| p.exists()) {
        if let Err(err) = std::fs::remove_file(&path) {
            eprintln!("neuron: {}: {err}", path.display());
            return 1;
        }
    }
    let _ = systemctl(&["daemon-reload"]);
    println!(
        "{}",
        crate::tr!(
            "✓ Service retiré (Neuron ne démarre plus avec la machine).",
            "✓ Service removed (Neuron no longer starts with the machine)."
        )
    );
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_runs_serve_and_does_not_fight_the_app() {
        let unit = unit_file("/usr/bin/neuron");
        assert!(unit.contains("ExecStart=\"/usr/bin/neuron\" serve\n"));
        assert!(unit.contains("Restart=always\n"));
        assert!(unit.contains("RestartPreventExitStatus=3\n"));
        assert!(unit.contains("WantedBy=default.target\n"));
        assert!(unit_file("/opt/My \"App\"/neuron").contains(r#"ExecStart="/opt/My \"App\"/neuron" serve"#));
    }
}

//! `neuron update [--check] [--yes]`: latest version from GitHub, installed after confirmation.

use std::io::Write;
use std::path::Path;

use crate::control::{self, InstanceMode};
use crate::error::AppResult;
use crate::update;

pub async fn run(data_dir: &Path, check_only: bool, yes: bool) -> AppResult<i32> {
    let info = update::fetch_latest().await?;
    if !info.available {
        println!("{}", crate::tr!("Neuron {} est à jour.", "Neuron {} is up to date.", info.current));
        return Ok(0);
    }
    println!(
        "{}",
        crate::tr!(
            "Nouvelle version : {} (installée : {}) — {}",
            "New version: {} (installed: {}) — {}",
            info.latest,
            info.current,
            info.page_url
        )
    );
    if check_only {
        return Ok(0);
    }
    if !yes && !confirm(&crate::tr!("Installer {} maintenant ? [O/n] ", "Install {} now? [Y/n] ", info.latest)) {
        println!("{}", crate::tr!("Rien n'a été modifié.", "Nothing was changed."));
        return Ok(1);
    }

    if cfg!(windows) {
        let path = update::download_installer(&info, |p| {
            match p.total.filter(|t| *t > 0) {
                Some(total) => {
                    print!("\r{} {} %   ", crate::tr!("Téléchargement…", "Downloading…"), p.downloaded * 100 / total)
                }
                None => {
                    print!("\r{} {} Mo   ", crate::tr!("Téléchargement…", "Downloading…"), p.downloaded / 1_048_576)
                }
            }
            let _ = std::io::stdout().flush();
        })
        .await?;
        println!();
        // The app reopens after the update if it was open (the installer closes it).
        let app_running = control::probe(data_dir).await.is_some_and(|i| i.mode == InstanceMode::App);
        update::record_pending(data_dir, &info.latest);
        if let Err(err) = update::launch_installer(&path, app_running).await {
            update::clear_pending(data_dir);
            return Err(err);
        }
        println!(
            "{}",
            crate::tr!(
                "Installateur lancé (autorisation administrateur demandée) : Neuron {} sera installé dans un instant.",
                "Installer started (administrator permission asked): Neuron {} will be installed in a moment.",
                info.latest
            )
        );
        return Ok(0);
    }
    if cfg!(target_os = "linux") {
        return Ok(run_in_terminal(&update::linux_update_command()));
    }
    println!("{}", crate::tr!("Télécharge-la ici : {}", "Download it here: {}", info.page_url));
    Ok(0)
}

fn confirm(question: &str) -> bool {
    print!("{question}");
    let _ = std::io::stdout().flush();
    let mut answer = String::new();
    if std::io::stdin().read_line(&mut answer).is_err() {
        return false;
    }
    let answer = answer.trim().to_lowercase();
    answer.is_empty() || ["o", "oui", "y", "yes"].contains(&answer.as_str())
}

/// Linux: becomes `bash -c <command>` in this terminal. `exec` (not a child): `install.sh` stops every running
/// `neuron` process, this one included, before installing.
#[cfg(unix)]
fn run_in_terminal(command: &str) -> i32 {
    use std::os::unix::process::CommandExt;
    let err = std::process::Command::new("bash").arg("-c").arg(command).exec();
    eprintln!("neuron: bash: {err}");
    1
}

#[cfg(not(unix))]
fn run_in_terminal(command: &str) -> i32 {
    match std::process::Command::new("bash").arg("-c").arg(command).status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(err) => {
            eprintln!("neuron: bash: {err}");
            1
        }
    }
}

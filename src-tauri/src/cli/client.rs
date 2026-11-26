//! Commands that talk to the running instance over the control channel.

use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use serde_json::{Value, json};

use super::args::{Command, RemoteCmd};
use super::output::{self, ago, on_off, short_id, table};
use crate::agents::access::AgentAccess;
use crate::commands::remote::{RemoteDevices, RemoteStatus};
use crate::control::{self, InstanceMode};
use crate::error::{AppError, AppResult};

pub async fn run(cmd: Command, paths: &crate::state::AppPaths) -> AppResult<i32> {
    let dir = paths.data_dir.as_path();
    match cmd {
        Command::Status => status(dir).await,
        Command::Remote(cmd) => remote(dir, cmd).await,
        Command::Serve | Command::Service(_) | Command::Version | Command::Help => Ok(0),
    }
}

async fn status(dir: &Path) -> AppResult<i32> {
    let Some(info) = control::probe(dir).await else {
        println!("{}", crate::tr!("Neuron {} — arrêté", "Neuron {} — not running", env!("CARGO_PKG_VERSION")));
        return Err(AppError::NotRunning);
    };
    let remote: RemoteStatus = control::call(dir, "remote_status", Value::Null).await?;
    let devices: RemoteDevices = control::call(dir, "remote_devices", Value::Null).await?;
    let agents: Vec<AgentAccess> = control::call(dir, "agent_access", Value::Null).await?;

    let mode = match info.mode {
        InstanceMode::App => crate::tr!("application", "app"),
        InstanceMode::Serve => crate::tr!("serveur (`neuron serve`)", "server (`neuron serve`)"),
    };
    println!(
        "{}",
        crate::tr!("Neuron {} — actif : {mode}, pid {}", "Neuron {} — running: {mode}, pid {}", info.version, info.pid)
    );
    println!("{}", crate::tr!("Données : {}", "Data: {}", info.data_dir));
    println!();
    print_remote(&remote);
    let connected = devices.clients.iter().filter(|c| c.connected).count();
    println!(
        "{}",
        crate::tr!(
            "Appareils : {} peuvent piloter celui-ci ({connected} connectés), {} pilotés",
            "Devices: {} may control this one ({connected} connected), {} controlled",
            devices.clients.len(),
            devices.hosts.len()
        )
    );
    println!();
    println!("{}", crate::tr!("Agents :", "Agents:"));
    let rows: Vec<Vec<String>> = agents
        .iter()
        .filter(|a| a.agent != crate::agents::events::AgentKind::Generic)
        .map(|a| {
            let installed = if a.installed {
                a.version.clone().unwrap_or_else(|| crate::tr!("installé", "installed"))
            } else {
                crate::tr!("non installé", "not installed")
            };
            let login = match (a.installed, a.logged_in) {
                (false, _) => String::new(),
                (true, Some(true)) => match &a.account {
                    Some(acc) => crate::tr!("connecté ({acc})", "signed in ({acc})"),
                    None => crate::tr!("connecté", "signed in"),
                },
                (true, Some(false)) => crate::tr!("non connecté", "not signed in"),
                (true, None) => "?".into(),
            };
            vec![format!("  {}", a.label), installed, login]
        })
        .collect();
    print!("{}", table(&rows));
    Ok(0)
}

fn print_remote(status: &RemoteStatus) {
    let s = &status.settings;
    println!("{}", crate::tr!("Appareil : {}", "Device: {}", s.device_name));
    if let Some(id) = &status.node_id {
        println!("{}", crate::tr!("Identifiant : {id}", "Id: {id}"));
    }
    let port = status.port.map(|p| crate::tr!(" · port UDP {p}", " · UDP port {p}")).unwrap_or_default();
    println!(
        "{}",
        crate::tr!(
            "Accès depuis d'autres appareils : {} · hors réseau local : {}{port}",
            "Access from other devices: {} · outside the local network: {}{port}",
            on_off(s.enabled),
            on_off(s.internet)
        )
    );
}

async fn remote(dir: &Path, cmd: RemoteCmd) -> AppResult<i32> {
    match cmd {
        RemoteCmd::Enable { internet } => {
            let mut status: RemoteStatus = control::call(dir, "remote_set_enabled", json!({ "enabled": true })).await?;
            if internet {
                status = control::call(dir, "remote_set_internet", json!({ "enabled": true })).await?;
            }
            print_remote(&status);
            println!(
                "{}",
                crate::tr!(
                    "→ `neuron remote code` pour appairer un appareil.",
                    "→ `neuron remote code` to pair a device."
                )
            );
        }
        RemoteCmd::Disable => {
            let status: RemoteStatus = control::call(dir, "remote_set_enabled", json!({ "enabled": false })).await?;
            print_remote(&status);
        }
        RemoteCmd::Internet(on) => {
            let status: RemoteStatus = control::call(dir, "remote_set_internet", json!({ "enabled": on })).await?;
            print_remote(&status);
        }
        RemoteCmd::Name(name) => {
            let status: RemoteStatus = control::call(dir, "remote_set_device_name", json!({ "name": name })).await?;
            print_remote(&status);
        }
        RemoteCmd::Code => return pair(dir).await,
        RemoteCmd::Devices => devices(dir).await?,
        RemoteCmd::Level { device, level } => {
            let list: RemoteDevices = control::call(dir, "remote_devices", Value::Null).await?;
            let (id, name) = find(&list.clients, &device, |c| (&c.node_id, &c.name))?;
            let args = json!({ "nodeId": id, "level": level });
            control::request(dir, "remote_set_level", args).await?;
            println!("{}", crate::tr!("{name} : {}", "{name}: {}", output::level(level)));
        }
        RemoteCmd::Revoke { device } => {
            let list: RemoteDevices = control::call(dir, "remote_devices", Value::Null).await?;
            let (id, name) = find(&list.clients, &device, |c| (&c.node_id, &c.name))?;
            control::request(dir, "remote_revoke", json!({ "nodeId": id })).await?;
            println!(
                "{}",
                crate::tr!("{name} ne peut plus piloter cet appareil.", "{name} can no longer control this device.")
            );
        }
        RemoteCmd::Forget { device } => {
            let list: RemoteDevices = control::call(dir, "remote_devices", Value::Null).await?;
            let (id, name) = find(&list.hosts, &device, |h| (&h.node_id, &h.name))?;
            control::request(dir, "remote_forget", json!({ "nodeId": id })).await?;
            println!(
                "{}",
                crate::tr!(
                    "{name} n'est plus piloté depuis cet appareil.",
                    "{name} is no longer controlled from this device."
                )
            );
        }
    }
    Ok(0)
}

async fn devices(dir: &Path) -> AppResult<()> {
    let list: RemoteDevices = control::call(dir, "remote_devices", Value::Null).await?;
    let state = |connected: bool| {
        if connected { crate::tr!("connecté", "connected") } else { crate::tr!("hors ligne", "offline") }
    };
    println!("{}", crate::tr!("Peuvent piloter cet appareil :", "May control this device:"));
    if list.clients.is_empty() {
        println!("  {}", crate::tr!("aucun", "none"));
    } else {
        let rows: Vec<Vec<String>> = list
            .clients
            .iter()
            .map(|c| {
                let seen = crate::tr!("vu {}", "seen {}", ago(c.last_seen));
                vec![
                    format!("  {}", c.name),
                    short_id(&c.node_id).into(),
                    output::level(c.level),
                    state(c.connected),
                    seen,
                ]
            })
            .collect();
        print!("{}", table(&rows));
    }
    println!("{}", crate::tr!("Pilotés depuis cet appareil :", "Controlled from this device:"));
    if list.hosts.is_empty() {
        println!("  {}", crate::tr!("aucun", "none"));
    } else {
        let rows: Vec<Vec<String>> = list
            .hosts
            .iter()
            .map(|h| {
                let seen = crate::tr!("vu {}", "seen {}", ago(h.last_seen));
                vec![format!("  {}", h.name), short_id(&h.node_id).into(), state(h.connected), seen]
            })
            .collect();
        print!("{}", table(&rows));
    }
    Ok(())
}

/// Opens the pairing window, shows the code and waits for a device to pair (or the window to close).
async fn pair(dir: &Path) -> AppResult<i32> {
    let status: RemoteStatus = control::call(dir, "remote_status", Value::Null).await?;
    if !status.settings.enabled {
        return Err(AppError::Invalid(crate::tr!(
            "l'accès depuis d'autres appareils est désactivé : `neuron remote enable` d'abord",
            "access from other devices is off: run `neuron remote enable` first"
        )));
    }
    let before: RemoteDevices = control::call(dir, "remote_devices", Value::Null).await?;
    let known: HashSet<String> = before.clients.into_iter().map(|c| c.node_id).collect();
    let code: crate::remote::pairing::PairingCode = control::call(dir, "remote_start_pairing", Value::Null).await?;
    let minutes = crate::remote::pairing::CODE_TTL_MS / 60_000;
    println!("{}", crate::tr!("Code d'appairage : {}", "Pairing code: {}", output::spaced_code(&code.code)));
    println!(
        "{}",
        crate::tr!(
            "Sur l'autre appareil : Paramètres → Appareils → Ajouter un appareil, puis saisis ce code ({minutes} min, 3 essais).",
            "On the other device: Settings → Devices → Add a device, then type this code ({minutes} min, 3 attempts)."
        )
    );
    // Internet mode: the invitation lets a device outside the local network pair (same window, same code).
    if let Some(invite) = control::call::<RemoteStatus>(dir, "remote_status", Value::Null).await?.invite {
        println!(
            "{}",
            crate::tr!(
                "Hors du réseau local : Paramètres → Appareils → « Appairer avec une invitation », puis colle :",
                "Outside the local network: Settings → Devices → “Pair with an invitation”, then paste:"
            )
        );
        println!("  {invite}");
    }
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                let _ = control::request(dir, "remote_cancel_pairing", Value::Null).await;
                println!("{}", crate::tr!("Appairage annulé.", "Pairing cancelled."));
                return Ok(130);
            }
            _ = tokio::time::sleep(Duration::from_secs(1)) => {}
        }
        let devices: RemoteDevices = control::call(dir, "remote_devices", Value::Null).await?;
        if let Some(new) = devices.clients.iter().find(|c| !known.contains(&c.node_id)) {
            println!(
                "{}",
                crate::tr!(
                    "✓ {} appairé : il peut piloter cet appareil.",
                    "✓ {} paired: it can control this device.",
                    new.name
                )
            );
            return Ok(0);
        }
        let status: RemoteStatus = control::call(dir, "remote_status", Value::Null).await?;
        if status.pairing.as_ref().map(|p| &p.code) != Some(&code.code) {
            println!(
                "{}",
                crate::tr!(
                    "Code expiré ou trop d'essais : `neuron remote code` pour recommencer.",
                    "Code expired or too many attempts: `neuron remote code` to try again."
                )
            );
            return Ok(1);
        }
    }
}

/// The device a user means: same id or name, else the only one whose id or name starts with `query` (any case).
fn find<'a, T>(
    items: &'a [T],
    query: &str,
    key: impl Fn(&'a T) -> (&'a String, &'a String),
) -> AppResult<(&'a str, &'a str)> {
    let q = query.trim().to_lowercase();
    let pairs: Vec<(&str, &str)> = items.iter().map(key).map(|(id, name)| (id.as_str(), name.as_str())).collect();
    let exact: Vec<_> = pairs.iter().filter(|(id, name)| id.to_lowercase() == q || name.to_lowercase() == q).collect();
    let matches: Vec<_> = if exact.len() == 1 {
        exact
    } else {
        pairs
            .iter()
            .filter(|(id, name)| id.to_lowercase().starts_with(&q) || name.to_lowercase().starts_with(&q))
            .collect()
    };
    match matches.as_slice() {
        [one] => Ok(**one),
        [] => Err(AppError::NotFound(crate::tr!(
            "aucun appareil appairé ne correspond à « {query} » (`neuron remote devices`)",
            "no paired device matches “{query}” (`neuron remote devices`)"
        ))),
        many => {
            let names: Vec<String> = many.iter().map(|(id, name)| format!("{name} ({})", short_id(id))).collect();
            Err(AppError::Invalid(crate::tr!(
                "« {query} » désigne plusieurs appareils : {}",
                "“{query}” matches several devices: {}",
                names.join(", ")
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(id: &str, name: &str) -> (String, String) {
        (id.to_string(), name.to_string())
    }

    fn key(x: &(String, String)) -> (&String, &String) {
        (&x.0, &x.1)
    }

    #[test]
    fn device_by_prefix_of_name_or_id() {
        let list = vec![d("ab12ff", "Laptop"), d("cd34ee", "Lab server"), d("ef56dd", "VPS")];
        assert_eq!(find(&list, "vps", key).unwrap(), ("ef56dd", "VPS"));
        assert_eq!(find(&list, "cd3", key).unwrap(), ("cd34ee", "Lab server"));
        assert_eq!(find(&list, "Lapt", key).unwrap(), ("ab12ff", "Laptop"));
        assert!(matches!(find(&list, "la", key), Err(AppError::Invalid(_))));
        assert!(matches!(find(&list, "zz", key), Err(AppError::NotFound(_))));
        // An exact name wins over longer names that start with it.
        let list = vec![d("1", "PC"), d("2", "PC portable")];
        assert_eq!(find(&list, "pc", key).unwrap(), ("1", "PC"));
    }
}

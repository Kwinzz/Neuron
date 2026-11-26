//! Command line of `neuron` (hand-parsed: a handful of subcommands, no dependency).

use super::service::ServiceCmd;
use crate::db::remote::AccessLevel;

#[derive(Debug, Clone, PartialEq)]
pub enum Command {
    /// Run the host without a window (agents, remote endpoint, control channel).
    Serve,
    Status,
    Remote(RemoteCmd),
    /// systemd user service (Linux).
    Service(ServiceCmd),
    /// `--cli-path add|remove` (Windows installer): `neuron` in the user's PATH.
    CliPath {
        add: bool,
    },
    Version,
    Help,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RemoteCmd {
    Enable { internet: bool },
    Disable,
    Internet(bool),
    Name(String),
    Code,
    Devices,
    Level { device: String, level: AccessLevel },
    Revoke { device: String },
    Forget { device: String },
}

/// `None`: not a command line invocation (the desktop app starts: no argument, `--background`, `--quick`…).
/// `Some(Err(message))`: a known subcommand used the wrong way.
pub fn parse(args: &[String]) -> Option<Result<Command, String>> {
    let first = args.first()?.as_str();
    let rest = &args[1..];
    let cmd = match first {
        "serve" => no_more(rest).map(|()| Command::Serve),
        "status" => no_more(rest).map(|()| Command::Status),
        "version" | "--version" | "-V" => Ok(Command::Version),
        "--cli-path" => match rest {
            [v] if v == "add" => Ok(Command::CliPath { add: true }),
            [v] if v == "remove" => Ok(Command::CliPath { add: false }),
            _ => Err("usage: neuron --cli-path add|remove".to_string()),
        },
        "help" | "--help" | "-h" => Ok(Command::Help),
        "remote" => parse_remote(rest).map(Command::Remote),
        "service" => match rest {
            [sub] if sub == "install" => Ok(Command::Service(ServiceCmd::Install)),
            [sub] if sub == "uninstall" => Ok(Command::Service(ServiceCmd::Uninstall)),
            [sub] if sub == "status" => Ok(Command::Service(ServiceCmd::Status)),
            _ => Err(crate::tr!(
                "usage : neuron service install|uninstall|status",
                "usage: neuron service install|uninstall|status"
            )),
        },
        _ => return None,
    };
    Some(cmd)
}

fn no_more(rest: &[String]) -> Result<(), String> {
    match rest.first() {
        None => Ok(()),
        Some(extra) => Err(crate::tr!("argument inattendu : {extra}", "unexpected argument: {extra}")),
    }
}

fn parse_remote(args: &[String]) -> Result<RemoteCmd, String> {
    let Some(sub) = args.first() else {
        return Err(crate::tr!("sous-commande manquante après « remote »", "missing subcommand after “remote”"));
    };
    let rest = &args[1..];
    let device = || -> Result<String, String> {
        let name = rest.join(" ");
        if name.trim().is_empty() {
            Err(crate::tr!("appareil manquant (nom ou identifiant)", "missing device (name or id)"))
        } else {
            Ok(name.trim().to_string())
        }
    };
    match sub.as_str() {
        "enable" => match rest {
            [] => Ok(RemoteCmd::Enable { internet: false }),
            [flag] if flag == "--internet" => Ok(RemoteCmd::Enable { internet: true }),
            [extra, ..] => Err(crate::tr!("argument inattendu : {extra}", "unexpected argument: {extra}")),
        },
        "disable" => no_more(rest).map(|()| RemoteCmd::Disable),
        "internet" => match rest {
            [v] if v == "on" => Ok(RemoteCmd::Internet(true)),
            [v] if v == "off" => Ok(RemoteCmd::Internet(false)),
            _ => Err(crate::tr!("usage : neuron remote internet on|off", "usage: neuron remote internet on|off")),
        },
        "name" => {
            let name = rest.join(" ");
            if name.trim().is_empty() {
                Err(crate::tr!("usage : neuron remote name <nom>", "usage: neuron remote name <name>"))
            } else {
                Ok(RemoteCmd::Name(name.trim().to_string()))
            }
        }
        "code" | "pair" => no_more(rest).map(|()| RemoteCmd::Code),
        "devices" | "list" => no_more(rest).map(|()| RemoteCmd::Devices),
        "level" => {
            let usage = || {
                crate::tr!(
                    "usage : neuron remote level <appareil> read|chat|full",
                    "usage: neuron remote level <device> read|chat|full"
                )
            };
            let (Some(level), true) = (rest.last(), rest.len() >= 2) else { return Err(usage()) };
            let level = parse_level(level).ok_or_else(usage)?;
            Ok(RemoteCmd::Level { device: rest[..rest.len() - 1].join(" "), level })
        }
        "revoke" => device().map(|device| RemoteCmd::Revoke { device }),
        "forget" => device().map(|device| RemoteCmd::Forget { device }),
        other => Err(crate::tr!("sous-commande inconnue : remote {other}", "unknown subcommand: remote {other}")),
    }
}

/// `read|chat|full` (or the French words of the app).
pub fn parse_level(value: &str) -> Option<AccessLevel> {
    match value.to_lowercase().as_str() {
        "read" | "lecture" => Some(AccessLevel::Read),
        "chat" | "discuter" => Some(AccessLevel::Chat),
        "full" | "complet" => Some(AccessLevel::Full),
        _ => None,
    }
}

pub fn help() -> String {
    let version = env!("CARGO_PKG_VERSION");
    crate::tr!(
        "Neuron {version} — poste de pilotage des agents IA en ligne de commande

Usage : neuron <commande>

  serve                           héberge Neuron sans fenêtre (serveur, VPS)
  status                          instance active, appareil, accès, agents installés
  remote enable [--internet]      autorise d'autres appareils à piloter celui-ci
  remote disable                  n'autorise plus aucun appareil
  remote internet on|off          accessible hors du réseau local (relais publics)
  remote name <nom>               nom montré aux autres appareils
  remote code                     ouvre l'appairage : code à saisir sur l'autre appareil
  remote devices                  appareils appairés
  remote level <appareil> read|chat|full
  remote revoke <appareil>        retire l'accès d'un appareil
  remote forget <appareil>        cesse de piloter un appareil
  service install|uninstall|status   service systemd : démarre avec la machine (Linux)
  version | help

Un appareil se désigne par le début de son nom ou de son identifiant.
Sans argument, Neuron ouvre l'application.",
        "Neuron {version} — cockpit for command line AI agents

Usage: neuron <command>

  serve                           host Neuron without a window (server, VPS)
  status                          running instance, device, access, installed agents
  remote enable [--internet]      let other devices control this one
  remote disable                  no device may control this one anymore
  remote internet on|off          reachable outside the local network (public relays)
  remote name <name>              name shown to the other devices
  remote code                     open pairing: the code to type on the other device
  remote devices                  paired devices
  remote level <device> read|chat|full
  remote revoke <device>          remove a device's access
  remote forget <device>          stop controlling a device
  service install|uninstall|status   systemd service: starts with the machine (Linux)
  version | help

A device is named by the start of its name or id.
Without arguments, Neuron opens the app."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(line: &str) -> Option<Result<Command, String>> {
        let args: Vec<String> = line.split_whitespace().map(String::from).collect();
        parse(&args)
    }

    #[test]
    fn desktop_launches_are_not_cli() {
        assert_eq!(p(""), None);
        assert_eq!(p("--background"), None);
        assert_eq!(p("--quick"), None);
        assert_eq!(p("--mcp-memory --db x"), None);
    }

    #[test]
    fn subcommands() {
        assert_eq!(p("serve"), Some(Ok(Command::Serve)));
        assert_eq!(p("status"), Some(Ok(Command::Status)));
        assert_eq!(p("--version"), Some(Ok(Command::Version)));
        assert_eq!(p("-h"), Some(Ok(Command::Help)));
        assert_eq!(p("remote enable"), Some(Ok(Command::Remote(RemoteCmd::Enable { internet: false }))));
        assert_eq!(p("remote enable --internet"), Some(Ok(Command::Remote(RemoteCmd::Enable { internet: true }))));
        assert_eq!(p("remote internet off"), Some(Ok(Command::Remote(RemoteCmd::Internet(false)))));
        assert_eq!(p("remote name Mon serveur"), Some(Ok(Command::Remote(RemoteCmd::Name("Mon serveur".into())))));
        assert_eq!(p("remote code"), Some(Ok(Command::Remote(RemoteCmd::Code))));
        assert_eq!(
            p("remote level PC de Kim chat"),
            Some(Ok(Command::Remote(RemoteCmd::Level { device: "PC de Kim".into(), level: AccessLevel::Chat })))
        );
        assert_eq!(p("--cli-path remove"), Some(Ok(Command::CliPath { add: false })));
        assert_eq!(p("service install"), Some(Ok(Command::Service(ServiceCmd::Install))));
        assert!(matches!(p("service start"), Some(Err(_))));
        assert_eq!(p("remote revoke ab12"), Some(Ok(Command::Remote(RemoteCmd::Revoke { device: "ab12".into() }))));
    }

    #[test]
    fn misuse_is_reported() {
        assert!(matches!(p("serve now"), Some(Err(_))));
        assert!(matches!(p("remote"), Some(Err(_))));
        assert!(matches!(p("remote internet maybe"), Some(Err(_))));
        assert!(matches!(p("remote level pc admin"), Some(Err(_))));
        assert!(matches!(p("remote level full"), Some(Err(_))));
        assert!(matches!(p("remote revoke"), Some(Err(_))));
        assert!(matches!(p("remote fly"), Some(Err(_))));
    }
}

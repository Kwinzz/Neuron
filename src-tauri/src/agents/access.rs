//! Is each agent CLI installed, and is the user signed in? Plus the « Installer » / « Se connecter » actions.
//!
//! - Claude Code: `claude --version`, `claude auth status` (JSON `loggedIn`), sign-in `claude auth login`.
//! - Codex: `codex --version`, `codex login status` (« Logged in using … » / « Not logged in »), sign-in `codex login`.
//! - Antigravity: `agy --version`; no status command, so `agy --print /quota` (0 token) tells: it answers when
//!   signed in and fails with an authentication message otherwise. Sign-in happens in `agy` itself (`/login`).
//!
//! Installing and signing in are interactive (browser, prompts): Neuron opens a PowerShell window running the
//! official command, then the frontend re-checks until the state changes. A CLI installed while Neuron runs is not
//! in its PATH yet: [`crate::env_path::refresh_path`] re-reads it (registry on Windows, login shell on Linux).

use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::agents::events::AgentKind;
use crate::agents::process::command;
use crate::error::{AppError, AppResult};
use crate::util::now_ms;

const PROBE_TIMEOUT: Duration = Duration::from_secs(20);
const CACHE_TTL: Duration = Duration::from_secs(120);

/// Agents Neuron can install and sign in to (generic CLIs are configured by hand).
pub const MANAGED: [AgentKind; 3] = [AgentKind::ClaudeCode, AgentKind::Codex, AgentKind::Antigravity];

/// Why an agent could not answer, when Neuron can offer a fix.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AccessIssue {
    NotInstalled,
    NotLoggedIn,
}

impl AccessIssue {
    pub fn as_str(self) -> &'static str {
        match self {
            AccessIssue::NotInstalled => "not_installed",
            AccessIssue::NotLoggedIn => "not_logged_in",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "not_installed" => Some(AccessIssue::NotInstalled),
            "not_logged_in" => Some(AccessIssue::NotLoggedIn),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AgentAccess {
    pub agent: AgentKind,
    pub label: String,
    pub installed: bool,
    pub version: Option<String>,
    /// `None` = could not tell (CLI too old, timeout, unexpected answer).
    pub logged_in: Option<bool>,
    /// Account kind when signed in (« Claude Pro », « ChatGPT », « Clé API »…).
    pub account: Option<String>,
    /// Official install command (PowerShell), shown in the UI.
    pub install_command: String,
    /// Command that signs in (run in a terminal).
    pub login_command: String,
    #[ts(type = "number")]
    pub checked_at: i64,
}

impl AgentAccess {
    pub fn issue(&self) -> Option<AccessIssue> {
        if !self.installed {
            Some(AccessIssue::NotInstalled)
        } else if self.logged_in == Some(false) {
            Some(AccessIssue::NotLoggedIn)
        } else {
            None
        }
    }
}

struct Spec {
    label: &'static str,
    env: &'static str,
    default_bin: &'static str,
    install: &'static str,
    login: &'static str,
}

fn spec(agent: AgentKind) -> Option<Spec> {
    match agent {
        AgentKind::ClaudeCode => Some(Spec {
            label: "Claude Code",
            env: "NEURON_CLAUDE_BIN",
            default_bin: "claude",
            install: if cfg!(windows) {
                "irm https://claude.ai/install.ps1 | iex"
            } else {
                "curl -fsSL https://claude.ai/install.sh | bash"
            },
            login: "claude auth login",
        }),
        AgentKind::Codex => Some(Spec {
            label: "Codex",
            env: "NEURON_CODEX_BIN",
            default_bin: "codex",
            install: if cfg!(windows) {
                "irm https://chatgpt.com/codex/install.ps1 | iex"
            } else {
                "curl -fsSL https://chatgpt.com/codex/install.sh | sh"
            },
            login: "codex login",
        }),
        AgentKind::Antigravity => Some(Spec {
            label: "Antigravity",
            env: "NEURON_AGY_BIN",
            default_bin: "agy",
            install: if cfg!(windows) {
                "irm https://antigravity.google/cli/install.ps1 | iex"
            } else {
                "curl -fsSL https://antigravity.google/cli/install.sh | bash"
            },
            login: "agy",
        }),
        AgentKind::Generic => None,
    }
}

fn binary(spec: &Spec) -> String {
    std::env::var(spec.env).unwrap_or_else(|_| spec.default_bin.into())
}

/// Program to run for an agent (honours `NEURON_*_BIN`); None for generic CLIs.
pub fn binary_for(agent: AgentKind) -> Option<String> {
    spec(agent).map(|s| binary(&s))
}

/// Display name of a managed agent.
pub fn label(agent: AgentKind) -> &'static str {
    spec(agent).map_or(crate::i18n::pick("CLI générique", "Generic CLI"), |s| s.label)
}

enum Probe {
    /// The program does not exist (not installed / not in the PATH).
    Missing,
    /// It ran: exit status + stdout and stderr together.
    Ran { ok: bool, out: String },
    /// Timeout or other spawn failure.
    Failed,
}

async fn probe(bin: &str, args: &[&str]) -> Probe {
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let child = command(bin, &args, &std::env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();
    match tokio::time::timeout(PROBE_TIMEOUT, child).await {
        Ok(Ok(o)) => Probe::Ran {
            ok: o.status.success(),
            out: format!("{}\n{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)),
        },
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => Probe::Missing,
        _ => Probe::Failed,
    }
}

/// `2.1.331 (Claude Code)` / `codex-cli 0.162.1` / `1.5.16` → the version number.
pub fn parse_version(out: &str) -> Option<String> {
    out.split_whitespace()
        .find(|w| w.chars().next().is_some_and(|c| c.is_ascii_digit()) && w.contains('.'))
        .map(|w| w.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-').to_string())
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

/// `claude auth status` JSON → (signed in, account kind).
pub fn parse_claude_auth(out: &str) -> (Option<bool>, Option<String>) {
    let json = match (out.find('{'), out.rfind('}')) {
        (Some(a), Some(b)) if a < b => serde_json::from_str::<Value>(&out[a..=b]).ok(),
        _ => None,
    };
    let Some(v) = json else { return (None, None) };
    let logged_in = v.get("loggedIn").and_then(Value::as_bool);
    let plan = v.get("subscriptionType").or_else(|| v.get("planTier")).and_then(Value::as_str);
    let account = match (logged_in, plan, v.get("authMethod").and_then(Value::as_str)) {
        (Some(true), Some(plan), _) if !plan.is_empty() => Some(format!("Claude {}", capitalize(plan))),
        (Some(true), _, Some("claude.ai")) => Some(crate::i18n::pick("Compte Claude", "Claude account").into()),
        (Some(true), _, Some(_)) => Some(crate::i18n::pick("Clé API", "API key").into()),
        _ => None,
    };
    (logged_in, account)
}

/// `codex login status` → (signed in, account kind). Never returns the (masked) key itself.
pub fn parse_codex_login(out: &str, ok: bool) -> (Option<bool>, Option<String>) {
    let lower = out.to_lowercase();
    if lower.contains("not logged in") {
        (Some(false), None)
    } else if lower.contains("logged in using chatgpt") {
        (Some(true), Some("ChatGPT".into()))
    } else if lower.contains("api key") && lower.contains("logged in") {
        (Some(true), Some(crate::i18n::pick("Clé API", "API key").into()))
    } else if lower.contains("logged in") {
        (Some(true), None)
    } else if !ok {
        (Some(false), None)
    } else {
        (None, None)
    }
}

/// Does this error text mean "you must sign in"? Used on agent errors (turn result, stderr, agy commands).
pub fn is_auth_error(text: &str) -> bool {
    const PATTERNS: &[&str] = &[
        "not logged in",
        "/login",
        "invalid api key",
        "authentication_failed",
        "authentication failed",
        "authentication required",
        "not authenticated",
        "unauthorized",
        "please sign in",
        "not signed in",
        "sign in again",
        "sign-in required",
        "login required",
        "oauth token has expired",
        "invalid_grant",
        "missing api key",
        "no api key",
    ];
    let lower = text.to_lowercase();
    PATTERNS.iter().any(|p| lower.contains(p))
}

/// Fragments of [`AppError::AgentNotInstalled`]'s message, in both languages (Codex reports spawn failures as a
/// turn error, and a chat may hold errors written before a language change).
const NOT_INSTALLED_MARKS: [&str; 2] = ["le CLI n'est pas installé", "the CLI is not installed"];

/// The fixable problem behind an agent error message, if any.
pub fn classify_error(text: &str) -> Option<AccessIssue> {
    if NOT_INSTALLED_MARKS.iter().any(|m| text.contains(m)) {
        Some(AccessIssue::NotInstalled)
    } else {
        is_auth_error(text).then_some(AccessIssue::NotLoggedIn)
    }
}

/// Message metadata stored with an error row (`messages.meta_json`).
pub fn error_meta(issue: Option<AccessIssue>) -> Option<Value> {
    issue.map(|i| serde_json::json!({ "issue": i.as_str() }))
}

async fn check_uncached(agent: AgentKind) -> Option<AgentAccess> {
    let spec = spec(agent)?;
    let bin = binary(&spec);
    let mut access = AgentAccess {
        agent,
        label: spec.label.into(),
        installed: true,
        version: None,
        logged_in: None,
        account: None,
        install_command: spec.install.into(),
        login_command: spec.login.into(),
        checked_at: now_ms(),
    };
    match probe(&bin, &["--version"]).await {
        Probe::Missing => {
            access.installed = false;
            return Some(access);
        }
        Probe::Ran { out, .. } => access.version = parse_version(&out),
        Probe::Failed => {}
    }
    let (logged_in, account) = match agent {
        AgentKind::ClaudeCode => match probe(&bin, &["auth", "status"]).await {
            Probe::Ran { out, .. } => parse_claude_auth(&out),
            _ => (None, None),
        },
        AgentKind::Codex => match probe(&bin, &["login", "status"]).await {
            Probe::Ran { ok, out } => parse_codex_login(&out, ok),
            _ => (None, None),
        },
        AgentKind::Antigravity => match crate::agents::antigravity::quota::run("quota", &std::env::temp_dir()).await {
            Ok(_) => (Some(true), None),
            Err(err) if is_auth_error(&err.to_string()) => (Some(false), None),
            Err(err) => {
                tracing::debug!(%err, "agy sign-in state unknown");
                (None, None)
            }
        },
        AgentKind::Generic => (None, None),
    };
    access.logged_in = logged_in;
    access.account = account;
    Some(access)
}

static CACHE: Mutex<Option<(Instant, Vec<AgentAccess>)>> = Mutex::new(None);

fn store(list: &[AgentAccess]) {
    let installed_changed = {
        let Ok(mut guard) = CACHE.lock() else { return };
        let mut current = guard.as_ref().map(|(_, l)| l.clone()).unwrap_or_default();
        let mut changed = false;
        for a in list {
            match current.iter_mut().find(|c| c.agent == a.agent) {
                Some(c) => {
                    changed |= c.installed != a.installed || c.logged_in != a.logged_in;
                    *c = a.clone();
                }
                None => current.push(a.clone()),
            }
        }
        current.sort_by_key(|a| MANAGED.iter().position(|m| *m == a.agent));
        *guard = Some((Instant::now(), current));
        changed
    };
    // Models come from the CLIs: a fresh install or sign-in changes what they list.
    if installed_changed {
        crate::agents::catalog::invalidate();
    }
}

/// Every managed agent (cached for 2 min unless `refresh`).
pub async fn list(refresh: bool) -> Vec<AgentAccess> {
    if !refresh {
        if let Ok(guard) = CACHE.lock() {
            if let Some((at, list)) = guard.as_ref() {
                if at.elapsed() < CACHE_TTL && list.len() == MANAGED.len() {
                    return list.clone();
                }
            }
        }
    }
    crate::env_path::refresh_path();
    let (c, x, a) = tokio::join!(
        check_uncached(AgentKind::ClaudeCode),
        check_uncached(AgentKind::Codex),
        check_uncached(AgentKind::Antigravity)
    );
    let list: Vec<AgentAccess> = [c, x, a].into_iter().flatten().collect();
    store(&list);
    list
}

/// One agent, always fresh (after « Installer » / « Se connecter »).
pub async fn check(agent: AgentKind) -> AppResult<AgentAccess> {
    crate::env_path::refresh_path();
    let access = check_uncached(agent).await.ok_or_else(|| {
        AppError::Invalid(crate::tr!(
            "les CLI génériques se configurent dans Paramètres",
            "generic CLIs are set up in Settings"
        ))
    })?;
    store(std::slice::from_ref(&access));
    Ok(access)
}

fn nothing_to_install() -> String {
    crate::tr!("rien à installer pour ce fournisseur", "nothing to install for this provider")
}

fn no_sign_in() -> String {
    crate::tr!("pas de connexion pour ce fournisseur", "no sign-in for this provider")
}

/// Window title of the install terminal.
fn install_title(label: &str) -> String {
    crate::tr!("Neuron - installation de {label}", "Neuron - installing {label}")
}

/// Window title of the sign-in terminal.
fn login_title(label: &str) -> String {
    crate::tr!("Neuron - connexion à {label}", "Neuron - signing in to {label}")
}

/// Opens a terminal running the official installer.
pub fn install(agent: AgentKind) -> AppResult<()> {
    let (title, script) = install_script(agent)?;
    open_terminal(&title, &script)
}

/// Opens a terminal running the agent's sign-in.
pub fn login(agent: AgentKind) -> AppResult<()> {
    let (title, script) = login_script(agent)?;
    open_terminal(&title, &script)
}

#[cfg(not(windows))]
use {bash_install_script as install_script, bash_login_script as login_script};

/// (window title, PowerShell script) of the installer.
#[cfg(windows)]
fn install_script(agent: AgentKind) -> AppResult<(String, String)> {
    let spec = spec(agent).ok_or_else(|| AppError::Invalid(nothing_to_install()))?;
    let (label, cmd) = (spec.label, spec.install);
    let script = crate::tr!(
        "$ErrorActionPreference = 'Stop'; \
         Write-Host 'Installation de {label} ({cmd})' -ForegroundColor Cyan; Write-Host ''; \
         try {{ {cmd}; Write-Host ''; \
         Write-Host '{label} est installé. Retourne dans Neuron : la fenêtre se ferme toute seule.' -ForegroundColor Green; \
         Start-Sleep -Seconds 4; exit }} \
         catch {{ Write-Host ''; Write-Host ('Échec : ' + $_) -ForegroundColor Red }}",
        "$ErrorActionPreference = 'Stop'; \
         Write-Host 'Installing {label} ({cmd})' -ForegroundColor Cyan; Write-Host ''; \
         try {{ {cmd}; Write-Host ''; \
         Write-Host '{label} is installed. Go back to Neuron: this window closes by itself.' -ForegroundColor Green; \
         Start-Sleep -Seconds 4; exit }} \
         catch {{ Write-Host ''; Write-Host ('Failed: ' + $_) -ForegroundColor Red }}"
    );
    Ok((install_title(spec.label), script))
}

/// (window title, PowerShell script) of the sign-in.
#[cfg(windows)]
fn login_script(agent: AgentKind) -> AppResult<(String, String)> {
    let spec = spec(agent).ok_or_else(|| AppError::Invalid(no_sign_in()))?;
    let bin = binary(&spec);
    let script = match agent {
        // agy has no sign-in subcommand: its interactive session asks for it (or `/login`).
        AgentKind::Antigravity => crate::tr!(
            "Write-Host 'Connecte-toi à Antigravity dans la session qui s''ouvre (commande /login si rien ne s''affiche),' -ForegroundColor Cyan; \
             Write-Host 'puis quitte avec /exit et retourne dans Neuron.' -ForegroundColor Cyan; Write-Host ''; & '{bin}'",
            "Write-Host 'Sign in to Antigravity in the session that opens (type /login if nothing shows up),' -ForegroundColor Cyan; \
             Write-Host 'then quit with /exit and go back to Neuron.' -ForegroundColor Cyan; Write-Host ''; & '{bin}'"
        ),
        _ => {
            let args = spec.login.split_once(' ').map_or("", |(_, a)| a);
            let label = spec.label;
            crate::tr!(
                "Write-Host 'Connexion à {label} : suis les instructions (une page de connexion peut s''ouvrir dans le navigateur).' -ForegroundColor Cyan; \
                 Write-Host ''; & '{bin}' {args}; \
                 if ($LASTEXITCODE -eq 0) {{ Write-Host ''; \
                 Write-Host 'Connecté. Retourne dans Neuron : la fenêtre se ferme toute seule.' -ForegroundColor Green; \
                 Start-Sleep -Seconds 3; exit }}",
                "Write-Host 'Signing in to {label}: follow the instructions (a sign-in page may open in your browser).' -ForegroundColor Cyan; \
                 Write-Host ''; & '{bin}' {args}; \
                 if ($LASTEXITCODE -eq 0) {{ Write-Host ''; \
                 Write-Host 'Signed in. Go back to Neuron: this window closes by itself.' -ForegroundColor Green; \
                 Start-Sleep -Seconds 3; exit }}"
            )
        }
    };
    Ok((login_title(spec.label), script))
}

#[cfg(windows)]
fn open_terminal(title: &str, script: &str) -> AppResult<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    crate::env_path::refresh_path();
    // Single quotes only in scripts: Rust's argument quoting then reaches PowerShell untouched.
    let full = format!("$Host.UI.RawUI.WindowTitle = '{title}'; {script}");
    let home = std::env::var_os("USERPROFILE").map(std::path::PathBuf::from).unwrap_or_else(std::env::temp_dir);
    std::process::Command::new("powershell.exe")
        .args(["-NoExit", "-ExecutionPolicy", "Bypass", "-Command", &full])
        .current_dir(home)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map_err(|e| {
            AppError::Other(crate::tr!("impossible d'ouvrir PowerShell ({e})", "could not open PowerShell ({e})"))
        })?;
    Ok(())
}

/// (window title, bash script) of the installer (Linux; compiled everywhere so the tests check it).
#[cfg_attr(windows, allow(dead_code))]
fn bash_install_script(agent: AgentKind) -> AppResult<(String, String)> {
    let spec = spec(agent).ok_or_else(|| AppError::Invalid(nothing_to_install()))?;
    let (label, cmd) = (spec.label, spec.install);
    let script = crate::tr!(
        "set -o pipefail; printf '\\033[36m%s\\033[0m\\n\\n' 'Installation de {label} ({cmd})'; \
         if {cmd}; then printf '\\n\\033[32m%s\\033[0m\\n' '{label} est installé. Retourne dans Neuron : la fenêtre se ferme toute seule.'; \
         sleep 4; exit 0; fi; \
         printf '\\n\\033[31m%s\\033[0m\\n' 'Échec de l’installation.'; read -r -p 'Entrée pour fermer… ' _",
        "set -o pipefail; printf '\\033[36m%s\\033[0m\\n\\n' 'Installing {label} ({cmd})'; \
         if {cmd}; then printf '\\n\\033[32m%s\\033[0m\\n' '{label} is installed. Go back to Neuron: this window closes by itself.'; \
         sleep 4; exit 0; fi; \
         printf '\\n\\033[31m%s\\033[0m\\n' 'Installation failed.'; read -r -p 'Press Enter to close… ' _"
    );
    Ok((install_title(spec.label), script))
}

/// (window title, bash script) of the sign-in (Linux; compiled everywhere so the tests check it).
#[cfg_attr(windows, allow(dead_code))]
fn bash_login_script(agent: AgentKind) -> AppResult<(String, String)> {
    let spec = spec(agent).ok_or_else(|| AppError::Invalid(no_sign_in()))?;
    let bin = binary(&spec).replace('\'', "");
    let script = match agent {
        // agy has no sign-in subcommand: its interactive session asks for it (or `/login`).
        AgentKind::Antigravity => crate::tr!(
            "printf '\\033[36m%s\\033[0m\\n\\n' 'Connecte-toi à Antigravity dans la session qui s’ouvre (commande /login si rien ne s’affiche), puis quitte avec /exit.'; \
             '{bin}'; exit 0",
            "printf '\\033[36m%s\\033[0m\\n\\n' 'Sign in to Antigravity in the session that opens (type /login if nothing shows up), then quit with /exit.'; \
             '{bin}'; exit 0"
        ),
        _ => {
            let args = spec.login.split_once(' ').map_or("", |(_, a)| a);
            let label = spec.label;
            crate::tr!(
                "printf '\\033[36m%s\\033[0m\\n\\n' 'Connexion à {label} : suis les instructions (une page de connexion peut s’ouvrir dans le navigateur).'; \
                 '{bin}' {args} && {{ printf '\\n\\033[32m%s\\033[0m\\n' 'Connecté. Retourne dans Neuron : la fenêtre se ferme toute seule.'; sleep 3; exit 0; }}; \
                 read -r -p 'Entrée pour fermer… ' _",
                "printf '\\033[36m%s\\033[0m\\n\\n' 'Signing in to {label}: follow the instructions (a sign-in page may open in your browser).'; \
                 '{bin}' {args} && {{ printf '\\n\\033[32m%s\\033[0m\\n' 'Signed in. Go back to Neuron: this window closes by itself.'; sleep 3; exit 0; }}; \
                 read -r -p 'Press Enter to close… ' _"
            )
        }
    };
    Ok((login_title(spec.label), script))
}
/// Terminals tried in order (after `$TERMINAL`), with the arguments that precede the command to run.
#[cfg(not(windows))]
const TERMINALS: &[(&str, &[&str])] = &[
    ("kitty", &[]),
    ("alacritty", &["-e"]),
    ("foot", &[]),
    ("wezterm", &["start", "--"]),
    ("ghostty", &["-e"]),
    ("konsole", &["-e"]),
    ("gnome-terminal", &["--"]),
    ("kgx", &["--"]),
    ("ptyxis", &["--"]),
    ("xfce4-terminal", &["-x"]),
    ("x-terminal-emulator", &["-e"]),
    ("xterm", &["-e"]),
];

/// The terminal to open: `$TERMINAL` first (arguments of a known one, `-e` otherwise), then [`TERMINALS`].
#[cfg(not(windows))]
fn pick_terminal() -> Option<(std::path::PathBuf, Vec<&'static str>)> {
    use crate::env_path::find_program;
    if let Some(wanted) = std::env::var("TERMINAL").ok().filter(|t| !t.trim().is_empty()) {
        let program = std::path::Path::new(wanted.trim());
        let name = program.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        let args = TERMINALS.iter().find(|(t, _)| *t == name).map_or(vec!["-e"], |(_, a)| a.to_vec());
        let found = if program.is_absolute() { Some(program.to_path_buf()) } else { find_program(name) };
        if let Some(path) = found.filter(|p| p.is_file()) {
            return Some((path, args));
        }
    }
    TERMINALS.iter().find_map(|(name, args)| find_program(name).map(|p| (p, args.to_vec())))
}

#[cfg(not(windows))]
fn open_terminal(title: &str, script: &str) -> AppResult<()> {
    use std::process::Stdio;
    crate::env_path::refresh_path();
    let (terminal, args) = pick_terminal().ok_or_else(|| {
        AppError::Invalid(crate::tr!(
            "aucun terminal trouvé (kitty, alacritty, konsole, gnome-terminal…) : lance la commande affichée",
            "no terminal found (kitty, alacritty, konsole, gnome-terminal…): run the command shown"
        ))
    })?;
    let full = format!("printf '\\033]0;%s\\007' '{title}'; {script}");
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let mut cmd = std::process::Command::new(&terminal);
    cmd.args(args).args(["bash", "-lc", &full]).current_dir(home);
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if let Some(path) = crate::env_path::path() {
        cmd.env("PATH", path);
    }
    let mut child = cmd.spawn().map_err(|e| {
        let terminal = terminal.display();
        AppError::Other(crate::tr!("impossible d'ouvrir {terminal} ({e})", "could not open {terminal} ({e})"))
    })?;
    // Reap it when the window closes (no zombie).
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real CLIs of this machine: `cargo test live_agent_access -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn live_agent_access() {
        for access in list(true).await {
            println!("{access:?}");
        }
    }

    /// Scripts to check with PowerShell's parser: `cargo test dump_terminal_scripts -- --ignored`.
    #[test]
    #[ignore]
    fn dump_terminal_scripts() {
        let dir = std::env::var("NEURON_SCRIPT_DUMP").expect("NEURON_SCRIPT_DUMP");
        // Ignored test, run alone on demand: it may switch the global language (`NEURON_SCRIPT_LANG=en`).
        if std::env::var("NEURON_SCRIPT_LANG").as_deref() == Ok("en") {
            crate::i18n::set(crate::i18n::Language::En);
        }
        for agent in MANAGED {
            for (kind, (title, script)) in
                [("install", install_script(agent).unwrap()), ("login", login_script(agent).unwrap())]
            {
                let full = format!("$Host.UI.RawUI.WindowTitle = '{title}'; {script}");
                std::fs::write(format!("{dir}/{}-{kind}.ps1", agent.as_str()), full).unwrap();
            }
            for (kind, (_, script)) in
                [("install", bash_install_script(agent).unwrap()), ("login", bash_login_script(agent).unwrap())]
            {
                std::fs::write(format!("{dir}/{}-{kind}.sh", agent.as_str()), script).unwrap();
            }
        }
    }

    #[test]
    fn reads_versions() {
        assert_eq!(parse_version("2.1.331 (Claude Code)\n").as_deref(), Some("2.1.331"));
        assert_eq!(parse_version("codex-cli 0.162.1\n").as_deref(), Some("0.162.1"));
        assert_eq!(parse_version("1.5.16").as_deref(), Some("1.5.16"));
        assert_eq!(parse_version("usage: foo"), None);
    }

    #[test]
    fn reads_claude_auth_status() {
        let (ok, account) =
            parse_claude_auth(r#"{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "pro"}"#);
        assert_eq!((ok, account.as_deref()), (Some(true), Some("Claude Pro")));
        let (ok, account) = parse_claude_auth(r#"{"loggedIn": true, "authMethod": "api_key"}"#);
        assert_eq!((ok, account.as_deref()), (Some(true), Some("Clé API")));
        assert_eq!(parse_claude_auth(r#"{"loggedIn": false, "authMethod": "none"}"#), (Some(false), None));
        assert_eq!(parse_claude_auth("error: unknown command 'auth'"), (None, None));
    }

    #[test]
    fn reads_codex_login_status() {
        assert_eq!(parse_codex_login("Logged in using ChatGPT\n", true), (Some(true), Some("ChatGPT".into())));
        assert_eq!(
            parse_codex_login("Logged in using an API key - sk-proj-***ABCD\n", true),
            (Some(true), Some("Clé API".into()))
        );
        assert_eq!(parse_codex_login("Not logged in\n", false), (Some(false), None));
    }

    #[test]
    fn spots_sign_in_errors() {
        assert_eq!(classify_error("Not logged in · Please run /login"), Some(AccessIssue::NotLoggedIn));
        assert_eq!(classify_error("Invalid API key · Please run /login"), Some(AccessIssue::NotLoggedIn));
        assert_eq!(
            classify_error("unexpected status 401 Unauthorized: Missing bearer authentication"),
            Some(AccessIssue::NotLoggedIn)
        );
        assert_eq!(classify_error("Le processus de l'agent s'est arrêté (code 1)."), None);
        assert_eq!(classify_error("rate limit exceeded"), None);
        let missing = AppError::AgentNotInstalled("codex".into()).to_string();
        assert_eq!(classify_error(&missing), Some(AccessIssue::NotInstalled));
        assert_eq!(
            classify_error("“codex” was not found: the CLI is not installed (or not in the PATH)."),
            Some(AccessIssue::NotInstalled),
            "English message too"
        );
    }
}

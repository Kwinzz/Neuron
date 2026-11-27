//! Agents launched by an agent — not the CLI's own sub-agents (Claude `Task`), but other agent CLIs it starts:
//! `agy` through `scripts/neon-bridge.sh`, `codex exec`, `gemini -p`… Recognised two ways, merged here:
//! - in the shell commands of every agent's tool calls ([`detect_cli`]);
//! - in the chat's process tree ([`crate::agents::proc_watch`]), which also catches agents started by a script.
//!
//! [`SubagentTracker`] (one per session) turns both into one sub-agent each, identified by the shell tool call that
//! launched it, or `proc:<pid>` when no command announced it.

use std::time::{Duration, Instant};

/// Agent CLIs by program name → key shown by the UI (`claude`, `codex`, `antigravity`, `gemini`, or the name).
const PROGRAMS: &[(&str, &str)] = &[
    ("claude", "claude"),
    ("codex", "codex"),
    ("agy", "antigravity"),
    ("antigravity", "antigravity"),
    ("neon-bridge", "antigravity"),
    ("gemini", "gemini"),
    ("cursor-agent", "cursor"),
    ("opencode", "opencode"),
    ("aider", "aider"),
    ("qwen", "qwen"),
    ("goose", "goose"),
    ("amp", "amp"),
    ("crush", "crush"),
    ("copilot", "copilot"),
];

/// npm packages of agent CLIs (run as `node …/<package>/…` or `npx <package>`).
const PACKAGES: &[(&str, &str)] = &[
    ("@anthropic-ai/claude-code", "claude"),
    ("@openai/codex", "codex"),
    ("@google/gemini-cli", "gemini"),
    ("@qwen-code/qwen-code", "qwen"),
    ("opencode-ai", "opencode"),
    ("@sourcegraph/amp", "amp"),
    ("@github/copilot", "copilot"),
];

/// First arguments that make a CLI call a quick utility, not an agent at work.
const UTILITY_ARGS: &[&str] = &[
    "--version",
    "-v",
    "-V",
    "version",
    "--help",
    "-h",
    "help",
    "mcp",
    "auth",
    "login",
    "logout",
    "config",
    "models",
    "update",
    "upgrade",
    "doctor",
    "install",
    "completion",
    "features",
    "debug",
    "status",
    "setup-token",
];

/// Commands that run the next word as the program.
const WRAPPERS: &[&str] = &["env", "sudo", "nohup", "time", "exec", "command", "stdbuf", "timeout", "nice", "xargs"];
const RUNNERS: &[&str] = &["npx", "bunx", "pnpx", "uvx", "dlx"];
const SHELLS: &[&str] = &["bash", "sh", "zsh", "fish", "dash"];

/// Program name without folders nor Windows extension, lowercase (`C:\…\agy.exe` → `agy`).
fn base_name(program: &str) -> String {
    let name = program.rsplit(['/', '\\']).next().unwrap_or(program).to_lowercase();
    for ext in [".exe", ".cmd", ".bat", ".ps1", ".sh", ".js", ".mjs"] {
        if let Some(stem) = name.strip_suffix(ext) {
            return stem.to_string();
        }
    }
    name
}

/// Key of an agent CLI from its program name only (`/usr/local/bin/codex` → `codex`), package paths aside.
pub fn program_name_key(program: &str) -> Option<&'static str> {
    let base = base_name(program);
    PROGRAMS.iter().find(|(name, _)| *name == base).map(|(_, key)| *key)
}

/// Key of an agent CLI from a program name, or of a package path (`…/node_modules/@google/gemini-cli/…`).
pub fn program_key(program: &str) -> Option<&'static str> {
    if let Some(key) = program_name_key(program) {
        return Some(key);
    }
    let path = program.replace('\\', "/").to_lowercase();
    PACKAGES
        .iter()
        .find(|(pkg, _)| path == *pkg || path.contains(&format!("{pkg}/")) || path.starts_with(&format!("{pkg}@")))
        .map(|(_, key)| *key)
}

/// An agent CLI recognised in a command line.
#[derive(Debug, Clone, PartialEq)]
pub struct Detected {
    pub key: &'static str,
    /// Program as written (`agy`, `scripts/neon-bridge.sh`).
    pub program: String,
    /// The prompt, when one is visible (longest argument with spaces).
    pub prompt: Option<String>,
}

/// Words of a shell command, quotes removed; `&&`, `||`, `|`, `;`, `&` and newlines become `None` (separators).
fn tokenize(command: &str) -> Vec<Option<String>> {
    let mut out = Vec::new();
    let mut word = String::new();
    let mut in_word = false;
    let mut chars = command.chars().peekable();
    let flush = |word: &mut String, in_word: &mut bool, out: &mut Vec<Option<String>>| {
        if *in_word {
            out.push(Some(std::mem::take(word)));
            *in_word = false;
        }
    };
    while let Some(c) = chars.next() {
        match c {
            '\'' => {
                in_word = true;
                for q in chars.by_ref() {
                    if q == '\'' {
                        break;
                    }
                    word.push(q);
                }
            }
            '"' => {
                in_word = true;
                while let Some(q) = chars.next() {
                    match q {
                        '"' => break,
                        '\\' if matches!(chars.peek(), Some('"' | '\\' | '$' | '`')) => {
                            if let Some(n) = chars.next() {
                                word.push(n);
                            }
                        }
                        _ => word.push(q),
                    }
                }
            }
            '\\' if chars.peek().is_some_and(|n| *n == '\n') => {
                chars.next();
            }
            '&' | '|' | ';' | '\n' => {
                flush(&mut word, &mut in_word, &mut out);
                while chars.peek().is_some_and(|n| matches!(n, '&' | '|')) {
                    chars.next();
                }
                out.push(None);
            }
            c if c.is_whitespace() => flush(&mut word, &mut in_word, &mut out),
            c => {
                in_word = true;
                word.push(c);
            }
        }
    }
    flush(&mut word, &mut in_word, &mut out);
    out
}

/// The agent CLI a shell command starts, if any (`cat claude.md`, `grep codex`, `claude --version` → none).
pub fn detect_cli(command: &str) -> Option<Detected> {
    let tokens = tokenize(command);
    for segment in tokens.split(Option::is_none) {
        let words: Vec<&str> = segment.iter().flatten().map(String::as_str).collect();
        if let Some(found) = detect_segment(&words) {
            return Some(found);
        }
    }
    None
}

fn detect_segment(words: &[&str]) -> Option<Detected> {
    let mut i = 0;
    // `FOO=bar cmd`, wrappers, runners (with their flags), `bash script.sh`.
    loop {
        let word = *words.get(i)?;
        let base = base_name(word);
        if word.contains('=') && !word.starts_with('-') && !word.contains('/') {
            i += 1;
        } else if WRAPPERS.contains(&base.as_str())
            || RUNNERS.contains(&base.as_str())
            || base == "pnpm"
            || base == "yarn"
        {
            i += 1;
            while words.get(i).is_some_and(|w| w.starts_with('-') || *w == "dlx" || *w == "exec") {
                i += 1;
            }
        } else if SHELLS.contains(&base.as_str()) && words.get(i + 1).is_some_and(|w| !w.starts_with('-')) {
            i += 1;
        } else {
            break;
        }
    }
    let program = words[i];
    let key = program_key(program)?;
    let args = &words[i + 1..];
    let first = args.iter().find(|a| !a.starts_with('-') || UTILITY_ARGS.contains(a));
    if args.is_empty() && key != "antigravity" {
        // `claude` alone = interactive session, not something an agent runs.
        return None;
    }
    if first.is_some_and(|a| UTILITY_ARGS.contains(a)) {
        return None;
    }
    let prompt = args.iter().filter(|a| a.contains(' ')).max_by_key(|a| a.len()).map(|a| a.trim().to_string());
    Some(Detected { key, program: program.to_string(), prompt })
}

/// Tools that run a shell command, for every agent (Claude `Bash`, Codex `Shell`, agy `run_command`…).
pub fn is_shell_tool(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "bash" | "powershell" | "shell" | "exec" | "run_command" | "execute_command" | "run_shell_command"
    )
}

/// Command line of a shell tool call's input.
pub fn shell_command(input: &serde_json::Value) -> Option<&str> {
    ["command", "cmd", "CommandLine", "Command"].iter().find_map(|k| input.get(*k).and_then(|v| v.as_str()))
}

/// Last `max` non-empty lines of a command's output, terminal escape codes removed.
pub fn output_tail(output: &str, max: usize) -> String {
    let clean = strip_ansi(output);
    let lines: Vec<&str> = clean.lines().map(str::trim_end).filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(max)..].join("\n")
}

fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            if c != '\r' {
                out.push(c);
            }
            continue;
        }
        match chars.next() {
            // CSI: parameters then one final byte in @..~
            Some('[') => {
                for n in chars.by_ref() {
                    if ('@'..='~').contains(&n) {
                        break;
                    }
                }
            }
            // OSC: up to BEL or ESC \
            Some(']') => {
                while let Some(n) = chars.next() {
                    if n == '\u{7}' || (n == '\u{1b}' && chars.peek() == Some(&'\\')) {
                        if n == '\u{1b}' {
                            chars.next();
                        }
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// An agent process found under a chat (see [`crate::agents::proc_watch`]).
#[derive(Debug, Clone, PartialEq)]
pub struct ProcAgent {
    pub pid: u32,
    pub key: &'static str,
    pub command: String,
}

/// What the tracker reports after looking at the processes.
#[derive(Debug, Clone, PartialEq)]
pub enum TrackerUpdate {
    /// A sub-agent process appeared. `merged`: it is the one a command already announced (same id).
    Started { id: String, agent: ProcAgent, merged: bool },
    /// A sub-agent process (or a background command never seen as a process) ended.
    Ended { id: String },
}

#[derive(Debug)]
struct Tracked {
    id: String,
    key: &'static str,
    pid: Option<u32>,
    background: bool,
    /// When the launching tool call returned (a background command keeps running after it).
    returned_at: Option<Instant>,
}

/// A background command whose process never showed up is considered over after this long.
const UNSEEN_BACKGROUND_TTL: Duration = Duration::from_secs(15);

/// Sub-agents of one session, from commands and processes (one entry each).
#[derive(Debug, Default)]
pub struct SubagentTracker {
    entries: Vec<Tracked>,
}

impl SubagentTracker {
    pub fn command_started(&mut self, id: &str, key: &'static str, background: bool) {
        self.entries.push(Tracked { id: id.to_string(), key, pid: None, background, returned_at: None });
    }

    pub fn is_tracked(&self, id: &str) -> bool {
        self.entries.iter().any(|e| e.id == id)
    }

    /// The launching tool call returned. `true`: the sub-agent is over (foreground command); `false`: a
    /// background command, still running until its process ends.
    pub fn command_returned(&mut self, id: &str, now: Instant) -> bool {
        let Some(index) = self.entries.iter().position(|e| e.id == id) else { return true };
        if self.entries[index].background {
            self.entries[index].returned_at = Some(now);
            return false;
        }
        self.entries.remove(index);
        true
    }

    /// Compares with the agent processes now running under the session.
    pub fn processes(&mut self, seen: &[ProcAgent], now: Instant) -> Vec<TrackerUpdate> {
        let mut updates = Vec::new();
        for agent in seen {
            if self.entries.iter().any(|e| e.pid == Some(agent.pid)) {
                continue;
            }
            if let Some(entry) = self.entries.iter_mut().find(|e| e.pid.is_none() && e.key == agent.key) {
                entry.pid = Some(agent.pid);
                updates.push(TrackerUpdate::Started { id: entry.id.clone(), agent: agent.clone(), merged: true });
            } else {
                let id = format!("proc:{}", agent.pid);
                self.entries.push(Tracked {
                    id: id.clone(),
                    key: agent.key,
                    pid: Some(agent.pid),
                    background: true,
                    returned_at: None,
                });
                updates.push(TrackerUpdate::Started { id, agent: agent.clone(), merged: false });
            }
        }
        self.entries.retain(|e| {
            let gone = match e.pid {
                Some(pid) => !seen.iter().any(|a| a.pid == pid),
                None => e.returned_at.is_some_and(|t| now.duration_since(t) >= UNSEEN_BACKGROUND_TTL),
            };
            // A foreground command's process may end just before its tool call returns: the call ends it.
            let ended = gone && (e.background || e.pid.is_none());
            if ended {
                updates.push(TrackerUpdate::Ended { id: e.id.clone() });
            }
            !ended
        });
        updates
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(command: &str) -> Option<&'static str> {
        detect_cli(command).map(|d| d.key)
    }

    #[test]
    fn recognises_agent_cli_commands() {
        assert_eq!(key("scripts/neon-bridge.sh -d . -f brief.md"), Some("antigravity"));
        assert_eq!(key("bash scripts/neon-bridge.sh -d . \"polish the dock\""), Some("antigravity"));
        assert_eq!(key("cd /repo && codex exec --json \"fix the tests\""), Some("codex"));
        assert_eq!(key("npx -y @google/gemini-cli -p \"summarize this\""), Some("gemini"));
        assert_eq!(key("AGY_BIN=agy agy -p \"\" --output-format stream-json < prompt.txt"), Some("antigravity"));
        assert_eq!(key("claude -p 'review the diff' --output-format json"), Some("claude"));
        assert_eq!(key("C:\\Users\\me\\.local\\bin\\agy.exe --model gemini \"x y\""), Some("antigravity"));
        assert_eq!(key("cat prompt.md | gemini --yolo"), Some("gemini"));
        let d = detect_cli("codex exec \"refactor the parser\"").unwrap();
        assert_eq!(d.prompt.as_deref(), Some("refactor the parser"));
    }

    #[test]
    fn ignores_mentions_and_utilities() {
        for cmd in [
            "cat claude.md",
            "grep -rn codex src/",
            "claude --version",
            "codex login status",
            "agy mcp add neuron",
            "gemini --help",
            "claude",
            "which agy",
            "echo \"run codex exec later\"",
            "git commit -m \"gemini support\"",
        ] {
            assert_eq!(key(cmd), None, "{cmd}");
        }
    }

    #[test]
    fn package_paths() {
        assert_eq!(program_key("C:\\nvm\\node_modules\\@google\\gemini-cli\\dist\\index.js"), Some("gemini"));
        assert_eq!(program_key("/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js"), Some("claude"));
        assert_eq!(program_key("/usr/bin/node"), None);
        assert_eq!(program_key("codex-linux-sandbox"), None);
    }

    #[test]
    fn output_tail_keeps_the_end_without_escape_codes() {
        let out = "\u{1b}[32mok\u{1b}[0m\r\n\nline 2\nline 3\n\u{1b}]0;title\u{7}line 4\n";
        assert_eq!(output_tail(out, 2), "line 3\nline 4");
        assert_eq!(output_tail(out, 10), "ok\nline 2\nline 3\nline 4");
    }

    fn proc(pid: u32, key: &'static str) -> ProcAgent {
        ProcAgent { pid, key, command: format!("{key} …") }
    }

    #[test]
    fn tracker_merges_commands_and_processes() {
        let t0 = Instant::now();
        let mut tracker = SubagentTracker::default();
        // Foreground `codex exec`: command first, then its process, then the call returns.
        tracker.command_started("call-1", "codex", false);
        let up = tracker.processes(&[proc(10, "codex")], t0);
        assert_eq!(up, vec![TrackerUpdate::Started { id: "call-1".into(), agent: proc(10, "codex"), merged: true }]);
        assert!(tracker.processes(&[proc(10, "codex")], t0).is_empty());
        // Its process ended just before the call returned: no « ended » from the processes.
        assert!(tracker.processes(&[], t0).is_empty());
        assert!(tracker.command_returned("call-1", t0));
        assert!(!tracker.is_tracked("call-1"));

        // An agy started by a script nobody announced.
        let up = tracker.processes(&[proc(20, "antigravity")], t0);
        assert!(matches!(&up[..], [TrackerUpdate::Started { id, merged: false, .. }] if id == "proc:20"));
        assert_eq!(tracker.processes(&[], t0), vec![TrackerUpdate::Ended { id: "proc:20".into() }]);

        // Background command: stays running after its call returned, ends with its process.
        tracker.command_started("call-2", "gemini", true);
        assert!(!tracker.command_returned("call-2", t0));
        tracker.processes(&[proc(30, "gemini")], t0);
        assert_eq!(tracker.processes(&[], t0), vec![TrackerUpdate::Ended { id: "call-2".into() }]);

        // Background command never seen as a process: ended after the grace period.
        tracker.command_started("call-3", "claude", true);
        tracker.command_returned("call-3", t0);
        assert!(tracker.processes(&[], t0).is_empty());
        let later = t0 + UNSEEN_BACKGROUND_TTL;
        assert_eq!(tracker.processes(&[], later), vec![TrackerUpdate::Ended { id: "call-3".into() }]);
    }
}

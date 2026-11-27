//! Process-tree watch: every 2 s while a chat's agent is running, the agent CLIs among its descendants (an `agy`
//! started by a script, a `codex` in the background…) become sub-agents (see [`crate::agents::subagents`]).

use std::collections::HashMap;
use std::time::Duration;

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use crate::agents::subagents::{ProcAgent, program_key, program_name_key};
use crate::state::Shared;

const TICK: Duration = Duration::from_secs(2);
/// Programs that run a script: the agent is named by the script (`node …/gemini-cli/…`).
const RUNTIMES: &[&str] = &["node", "bun", "deno", "python", "python3"];
/// First arguments of an agent's own helper processes (`codex sandbox …`, `codex app-server`), not an agent at work.
const HELPER_ARGS: &[&str] = &["sandbox", "app-server", "exec-server", "mcp-server"];

/// One process of a snapshot.
#[derive(Debug, Clone)]
pub struct ProcInfo {
    pub pid: u32,
    pub parent: Option<u32>,
    pub name: String,
    pub cmd: Vec<String>,
    /// A thread of `parent` (Linux lists them as its children, with its command line).
    pub thread: bool,
}

fn runtime(name: &str) -> bool {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name).to_lowercase();
    let base = base.strip_suffix(".exe").unwrap_or(&base);
    RUNTIMES.contains(&base)
}

/// Agent of a process and whether it is one of its helpers. The program is the name it was started as (argv[0], after
/// `env` from a shebang): the `codex` executable started as `codex-linux-sandbox` is not `codex`. Package paths only
/// name the script a runtime runs (`node …/@google/gemini-cli/…`), not a binary shipped inside a package.
fn agent_program(p: &ProcInfo) -> Option<(&'static str, bool)> {
    let (mut program, mut args) = match p.cmd.split_first() {
        Some((first, rest)) => (first.as_str(), rest),
        None => (p.name.as_str(), &[][..]),
    };
    if program.rsplit(['/', '\\']).next() == Some("env") {
        let skip = args.iter().take_while(|a| a.starts_with('-') || a.contains('=')).count();
        let (first, rest) = args[skip..].split_first()?;
        (program, args) = (first.as_str(), rest);
    }
    let key = match program_name_key(program) {
        Some(key) => key,
        None if runtime(program) => {
            let script = args.iter().position(|a| !a.starts_with('-'))?;
            let key = program_key(&args[script])?;
            args = &args[script + 1..];
            key
        }
        None => return None,
    };
    let helper = args.iter().find(|a| !a.starts_with('-')).is_some_and(|a| HELPER_ARGS.contains(&a.as_str()));
    Some((key, helper))
}

/// Agent key of a process: its program, or the script a runtime runs; none for an agent's helper.
fn agent_key(p: &ProcInfo) -> Option<&'static str> {
    agent_program(p).filter(|(_, helper)| !helper).map(|(key, _)| key)
}

/// Agent processes under `roots` (not the roots themselves), the highest of each chain only: the processes an
/// agent CLI starts (its own tools, MCP servers, a nested agent) are not listed. A root's direct child that is the
/// same agent (npm wrapper → native binary) is the chat's agent itself: looked through, not listed.
pub fn agents_under(procs: &[ProcInfo], roots: &[u32]) -> Vec<ProcAgent> {
    let mut children: HashMap<u32, Vec<&ProcInfo>> = HashMap::new();
    for p in procs.iter().filter(|p| !p.thread) {
        if let Some(parent) = p.parent.filter(|parent| *parent != p.pid) {
            children.entry(parent).or_default().push(p);
        }
    }
    let own_agent = |pid: u32| procs.iter().find(|p| p.pid == pid).and_then(agent_program).map(|(key, _)| key);
    let mut found = Vec::new();
    // (pid, agent of the chat when `pid` is its process).
    let mut stack: Vec<(u32, Option<&'static str>)> = roots.iter().map(|pid| (*pid, own_agent(*pid))).collect();
    let mut visited = std::collections::HashSet::new();
    while let Some((pid, own)) = stack.pop() {
        if !visited.insert(pid) {
            continue;
        }
        for child in children.get(&pid).map(Vec::as_slice).unwrap_or_default() {
            match agent_key(child) {
                Some(key) if own == Some(key) => stack.push((child.pid, own)),
                Some(key) => found.push(ProcAgent { pid: child.pid, key, command: child.cmd.join(" ") }),
                None => stack.push((child.pid, None)),
            }
        }
    }
    found.sort_by_key(|a| a.pid);
    found
}

fn snapshot(system: &mut System) -> Vec<ProcInfo> {
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::OnlyIfNotSet),
    );
    system
        .processes()
        .iter()
        .map(|(pid, p)| ProcInfo {
            pid: pid.as_u32(),
            parent: p.parent().map(|parent| parent.as_u32()),
            name: p.name().to_string_lossy().into_owned(),
            cmd: p.cmd().iter().map(|a| a.to_string_lossy().into_owned()).collect(),
            thread: p.thread_kind().is_some(),
        })
        .collect()
}

/// Background task (app and `neuron serve`): looks at the processes only while some session runs.
pub fn spawn(state: &Shared) {
    let state = std::sync::Arc::clone(state);
    tauri::async_runtime::spawn(async move {
        let mut system = Some(System::new());
        loop {
            tokio::time::sleep(TICK).await;
            let roots = state.agents.process_roots();
            if roots.is_empty() {
                continue;
            }
            let Some(mut sys) = system.take() else { continue };
            let result = tokio::task::spawn_blocking(move || {
                let procs = snapshot(&mut sys);
                (sys, procs)
            })
            .await;
            let Ok((sys, procs)) = result else {
                system = Some(System::new());
                continue;
            };
            system = Some(sys);
            let found: Vec<(String, Vec<ProcAgent>)> =
                roots.into_iter().map(|(thread, pids)| (thread, agents_under(&procs, &pids))).collect();
            state.agents.update_process_subagents(state.events.as_ref(), found);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, parent: u32, name: &str, cmd: &str) -> ProcInfo {
        ProcInfo {
            pid,
            parent: Some(parent),
            name: name.into(),
            cmd: cmd.split(' ').map(String::from).collect(),
            thread: false,
        }
    }

    /// Codex on Linux (issue #7): none of these is a sub-agent, only the `codex exec` started from one of its shells.
    #[test]
    fn codex_own_processes_are_not_subagents() {
        let wrapper = "node /usr/local/bin/codex exec --json hi";
        let native = "/usr/lib/node_modules/@openai/codex/vendor/x86_64-unknown-linux-musl/codex/codex exec --json hi";
        let mut procs = vec![
            p(10, 1, "node", wrapper),
            // The wrapper's threads (same command line).
            ProcInfo { thread: true, ..p(11, 10, "node", wrapper) },
            ProcInfo { thread: true, ..p(12, 10, "node", wrapper) },
            // The native binary, its threads and helpers.
            p(20, 10, "codex", native),
            ProcInfo { thread: true, ..p(21, 20, "codex", native) },
            p(30, 20, "codex", "codex-linux-sandbox --sandbox-policy x -- bash -lc ls"),
            p(31, 30, "bwrap", "bwrap --ro-bind / / bash -lc ls"),
            p(32, 31, "bash", "bash -lc sleep 3"),
            p(40, 20, "node", "node /home/me/.codex/node_repl.js"),
            p(41, 40, "codex", "codex sandbox linux --full-auto node x.js"),
            p(50, 20, "codex-code-mode", "/usr/lib/node_modules/@openai/codex/vendor/codex-code-mode-host"),
            p(60, 1, "bash", "bash -lc echo"),
        ];
        assert!(agents_under(&procs, &[10]).is_empty(), "{:?}", agents_under(&procs, &[10]));

        // A real sub-agent, from a sandboxed shell; a script with `#!/usr/bin/env node` is named by its script.
        procs.push(p(33, 32, "codex", "codex exec --json review"));
        procs.push(p(34, 32, "node", "/usr/bin/env node /usr/local/bin/gemini -p hi"));
        let keys: Vec<(u32, &str)> = agents_under(&procs, &[10]).iter().map(|a| (a.pid, a.key)).collect();
        assert_eq!(keys, vec![(33, "codex"), (34, "gemini")]);
    }

    #[test]
    fn finds_the_highest_agent_of_each_chain() {
        let procs = vec![
            p(1, 0, "claude.exe", "claude -p"),
            p(2, 1, "bash.exe", "bash -c scripts/neon-bridge.sh"),
            p(3, 2, "bash.exe", "bash scripts/neon-bridge.sh -d ."),
            // neon-bridge.sh runs under bash: agy is the agent found.
            p(4, 3, "agy.exe", "agy --model gemini-4-neon-high"),
            // agy's own children are not listed.
            p(5, 4, "node.exe", "node C:/x/node_modules/@google/gemini-cli/dist/index.js"),
            p(6, 1, "node.exe", "node C:/Users/me/AppData/npm/node_modules/@google/gemini-cli/dist/index.js -p hi"),
            p(7, 1, "neuron.exe", "neuron --mcp-memory"),
            p(8, 1, "codex-linux-sandbox", "codex-linux-sandbox"),
            // Not under the chat.
            p(9, 100, "codex", "codex exec x"),
        ];
        let found = agents_under(&procs, &[1]);
        let keys: Vec<(u32, &str)> = found.iter().map(|a| (a.pid, a.key)).collect();
        assert_eq!(keys, vec![(4, "antigravity"), (6, "gemini")]);
        assert!(agents_under(&procs, &[]).is_empty());
    }

    /// Real processes: `cargo test proc_watch -- --ignored` (a system tool copied as `gemini`, run for 3 s).
    #[test]
    #[ignore]
    fn sees_a_real_child_process() {
        let dir = std::env::temp_dir().join(format!("neuron-proc-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let (tool, name, args): (&str, &str, &[&str]) = if cfg!(windows) {
            (r"C:\Windows\System32\PING.EXE", "gemini.exe", &["-n", "4", "127.0.0.1"])
        } else {
            ("/bin/sleep", "gemini", &["3"])
        };
        let fake = dir.join(name);
        std::fs::copy(tool, &fake).unwrap();
        let mut child =
            std::process::Command::new(&fake).args(args).stdout(std::process::Stdio::null()).spawn().unwrap();
        std::thread::sleep(Duration::from_millis(800));
        let mut system = System::new();
        let procs = snapshot(&mut system);
        let found = agents_under(&procs, &[std::process::id()]);
        let _ = child.kill();
        let _ = child.wait();
        std::fs::remove_dir_all(&dir).ok();
        assert!(found.iter().any(|a| a.key == "gemini" && a.pid == child.id()), "{found:?}");
    }
}

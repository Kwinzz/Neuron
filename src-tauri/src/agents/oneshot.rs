//! One-off prompt to an agent CLI, outside any chat (e.g. rewriting imported memories): no tools, no session,
//! run in the temp folder, answer = the agent's final text.

use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncWriteExt;

use crate::agents::access;
use crate::agents::events::AgentKind;
use crate::agents::process::{command, spawn_error};
use crate::error::{AppError, AppResult};

const TIMEOUT: Duration = Duration::from_secs(180);
/// Fast, cheap Claude model for utility prompts.
const CLAUDE_MODEL: &str = "claude-haiku-5-5";

/// Send `prompt` to `agent` and return its answer.
pub async fn run(agent: AgentKind, prompt: &str) -> AppResult<String> {
    let bin = access::binary_for(agent)
        .ok_or_else(|| AppError::Invalid("choisis Claude Code, Codex ou Antigravity".into()))?;
    let tmp = std::env::temp_dir();
    let last_message = tmp.join(format!("neuron-oneshot-{}.txt", uuid::Uuid::new_v4()));
    // (arguments, prompt written on stdin)
    let (args, stdin): (Vec<String>, Option<&str>) = match agent {
        AgentKind::ClaudeCode => {
            (["-p", "--output-format", "text", "--model", CLAUDE_MODEL].map(String::from).to_vec(), Some(prompt))
        }
        AgentKind::Codex => (
            vec![
                "exec".into(),
                "--skip-git-repo-check".into(),
                "--sandbox".into(),
                "read-only".into(),
                "--output-last-message".into(),
                last_message.display().to_string(),
                "-".into(),
            ],
            Some(prompt),
        ),
        AgentKind::Antigravity => (vec!["--print".into(), prompt.into(), "--mode".into(), "plan".into()], None),
        AgentKind::Generic => return Err(AppError::Invalid("choisis Claude Code, Codex ou Antigravity".into())),
    };

    let mut child = command(&bin, &args, &tmp)
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| spawn_error(&bin, e))?;
    if let (Some(text), Some(mut pipe)) = (stdin, child.stdin.take()) {
        pipe.write_all(text.as_bytes()).await?;
        drop(pipe); // EOF: the CLI starts
    }
    let output = tokio::time::timeout(TIMEOUT, child.wait_with_output()).await.map_err(|_| {
        AppError::Other(format!("{} n'a pas répondu en {} s", access::label(agent), TIMEOUT.as_secs()))
    })??;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let answer = match agent {
        AgentKind::Codex => {
            let text = std::fs::read_to_string(&last_message).unwrap_or_default();
            let _ = std::fs::remove_file(&last_message);
            text
        }
        _ => stdout.clone(),
    };
    if output.status.success() && !answer.trim().is_empty() {
        return Ok(answer);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let details = format!("{stdout}\n{stderr}");
    if access::classify_error(&details) == Some(access::AccessIssue::NotLoggedIn) {
        return Err(AppError::Other(format!(
            "{} n'est pas connecté à ton compte : connecte-le dans Paramètres → Agents & MCP.",
            access::label(agent)
        )));
    }
    let last = details.lines().rev().map(str::trim).find(|l| !l.is_empty()).unwrap_or("réponse vide");
    Err(AppError::Other(format!("{} : {last}", access::label(agent))))
}

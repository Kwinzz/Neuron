//! Live end-to-end checks of the agent adapters against the real CLIs (costs a few tokens).
//! Run manually: `cargo test --test live_agents -- --ignored --nocapture`
//! Set NEURON_LIVE_DIR to a throwaway folder.

use std::path::PathBuf;
use std::time::Duration;

use neuron_lib::agents::antigravity::AntigravityAdapter;
use neuron_lib::agents::claude::ClaudeCodeAdapter;
use neuron_lib::agents::codex::CodexAdapter;
use neuron_lib::agents::{AdapterEvent, AgentAdapter, SessionCommand, SessionSpec};

fn spec(model: &str, effort: Option<&str>) -> SessionSpec {
    let dir = std::env::var("NEURON_LIVE_DIR").expect("set NEURON_LIVE_DIR to a throwaway folder");
    SessionSpec {
        thread_id: "live".into(),
        cwd: PathBuf::from(dir),
        model: Some(model.into()),
        effort: effort.map(str::to_string),
        permission_mode: "acceptEdits".into(),
        resume: None,
        append_system_prompt: None,
    }
}

/// Two turns in the same session; returns the completed texts.
async fn two_turns(adapter: &dyn AgentAdapter, spec: SessionSpec) -> Vec<String> {
    let mut handle = adapter.start(&spec).expect("start");
    let mut texts = Vec::new();
    let mut turns = 0;
    handle.commands.send(SessionCommand::Prompt("Reply with exactly: ONE".into())).unwrap();
    while let Ok(Some(ev)) = tokio::time::timeout(Duration::from_secs(180), handle.events.recv()).await {
        match ev {
            AdapterEvent::BlockCompleted { text, channel: neuron_lib::agents::events::DeltaChannel::Text, .. } => {
                texts.push(text)
            }
            AdapterEvent::TurnComplete { error, usage, .. } => {
                assert!(error.is_none(), "turn error: {error:?}");
                assert!(usage.input + usage.cache_read > 0, "usage reported");
                turns += 1;
                if turns == 1 {
                    handle.commands.send(SessionCommand::Prompt("Reply with exactly: TWO".into())).unwrap();
                } else {
                    handle.commands.send(SessionCommand::Shutdown).unwrap();
                }
            }
            AdapterEvent::Exited { .. } => break,
            _ => {}
        }
    }
    assert_eq!(turns, 2, "two turns completed");
    texts
}

#[tokio::test]
#[ignore]
async fn claude_two_turns() {
    let texts = two_turns(&ClaudeCodeAdapter::default(), spec("claude-haiku-5-5", Some("low"))).await;
    println!("claude: {texts:?}");
    assert!(texts.iter().any(|t| t.contains("ONE")) && texts.iter().any(|t| t.contains("TWO")));
}

#[tokio::test]
#[ignore]
async fn antigravity_two_turns() {
    let texts = two_turns(&AntigravityAdapter::default(), spec("gemini-4-neon-low", Some("low"))).await;
    println!("antigravity: {texts:?}");
    assert!(texts.iter().any(|t| t.contains("ONE")) && texts.iter().any(|t| t.contains("TWO")));
}

#[tokio::test]
#[ignore]
async fn codex_two_turns() {
    let texts = two_turns(&CodexAdapter::default(), spec("gpt-6-luna", Some("low"))).await;
    println!("codex: {texts:?}");
    assert!(texts.iter().any(|t| t.contains("ONE")) && texts.iter().any(|t| t.contains("TWO")));
}

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
        mcp: None,
        remote_mcp: None,
        generic: None,
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

/// One turn; returns the concatenated completed text.
async fn ask(adapter: &dyn AgentAdapter, spec: SessionSpec, prompt: String) -> String {
    let mut handle = adapter.start(&spec).expect("start");
    handle.commands.send(SessionCommand::Prompt(prompt.into())).unwrap();
    let mut out = String::new();
    while let Ok(Some(ev)) = tokio::time::timeout(Duration::from_secs(180), handle.events.recv()).await {
        match ev {
            AdapterEvent::BlockCompleted { text, channel: neuron_lib::agents::events::DeltaChannel::Text, .. } => {
                out.push_str(&text)
            }
            AdapterEvent::TurnComplete { error, .. } => {
                assert!(error.is_none(), "turn error: {error:?}");
                handle.commands.send(SessionCommand::Shutdown).unwrap();
            }
            AdapterEvent::Exited { .. } => break,
            _ => {}
        }
    }
    out
}

const CONTEXT: &str = "# Contexte du projet\nLe mot de code de ce projet est PAPAYE.";
const QUESTION: &str = "Quel est le mot de code du projet ? Réponds avec ce seul mot.";

#[tokio::test]
#[ignore]
async fn claude_receives_system_context() {
    let mut s = spec("claude-haiku-5-5", Some("low"));
    s.append_system_prompt = Some(CONTEXT.into());
    let answer = ask(&ClaudeCodeAdapter::default(), s, QUESTION.into()).await;
    println!("claude: {answer}");
    assert!(answer.to_uppercase().contains("PAPAYE"));
}

#[tokio::test]
#[ignore]
async fn codex_and_antigravity_receive_preamble() {
    let prompt = neuron_lib::context::as_preamble(CONTEXT, QUESTION);
    let codex = ask(&CodexAdapter::default(), spec("gpt-6-luna", Some("low")), prompt.clone()).await;
    println!("codex: {codex}");
    let agy = ask(&AntigravityAdapter::default(), spec("gemini-4-neon-low", None), prompt).await;
    println!("antigravity: {agy}");
    assert!(codex.to_uppercase().contains("PAPAYE") && agy.to_uppercase().contains("PAPAYE"));
}

/// One turn with Neuron's memory MCP server; prints tool calls; returns the text.
async fn ask_with_memory(adapter: &dyn AgentAdapter, mut spec: SessionSpec, agent: &str) -> (String, Vec<String>) {
    use neuron_lib::memory::{MemoryCategory, MemoryPaths, mcp::McpLaunch};
    let dir = PathBuf::from(std::env::var("NEURON_LIVE_DIR").unwrap()).join(format!("mem-{agent}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let paths = MemoryPaths { db_path: dir.join("neuron.db"), file_path: dir.join("memory.md") };
    let db = neuron_lib::db::Db::open(&paths.db_path).unwrap();
    db.blocking(|c| {
        neuron_lib::db::memories::insert(c, MemoryCategory::Other, "Le mot de code mémoire est KIWI.", "user", 1)
    })
    .unwrap();
    drop(db);
    spec.mcp = Some(McpLaunch::new(PathBuf::from(env!("CARGO_BIN_EXE_neuron")), &paths, agent, None));

    let mut handle = adapter.start(&spec).expect("start");
    handle
        .commands
        .send(SessionCommand::Prompt(
            "Appelle l'outil MCP neuron_memory (action search) avec la requête « mot de code », puis réponds uniquement \
             avec le mot de code trouvé."
                .into(),
        ))
        .unwrap();
    let (mut out, mut tools) = (String::new(), Vec::new());
    while let Ok(Some(ev)) = tokio::time::timeout(Duration::from_secs(240), handle.events.recv()).await {
        match ev {
            AdapterEvent::BlockCompleted { text, channel: neuron_lib::agents::events::DeltaChannel::Text, .. } => {
                out.push_str(&text)
            }
            AdapterEvent::ToolCallStart { name, .. } => tools.push(name),
            AdapterEvent::ToolCallResult { output, is_error, .. } => {
                println!("[{agent}] tool result (error={is_error}): {}", output.chars().take(160).collect::<String>())
            }
            AdapterEvent::PermissionRequest { .. } => println!("[{agent}] PERMISSION REQUEST: {ev:?}"),
            AdapterEvent::Warning(w) => println!("[{agent}] warning: {w}"),
            AdapterEvent::TurnComplete { error, .. } => {
                if let Some(e) = error {
                    println!("[{agent}] turn error: {e}");
                }
                handle.commands.send(SessionCommand::Shutdown).unwrap();
            }
            AdapterEvent::Exited { stderr_tail, .. } => {
                if !stderr_tail.trim().is_empty() {
                    println!("[{agent}] stderr: {}", stderr_tail.chars().take(400).collect::<String>());
                }
                break;
            }
            _ => {}
        }
    }
    (out, tools)
}

#[tokio::test]
#[ignore]
async fn memory_mcp_claude() {
    let (answer, tools) =
        ask_with_memory(&ClaudeCodeAdapter::default(), spec("claude-haiku-5-5", Some("low")), "claude_code").await;
    println!("claude tools={tools:?} answer={answer}");
    assert!(answer.to_uppercase().contains("KIWI"));
}

#[tokio::test]
#[ignore]
async fn memory_mcp_codex() {
    let (answer, tools) = ask_with_memory(&CodexAdapter::default(), spec("gpt-6-luna", Some("low")), "codex").await;
    println!("codex tools={tools:?} answer={answer}");
    assert!(answer.to_uppercase().contains("KIWI"));
}

#[tokio::test]
#[ignore]
async fn memory_mcp_antigravity() {
    let (answer, tools) =
        ask_with_memory(&AntigravityAdapter::default(), spec("gemini-4-neon-low", None), "antigravity").await;
    println!("antigravity tools={tools:?} answer={answer}");
    assert!(answer.to_uppercase().contains("KIWI"));
}

/// A pasted image reaches each agent through Neuron's adapters (Claude inline, Codex --image, agy by path).
#[tokio::test]
#[ignore]
async fn image_attachment_all_agents() {
    use base64::Engine;
    let dir = PathBuf::from(std::env::var("NEURON_LIVE_DIR").unwrap()).join("attachments");
    // 32×32 solid red PNG.
    let png = {
        let w = 32u32;
        // Each row: filter byte 0 then `w` red pixels.
        let row: Vec<u8> = std::iter::once(0u8).chain([0xd0, 0x10, 0x10].repeat(w as usize)).collect();
        let raw = row.repeat(w as usize);
        fn chunk(out: &mut Vec<u8>, t: &[u8], d: &[u8]) {
            out.extend_from_slice(&(d.len() as u32).to_be_bytes());
            let mut c = t.to_vec();
            c.extend_from_slice(d);
            out.extend_from_slice(&c);
            let mut crc = 0xffff_ffffu32;
            for b in &c {
                crc ^= u32::from(*b);
                for _ in 0..8 {
                    crc = if crc & 1 != 0 { (crc >> 1) ^ 0xedb8_8320 } else { crc >> 1 };
                }
            }
            out.extend_from_slice(&(!crc).to_be_bytes());
        }
        // Stored (uncompressed) deflate block inside a zlib stream.
        let mut z = vec![0x78, 0x01, 0x01];
        let len = raw.len() as u16;
        z.extend_from_slice(&len.to_le_bytes());
        z.extend_from_slice(&(!len).to_le_bytes());
        z.extend_from_slice(&raw);
        let (mut a, mut b) = (1u32, 0u32);
        for x in &raw {
            a = (a + u32::from(*x)) % 65521;
            b = (b + a) % 65521;
        }
        z.extend_from_slice(&((b << 16) | a).to_be_bytes());
        let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut ihdr = w.to_be_bytes().to_vec();
        ihdr.extend_from_slice(&w.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        chunk(&mut out, b"IHDR", &ihdr);
        chunk(&mut out, b"IDAT", &z);
        chunk(&mut out, b"IEND", &[]);
        out
    };
    let data = base64::engine::general_purpose::STANDARD.encode(&png);
    let image = neuron_lib::attachments::save_base64(&dir, "collée.png", "image/png", &data).unwrap();
    let turn = neuron_lib::agents::UserTurn {
        text: "Quelle est la couleur dominante de l'image jointe ? Réponds en un mot.".into(),
        attachments: vec![image],
    };
    for (name, adapter, spec) in [
        (
            "claude",
            Box::new(ClaudeCodeAdapter::default()) as Box<dyn AgentAdapter>,
            spec("claude-haiku-5-5", Some("low")),
        ),
        ("codex", Box::new(CodexAdapter::default()), spec("gpt-6-luna", Some("low"))),
        ("antigravity", Box::new(AntigravityAdapter::default()), spec("gemini-4-neon-low", None)),
    ] {
        let mut handle = adapter.start(&spec).expect("start");
        handle.commands.send(SessionCommand::Prompt(turn.clone())).unwrap();
        let mut out = String::new();
        while let Ok(Some(ev)) = tokio::time::timeout(Duration::from_secs(180), handle.events.recv()).await {
            match ev {
                AdapterEvent::BlockCompleted {
                    text, channel: neuron_lib::agents::events::DeltaChannel::Text, ..
                } => out.push_str(&text),
                AdapterEvent::TurnComplete { error, .. } => {
                    assert!(error.is_none(), "{name}: {error:?}");
                    handle.commands.send(SessionCommand::Shutdown).unwrap();
                }
                AdapterEvent::Exited { .. } => break,
                _ => {}
            }
        }
        println!("{name}: {out}");
        assert!(out.to_lowercase().contains("rouge") || out.to_lowercase().contains("red"), "{name}: {out}");
    }
}

/// The « / » menu lists real commands for Claude (initialize) and Antigravity (ACP).
#[tokio::test]
#[ignore]
async fn slash_command_lists() {
    use neuron_lib::agents::events::AgentKind;
    let dir = PathBuf::from(std::env::var("NEURON_LIVE_DIR").unwrap());
    for agent in [AgentKind::ClaudeCode, AgentKind::Antigravity, AgentKind::Codex] {
        let list = neuron_lib::agents::slash::list(agent, &dir).await;
        println!(
            "{agent:?}: {} commands, e.g. {:?}",
            list.len(),
            list.iter().take(6).map(|c| &c.name).collect::<Vec<_>>()
        );
        assert!(!list.is_empty(), "{agent:?}");
    }
}

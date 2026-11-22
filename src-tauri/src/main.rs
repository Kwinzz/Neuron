// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `neuron --mcp-memory …`: the embedded memory MCP server launched by agents (no window).
    if let Some(code) = neuron_lib::memory::mcp::entry_from_args() {
        std::process::exit(code);
    }
    neuron_lib::run()
}

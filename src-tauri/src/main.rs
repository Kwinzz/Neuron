// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK: the DMA-BUF renderer shows a blank window when the proprietary NVIDIA driver is the only GPU. Only
    // there: turning it off elsewhere (hybrid laptops included) drops GPU rendering and the whole app lags.
    // (A value set by the user always wins.)
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        && neuron_lib::env_path::needs_dmabuf_workaround(&neuron_lib::env_path::gpu_drivers())
    {
        // SAFETY: first statement of `main`, before any other thread exists.
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }
    // `neuron --mcp-memory …`: the embedded memory MCP server launched by agents (no window).
    if let Some(code) = neuron_lib::memory::mcp::entry_from_args() {
        std::process::exit(code);
    }
    // `neuron serve`, `neuron status`, `neuron remote …`: the command line (no window).
    if let Some(code) = neuron_lib::cli::entry_from_args() {
        std::process::exit(code);
    }
    neuron_lib::run()
}

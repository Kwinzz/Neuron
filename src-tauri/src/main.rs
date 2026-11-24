// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK: the DMA-BUF renderer shows a blank window with the proprietary NVIDIA driver. Only there: turning
    // it off elsewhere drops GPU rendering and makes the whole app lag. (A value set by the user always wins.)
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        && std::path::Path::new("/proc/driver/nvidia/version").exists()
    {
        // SAFETY: first statement of `main`, before any other thread exists.
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }
    // `neuron --mcp-memory …`: the embedded memory MCP server launched by agents (no window).
    if let Some(code) = neuron_lib::memory::mcp::entry_from_args() {
        std::process::exit(code);
    }
    neuron_lib::run()
}

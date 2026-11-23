fn main() {
    // The icons are embedded at compile time (exe resource + window icon): rebuild when they change.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}

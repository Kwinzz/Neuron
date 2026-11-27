// `npm run dev:isolated [-- <tauri dev args>]`: Neuron in dev on its own data, next to the installed Neuron.
// NEURON_DATA_DIR (default ~/.neuron-dev) holds the database, memory.md and the webview data; the dev build then
// skips the app-wide single instance (debug builds only, see `state::isolated_dev`).
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const dataDir = process.env.NEURON_DATA_DIR || join(homedir(), ".neuron-dev");
console.log(`Neuron (dev) — data: ${dataDir}`);

const child = spawn("npm", ["run", "tauri", "dev", "--", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, NEURON_DATA_DIR: dataDir },
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));

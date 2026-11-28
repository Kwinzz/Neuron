# Neuron

Desktop app that drives your command-line AI agents — **Claude Code**, **Codex**, **Antigravity (`agy`)** and custom CLIs — from a single interface: parallel chats, shared memory, quotas & costs, notifications, quick prompt, and multi-device control.

Neuron contains no AI of its own: it runs the CLIs installed on your devices, using your own subscriptions.

![Neuron — Home: token usage per agent over the last 7 days, projects and chats (example data)](docs/screenshot-home-en.png)

**Jump to:** [Features](#features) · [Install](#install) · [AI agents](#first-launch-ai-agents) · [Other devices & servers](#other-devices--headless-servers) · [CLI reference](#cli-reference) · [Data & development](#data-privacy--development)

---

## Features

- **Multi-agent chats**: Claude Code, Codex, Antigravity and custom CLIs — streaming, code blocks, inline file diffs, approval requests, Plan mode, model & reasoning level picker.
- **Parallel agents & sub-agents**: every chat runs in the background, tracked live in **Live threads** with a mini-terminal per sub-agent.
- **Projects & shared memory**: one folder = one project (`.neuron/context.md`, git status), plus global memory shared across all agents via built-in MCP (importable from claude.ai, ChatGPT, Gemini or `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, editable in `~/.neuron/memory.md`).
- **Quotas & costs**: 5-hour / weekly subscription windows, token counts and estimated costs per agent and project.
- **Desktop workflow**: global quick prompt, end-of-turn notifications, system tray, launch at login, English & French UI (**Settings → General → Language**).
- **Multi-device & cross-device workspaces**: pair PCs or headless Linux servers with a 6-digit code (LAN or internet). Drive agents remotely, or run **Claude Code**, **Codex** or **Antigravity** on one paired PC while its file & terminal tools operate on another.

---

## Install

### Windows

1. Download `Neuron_<version>_x64-setup.exe` from the [latest release](https://github.com/Kwinzz/Neuron/releases/latest).
2. Run it (accept admin prompt; if SmartScreen warns because the installer isn't signed, click **More info → Run anyway**).
3. Pick your language (EN/FR) and options (launch at login, add `neuron` to PATH).

**Update:** **Settings → Updates**, `neuron update` in a terminal, or re-run the new installer directly (updates in place and keeps all chats/settings).

<details>
<summary>Build from source (Windows)</summary>

Requirements: [Rust](https://rustup.rs), [Node.js](https://nodejs.org) 20.19+, [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (C++ Build Tools, WebView2).

```powershell
git clone https://github.com/Kwinzz/Neuron && cd Neuron
npm ci
npm run tauri build
```

Installer output: `src-tauri\target\release\bundle\nsis\`.

</details>

### Linux (Arch, Debian / Ubuntu, Fedora)

One command downloads the prebuilt package for the latest `main` build (`x86_64` and `ARM64`, installed via `pacman` / `apt` / `dnf` in a few seconds; falls back to building from source elsewhere or with `--from-source`):

```bash
curl -fsSL https://raw.githubusercontent.com/Kwinzz/Neuron/main/install.sh | bash
```

**Update / reinstall / uninstall:** run the same command again, use **Settings → Updates** / `neuron update`, or pass flags directly:

```bash
curl -fsSL https://raw.githubusercontent.com/Kwinzz/Neuron/main/install.sh | bash -s -- --update      # or --install, --reinstall
curl -fsSL https://raw.githubusercontent.com/Kwinzz/Neuron/main/install.sh | bash -s -- --uninstall   # --yes skips prompts (data is never auto-deleted)
```

> Pass `--lang en` (or `fr`) to skip the language prompt, or `NEURON_BRANCH=<branch> bash` to build another branch from source. On Debian 12 / Ubuntu 24.04, building from source requires Node.js 20.19+ ([NodeSource](https://github.com/nodesource/distributions)).

<details>
<summary>Build by hand & Linux specifics (Arch, Wayland, GNOME tray, NVIDIA…)</summary>

**Arch Linux (`makepkg`)**:
```bash
sudo pacman -S --needed base-devel git rust nodejs npm mold webkit2gtk-4.1 gtk3 libayatana-appindicator
git clone https://github.com/Kwinzz/Neuron && cd Neuron/packaging/arch
makepkg -si   # update: git pull && makepkg -si · uninstall: sudo pacman -R neuron
```

**Debian / Ubuntu & other distros**:
```bash
sudo apt install build-essential curl git libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev
git clone https://github.com/Kwinzz/Neuron && cd Neuron
npm ci && npm run tauri build   # bundles in src-tauri/target/release/bundle/ (add -- --bundles rpm for .rpm)
```

**Linux tips**:
- **Wayland quick prompt**: bind `neuron --quick` to a desktop shortcut (e.g. Hyprland: `bind = CTRL ALT, Space, exec, neuron --quick`). X11 uses Neuron's built-in shortcut directly.
- **GNOME tray icon**: install the *AppIndicator and KStatusNotifierItem Support* extension.
- **Blank window (NVIDIA)**: launch with `WEBKIT_DISABLE_DMABUF_RENDERER=1 neuron` (or `WEBKIT_DISABLE_COMPOSITING_MODE=1 neuron`).
- **Missing CLI in PATH**: Neuron reads your shell PATH on launch — restart it after editing `~/.bashrc`, `~/.zshrc` or fish config.

More details in [`packaging/arch/README.md`](packaging/arch/README.md).

</details>

---

## First launch: AI agents

Install and sign in to at least one CLI — easiest in **Settings → Agents & MCP → AI providers** (one-click **Install** & **Sign in**), or from your terminal:

| Agent | Account | Install (Windows PowerShell) | Install (Linux) | Sign in |
|---|---|---|---|---|
| **Claude Code** | Claude Pro / Max or API key | `irm https://claude.ai/install.ps1 \| iex` | `curl -fsSL https://claude.ai/install.sh \| bash` | `claude auth login` |
| **Codex** | ChatGPT Plus / Pro or API key | `irm https://chatgpt.com/codex/install.ps1 \| iex` | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` | `codex login` |
| **Antigravity (`agy`)** | Google account | `irm https://antigravity.google/cli/install.ps1 \| iex` | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` | `agy` then `/login` |

---

## Other devices & headless servers

Run Neuron on a server, Raspberry Pi or second PC without a screen and control it from your desktop app:

```bash
curl -fsSL https://raw.githubusercontent.com/Kwinzz/Neuron/main/install.sh | bash
neuron service install            # background systemd user service, starts at boot
neuron remote enable --internet   # allow remote control (--internet = outside LAN via relays)
neuron remote code                # prints a 6-digit code + invitation to enter on your PC
```

On your PC: **Settings → Devices → Add a device**, pick the machine on your network (or paste the invitation after enabling *Reachable outside the local network*), then sign in to your CLIs on the server once.

- **Cross-device workspaces** (AI on your PC, files/shell on this server): enable remote tools on the target machine with `neuron remote tools on` (or `--scope full` for access outside Neuron projects), and give the PC `full` access (`neuron remote level <device> full`).
- **Firewall**: allow UDP port `47831` (`ufw allow 47831/udp`) for direct connections.

---

## CLI reference

Run **`neuron help`** (or `neuron --help` / `neuron -h`) at any time to list every available command.

### General & updates

| Command | Description |
|---|---|
| `neuron` | Open the desktop app |
| `neuron --quick` / `neuron --background` | Open the quick prompt / launch minimized in tray |
| `neuron help` (`--help`, `-h`) | List all CLI commands and usage |
| `neuron version` (`--version`, `-V`) | Print the installed version |
| `neuron status` | Running instance, device ID, remote access state, installed agents |
| `neuron update [--check] [--yes]` | Check for updates and install the latest build (restarts service on Linux) |
| `neuron serve` | Run Neuron headless in the foreground (no window) |

### Remote devices & cross-device tools

| Command | Description |
|---|---|
| `neuron remote enable [--internet]` | Allow paired devices to control this machine (`--internet`: via public relays too) |
| `neuron remote disable` | Stop allowing remote control of this machine |
| `neuron remote internet on\|off` | Toggle reachability outside the local network |
| `neuron remote tools on\|off [--scope projects\|full]` | Allow remote file/shell tools for `full`-access peers (`projects` by default) |
| `neuron remote name <name>` | Set the display name shown to other devices |
| `neuron remote code` | Open a pairing window and print the 6-digit code (+ invitation if internet is on) |
| `neuron remote devices` | List paired devices and their access levels |
| `neuron remote level <device> read\|chat\|full` | Change a paired device's access level |
| `neuron remote revoke <device>` | Remove a device's access to this machine |
| `neuron remote forget <device>` | Stop controlling a paired host |

> `<device>` accepts any unique prefix of the device name or ID.

### Background service (Linux / systemd)

| Command | Description |
|---|---|
| `neuron service install` | Install, enable and start `neuron.service` (with `loginctl enable-linger`) |
| `neuron service restart` | Restart the background service |
| `neuron service status` | Show systemd service status |
| `neuron service uninstall` | Stop, disable and remove `neuron.service` |
| `systemctl --user stop neuron` / `start neuron` | Stop or start the background service manually |
| `journalctl --user -u neuron -f` | Follow live service logs |

---

## Data, privacy & development

| | Windows | Linux |
|---|---|---|
| **Database** | `%APPDATA%\dev.neuron.app\` | `~/.local/share/dev.neuron.app/` |
| **Shared memory** | `%USERPROFILE%\.neuron\memory.md` | `~/.neuron/memory.md` |

**Network:** Neuron itself only fetches the public model price list (at most once/day) and checks GitHub for updates (every 12h, toggleable in **Settings → Updates**), plus encrypted P2P traffic to devices you explicitly pair. Everything else stays local.

**Development:**
```bash
npm ci
npm run tauri dev        # full app in dev mode (or npm run dev:isolated for a separate data dir)
cd src-tauri && cargo test
```

Stack: Tauri 2 (Rust, SQLite) + React 19 / TypeScript / Tailwind CSS 4. UI strings live in `src/i18n/{fr,en}/`; backend strings use `tr!` (`src-tauri/src/i18n.rs`).

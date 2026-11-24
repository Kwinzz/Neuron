# Neuron on Arch Linux

Package built from the sources of this repository (`/usr/bin/neuron` binary, menu entry, icons).

## Install

The easiest way, from anywhere (also offers update / uninstall when Neuron is already there; asks for the
language — `--lang en` or `--lang fr` to skip the question):

```bash
curl -fsSL https://raw.githubusercontent.com/Kwinzz/Neuron/main/install.sh | bash
```

By hand:

```bash
sudo pacman -S --needed base-devel git rust nodejs npm mold webkit2gtk-4.1 gtk3 libayatana-appindicator
git clone https://github.com/Kwinzz/Neuron
cd Neuron/packaging/arch
makepkg -si
```

Update: `git pull` at the root of the repository, then `makepkg -si` again in `packaging/arch`.
Builds use `packaging/linux-build-env.sh` (no LTO, incremental, `mold` linker): updates only rebuild what changed.

## After installing

- Start **Neuron** from the applications menu.
- Settings → Agents & MCP: « Install » / « Sign in » open a terminal (`$TERMINAL`, otherwise kitty, alacritty, foot,
  wezterm, ghostty, konsole, gnome-terminal, kgx, ptyxis, xfce4-terminal, xterm).
- **Quick prompt on Wayland** (Hyprland, KDE, GNOME…): global shortcuts don't exist there, bind the command
  `neuron --quick` to a shortcut of your desktop, e.g. for Hyprland: `bind = CTRL ALT, Space, exec, neuron --quick`.
  On X11, the shortcut set in Neuron works directly.
- System tray icon on GNOME: needs the « AppIndicator and KStatusNotifierItem Support » extension.

## Troubleshooting

- **White or black window**: Neuron only disables WebKit's DMA-BUF renderer when NVIDIA is the only GPU. If it still
  happens, try `WEBKIT_DISABLE_DMABUF_RENDERER=1 neuron`, then `WEBKIT_DISABLE_COMPOSITING_MODE=1 neuron`.
- **Laggy UI on a hybrid laptop**: make sure GPU rendering is on: `WEBKIT_DISABLE_DMABUF_RENDERER=0 neuron`.
- **CLI not found although it works in your terminal**: Neuron reads your login shell's PATH (`$SHELL -ilc`) at
  startup; restart Neuron after editing `~/.bashrc` / `~/.zshrc` / your fish config.
- Logs: run `RUST_LOG=info neuron` from a terminal.

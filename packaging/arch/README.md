# Neuron sur Arch Linux

Paquet construit depuis les sources de ce dépôt (binaire `/usr/bin/neuron`, entrée de menu, icônes).

## Installer

```bash
sudo pacman -S --needed base-devel git rust nodejs npm webkit2gtk-4.1 gtk3 libayatana-appindicator
git clone https://github.com/Kwinzz/Neuron
cd Neuron/packaging/arch
makepkg -si
```

Mettre à jour : `git pull` à la racine du dépôt, puis `makepkg -si` à nouveau dans `packaging/arch`.

## Après l'installation

- Lance **Neuron** depuis le menu des applications.
- Paramètres → Agents & MCP : « Installer » / « Se connecter » ouvrent un terminal (`$TERMINAL`, sinon kitty,
  alacritty, foot, wezterm, ghostty, konsole, gnome-terminal, kgx, ptyxis, xfce4-terminal, xterm).
- **Demande rapide sous Wayland** (Hyprland, KDE, GNOME…) : les raccourcis globaux n'existent pas, lie la commande
  `neuron --quick` à un raccourci de ton bureau, par exemple pour Hyprland :
  `bind = CTRL ALT, Space, exec, neuron --quick`. Sous X11, le raccourci réglé dans Neuron fonctionne directement.
- Icône de la zone de notification : sous GNOME, il faut l'extension « AppIndicator and KStatusNotifierItem Support ».

## Dépannage

- **Fenêtre blanche ou noire** : Neuron met déjà `WEBKIT_DISABLE_DMABUF_RENDERER=1` ; si ça persiste (NVIDIA),
  essaie `WEBKIT_DISABLE_COMPOSITING_MODE=1 neuron`.
- **CLI introuvable alors qu'il marche dans le terminal** : Neuron lit le PATH de ton shell de connexion
  (`$SHELL -ilc`) au démarrage ; relance Neuron après avoir modifié ton `~/.bashrc` / `~/.zshrc` / config fish.
- Journaux : lance `RUST_LOG=info neuron` depuis un terminal.

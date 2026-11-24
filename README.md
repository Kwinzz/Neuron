# Neuron

Application de bureau qui pilote tes agents IA en ligne de commande — **Claude Code**, **Codex**, **Antigravity**
et d'autres CLI — dans une seule interface : chats, mémoire partagée entre les agents, quotas et coûts,
notifications et demande rapide depuis n'importe quelle app.

Neuron ne contient pas d'IA : il lance les CLI installés sur ton ordinateur, avec ton propre abonnement.

---

## Installation sous Windows

1. Télécharge l'installateur `Neuron_<version>_x64-setup.exe` depuis la
   [dernière release](https://github.com/Kwinzz/Neuron/releases/latest).
2. Lance-le et accepte la demande de droits administrateur (installation dans *Program Files*).
3. Choisis si Neuron doit démarrer avec Windows, puis lance-le depuis le menu Démarrer.

> Windows SmartScreen peut afficher « Windows a protégé votre ordinateur » (l'installateur n'est pas signé) :
> clique sur **Informations complémentaires** → **Exécuter quand même**.

Mise à jour : télécharge la nouvelle version et lance-la, elle remplace l'ancienne (tes données sont gardées).

### Compiler soi-même (Windows)

Prérequis : [Rust](https://rustup.rs), [Node.js](https://nodejs.org) 20+, les
[prérequis Tauri](https://v2.tauri.app/start/prerequisites/) (Microsoft C++ Build Tools, WebView2).

```powershell
git clone https://github.com/Kwinzz/Neuron
cd Neuron
npm ci
npm run tauri build
```

L'installateur est créé dans `src-tauri\target\release\bundle\nsis\`.

---

## Installation sous Linux

### Arch Linux (et dérivées : EndeavourOS, Manjaro, CachyOS…)

Le paquet est construit depuis les sources avec `makepkg` (compter quelques minutes pour la première compilation) :

```bash
sudo pacman -S --needed base-devel git rust nodejs npm webkit2gtk-4.1 gtk3 libayatana-appindicator
git clone https://github.com/Kwinzz/Neuron
cd Neuron/packaging/arch
makepkg -si
```

Neuron apparaît ensuite dans le menu des applications (commande `neuron`).

Mise à jour :

```bash
cd Neuron && git pull
cd packaging/arch && makepkg -si
```

Désinstallation : `sudo pacman -R neuron`.

### Autres distributions (Debian, Ubuntu, Fedora…)

Pas encore de paquet tout prêt : compile avec Tauri, qui produit un `.deb` et un AppImage.

```bash
# Debian / Ubuntu : dépendances de compilation
sudo apt install build-essential curl git libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev
# Rust (https://rustup.rs) et Node.js 20+ requis
git clone https://github.com/Kwinzz/Neuron
cd Neuron
npm ci
npm run tauri build
```

Les paquets sont dans `src-tauri/target/release/bundle/` (`deb/`, `appimage/`). Pour les autres distributions,
voir les [prérequis Tauri pour Linux](https://v2.tauri.app/start/prerequisites/#linux).

### Spécificités Linux

- **Demande rapide sous Wayland** (Hyprland, KDE Plasma, GNOME, Sway…) : les raccourcis globaux n'y existent pas.
  Lie la commande `neuron --quick` à un raccourci de ton bureau. Exemple Hyprland :
  `bind = CTRL ALT, Space, exec, neuron --quick`. Sous X11, le raccourci réglé dans Neuron marche directement.
- **Icône de la zone de notification** sous GNOME : installe l'extension
  « AppIndicator and KStatusNotifierItem Support ».
- **Fenêtre blanche ou noire** (souvent NVIDIA) : lance `WEBKIT_DISABLE_COMPOSITING_MODE=1 neuron`.
- **Un CLI n'est pas trouvé** alors qu'il marche dans ton terminal : Neuron lit le PATH de ton shell au démarrage,
  relance-le après avoir modifié `~/.bashrc`, `~/.zshrc` ou ta config fish.

Plus de détails : [`packaging/arch/README.md`](packaging/arch/README.md).

---

## Premier lancement : les agents

Neuron a besoin d'au moins un des CLI suivants, installé **et connecté à ton compte** :

| Agent | Abonnement / compte |
|---|---|
| Claude Code | Claude Pro / Max ou clé API Anthropic |
| Codex | ChatGPT Plus / Pro ou clé API OpenAI |
| Antigravity (`agy`) | Compte Google |

Le plus simple : **Paramètres → Agents & MCP → Fournisseurs IA**. Pour chaque agent, Neuron indique s'il est
installé et connecté, et propose :

- **Installer** : ouvre un terminal avec l'installateur officiel ;
- **Se connecter** : ouvre un terminal avec la connexion du CLI (une page peut s'ouvrir dans le navigateur).

Neuron détecte tout seul la fin de l'installation ou de la connexion. Si un agent n'est pas connecté, le chat le
signale aussi, avec le bouton pour régler ça.

Commandes officielles, si tu préfères les lancer toi-même :

| Agent | Windows (PowerShell) | Linux |
|---|---|---|
| Claude Code | `irm https://claude.ai/install.ps1 \| iex` | `curl -fsSL https://claude.ai/install.sh \| bash` |
| Codex | `irm https://chatgpt.com/codex/install.ps1 \| iex` | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` |
| Antigravity | `irm https://antigravity.google/cli/install.ps1 \| iex` | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` |

Connexion : `claude auth login`, `codex login`, ou `agy` puis `/login`.

---

## Importer ta mémoire

Vue **Mémoire → Importer** : récupère ce que claude.ai, ChatGPT ou Gemini savent de toi (colle la liste de leurs
souvenirs) ou les fichiers d'instructions de tes CLI (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`,
`~/.gemini/GEMINI.md`). Tu vérifies l'aperçu, et tu peux demander à un agent de tout reformuler proprement.
La mémoire est partagée avec tous tes agents et reste éditable dans `~/.neuron/memory.md`.

---

## Où sont les données ?

| | Windows | Linux |
|---|---|---|
| Base de données | `%APPDATA%\dev.neuron.app\` | `~/.local/share/dev.neuron.app/` |
| Mémoire | `%USERPROFILE%\.neuron\memory.md` | `~/.neuron/memory.md` |

Neuron ne fait qu'un seul appel réseau à lui : la liste des prix publics des modèles (au plus une fois par jour),
pour estimer les coûts. Tout le reste reste sur ton ordinateur.

## Développement

```bash
npm ci
npm run tauri dev        # app complète en mode dev
cd src-tauri && cargo test
```

Voir [`CLAUDE.md`](CLAUDE.md) (conventions, architecture) et [`project.md`](project.md) (état et journal).

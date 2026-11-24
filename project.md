# Neuron — Contexte projet

> Document vivant. **Mis à jour à chaque changement** (voir règle dans `CLAUDE.md`).
> Dernière mise à jour : 2026-11-24 (import de mémoire, version Arch Linux)

## Vision

Application desktop personnelle, ultra-rapide et sans temps de chargement, qui centralise, pilote et transforme
les agents IA en ligne de commande (**Claude Code**, **Antigravity**, **Codex**, futurs CLI) en un poste de pilotage
graphique unifié.

## Fonctionnalités cibles

- **A. Moteur multi-agents** — `trait AgentAdapter` Rust, events normalisés (`MessageDelta`, `ToolCallStart`,
  `ToolCallResult`, `PermissionRequest`, `TokenUsageUpdate`, `ThreadStatusChanged`, `ThreadError`).
  Adaptateurs : `ClaudeCodeAdapter` (stream-json, prioritaire), `AntigravityAdapter`, `CodexAdapter`,
  `GenericCliAdapter` (configurable en JSON, fallback PTY).
- **B. Projets & contexte** — projet = répertoire local ; `.neuron/context.md` auto-créé et éditable (preview MD) ;
  injection automatique à chaque nouveau thread : context.md + snapshot git (branche, fichiers récents) + mémoire
  globale pertinente ; indicateur de contexte actif dans le chat.
- **C. Mémoire globale** — `~/.neuron/memory.md` (catégories *Profil*, *Préférences Techniques*, *Style de Code*,
  *Règles Strictes*) synchronisé avec SQLite `memories` ; serveur **MCP local embarqué** (`neuron_memory_read`,
  `neuron_memory_search`, `neuron_memory_save`) auto-configuré pour les agents compatibles ; injection texte sinon ;
  vue « Mémoire ».
- **D. Moniteur de threads live** — dock persistant : thread, projet, badge IA, statut granulaire, chrono, tokens
  live ; vrai multitâche (processus en arrière-plan côté Rust, kill propre) ; notifications/badges.
- **E. Chat avancé** — streaming 60 FPS, blocs de code (copie, nom de fichier), diffs, blocs pliables tool calls /
  thinking, sélecteur IA + modèle par thread, saisie `@` fichiers, `/` commandes, historique.
- **F. Mission Control** — accueil < 50 ms depuis SQLite : quotas/abonnements, consommation tokens (jour/semaine/mois,
  par IA et projet, coût estimé), activité live + reprise rapide, palette `Ctrl+K`.

## Direction artistique

**shadcn/ui** (style `radix-nova`, base *Neutral*, sombre uniquement) — look Vercel/shadcn « dashboard-01 » :
fond quasi noir, cartes plates à bordure fine, gris zinc, bouton principal blanc, beaucoup d'air.
(Historique : Linear/émeraude en phases 0–1, puis Vision UI violet ; remplacé par shadcn à la demande de l'utilisateur.)

| Élément | Valeur |
|---|---|
| Fond / carte / popover | `oklch(0.145)` / `oklch(0.175)` / `oklch(0.205)` (neutres) |
| Bordure / input | blanc 10 % / 15 % |
| Primaire | `oklch(0.922)` (blanc cassé) sur texte `oklch(0.205)` |
| Statuts | ok émeraude · warn ambre · destructive rouge · live bleu ciel (toujours avec icône/libellé) |
| Agents = `chart-1..4` (ordre fixe) | Claude `#d95926` · Antigravity `#3987e5` · Codex `#d55181` · Générique `#c98500` — revalidés sur fond neutre |
| Typo | Geist (UI), Geist Mono (code, compteurs) ; chiffres `tabular-nums` |
| Rayon | `--radius` 0.625rem (échelle shadcn) |
| Vocabulaire | « Accueil », « chat » (jamais « thread » à l'écran, sauf le panneau « Threads live ») |

## Décisions d'architecture

| Décision | Raison |
|---|---|
| Tauri **2.12** fixé (crate `2.12` / npm `^2.12`) | crates.io publie déjà 3.0-alpha ; on reste sur le stable exigé, crate et npm alignés sur la même mineure |
| TypeScript 7 (natif) + Vite 8 (rolldown/oxc) | versions courantes installées par npm ; options tsconfig modernes (bundler, ES2022) |
| `rusqlite` (bundled) plutôt que `sqlx` | synchrone simple, compile vite, SQLite embarqué avec FTS5, pas de macro réseau ; appelé via `spawn_blocking` |
| Migrations SQL embarquées + `PRAGMA user_version` | zéro dépendance, appliquées au `setup` en quelques ms |
| `ts-rs` pour les types IPC | génération fiable des types TS depuis Rust (`cargo test`), stable |
| Canal d'events unique `agent://event` | un seul listener front, routage par `threadId` |
| Polices via `@fontsource-variable` | aucune requête réseau au démarrage |
| Sous-agent **neon** → `agy -p --model gemini-4-neon-high` via `scripts/neon-bridge.sh` | parallélisation du travail UI ; mode par défaut `--dangerously-skip-permissions` (choix utilisateur), surcharge via `NEON_MODE` / `NEON_MODEL` |
| DB dans `app_data_dir()/neuron.db` (WAL) | données app séparées de la mémoire utilisateur `~/.neuron/` |
| Git : commit local par phase validée, pas de push | choix utilisateur |
| **shadcn/ui** (vrais composants Radix, cmdk, Recharts, Sonner) | choix utilisateur après comparaison avec Vision ; composants copiés dans le repo, thème par variables CSS |
| Nouveau chat sans pop-up : vue « brouillon », chat créé au 1er message | demande utilisateur ; aucun chat vide en base |
| Modèle exact + niveau de raisonnement (`--effort`) par chat, modifiables en cours de chat | un changement marque la session « périmée » : elle redémarre avec `--resume` avant le message suivant (contexte conservé) |
| Projets = dossiers locaux, affichés en dossiers repliables dans la sidebar | création d'un chat directement dans un projet (cwd = dossier du projet) |
| **zustand** pour l'état front | sélecteurs fins → un event d'un thread ne re-rend que sa ligne ; pas de Provider |
| Un seul aller-retour `dashboard_snapshot` pour l'accueil | < 1 ms de requêtes SQLite mesuré (affiché dans l'en-tête) |
| Buckets d'usage en heure **locale** calculés par SQLite (CTE récursive) | pas de dépendance chrono, buckets vides inclus |
| Rafraîchissement dashboard throttlé (2,5 s) sur events | évite de spammer SQLite pendant le streaming |
| Graphiques SVG faits main (pas de lib de charts) | bundle léger, contrôle total des règles dataviz |
| Commandes `dev_*` (seed / simulation d'events / purge) en debug | tester UI et pipeline d'events avant les vrais adaptateurs |
| `NEURON_DATA_DIR` | base isolée pour tests manuels et captures |
| Cartes quotas : limites `NULL` par défaut, éditables | les limites réelles Claude/Antigravity/Codex ne sont pas publiques en tokens |

## Environnement de dev

Windows 11 · Node 24.15 / npm 11.12 · Rust 1.99 (MSVC) · Git 2.54 · CLI : `claude`, `codex`, `agy` 1.5.13.

## État d'avancement

- [x] **Phase 0** — Init Tauri v2 + React/TS/Tailwind v4, CLAUDE.md, project.md, neon, bridge, schéma SQLite
- [x] **Phase 1** — Shell (sidebar, dock live, palette Ctrl+K) + Mission Control sur SQLite
- [x] **Phase 2** — `AgentAdapter`, registre multi-threads, `ClaudeCodeAdapter`, chat streaming
- [x] **Phase 3** — Projets, `.neuron/context.md`, injection de contexte (page projet, indicateur de contexte, aperçu dans le nouveau chat)
- [x] **Phase 4** — Mémoire globale (`~/.neuron/memory.md` + SQLite), vue Mémoire, serveur MCP embarqué
- [x] **Phase 5** — Adaptateurs Antigravity / Codex, CLI génériques (pipe + PTY), Paramètres, raccourcis, notifications, fluidité

## Journal des changements

### 2026-11-24 — Rendu GPU rétabli sur les portables hybrides (Linux)
- Le correctif « écran blanc NVIDIA » (`WEBKIT_DISABLE_DMABUF_RENDERER=1`) se déclenchait dès que le pilote NVIDIA
  était chargé, donc aussi sur les portables Intel/AMD + NVIDIA, où la fenêtre est dessinée par la puce intégrée :
  WebKitGTK perdait le rendu GPU → tout saccadait (survol, défilement). Maintenant : seulement si NVIDIA est la
  seule carte (`env_path::gpu_drivers` lit `/sys/class/drm/card*/device/driver`, `needs_dmabuf_workaround` testé).

### 2026-11-24 — Survol à la souris saccadé sous Linux
- Transitions CSS coupées sous Linux (`html.platform-linux`, durée 0) : chaque fondu de couleur de 150 ms au survol
  pouvait redessiner toute la fenêtre dans WebKitGTK. Les animations d'entrée (`animate-in`, menus, dialogues)
  restent. Animations des graphiques Recharts désactivées sous Linux (`UsageBarChart`, `CacheCard`).

### 2026-11-24 — Saccades pendant le travail des agents (surtout Linux)
- **Rechargements** : chaque `ThreadStatusChanged` (outil lancé, approbation demandée…) relançait le tableau de bord
  complet + la liste de la barre latérale (toutes les 2,5–3 s pendant qu'un agent travaille) → seulement au
  début / à la fin d'un tour, sur erreur ou fin de tour (`useAgentEventBridge`).
- **Re-rendus inutiles** : `lib/sameValue.ts::keepIfSame` — `useLive.hydrate` garde les fiches inchangées (et la
  map quand rien ne change), `useNav.load` garde `projects` / `chats`, `useDashboard.load` garde chaque partie du
  snapshot inchangée (cartes de l'Accueil, quotas de l'en-tête de chat).
- **Réponse en cours d'écriture** : le message entier était ré-analysé en Markdown + coloré (highlight.js) à chaque
  image → coloration syntaxique seulement une fois la réponse affichée (`Markdown highlight`), et sous Linux
  20 mises à jour / s au lieu de 60 (`useSmoothText`, même vitesse de défilement).

### 2026-11-24 — Compilation Linux plus rapide
- Les deux dernières étapes (crate `neuron` + édition des liens) prenaient ~5 min : profil release de Windows
  (LTO complet, `codegen-units = 1`). `packaging/linux-build-env.sh` (sourcé par le PKGBUILD et `install.sh`) :
  pas de LTO, 16 unités, compilation incrémentale (les mises à jour ne recompilent que ce qui a changé), éditeur
  de liens `mold` (ajouté aux dépendances), npm sans audit / fund. `NEURON_FULL_OPT=1` garde le profil complet.
  Windows (installateur NSIS) inchangé.

### 2026-11-24 — Fluidité sous Linux, Accueil remonté en haut
- **Linux lent / saccadé** : sous WebKitGTK, les flous et ombres animées sont repeints à chaque image. Classe
  `platform-linux` sur `<html>` (`main.tsx`) → sans `backdrop-filter`, apparition des blocs de réponse sans flou,
  logo « en cours » sans ombre animée ; barre d'en-tête du chat opaque (plus de flou sous le défilement).
- `WEBKIT_DISABLE_DMABUF_RENDERER=1` seulement avec le pilote NVIDIA propriétaire (`/proc/driver/nvidia/version`) :
  ailleurs il coupait le rendu GPU de WebKitGTK et ralentissait toute l'app.
- **Défilement** (Windows et Linux) : toutes les vues partagent un conteneur de défilement ; en quittant un chat,
  l'Accueil s'ouvrait au milieu. Remise en haut à chaque changement de vue (`AppShell`, sauf les chats qui
  descendent d'eux-mêmes au dernier message).

### 2026-11-24 — Premier lancement sur Arch : compatibilité WebKitGTK
- Écran planté au démarrage : `window.requestIdleCallback` n'existe pas dans WebKitGTK → `lib/idle.ts::whenIdle`
  (repli `setTimeout`), utilisé par le préchargement des vues (`AppShell`).
- `field-sizing: content` non géré par WebKit : hauteur des lignes de l'aperçu d'import calculée d'après le texte
  (la zone de saisie du chat se redimensionnait déjà en JS).

### 2026-11-24 — Installation Linux en une commande
- `install.sh` à la racine : `curl -fsSL https://raw.githubusercontent.com/Kwinzz/Neuron/main/install.sh | bash`.
  Détecte pacman / apt / dnf, installe les dépendances, Rust (rustup si absent, hors Arch) et vérifie Node ≥ 20.19,
  clone ou met à jour les sources dans `~/.local/share/neuron-src`, compile et installe (Arch : `makepkg -sif` du
  PKGBUILD ; Debian : `.deb` ; Fedora : `.rpm` via `tauri build --bundles`). Déjà installé → menu mettre à jour /
  réinstaller / désinstaller (questions lues sur `/dev/tty`, compatible `curl | bash`) ; options `--install`,
  `--update`, `--reinstall`, `--uninstall`, `--yes`. Désinstallation : paquet + entrée de démarrage auto ; données
  (`~/.local/share/dev.neuron.app`, `~/.neuron`) supprimées seulement sur demande explicite, jamais avec `--yes`.
- Testé ici par simulation (faux `uname` / `pacman` / `sudo`) : désinstallation et mise à jour jusqu'à `makepkg` ;
  à valider en vrai sur Arch.
- Arch : si `pacman -S` échoue (base locale périmée, miroir en 404 — vu sur Omarchy), le script propose
  `pacman -Syu` (jamais `-Sy` seul) puis réessaie.
- README : section « Fonctionnalités », liens rapides d'installation, Node 20.19+, `.rpm`, avertissement sur le
  retard possible de la release Windows.

### 2026-11-24 — README d'installation
- `README.md` à la racine : présentation, installation Windows (installateur de la release, SmartScreen,
  compilation), Linux (Arch via `makepkg -si`, autres distributions via `tauri build` → `.deb` / AppImage,
  spécificités Wayland / GNOME / WebKitGTK / PATH), premier lancement des agents (Fournisseurs IA, commandes
  officielles), import de mémoire, emplacement des données.

### 2026-11-24 — Version Arch Linux
- **Paquet** : `packaging/arch/PKGBUILD` (construit le dépôt local : `npm ci` + `tauri build --no-bundle`, installe
  `/usr/bin/neuron`, `neuron.desktop` avec l'action « Demande rapide », icônes hicolor) + `packaging/arch/README.md`
  (installation, Wayland, dépannage). `src-tauri/tauri.linux.conf.json` : cibles `deb` / `appimage` sous Linux,
  Windows inchangé (NSIS).
- **PATH** (`env_path.rs`, ex-`access::refresh_path`) : sous Linux, PATH du shell de connexion lu une fois en
  arrière-plan (`$SHELL -ilc`, fish géré, marqueurs pour ignorer les messages d'accueil, 3 s max) + `~/.local/bin`,
  `~/.npm-global/bin`, `~/.bun/bin`, `~/.cargo/bin`, `~/.codex/bin` ; donné explicitement aux enfants
  (`process::command`, PTY, terminal) — l'environnement du processus n'est jamais modifié sous Unix.
- **Processus** : agents lancés dans leur propre groupe (`process_group(0)`) ; `kill_process_tree` envoie `TERM` au
  groupe puis `KILL` 3 s plus tard.
- **Installer / Se connecter sous Linux** : terminal `$TERMINAL` puis kitty, alacritty, foot, wezterm, ghostty,
  konsole, gnome-terminal, kgx, ptyxis, xfce4-terminal, x-terminal-emulator, xterm ; script bash ; commandes
  officielles `curl -fsSL https://claude.ai/install.sh | bash`, `https://chatgpt.com/codex/install.sh | sh`,
  `https://antigravity.google/cli/install.sh | bash`. Scripts bash vérifiés par `bash -n` (test `dump_terminal_scripts`).
- **Demande rapide sous Wayland** : `neuron --quick` (instance unique → `toggle_quick`, ou démarrage en arrière-plan
  + demande rapide) ; message d'erreur explicite quand le raccourci global échoue sous Wayland ; aide dans Paramètres.
- `WEBKIT_DISABLE_DMABUF_RENDERER=1` par défaut sous Linux ; `util::neuron_exe()` (préfère `$APPIMAGE`) pour le
  serveur MCP ; libellés selon l'OS (`lib/platform.ts` : « Lancer à l'ouverture de session », notifications).
- Non compilé ici (Windows sans WebKitGTK) : à valider par `makepkg -si` sur la machine Arch.

### 2026-11-24 — Importer une mémoire (claude.ai, ChatGPT, Gemini, CLI)
- Vue Mémoire → **Importer** : texte collé ou fichier (.txt/.md/.json) depuis claude.ai / ChatGPT / Gemini (prompt
  à copier pour obtenir la liste), ou fichiers des CLI détectés (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`,
  `~/.gemini/GEMINI.md`). Aperçu modifiable (cases, catégorie, texte, doublons signalés), puis import.
- **Reformuler avec l'IA** (optionnel) : un agent installé (Claude Code par défaut, Haiku ; Codex `exec` en lecture
  seule ; Antigravity `--print --mode plan`) fusionne, réécrit et classe les souvenirs (`agents/oneshot.rs`,
  20 000 caractères max). Essai réel : 3 souvenirs bruts → 2 souvenirs propres bien classés.
- Backend `memory/import.rs` (fonctions pures testées : `split_memories` JSON / Markdown à titres / puces / texte,
  `guess_category` par mots-clés, `parse_reformulated`), commandes `memory_import_sources`,
  `read_memory_import_file`, `split_memory_import`, `reformulate_memory_import`, `import_memories`
  (`source = import:<origine>`, doublons ignorés). UI par neon : `MemoryImportDialog` + `Import*`, source affichée
  « Importé de ChatGPT ».

### 2026-11-24 — Fournisseurs IA : installer / se connecter, « non connecté » dans le chat
- **`agents/access.rs`** : pour Claude Code, Codex et Antigravity — installé ? (`--version`, absence = `NotFound`),
  connecté ? (`claude auth status` JSON, `codex login status`, et pour agy `agy --print /quota` : répond si connecté,
  erreur d'authentification sinon), type de compte (« Claude Pro », « ChatGPT », « Clé API » ; jamais la clé ni
  l'e-mail). Cache 2 min. Commandes `agent_access`, `check_agent_access`, `install_agent`, `login_agent`.
- **Installer / Se connecter** ouvrent une fenêtre PowerShell (nouvelle console) avec la commande officielle :
  `irm https://claude.ai/install.ps1 | iex`, `irm https://chatgpt.com/codex/install.ps1 | iex`,
  `irm https://antigravity.google/cli/install.ps1 | iex` ; `claude auth login`, `codex login`, `agy` (`/login`).
  La fenêtre se ferme seule si tout s'est bien passé. Le front revérifie l'agent toutes les 4 s (10 min max) et
  prévient (toast) ; le catalogue de modèles est rechargé.
- **PATH** : `access::refresh_path()` relit le PATH utilisateur + machine dans le registre et ajoute les dossiers des
  installateurs (`~/.local/bin`, `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`, `%LOCALAPPDATA%\agy\bin`,
  `%APPDATA%\npm`) — au démarrage et avant chaque vérification : un CLI installé pendant que Neuron tourne est
  trouvé sans redémarrer.
- **Chat** : `AccessIssue` (`not_installed` / `not_logged_in`) porté par `AgentEvent::ThreadError.issue` et
  `ChatItem::Error.issue` (persisté dans `messages.meta_json`). Détecté sur l'erreur de fin de tour, la sortie
  d'erreur du processus et les commandes agy (« Not logged in · Please run /login », « 401 Unauthorized »…), et sur
  le lancement d'un CLI absent (`AppError::AgentNotInstalled` → carte d'erreur au lieu d'un envoi en échec). La
  carte d'erreur affiche le bouton adapté, puis « prêt : renvoie ton message » une fois réglé ; un bandeau au-dessus
  de la zone de saisie (chat et nouveau chat) prévient avant d'envoyer.
- **UI** : carte « Fournisseurs IA » en tête de Paramètres → Agents & MCP (version, état, compte, bouton, commande
  affichée, état de la mémoire Neuron — dont « Brancher la mémoire » pour Antigravity, `AgyMemoryLine`). La liste
  « Agents » de la carte MCP est retirée (doublon) : cette carte ne garde que les outils exposés et la commande. Composants
  `components/agents/AgentAccessButton`, `components/chat/AgentAccessNotice`, store `stores/access.ts`.

### 2026-11-24 — Couleurs noires du graphe dans l'app installée (v0.1.2)
- Cause (vérifiée sur un build de release isolé, via le protocole DevTools) : en production, Tauri ajoute des
  empreintes (hash) à la CSP des ressources embarquées ; dès qu'une empreinte figure dans `style-src`, le
  navigateur ignore `'unsafe-inline'` et bloque les `<style>` injectés à l'exécution — dont celui du composant de
  graphe shadcn qui définit `--color-<série>` → barres (et anneau du cache) en noir. Invisible en dev (front servi
  par Vite, sans empreintes).
- Correctif : `app.security.dangerousDisableAssetCspModification: ["style-src"]` — la CSP déclarée (`style-src
  'self' 'unsafe-inline'`) s'applique telle quelle. Vérifié : barres orange avant et après changement de période.
- Version 0.1.2.

### 2026-11-24 — Usage réel des abonnements, données de démo retirées, anneau du cache (v0.1.1)
- **Usage hors Neuron** : `usage_import.rs` importe les journaux locaux de Claude Code (`~/.claude/projects`) et de
  Codex (`~/.codex/sessions`) — incrémental (position par fichier dans `usage_import_files`), dédoublonné
  (`token_usage.dedupe_key`), projet déduit du dossier, coût estimé au tarif API. Au démarrage, toutes les 10 min et
  après chaque tour Claude / Codex ; événement `usage://changed` → l'accueil se recharge. Migration
  `0007_cli_usage_logs` : colonnes `source` / `dedupe_key`, tables `usage_import_files` / `usage_log_start`, vue
  `usage_effective` (journaux = source de vérité d'un agent à partir de sa 1re ligne, lignes Neuron avant) lue par
  le tableau de bord et les quotas. Premier import réel : Claude Code 2,51 Md tokens (7 090 réponses, ~762 $),
  Codex 716 M (3 343 réponses, ~263 $). Claude Code efface ses journaux après 30 jours : l'historique plus ancien
  n'existe plus sur le disque (Neuron garde désormais ce qu'il a importé).
- Codex : `output_tokens` inclut déjà le raisonnement → l'adaptateur ne l'ajoute plus une 2e fois.
- Graphe « Tokens » = cache compris (même compte que « Tokens au total »).
- **Données de démo supprimées** : commandes `dev_*` (`commands/dev.rs`), entrées de la palette, IPC ; la migration
  0007 efface les lignes `demo-` existantes.
- Carte « Efficacité du cache » : anneau en rayons relatifs (76 % / 98 %), centré dans la hauteur libre de la carte
  et mis à l'échelle (150–280 px) au lieu de rayons fixes en pixels.
- Version 0.1.1 (l'installateur propose de remplacer la 0.1.0).

### 2026-11-24 — Installateur Windows
- `tauri.conf.json` : bundle NSIS seul, `perMachine` (droits admin, Program Files), français, icône, visuels
  (`installer/sidebar.bmp`, `header.bmp`), dossier menu Démarrer « Neuron », métadonnées (éditeur, description,
  catégorie). Installation existante : le modèle Tauri propose de désinstaller puis réinstaller.
- `installer/hooks.nsh` : fin d'installation → « Lancer Neuron automatiquement à l'ouverture de session ? »
  (écrit l'entrée de démarrage de `tauri-plugin-autostart`) ; désinstallation → entrée de démarrage et identité
  de notification retirées.
- App : `sync_autostart_setting` (au démarrage, l'entrée du système fait foi pour le réglage et est réécrite vers
  l'exe courant) ; en build de dev, le démarrage avec Windows n'est jamais modifié (mention dans Paramètres).

### 2026-11-24 — Tour du projet : mise en ordre
- Rust : `rustfmt.toml` (`max_width = 120`, `use_small_heuristics = "Max"`, le style déjà utilisé) et `cargo fmt`
  sur tout `src-tauri/` ; `cargo clippy --all-targets` sans avertissement.
- Code mort retiré : `views/chat/CodeBlock.tsx` (ré-export inutilisé), composants shadcn jamais importés
  (`radio-group`, `scroll-area`), `__reduceChat`, `LEVEL_FILL`, prop `agent` inutilisée d'`AssistantText`,
  `app-icon.svg` (source de l'icône de la phase 0, remplacée par `neuronicon.png`).
- Vérifié : aucune dépendance npm inutilisée, aucun `console.log`, `TODO` ni code commenté.
- `CLAUDE.md` : arborescence à jour (desktop, notifications, quick, stores…), police Geist (et non Inter).

### 2026-11-24 — Raccourcis du navigateur désactivés
- `lib/browserKeys.ts` (branché dans `main.tsx`) annule l'action par défaut de WebView2 pour Ctrl+F (barre de
  recherche), Ctrl+G, Ctrl+P (impression), Ctrl+R / F5 (rechargement), Ctrl+U, Ctrl+S, Ctrl+H, Ctrl+O, F3, F7,
  Ctrl+Shift+I/C/R. Les raccourcis de Neuron reçoivent toujours l'événement ; le zoom reste disponible.
  Vérifié en vrai : Ctrl+F n'ouvre plus rien.

### 2026-11-24 — Projets dans la demande rapide, Claude Fable 5.2
- Catalogue Claude : Fable 5.2 n'est plus étiqueté « Génération précédente » (il fait partie de la famille Claude 5).
- Fenêtre rapide : sélecteur de projet (`QuickProjectPicker`, `Ctrl+P`, mémorisé dans `neuron.quickProject`) à côté
  du modèle. Avec un projet : le nouveau chat est créé dans le projet (`projectId`) et la liste montre ses chats.
  Champ vide + Entrée = **ouvrir** dans Neuron le chat choisi (`show_thread`) ou l'écran « Nouveau chat » du projet
  (nouvelle commande `show_new_chat` → événement `quick://new-chat` → `startChat(projectId)` dans la fenêtre
  principale). Le pied affiche « Envoyer » ou « Ouvrir » selon le champ.

### 2026-11-24 — Point d'activité de la liste des chats
- Barre latérale : le point « l'agent travaille » (badge en position absolue) chevauchait le titre. Le bouton
  réserve sa place (`pr-7`) tant que le point est affiché ; dans les chats d'un projet, le titre prend la place
  restante (`min-w-0 flex-1`) et le point ne rétrécit plus.

### 2026-11-24 — Choix du modèle dans la demande rapide
- Ligne « Nouveau chat » de la fenêtre rapide : le `ModelPicker` des chats (recherche, tous fournisseurs) remplace
  les pastilles d'agent ; `Ctrl+M` l'ouvre au clavier, Tab passe à l'agent suivant (modèle par défaut). Le choix
  agent + modèle (+ niveau gardé s'il est compatible) est mémorisé à part (`neuron.quickDefaults`,
  `lib/chatDefaults.ts`), repli sur les réglages du dernier « Nouveau chat ».
- `ModelPicker` : ouverture contrôlable (`open` / `onOpenChange`) et hauteur de liste réglable (`listClassName`).
- Vérifié en vrai : modèle affiché dans la fenêtre rapide, `Ctrl+M` ouvre la liste.

### 2026-11-24 — Résumé de l'agent dans les notifications, arrière-plan, demande rapide globale
- **Résumé de fin de tâche** : `neuron_intro` demande à chaque agent de finir sa réponse par une ligne cachée
  `<!-- neuron: ok|partiel|échec | résumé -->` (rappel court ajouté aux messages suivants des agents sans
  system prompt : `context::SUMMARY_REMINDER`). Le pump garde le dernier texte du tour ; `agents/summary.rs`
  (`turn_summary`, testé) en tire `TurnOutcome` + résumé (repli : première phrase) → nouvel
  `AgentEvent::TurnSummary`, émis juste avant le statut final. Notification : « ✅ Tâche réussie / ⚠️ Faite en
  partie / ❌ Non effectuée · <chat> » + le résumé. La ligne est masquée dans le chat, même en streaming
  (`lib/turnSummary.ts`), et dans le dock.
- **Arrière-plan** (`desktop.rs`) : icône dans la zone de notification (clic = ouvrir ; menu Ouvrir / Demande
  rapide / Quitter), la croix cache la fenêtre (réglage `background.closeToTray`, notification explicative la
  1re fois), `tauri-plugin-autostart` (`background.launchAtLogin`, lancé avec `--background` → reste caché),
  `tauri-plugin-single-instance` (relancer Neuron ramène la fenêtre). Fenêtre principale `visible: false` dans la
  config, affichée par `desktop::setup`. Feature `tray-icon`.
- **Demande rapide globale** : `tauri-plugin-global-shortcut` (réglage `quickLauncher`, défaut `Ctrl+Shift+Space`,
  ré-enregistré à chaque sauvegarde ; raccourci invalide ou déjà pris → réglages précédents restaurés + erreur).
  Deuxième fenêtre `quick` (sans bordure, transparente, toujours au premier plan, hors barre des tâches), affichée
  sur l'écran du curseur, cachée quand elle perd le focus. Vue `views/quick/QuickLauncher.tsx` (routée par
  `windowLabel()` dans `App.tsx`) : champ de demande, « Nouveau chat » (agent Claude / Antigravity / Codex, Tab) +
  7 chats récents (↑↓), Entrée = envoyer, Ctrl+Entrée = envoyer et ouvrir (`show_thread`), Échap = fermer.
  Réglages par défaut d'un nouveau chat partagés avec l'écran « Nouveau chat » (`lib/chatDefaults.ts`).
- Paramètres → **Arrière-plan & raccourci** (`BackgroundSection`, enregistreur de raccourci).
- Vérifié en vrai : raccourci global → fenêtre rapide affichée, fermeture → fenêtre cachée (processus vivant),
  2e lancement → fenêtre ramenée.

### 2026-11-23 — Images des agents affichées dans le chat
- Génération d'images testée en direct : `agy` CLI n'a pas d'outil d'image ; Claude Code non plus ; Codex a
  `image_gen` (feature `image_generation` active) mais répond « indisponible dans cette session » en `codex exec`
  (compte sans abonnement, probablement). Décision utilisateur : afficher les images, pas d'API payante.
- `extractImagePaths` (`views/chat/imagePaths.ts`) repère les chemins d'images d'un message d'agent (cibles de
  liens Markdown, code inline, chemins nus ; png/jpg/webp/gif/bmp/svg/avif). `AgentImages` les envoie à la nouvelle
  commande `agent_images(threadId, paths)` : `attachments::local_image` garde les fichiers image existants (relatifs
  résolus sur le dossier du chat, ≤ 40 Mo) et chacun est ouvert au protocole asset (`allow_file`). Affichage sous le
  message, une fois écrit, avec les vignettes + visionneuse de `MessageAttachments`.
- Markdown : `![](local)` ne s'affiche plus en image cassée (l'image passe par la galerie), image distante = lien (CSP).
- `neuron_intro` : les agents savent qu'il suffit de citer le chemin d'une image pour qu'elle s'affiche.

### 2026-11-23 — Logo dans la barre latérale, barre latérale redimensionnable
- En-tête de la barre latérale : glyphe de l'app (sans la tuile noire) à côté de « Neuron ». `src/assets/neuron-mark.png`
  = glyphe blanc extrait de l'icône (alpha), peint en `bg-foreground` via `mask` (suit la couleur du texte).
- Bord droit de la barre latérale (`SidebarResizer`, remplace `SidebarRail`) : glisser = redimensionner (200–440 px),
  clic = replier / déplier comme avant. Largeur dans `stores/layout.ts`, mémorisée en `localStorage` (repli 256 px),
  injectée dans `--sidebar-width` par `AppShell`. Pendant le glisser : pas de transition de largeur, curseur
  `col-resize` partout, pas de sélection (`:root[data-sidebar-resizing]`).

### 2026-11-23 — Boutons de fenêtre dans le coin, pied « SQLite » retiré
- `WindowControls` toujours dans le coin haut droit : dans l'en-tête du dock « Threads live » quand il est ouvert
  (en-tête lui aussi déplaçable), sinon dans `SiteHeader` (avant, ils restaient au milieu, collés au dock).
- Pied de la barre latérale (« SQLite vN · v0.1.0 ») supprimé.

### 2026-11-23 — Barre de titre maison, info-bulle du graphe sans glissement
- Barre de titre native retirée (`decorations: false`, ombre conservée). `SiteHeader` sert de barre de titre :
  zones vides en `data-tauri-drag-region` (glisser = déplacer, double-clic = agrandir), boutons Réduire /
  Agrandir-Restaurer / Fermer (`components/shell/WindowControls.tsx`, survol rouge pour Fermer). Haut de la barre
  latérale aussi déplaçable. IPC : `appWindow` dans `lib/ipc.ts` ; permissions `core:window:allow-minimize`,
  `allow-toggle-maximize`, `allow-close`, `allow-start-dragging`.
- Graphe de consommation : l'info-bulle ne glisse plus d'un point à l'autre (`isAnimationActive={false}`), elle
  apparaît sur place en fondu.

### 2026-11-23 — Notifications au nom et au logo de Neuron
- Windows : le plugin de notification prenait l'identité de PowerShell (nom + icône) dès que l'exe tourne depuis
  `target/debug|release`. Neuron enregistre désormais son propre AppUserModelID (`dev.neuron.app`) sous
  `HKCU\Software\Classes\AppUserModelId` (DisplayName « Neuron », IconUri = icône 256 px copiée dans le dossier
  de données) au démarrage, et envoie ses toasts lui-même (`notifications.rs`, `tauri-winrt-notification`,
  `winreg`). Autres OS : plugin inchangé.
- Nouvelle commande `send_notification(title, body, threadId)` ; un clic sur la notification ramène la fenêtre et
  ouvre le chat concerné (événement `notification://clicked`).
- `tests/live_agents.rs` recompilait plus (`McpLaunch::new` avec `project`) : corrigé.

### 2026-11-23 — Graphe de consommation de l'accueil retravaillé
- Choix de la mesure : **Tokens** (entrée + sortie), **Coût**, **Requêtes** (`views/home/usageMetric.ts`) ; le
  tableau suit la même mesure.
- Légende remplacée par `AgentTotals` : total et part de chaque agent ; un clic masque / réaffiche ses barres
  (couleurs inchangées, ordre fixe ; le dernier agent visible ne peut pas être masqué).
- Barres : largeur max 24 px, espace de 2 px entre segments empilés, coins arrondis uniquement en haut de la
  pile réelle (segment custom), survol par bande discrète.
- Info-bulle `UsageTooltip` : valeur d'abord, agents de la tranche + total.
- Description : total visible · période · pic de la période. Au changement de période, l'ancien graphe reste
  affiché (atténué) avec ses propres libellés jusqu'à l'arrivée des données (plus d'axes mal libellés).

### 2026-11-23 — Logo de l'agent à la place de la bulle
- Liste des chats (barre latérale), palette Ctrl+K et chat vide : l'icône bulle est remplacée par le logo de l'IA
  du chat (`AgentLogo` : Claude, Gemini pour Antigravity, OpenAI pour Codex, terminal pour les CLI génériques).

### 2026-11-23 — Icône arrondie, quotas qui suivent l'abonnement
- Icône : coins arrondis transparents (rayon 22 %, masque suréchantillonné), toutes tailles régénérées.
- **Accueil** : dès qu'un agent a rapporté les fenêtres de son abonnement, ses cartes de quota sont exactement
  ces fenêtres (`providers::list_with_usage`) : cartes manquantes créées (`<agent>-<fenêtre>`, configurables),
  les autres masquées (pas supprimées). Ex. Antigravity Plus → hebdo seul ; Pro → 5 h + hebdo ; Codex sans
  abonnement → 30 jours. Agents sans rapport : cartes configurées inchangées. Ordre agent puis 5 h / hebdo / 30 j.
- `LiveQuota.group` : groupe Antigravity le plus utilisé, affiché sous la carte (« source Antigravity · Gemini
  Models ») ; la source affichée suit l'agent (n'était « source Claude » en dur).
- En-tête de chat : déjà limité aux fenêtres rapportées (groupe du modèle du chat pour Antigravity).

### 2026-11-23 — Les agents connaissent Neuron, modifient la mémoire et le contexte du projet
- **Icône** : l'exe n'avait pas été recompilé (cargo ne voit pas les icônes) → `build.rs` déclare
  `rerun-if-changed=icons` ; exe recompilé, icône vérifiée dans la ressource de l'exe.
- **Présentation de Neuron** (`context::neuron_intro`) donnée à chaque session : où l'agent tourne, la mémoire
  globale et comment la lire / l'enrichir / la corriger, le `.neuron/context.md` du projet à tenir à jour. Claude :
  dans `--append-system-prompt` (avec le contexte figé) ; Codex / Antigravity : dans le préambule du 1er message.
  Repli sans outils MCP : modifier directement `memory.md` (réimporté par Neuron) et `.neuron/context.md`.
- **Serveur MCP étendu** (7 outils) : `neuron_memory_update` / `neuron_memory_delete` (identifiants courts affichés
  par read / search), `neuron_project_context_read` / `neuron_project_context_update` (réécriture complète,
  100 Ko max) — listés seulement quand le serveur connaît le projet (`--project <dossier>` pour les chats de
  projet ; sinon dossier courant s'il contient `.neuron/context.md`, cas d'Antigravity inscrit globalement).
  Essai réel (Claude Haiku + vrai serveur) : souvenir enregistré et contexte du projet complété.

### 2026-11-23 — Nouvelle icône, en-tête « Neuron »
- Icône de l'app (réseau de nœuds blanc sur fond noir) : source 905×955 centrée sur un carré noir de 1024 px, puis
  `tauri icon` → mêmes fichiers que avant dans `src-tauri/icons` (ico, icns, PNG, logos Windows Store).
- Barre latérale : l'en-tête n'affiche plus que « Neuron » centré (plus d'icône ni de « Poste de pilotage IA ») ;
  « N » quand la barre est réduite.

### 2026-11-23 — Durée de chaque requête, questions de l'agent
- **Temps total** sous chaque requête (tokens · coût · ⏱ durée) : mesuré par le registre de l'envoi du premier
  message à la fin du tour (approbations comprises), repli sur la durée du CLI ; `TokenUsageUpdate.durationMs`
  (donc visible en direct, plus seulement dans l'historique). Format « 12,4 s », « 1 min 05 s », « 1 h 02 min ».
- **Questions de Claude** (`AskUserQuestion`, cycle vérifié en réel) : la demande d'autorisation devient une carte
  `QuestionCard` (une ou plusieurs questions, choix unique ou multiple, « Autre… » = réponse libre, Répondre /
  Ignorer) ; les réponses partent dans `updatedInput.answers` (`respond_permission(..., answers)`). Une fois répondu,
  `QuestionSummary` affiche questions → réponses (relues dans le résultat de l'outil, donc aussi dans l'historique).
- Toasts / notifications : « L'agent pose une question », « Plan prêt à valider » au lieu de « Approbation requise ».
- Antigravity : son outil `ask_question` est sauté automatiquement en mode print (« You skipped answering ») et
  n'apparaît pas dans le flux — pas de réponse possible depuis Neuron. Codex n'a pas d'outil de question.

### 2026-11-23 — Plans affichés comme des fichiers Markdown
- `MarkdownFileCard` : document .md dans le chat (nom du fichier, badge « Plan », Aperçu rendu / Source, copier,
  replier, « Afficher tout » au-delà de 40 lignes).
- Claude : le plan d'`ExitPlanMode` s'affiche avec le nom de son fichier (`planFilePath`) ; Antigravity en Plan écrit
  `~/.gemini/antigravity-cli/brain/<conv>/plan.md` (vérifié en réel) → affiché comme document au lieu d'un diff, de
  même que ses autres artefacts du dossier `brain` et tout `*plan*.md`.
- `FileChange.content` : contenu complet des fichiers Markdown modifiés (≤ 200 Ko) ; repli sur les lignes ajoutées
  du diff pour un nouveau fichier.

### 2026-11-23 — Composer aligné, bascule Exécuter / Planifier
- La zone de saisie reprend la colonne des messages (même gouttière `pl-10` que le curseur de l'agent), via
  `Composer timelineGutter` ; menu « / » et pastille « Nouveaux messages » restent centrés sur elle.
- **Bascule de mode** (`components/chat/ModeSwitch`) à côté des permissions : Exécuter ⇄ Planifier. Le menu
  Permissions ne garde que les modes d'exécution (Demander, Éditions auto, Auto, Tout autoriser) ; en Plan, il
  choisit le mode repris en sortant du Plan. **Maj+Tab** dans la zone de saisie bascule (événement `neuron:toggle-plan`).

### 2026-11-23 — Modes Plan / Auto pris en charge
- **Mode Auto** proposé dans le sélecteur (Claude `--permission-mode auto`, agy `--mode auto`, Codex `workspace-write`).
- **Changement de mode à chaud pour Claude** : `update_thread_settings` envoie `set_permission_mode` à la session
  vivante quand seul le mode change (plus de redémarrage) ; les autres agents redémarrent comme avant.
- **Mode suivi en direct** : `system/status.permissionMode` (plan approuvé, `EnterPlanMode`…) → `ModeChanged` →
  persisté + `AgentEvent::PermissionModeChanged` → le sélecteur du chat se met à jour.
- **Plan mode Claude** (cycle vérifié en réel) : l'appel `ExitPlanMode` s'affiche comme un document « Plan proposé »
  (Markdown) et sa demande d'autorisation comme une barre « Exécuter ce plan ? » : éditions auto / auto / en demandant
  (`updatedPermissions: setMode`, Claude enchaîne l'exécution) ou « Continuer à planifier » (refus avec consigne).
  Le fichier `~/.claude/plans/…` reste une ligne d'outil repliée.
- **Codex / Antigravity en Plan** : après leur réponse, barre « Exécuter le plan » (passe le chat en éditions auto et
  envoie « Exécute le plan ci-dessus. »).

### 2026-11-23 — Blocs de code des fichiers modifiés dans la conversation
- **Diff calculé par Neuron pour tous les agents** (`agents/file_changes.rs`, crate `similar`) : agy (`write_file`,
  `edit_file`…) et Codex (`file_change`) ne donnent que les chemins, Claude `Write` que le nouveau contenu. Le pump
  lit chaque fichier quand l'outil d'édition démarre (vérifié : agy `ACTIVE` et Codex `item.started` arrivent avant
  l'écriture) puis quand il se termine → diff unifié (3 lignes de contexte, fichiers ≤ 1 Mo, texte UTF-8, 200 Ko max).
- Migration `0006_tool_changes` (`tool_calls.changes_json`), `ChatItem::Tool.changes`, `AgentEvent::ToolCallResult.changes`.
- UI : chaque fichier modifié s'affiche comme un bloc de code ouvert dans la conversation (`FileEditBlock` +
  `UnifiedDiff` : chemin, nouveau/supprimé, +/−, numéros de ligne, parties inchangées repliées, « Afficher tout » au-delà
  de 300 lignes). Anciens chats Claude : le bloc d'outil Edit/Write s'ouvre par défaut sur son diff.

### 2026-11-23 — Quotas Antigravity, /quota /usage /credits, Agents & MCP dans Paramètres
- **Quotas Antigravity** (`agents/antigravity/quota.rs`) : `agy --print /quota --output-format json` (répondu par le
  CLI, aucun token ; refusé dans une session stream-json) → groupes de modèles (« Gemini Models », « Claude and GPT
  models », « Gemini 4 Argon ») × fenêtres 5 h / hebdo. Stockés comme ceux de Claude/Codex (`store_live_windows`,
  fenêtres avec `group` + `models`), rafraîchis après chaque tour agy et toutes les 15 min (+ 5 s après le
  lancement), événement `quotas://changed` → rechargement de l'Accueil. Accueil : fenêtre hebdo du groupe le plus
  consommé ; en-tête de chat : 5 h + hebdo du groupe du modèle du chat.
- **/quota, /usage, /credits dans un chat Antigravity** : interceptés par `send_prompt`, exécutés en `agy --print`,
  affichés dans la carte de commande (jauges « N% utilisé · reset dans … ») ; ajoutés au menu « / ».
- **Agents & MCP** : la carte quitte la vue Mémoire (désormais sur une colonne) pour une section de Paramètres.

### 2026-11-23 — Commandes locales affichées à part, niveau de raisonnement plus court
- **Commandes locales Claude** (`/usage`, `/context`, `/cost`…) : le message `<synthetic>` est retenu par le parseur
  jusqu'au `result` ; si celui-ci porte `local_command`, il devient `AdapterEvent::CommandOutput` → rôle `command`
  en base, `ChatItem::Command` / `AgentEvent::CommandOutput`, sinon il redevient du texte normal. Pas de marqueur
  de fin de tour ni d'usage enregistré pour ces tours à 0 token. Fixture `fixtures/local_command.jsonl`.
- UI : un message « /commande » s'affiche comme une note discrète « Commande /usage utilisée » (au lieu d'une
  bulle) ; la sortie dans une carte repliable `CommandOutput` (Markdown pour /context, jauges pour les lignes
  « N% used », texte mono sinon).
- En-tête de chat : le niveau s'affiche seul (« Moyen », « Élevé », « Max ») au lieu de « raisonnement moyen » ;
  libellé `max` → « Max ».

### 2026-11-23 — Slash commands de chaque fournisseur (menu « / »)
- **Liste par fournisseur et dossier** (`agents/slash.rs`, commande `list_slash_commands`, cache 15 min) :
  Claude Code via la requête de contrôle `initialize` (≈ 96 commandes : intégrées, skills, plugins, avec
  descriptions ; aucun token consommé) ; Antigravity via `agy acp` → `available_commands_update` (13 commandes :
  /goal, /compact, /plan, /swarm…) ; Codex (pas de slash en `exec`) : `/review` + ses skills (`~/.codex/skills`,
  `~/.agents/skills`, `<cwd>/.agents/skills`, `<cwd>/.codex/skills`).
- **Exécution** : Claude et Antigravity reçoivent la commande telle quelle et l'exécutent (vérifié : `/context`
  renvoie le tableau du contexte). Codex : `/review [instructions]` → `codex exec review --json` (sans changer le fil
  repris ensuite), `/<skill>` → instruction explicite `$skill` + chemin du `SKILL.md`.
- **Composer** : menu au-dessus du champ dès qu'on tape « / » (filtrage flou, ↑/↓, Tab ou Entrée pour compléter,
  Entrée sur une commande complète pour l'envoyer, Échap pour fermer sans arrêter l'agent). Composant `SlashMenu`
  par neon (Gemini 4 Neon High).


### 2026-11-23 — Pièces jointes : bouton « + » et images collées
- **Composer** : bouton « + » (sélecteur de fichiers natif, plusieurs fichiers) et collage d'images / de fichiers
  (Ctrl+V) ; vignettes et puces au-dessus du champ, retrait « × », tuiles de chargement ; envoi possible sans texte.
- **Stockage** (`attachments.rs`) : chaque pièce jointe est copiée dans `<data_dir>/attachments/<id>/<nom>` (50 Mo max) ;
  le front ne renvoie que des copies de Neuron (chemins vérifiés). Métadonnées dans `messages.meta_json`
  (`ChatItem::User.attachments`) → affichées dans l'historique. Vignettes via le protocole `asset` limité à ce dossier.
- **Transmission, vérifiée en live sur les 3 agents (image rouge → « Rouge »)** : Claude reçoit les images en blocs
  base64 (≤ 3,7 Mo), Codex via `--image=<chemin>` (forme `=` obligatoire : `-i` est variadique et avale le prompt),
  Antigravity n'accepte que du texte en entrée → chemins listés dans le message, il ouvre le fichier lui-même. Les
  autres fichiers sont toujours donnés par leur chemin.
- **UI (neon / Gemini 4 Neon High)** : `components/attachments` — `AttachmentTray`, `MessageAttachments` (visionneuse
  plein écran avec ←/→), `fileMeta`.


### 2026-11-23 — Quotas : barre lisible + quotas du fournisseur dans l'en-tête du chat
- **Accueil** : nouvelle barre de quota (`QuotaBar`, 24 px) avec le pourcentage dedans à gauche et le temps avant
  reset dedans à droite ; remplissage translucide pour garder le texte lisible.
- **En-tête de chat** : fenêtres 5 h et hebdomadaire du fournisseur du chat (mini-barre + %, info-bulle avec le reset),
  écrans larges.
- **Codex** : ses limites ne sont pas dans le flux JSON mais dans son fichier de session
  (`~/.codex/sessions/…/rollout-…-<thread>.jsonl`, `rate_limits.primary/secondary`) → lues après chaque tour
  (`agents/codex/limits.rs`). Fenêtres 300 / 10 080 / 43 200 min → `five_hour` / `seven_day` / `thirty_day`.
  Plan gratuit actuel : une seule fenêtre de 30 jours.
- Limites stockées par agent (`<agent>.rate_limits`, Claude inchangé) ; `DashboardSnapshot.liveQuotas`.
- Antigravity n'expose aucune donnée de quota (ni flux, ni fichiers locaux) : rien n'est affiché pour lui.


### 2026-11-23 — Accueil : cartes KPI épurées
- Plus de textes sous les nombres (« En hausse vs période précédente », descriptions) : seuls le libellé, la valeur et
  le badge d'évolution restent ; la description passe en info-bulle du libellé.
- « Tours » remplacé par **Tokens au total** (entrée + sortie + cache, tous fournisseurs) ; « Coût estimé » devient
  **Coût total** (tous fournisseurs : Claude communiqué, Codex/Antigravity estimés).


### 2026-11-22 — Tarifs mis à jour automatiquement (LiteLLM)
- `pricing.rs` : la liste publique de LiteLLM (GitHub) est téléchargée au démarrage **au plus une fois par jour**
  (`reqwest`/rustls, 30 s max, en tâche de fond) et mise en cache dans `<data_dir>/prices.json` (≈ 27 Ko, 275 modèles
  officiels). Seules les entrées des éditeurs (OpenAI, Anthropic, Google) sont gardées, jamais les revendeurs. Un nouveau
  modèle est chiffré dès qu'il apparaît dans la liste ; hors ligne : dernier cache, puis table intégrée.
- Après chaque mise à jour, les requêtes Codex/Antigravity encore à 0 $ sont recalculées.
- Paramètres › Général : carte « Tarifs des modèles » (source, date, nombre de modèles, erreur éventuelle, Actualiser).
- **Premier appel réseau de l'app elle-même** (validé par l'utilisateur) : téléchargement d'un fichier public, rien
  n'est envoyé.


### 2026-11-22 — Coût en dollars pour tous les fournisseurs + terminal épuré
- **Tarifs** (`pricing.rs`) : Codex et Antigravity ne communiquent que des tokens → coût de chaque requête estimé au
  tarif API public du modèle (entrée, cache, sortie ; familles sans suffixe de raisonnement). Claude : tarifs officiels
  Anthropic ; OpenAI / Gemini : listes tierces concordantes (pages officielles non accessibles), à revérifier.
  Modèles sans tarif connu (GPT-OSS, Orchestrator…) : « — ». Recalcul unique des anciennes requêtes à 0 $ au démarrage.
- **Affichage** : `CostLabel` partout (en-tête de chat, marqueurs de tour) — montant Claude tel que communiqué,
  « ≈ » pour les estimations ; carte « Coût estimé » de l'Accueil reformulée.
- **Mini-terminal** : plus de lignes « Nouveau message » / « Tour terminé » / « Arrêté ».


### 2026-11-22 — Threads live en mini-terminaux + sous-agents
- **Backend** : le parser Claude lit `parent_tool_use_id` (appels faits par un sous-agent → `parentToolCallId` sur
  `ToolCallStart`) et les événements `task_started` / `task_progress` / `task_notification` → nouvel événement
  `SubagentUpdate` (description, type, statut, nombre d'outils, tokens, dernier outil). Correctif : le texte écrit par
  un sous-agent n'est plus affiché comme réponse principale. Fixture réelle `claude/fixtures/subagent.jsonl` (nettoyée)
  + test.
- **Front** : store `activity` (journal par chat, 120 lignes max, texte en cours regroupé par frame), alimenté par
  `useAgentEventBridge`.
- **Dock (neon / Gemini 4 Neon High)** : une carte par chat avec un mini-terminal (outil en cours / ✓ / ✗ et résultat,
  ligne en cours d'écriture, autorisations, séparateurs de tour, erreurs), suivi automatique du bas, chats terminés
  réduits à 3 lignes ; sous-agents en couloirs imbriqués sous l'appel qui les a lancés (statut, outils, tokens).
  Dock élargi à 380 px.
- Simulation de démo (palette, debug) enrichie : actions, texte, autorisation et un sous-agent.


### 2026-11-22 — Phase 5 : CLI génériques, Paramètres, raccourcis, notifications, fluidité
- **CLI génériques** (`agents/generic`) : profils configurés dans Paramètres (commande, arguments avec `{prompt}`
  sinon entrée standard, option PTY). Chaque profil apparaît comme un modèle « CLI génériques » dans Nouveau chat.
  Un processus par message, sortie streamée en texte (codes ANSI retirés par `vte`). PTY via `portable-pty`
  (ConPTY) : Neuron répond à la requête de position du curseur, sans quoi le programme ne démarre pas sous Windows.
  Tests pipe + PTY ; bouton « Tester » dans Paramètres.
- **Paramètres** (`app_settings.rs`, un document JSON) : arrêt des agents inactifs (15 min par défaut, reprise
  transparente au message suivant), notifications natives (autorisation / fin / erreur, uniquement fenêtre en
  arrière-plan, `tauri-plugin-notification` 2.4), contexte injecté (mémoire / git / fichiers récents), CLI génériques.
- **UI (neon / Gemini 4 Neon High)** : vue Paramètres (navigation par section, enregistrement immédiat, éditeur de
  CLI avec préréglages Ollama / Aider / Gemini CLI / LLM et aperçu de la commande), dialogue d'aide des raccourcis.
- **Raccourcis** : `Ctrl+,` Paramètres, `Ctrl+Maj+M` Mémoire, `Ctrl+Maj+H` Accueil, `Ctrl+/` aide, `Alt+↑/↓` chat
  précédent/suivant, `Échap` arrête l'agent dans un chat. Liste unique dans `lib/shortcuts.ts`.
- **Fluidité** : toutes les vues chargées à la demande et préchargées au repos ; bundle principal 793 → 375 kB,
  plus d'avertissement de taille. Réglages de raisonnement/permissions masqués pour les CLI génériques.
- Vérifié : 89 tests Rust, clippy propre, build OK, app montée sans erreur. Non vérifié à l'écran.


### 2026-11-22 — Phase 4 (UI) : vue Mémoire + Markdown partagé
- **Vue Mémoire (neon / Gemini 4 Neon High)** : souvenirs par catégorie (Règles strictes mises en avant), ajout
  rapide, édition en ligne, suppression confirmée, recherche plein texte surlignée (`/`), provenance (toi,
  memory.md, agent via MCP) ; carte « Agents & MCP » (Claude Code et Codex actifs automatiquement, bouton
  « Connecter Antigravity » → `agy mcp add`, commande du serveur copiable). Mise à jour en direct sur
  `memory://changed`. Entrées sidebar, palette et en-tête.
- **Markdown partagé (neon)** : `components/markdown` (Markdown + CodeBlock + `md-prose`) utilisé par les réponses du
  chat et tous les aperçus de contexte ; éditeur `context.md` refondu (barre d'outils, statut d'enregistrement en
  ligne, modes Éditer/Partagé/Aperçu, Tab = indentation, scroll synchronisé) ; cartes Git / Fichiers récents / Chats
  harmonisées.
- Vérifié : app montée, `memory.md` créé (dossier isolé en dev), modification externe importée par le watcher.
- Non testé : inscription Antigravity (modifie la config globale d'agy : action volontairement laissée à
  l'utilisateur).


### 2026-11-22 — Phase 4 (backend) : mémoire globale + serveur MCP embarqué
- `memory/` : SQLite `memories` (FTS5) ⇄ `~/.neuron/memory.md` (catégories Profil / Préférences techniques / Style
  de code / Règles strictes / Autres ; import des modifications du fichier, réécriture après chaque changement ;
  hash du dernier état synchronisé dans `settings`). Isolé dans `<NEURON_DATA_DIR>/.neuron` en dev.
- Serveur MCP stdio embarqué : `neuron --mcp-memory --db … --memory-file … --agent …` (même exécutable), outils
  `neuron_memory_read` / `neuron_memory_search` / `neuron_memory_save`. Offert à chaque session : Claude via
  `--mcp-config` + `--allowedTools`, Codex via `-c mcp_servers.neuron.*` — **vérifié en live (les deux retrouvent
  le souvenir)**. Antigravity n'accepte pas de serveur MCP par session : inscription unique `agy mcp add` via un
  bouton de la vue Mémoire (commandes `connect/disconnect_antigravity_mcp`), outils pré-approuvés par `--settings`.
- Mémoire injectée dans **chaque** nouveau chat (règles strictes en tête), aussi dans l'aperçu du contexte projet.
- Watcher `memory.md` (stat toutes les 2 s) → événement `memory://changed`. Front : `ipc` mémoire, store `memory`,
  vue `memory` déclarée.


### 2026-11-22 — Phase 3 : projets & injection de contexte
- **Backend** (`context.rs`) : `.neuron/context.md` créé depuis un modèle à l'ajout du projet (jamais écrasé, jamais
  créé dans un dossier absent), instantané git (branche, `status --porcelain` ≤ 30, 5 derniers commits, timeout 5 s,
  sans fenêtre console), fichiers modifiés depuis 7 jours (crate `ignore`, respecte `.gitignore`, ignore `.neuron/`).
  Le contexte assemblé est **figé dans le chat** à sa création (migration `0005_thread_context` : `context`,
  `context_sources` ; `ThreadSummary.hasContext`).
- **Injection** : Claude Code → `--append-system-prompt` (réappliqué à chaque reprise `--resume`) ; Codex et
  Antigravity (pas d'option système) → préambule `<contexte_neuron>` devant le **premier** message seulement (le
  message stocké reste celui de l'utilisateur). Vérifié en live sur les 3 CLI (mot de code retrouvé).
- **Commandes** : `project_context`, `save_project_context`, `project_overview` (git + récents + aperçu exact du
  contexte d'un nouveau chat), `thread_context`.
- **UI (neon / Gemini 4 Neon High)** : page projet (vue `project`, onglets Contexte / Chats) — éditeur `context.md`
  avec aperçu markdown, Ctrl+S, indicateur de modifications, « Ce que recevra un nouveau chat » ; cartes Git et
  Fichiers récents ; liste des chats du projet. Indicateur « Contexte » dans l'en-tête du chat (popover : sources +
  markdown injecté, « Modifier context.md »). Bandeau « Contexte injecté au démarrage » dans le nouveau chat d'un
  projet. Entrées « Contexte & projet » dans la sidebar et le menu du dossier ; la palette ouvre la page projet.
- **Correctifs chat** : curseur d'agent en lissage exponentiel (plus de rebond à chaque ligne) ; la zone de saisie
  ne bouge plus entre « remonté » et « en bas » (padding bas retiré de la racine du chat).
- Limite connue : un brouillon non enregistré de `context.md` est perdu si on quitte la page projet.


### 2026-11-22 — Transitions partout (neon) + curseur d'agent fluide
- **Curseur d'agent** : le logo n'est plus attaché au bloc de texte ; un curseur unique par conversation, dans la
  marge gauche de la timeline, suit le **dernier élément quel qu'il soit** (ligne de texte, bloc de code, bloc shell,
  carte, ligne « Working ») via un ressort amorti piloté par rAF (transform écrit directement, sans re-render) → glisse
  fluidement même quand un gros bloc apparaît. Reste visible tant qu'un texte se révèle (store `reveal`), y compris
  après la fin du tour (Codex).
- **Transitions (neon / Gemini 4 Neon High, ~95 % Antigravity, 38 fichiers)** : changement de vue (fondu + légère
  montée ; chat → chat en fondu seul pour ne pas faire bouger l'en-tête), dock « Threads live » qui s'ouvre/se ferme en
  glissant (largeur animée, panneau démonté après la fermeture), lignes du dock en cascade, survols/actifs en fondu
  dans la sidebar, fil d'Ariane en fondu, palette (surbrillance qui glisse, résultats en fondu), Accueil (cartes en
  cascade, valeurs en fondu, barres qui poussent, anneau du cache qui se remplit, barres de quotas animées), chat
  (focus du composer, bouton Stop, pastille « Nouveaux messages », flèches, boutons copier, sélecteurs).
  Respect de `prefers-reduced-motion`. Relu : pas de sélecteur instable, pas de hex, build OK.


### 2026-11-22 — Débordements corrigés, modèles Antigravity regroupés par famille
- **Texte qui dépasse à droite** : cause principale dans le dock « Threads live » — le `ScrollArea` Radix enveloppe le
  contenu dans un bloc `display: table` qui s'élargit avec le texte et neutralise `truncate` → remplacé par un simple
  conteneur défilant. Chat : longs mots/chemins/URL coupés (`overflow-wrap: anywhere`), tableaux défilants dans leur
  cadre, badges d'outils qui passent à la ligne, colonnes `min-w-0`, zone principale sans défilement horizontal.
- **Antigravity** : un modèle par niveau (`gemini-4-neon-low/medium/high/xhigh`) → le catalogue les regroupe en
  familles (« Gemini 4 Neon ») avec leurs niveaux ; choisir un niveau sélectionne la variante (`effortModels`), comme
  pour Claude et Codex. Les chats existants affichent le niveau de leur variante.


### 2026-11-22 — Logo OpenAI, coûts honnêtes, texte fluide, logo qui suit l'écriture
- Logo **OpenAI** pour Codex (LobeHub Icons, MIT ; monochrome, suit la couleur du texte).
- Coûts : Codex et Antigravity ne renvoient que des tokens (usage inclus dans l'abonnement) → plus de « 0 $ »
  trompeur : « inclus (abonnement) » avec explication au survol (fin de tour, en-tête) ; la carte « Coût estimé »
  précise « Claude Code uniquement ».
- **Apparition fluide du texte** : révélation progressive à chaque frame (accélère s'il y a du retard), y compris pour
  Codex qui envoie ses messages d'un bloc ; chaque nouveau bloc apparaît en fondu ; l'historique s'affiche d'un coup.
- **Logo de l'IA qui descend ligne par ligne** dans une marge à gauche pendant l'écriture (glisse en suivant la dernière
  ligne), puis s'efface ; aligné avec l'indicateur « Working » qui le précède.
- « Working » : les trois points sont sur la ligne de base du mot.


### 2026-11-22 — Chat : en-tête fixe, indicateur « Working », animations
- En-tête du chat **toujours visible** (collant en haut, fond translucide flouté) et restylé : logo de l'agent
  (point animé quand il travaille), titre renommable, « agent · modèle · raisonnement · dossier », statut en badge
  avec chrono, tokens/coût, bouton Arrêter.
- Indicateur **Working** sous le dernier message pendant que l'agent travaille (logo qui respire, texte scintillant,
  points qui rebondissent, action en cours) ; disparaît dès que la réponse s'affiche en direct ou qu'une
  autorisation est demandée.
- Animations : apparition des blocs de code et des blocs outil/shell, dépliage/repliage animé des blocs shell et de
  la réflexion, entrée des nouveaux messages/cartes (l'historique chargé n'est pas animé).


### 2026-11-22 — Multi-fournisseurs (Claude Code, Codex, Antigravity), sélecteurs refaits, sidebar
- **Codex et Antigravity fonctionnent pour de vrai** (avancé depuis la Phase 5). Protocoles vérifiés en réel avant
  de coder :
  - Antigravity : stream-json bidirectionnel avec un champ `event` (`{"event":"user",…}` → `init` / `step_update` /
    `result`) ; plusieurs tours par process ; usage du `result` **cumulé** → compté par étape ; pas de demande de
    permission en mode non interactif.
  - Codex : `exec --json` = 1 process par tour, `resume <thread_id>` pour la suite ; options avant `resume` ;
    `--` avant le prompt ; modèle par défaut de l'utilisateur (`gpt-6.1-sol`) refusé par un compte ChatGPT → le
    catalogue (`codex debug models`) ne propose que les modèles listés.
- Plomberie NDJSON commune (`agents/process.rs`), adaptateur Claude migré dessus ; Stop par kill = « Annulé ».
- Tests : parseurs sur flux réels nettoyés + **tests live** des 3 CLI (2 tours chacun : ONE/TWO) — tous verts.
- `list_models` : catalogue par fournisseur (Claude statique, Codex et Antigravity lus depuis les CLI, cache 10 min,
  disponibilité du CLI).
- UI : sélecteur de modèle **tous fournisseurs** (popover + recherche, groupé par fournisseur, logos) ; dans un chat
  existant le fournisseur est verrouillé ; raisonnement (niveaux propres au modèle) et permissions en menus simples
  (fini le défilement au survol des `Select` Radix ; `Select` passé en mode `popper` partout) ; logos Claude / Gemini
  (Simple Icons, CC0), glyphe neutre pour Codex ; badges d'agent avec logo.
- Sidebar : chevron du dossier à gauche (ne chevauche plus le menu « … »), dépliage animé + apparition en cascade
  des chats.


### 2026-11-22 — shadcn/ui adopté, « chats », projets en dossiers, nouveau chat direct
- La variante **shadcn/ui** (branche `design/shadcn`) est fusionnée dans `main` ; l'interface Vision est supprimée
  (tokens, primitives Card/Button/Progress/RingGauge, vues orphelines, docs).
- Correctif écran noir au lancement : sélecteur zustand qui créait des objets neufs → boucle de rendu infinie.
  Ajout d'une **ErrorBoundary** (écran d'erreur lisible) et de `frontend_log` (erreurs front dans le log Rust).
- Renommages UI : « Mission Control » → **Accueil**, « thread » → **chat** (le panneau « Threads live » garde son nom).
- **Projets** : ajout d'un dossier (`create_project`, sélecteur natif), retrait (`delete_project`, les chats sont
  conservés) ; sidebar en **dossiers repliables** (état mémorisé) avec « Nouveau chat » et la liste des chats du projet ;
  section « Chats » pour les chats hors projet.
- **Nouveau chat sans pop-up** (`Ctrl+N`, sidebar, en-tête, palette) : vue vide avec le composer ; le chat est créé
  au premier message, dans le projet le cas échéant. Pop-up « Nouveau thread » supprimée.
- **Sélecteur de modèle exact** (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.2, défaut) et **niveau de raisonnement**
  (faible → maximum, `claude --effort`), plus les permissions, dans la barre du composer — en brouillon comme dans un
  chat existant (`update_thread_settings` ; redémarrage avec `--resume` au message suivant). Migration `0004` (effort).
- 51 tests Rust, clippy propre, build OK ; montage vérifié via les logs front.


### 2026-11-22 — Phase 2 terminée : moteur d'agents + chat Claude Code
- **Protocole vérifié en réel avant de coder** (sessions sondes) : `claude -p` en stream-json bidirectionnel garde
  **un processus par thread pour plusieurs tours** ; permissions via `--permission-prompts host
  --permission-prompt-tool stdio` (`control_request can_use_tool` ⇄ `control_response`). Sans
  `--permission-prompt-tool stdio`, les demandes sont refusées d'office.
- Back : `AgentAdapter` / `SessionSpec` / `AdapterEvent`, `ClaudeCodeAdapter` (spawn sans console, stdin/stdout/stderr
  en tâches async, `--resume` après redémarrage), parseur pur testé sur 2 sessions réelles nettoyées,
  `AgentRegistry` (sessions + pump par thread : persistance messages/outils/usage/statut, émission d'events,
  permissions en attente, stop = interrupt puis kill de l'arbre après 5 s, `shutdown_all` à la fermeture),
  statut granulaire par outil (`activity.rs`), migration `0003` (cwd, permission_mode, seq des outils),
  commandes threads (create/send/permission/stop/history/rename/delete/prompt history/default cwd),
  plugin dialog (choix du dossier), threads actifs remis à `idle` au démarrage.
- **Quotas réels** : `rate_limit_event` de Claude (fenêtres 5h / 7j de l'abonnement) → `ProviderUsage.live`
  → cartes « Abonnement · source Claude » avec % et réinitialisation, sans configuration.
- Front : store `useChat` (deltas appliqués une fois par frame, dédup historique/live), vue **Nouveau thread**
  (`Ctrl+N` : agent, dossier, modèle, permissions, premier message), navigation vers le chat depuis dock/palette/
  tableaux, titre du thread dans la navbar.
- **Vue chat** (neon / Gemini 4 Neon High, ~21 fichiers, 6 corrections par neon) : en-tête (renommage, modèle,
  permissions, cwd, statut live, Stop), markdown + code coloré + copier, réflexion pliable, outils pliables avec
  **diff** pour Edit, sortie tronquée, **carte d'autorisation** (Entrée / Échap), marqueurs de tour, composer
  (historique ↑/↓, stop), suivi automatique du bas.
- Test de bout en bout réel (Haiku, dossier jetable) : création + permission Write → fichier créé, 2e tour dans
  le même processus (markdown + Rust coloré), Stop pendant un essai long → « Annulé » sans kill, rechargement →
  historique intact, aucun processus orphelin même après fermeture forcée.
- Corrigé pendant le test : navbar qui passait sur 2 lignes, threads « Inactif » avec chronos absurdes dans le dock
  (exclus ; les terminés affichent « il y a … »), focus perdu après une autorisation, double coche.

### 2026-11-22 — Ajustements UI après comparaison au template
- **Cause du « on ne distingue pas les conteneurs »** : le `<style>` inline de `index.html` (`html, body {background}`)
  n'était pas dans un layer Tailwind et écrasait `bg-app` → le fond restait un navy uni, de la même teinte que les cartes.
  Corrigé (style inline limité à `html`) et fond refait comme le template : navy traversé d'une bande diagonale
  bleu-violet lumineuse (CSS maison) sur laquelle les cartes sombres translucides ressortent.
- Quotas : fenêtre affichée en pastille, plus de doublon « Fenêtre glissante 5h · Fenêtre 5h ». Carte raccourcis en liste.
- neon : le bridge fixe désormais le modèle `gemini-4-neon-high` par défaut (`NEON_MODEL` / `-m` pour changer).
  Les deux délégations précédentes avaient tourné sur Gemini 4 Argon (réglage Antigravity de l'utilisateur).

### 2026-11-22 — Refonte UI style « Vision UI » (avant Phase 2)
- Demande utilisateur : interface dans le style du template **Vision UI Dashboard Chakra** (Creative Tim, MIT).
  Choix : rester en **Tailwind** (pas de Chakra/emotion au runtime), violet `#582CFF` en couleur de marque.
- Tokens refaits (`index.css`) avec les mêmes noms sémantiques + `brand`, `accent-2`, `track`, `line-chart`, `axis` ;
  utilitaires `bg-app`, `glass-card`, `glass-tile`, `glass-panel`, `glass-overlay`, `text-wordmark`. Police Plus Jakarta Sans
  (locale). Contrastes vérifiés : texte violet `#9F8CFF` (7:1), danger `#FF5B6B`. Palette agents revalidée sur navy.
- Primitives : `Card`, `IconBox`, `Button`, `Progress`, `RingGauge`, `StatusIconBox`.
- Shell : sidebar flottante (wordmark, items à icon box, projets, carte raccourcis), **Navbar** (fil d'Ariane,
  recherche, bouton dock + badge, verre au scroll), dock en tuiles avec icônes de statut, palette et toasts en verre.
- Back : `UsageReport.previous` (même durée écoulée sur la période précédente) → deltas des cartes stats.
- Mission Control (neon/Antigravity, ~2 200 lignes, 5 retouches de neon) : stats + deltas, accueil avec visuel neuronal SVG,
  jauge du quota le plus sollicité, efficacité du cache, graphique Vision (grille pointillée) + parts par IA, liste des
  quotas, tableau des threads récents, timeline « En cours », par projet.
- Corrigé à l'intégration : grilles basées sur la largeur réelle (container queries, sidebar + dock), delta qui passait
  à la ligne, barre de défilement horizontale de la timeline, **bug** de chrono (un thread redevenu actif gardait l'heure de
  départ de l'ancien état).

### 2026-11-22 — Phase 1 terminée
- Back : migration `0002_default_providers` (4 cartes quotas), modules `db/{projects,threads,providers,usage}`,
  commandes `dashboard_snapshot`, `usage_report`, `update_provider`, `list_projects`, `list_threads`, `get_thread`,
  `dev_seed_demo` / `dev_simulate_activity` / `dev_clear_demo` (debug), `NEURON_DATA_DIR`. `AgentKind`/`ThreadStatus`
  lisibles/écrivables directement en SQL. 34 tests, clippy propre.
- Front : stores zustand (`ui`, `live`, `dashboard`, `toast`), pont d'events unique, `useNow` (horloge partagée),
  `useHotkey`. Shell : Sidebar (recherche, nav, projets avec compteurs live), **Live Dock** (statut granulaire,
  chrono, tokens, badges « À valider / Terminé / Erreur », rail réduit avec indicateurs, `Ctrl+J`), **palette `Ctrl+K`**
  (recherche floue sans accents, navigation clavier, threads/projets/actions), toasts d'attention.
- **Mission Control** (réalisé par neon) : cartes quotas éditables (popover), stats, graphique empilé SVG par IA
  (tooltip, clavier, vue tableau), répartition par IA / projet, activité en cours + récents.
- Palette des agents revue et validée avec l'outil dataviz (l'ancienne échouait luminosité/chroma).
- Vérifié en app réelle sur base isolée : seed, simulation live (statuts, tokens, terminé/erreur/approbation, toast).
- **Bilan neon/Antigravity** : ~1 400 lignes produites en une passe à partir d'un brief détaillé, ~90 % conservées ;
  2 vrais bugs corrigés en relecture (ResizeObserver figé, popover qui se rouvrait) + finitions. Gain réel sur une vue
  volumineuse et bien spécifiée ; la relecture reste indispensable. Corrections d'intégration faites ensuite :
  en-tête des cartes tronqué, tuile cache sur 2 lignes, format monétaire.

### 2026-11-22 — Phase 0 terminée
- Fichiers de pilotage : `CLAUDE.md`, `project.md`, `.gitignore`, `.gitattributes` (LF partout),
  `.claude/agents/neon.md`, `scripts/neon-bridge.sh` (testé de bout en bout avec `agy` : OK).
- Front : Vite 8 + React 19.3 + TS 7 strict + Tailwind 4.3 ; design tokens dans `src/styles/index.css`
  (accent `#00E5A0`, couleurs agents, sémantiques) ; polices locales Inter / JetBrains Mono ; `src/lib/ipc.ts`.
- Back : Tauri 2.12.7, `AppState` (DB + chemins), `Db::call` (spawn_blocking), migrations embarquées
  `0001_init.sql` (11 tables + FTS5 `memories_fts` avec triggers), `AppError` → `IpcError` typé,
  contrat d'events `AgentEvent`/`AgentEventEnvelope` sur `agent://event`, commande `app_info`.
- Bindings TS générés par ts-rs dans `src/bindings/` (via `TS_RS_EXPORT_DIR`).
- Icônes générées depuis `app-icon.svg`.
- Vérifs : `cargo check` sans warning, `cargo test` 16/16, `npm run build` OK, `tauri dev` → fenêtre sombre,
  schéma v1/1, ouverture DB ≈ 12 ms, setup (WebView incluse, debug) ≈ 450 ms.
- Correctif : la crate `tauri` résolue en 2.11 vs npm 2.12 → alignée en 2.12.7 et version mineure fixée.

## Questions ouvertes


- Source des données de quotas (Claude Pro/Max, Antigravity, Codex) : saisie manuelle dans les paramètres vs lecture
  depuis les CLI quand disponible — à trancher en Phase 1/5.
- Temps de démarrage : mesurer en build release (objectif fenêtre + accueil < 50 ms côté données ; l'init WebView2
  domine le temps total).
- Connexion SQLite unique derrière un `Mutex` : suffisant aujourd'hui ; envisager une connexion lecture dédiée
  (WAL) si les dashboards concurrencent l'écriture des events en Phase 2.

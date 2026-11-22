# Neuron — Contexte projet

> Document vivant. **Mis à jour à chaque changement** (voir règle dans `CLAUDE.md`).
> Dernière mise à jour : 2026-11-22 (Phase 1)

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

Style **« Vision UI »** (template MIT *Vision UI Dashboard Chakra* de Creative Tim) recréé en Tailwind v4 :
fond navy dégradé, cartes « verre », violet de marque, cyan secondaire, valeurs blanches grasses sur libellés gris.
(Remplace le style Linear/Raycast émeraude des phases 0–1, à la demande de l'utilisateur.)

| Token | Valeur |
|---|---|
| Fond de page | `#070B24` + dégradé `159deg #0F123B → #090D2E → #020515` + halos violet/cyan (CSS maison) |
| Carte | `linear-gradient(127.09deg, rgba(6,11,40,.94), rgba(10,14,35,.49))`, radius 20px, padding 22px |
| Tuile / sidebar | `126.97deg #060C29 → rgba(4,12,48,.5)` / `111.84deg rgba(6,11,38,.94) → transparent` + blur 10px |
| Surfaces | `#1A1F37` (pastilles, items actifs) · `#22234B` (hover) · piste `#2D2E5F` · grille charts `#56577A` |
| Marque | Violet `#582CFF` (fonds) · texte violet `#9F8CFF` · cyan `#2CD9FF` |
| Sémantique | ok `#01B574` · warn `#FFB547` · danger `#FF5B6B` (texte lisible) |
| Agents (ordre fixe) | Claude `#d95926` · Antigravity `#3987e5` · Codex `#d55181` · Générique `#c98500` — revalidés sur la carte navy |
| Typo | Plus Jakarta Sans (UI), JetBrains Mono (code + compteurs live) ; chiffres `tabular-nums` |
| Rayons | 12px boutons/icon box · 15–16px items/panneaux · 20px cartes |
| Motion | 150 ms, GPU (transform/opacity) ; flou réservé aux panneaux/overlays (perf) |

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
| Sous-agent **neon** → `agy -p` via `scripts/neon-bridge.sh` | parallélisation du travail UI ; mode par défaut `--dangerously-skip-permissions` (choix utilisateur), surcharge via `NEON_MODE` |
| DB dans `app_data_dir()/neuron.db` (WAL) | données app séparées de la mémoire utilisateur `~/.neuron/` |
| Git : commit local par phase validée, pas de push | choix utilisateur |
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
- [ ] **Phase 2** — `AgentAdapter`, registre multi-threads, `ClaudeCodeAdapter`, chat streaming
- [ ] **Phase 3** — Projets, `.neuron/context.md`, injection de contexte
- [ ] **Phase 4** — Mémoire globale (`~/.neuron/memory.md` + SQLite), vue Mémoire, serveur MCP embarqué
- [ ] **Phase 5** — Adaptateurs Antigravity / Codex / Generic PTY, paramètres, raccourcis, fluidité

## Journal des changements

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

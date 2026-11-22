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

Linear / Raycast *Dark Minimalist Precision* + touche *Cyber-Industrial* pour les métriques (Zed, Teenage Engineering).

| Token | Valeur |
|---|---|
| Fond | `#0B0C0E` |
| Surface / hover | `#121418` / `#181B21` |
| Bordure | `1px rgba(255,255,255,0.07)` |
| Accent | Émeraude `#00E5A0` |
| Agents (ordre fixe) | Claude `#d95926` · Antigravity `#3987e5` · Codex `#d55181` · Générique `#c98500` — validés sur fond sombre (bande de luminosité, chroma, CVD adjacent ΔE ≥ 13) |
| Typo | Inter (UI), JetBrains Mono (code, tokens, chronos, `tabular-nums`) |
| Motion | 150 ms, GPU (transform/opacity) |

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

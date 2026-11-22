# Neuron — CLAUDE.md

Neuron est une app desktop personnelle (Tauri v2) qui centralise et pilote les agents IA en ligne de commande
(Claude Code, Antigravity `agy`, Codex, CLI génériques) dans un poste de pilotage graphique unifié.

> **Règle permanente :** toute modification du projet (code, archi, décision, dépendance) doit être reflétée
> dans [`project.md`](project.md) — section *État d'avancement* et *Journal des changements* (entrée datée en haut).

## Stack (versions fixées)

| Couche | Choix |
|---|---|
| Desktop | **Tauri 2** (`tauri = "2.12"`, `@tauri-apps/api@^2.12`, `@tauri-apps/cli@^2.12`) — ne pas passer en 3.x alpha ; garder crate et paquets npm sur la **même mineure** (sinon `tauri dev` signale un mismatch) |
| Backend | Rust (edition 2024) + **Tokio** |
| DB | **SQLite** via `rusqlite` (feature `bundled`, FTS5 inclus), migrations SQL embarquées |
| IPC typé | `ts-rs` → types générés dans `src/bindings/` (versionnés) |
| Frontend | React 19 + TypeScript strict + Vite + **Tailwind CSS v4** (`@tailwindcss/vite`) + `lucide-react` |
| Polices | `@fontsource-variable/inter` (UI), `@fontsource-variable/jetbrains-mono` (code, tokens, chronos) — locales, zéro réseau |

## Arborescence

```
src-tauri/
  migrations/NNNN_*.sql     migrations SQL (append-only, jamais modifier une migration publiée)
  src/
    lib.rs                  bootstrap Tauri, setup (DB, état), registre des commandes
    error.rs                AppError (thiserror) sérialisé vers le front
    state.rs                AppState partagé (managed state Tauri)
    db/                     connexion, PRAGMAs, migrations (PRAGMA user_version)
    commands/               commandes #[tauri::command] groupées par domaine
    agents/                 trait AgentAdapter, adaptateurs, registre de processus, events normalisés
src/
  bindings/                 GÉNÉRÉ par `cargo test` (ts-rs) — ne pas éditer à la main
  lib/ipc.ts                SEUL point d'accès à invoke()/listen()
  styles/index.css          design tokens Tailwind v4 (@theme)
  components/ views/ hooks/ (à partir de la Phase 1)
scripts/neon-bridge.sh      bridge vers Antigravity pour le sous-agent neon
.claude/agents/neon.md      définition du sous-agent neon
```

## Répartition des rôles

- **Claude Code (lead)** : architecture globale, backend Rust (`src-tauri/`), gestionnaire de processus IA,
  SQLite, serveur MCP de mémoire, typage IPC (`src/bindings`, `src/lib/ipc.ts`), intégration finale, revue.
- **neon (Antigravity via `scripts/neon-bridge.sh`)** : UI/UX dans `src/` — design system Tailwind, composants
  React, animations, polish des vues complexes (Dashboard, Chat, Moniteur de threads, Palette Ctrl+K).
  neon ne touche **jamais** `src-tauri/`, `src/bindings/` ni `src/lib/ipc.ts`.
- Claude relit systématiquement le travail de neon (diff + `npm run build`) avant intégration.

## Conventions Rust

- Pas d'`unwrap()`/`expect()` hors tests et hors `main` (sauf invariant documenté).
- Commandes Tauri : `async fn ...(...) -> Result<T, AppError>`; les noms sont en `snake_case`, groupés par domaine.
- Tout accès SQLite passe par `Db::call(|conn| ...)` (exécuté via `spawn_blocking`) — jamais d'I/O bloquante sur le runtime async.
- Events vers le front : canal unique **`agent://event`**, payload `AgentEventEnvelope { threadId, event }`
  où `event` est un enum tagué `kind` (`MessageDelta`, `ToolCallStart`, `ToolCallResult`, `PermissionRequest`,
  `TokenUsageUpdate`, `ThreadStatusChanged`, `ThreadError`).
- Identifiants : UUID v4 en `String`. Timestamps : `i64` millisecondes Unix.
- Tout type traversant l'IPC dérive `Serialize` (+ `Deserialize` si entrant) **et** `ts_rs::TS` avec
  `#[ts(export)]` et `#[serde(rename_all = "camelCase")]` (enums tagués : `rename_all_fields`). Le dossier de sortie
  vient de `TS_RS_EXPORT_DIR` (`src-tauri/.cargo/config.toml`). Les entiers 64 bits portent `#[ts(type = "number")]`.
- Logs via `tracing` (pas de `println!`).
- Nouvelle table/colonne = nouvelle migration `NNNN_description.sql`.

## Conventions TypeScript / UI

- `strict: true`, pas de `any`, pas de `as` non justifié. Types IPC importés depuis `src/bindings/`.
- Aucun `invoke`/`listen` hors de `src/lib/ipc.ts`.
- Couleurs, rayons, durées : **uniquement les tokens** de `src/styles/index.css` (`bg-bg`, `bg-surface`,
  `border-line`, `text-accent`, `text-agent-claude`…). Pas de hex en dur dans les composants.
- Chiffres dynamiques (tokens, chronos, compteurs) : `font-mono tabular-nums`.
- Transitions : `150ms`, uniquement `transform`/`opacity`/`color`/`background-color` (GPU-friendly).
- Pas de spinner inutile ; streaming sans re-render global (état par thread, mémoïsation).
- Composants fonctionnels, un composant par fichier, nommage `PascalCase.tsx`.

## Commandes

```bash
npm install                     # dépendances front
npm run dev                     # Vite seul (port 1420)
npm run tauri dev               # app complète en dev
npm run build                   # tsc -b + vite build  (doit passer à chaque phase)
cd src-tauri && cargo check     # (doit passer à chaque phase)
cd src-tauri && cargo test      # tests + régénération des bindings TS
scripts/neon-bridge.sh -d . -f brief.md     # déléguer une tâche UI à Antigravity
```

## Workflow par phase

1. Implémenter. 2. `cargo check` + `cargo test` + `npm run build` verts. 3. Mettre à jour `project.md`.
4. Commit local `Phase N: ...` (pas de push sans demande explicite). 5. Pause pour validation utilisateur.

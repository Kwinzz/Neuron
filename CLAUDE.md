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
    db/                     connexion, PRAGMAs, migrations (PRAGMA user_version) + requêtes par domaine
                            (projects, threads, providers, usage) — fonctions sync `fn(&Connection, ...)`
    util.rs                 now_ms, constantes de durée
    app_settings.rs         Paramètres (document JSON unique dans `settings`, valeurs par défaut tolérantes)
    context.rs              contexte projet : .neuron/context.md, instantané git, fichiers récents, assemblage
    memory/                 mémoire globale (memory.md ⇄ SQLite) + serveur MCP stdio embarqué (mcp.rs)
    commands/               commandes #[tauri::command] groupées par domaine
    agents/                 trait AgentAdapter, adaptateurs, registre de processus, events normalisés
src/
  bindings/                 GÉNÉRÉ par `cargo test` (ts-rs) — ne pas éditer à la main
  lib/ipc.ts                SEUL point d'accès à invoke()/listen()
  lib/                      agents.ts (méta + ordre), status.ts, format.ts, fuzzy.ts
  stores/                   zustand : ui, live (threads temps réel), dashboard, toast
  hooks/                    useAgentEventBridge, useHotkey, useNow
  components/shell/         AppShell, Sidebar, LiveDock, DockThreadRow, Toaster
  components/palette/       CommandPalette (Ctrl+K)
  components/ui/            primitives partagées (AgentBadge, StatusDot, Kbd, LiveTimer)
  views/home/               Accueil (dashboard)
  views/chat/               ChatView (chat existant) + DraftChat (nouveau chat vide, créé au 1er message)
  views/project/            page projet (éditeur context.md, git, fichiers récents, chats du projet)
  components/context/       indicateur de contexte injecté (en-tête de chat, nouveau chat)
  components/markdown/      rendu Markdown partagé (chat + aperçus) : Markdown, CodeBlock, markdown.css
  views/memory/             vue Mémoire (souvenirs par catégorie, recherche)
  views/settings/           Paramètres (agents inactifs, Agents & MCP, notifications, contexte injecté, CLI génériques, raccourcis)
  lib/shortcuts.ts          liste unique des raccourcis globaux (aide + palette)
  styles/index.css          design tokens Tailwind v4 (@theme)
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
- **Design system : shadcn/ui** (style `radix-nova`, couleur de base *Neutral*, sombre uniquement — `<html class="dark">`).
  Composants officiels dans `src/components/ui/*.tsx` (minuscules, ajoutés via `npx shadcn@latest add <nom>`),
  `cn` depuis `"cn"`. Look Vercel/shadcn : cartes plates à bordure 1px, `rounded-xl`, beaucoup d'air, pas de dégradé.
- Tokens shadcn (`bg-background`, `bg-card`, `text-muted-foreground`, `border`, `bg-primary text-primary-foreground`,
  `bg-accent` = **fond de survol**, `ring`, `chart-1..4` = couleurs des agents dans l'ordre fixe). Tokens Neuron
  complémentaires : `text-ok` / `text-warn` / `text-destructive` / `text-live`, `hl` (texte mis en avant),
  `agent-*`. Pas de hex dans les composants.
- Primitives Neuron restantes (`src/components/ui/PascalCase.tsx`) : `AgentBadge`, `StatusDot`, `StatusIconBox`,
  `IconBox`, `Kbd`, `LiveTimer`. Barre de réglages de chat : `components/chat/ChatSettingsBar` (modèle exact,
  niveau de raisonnement, permissions d'exécution + bascule `ModeSwitch` Exécuter/Planifier, Maj+Tab — options dans `lib/models.ts`).
- Valeurs KPI `text-2xl font-semibold tabular-nums`, descriptions `text-muted-foreground`. Police Geist / Geist Mono.
- **Vocabulaire UI** : on dit « chat » (pas « thread ») partout, sauf le panneau « Threads live ». L'accueil s'appelle
  « Accueil ». Le code (types, tables, commandes) garde `thread`.
- **Sélecteurs zustand** : ne jamais créer d'objets/tableaux neufs dans un sélecteur sans `useShallow`, et même avec
  `useShallow`, ne pas `map` vers des objets neufs (boucle de rendu infinie → écran noir). Renvoyer des primitives ou
  les objets du store.
- Transitions : `150ms`, uniquement `transform`/`opacity`/`color`/`background-color` (GPU-friendly).
- Pas de spinner inutile ; streaming sans re-render global (état par thread, mémoïsation).
- Composants fonctionnels, un composant par fichier, nommage `PascalCase.tsx`.
- État global : **zustand** (`src/stores/`). Toujours lire via sélecteur (`useLive(s => s.threads[id])`) ;
  sélecteur qui renvoie un tableau/objet neuf → `useShallow`. Les événements agents entrent **uniquement** par
  `useAgentEventBridge` (monté une fois dans `AppShell`).
- Horloges : `useNow(periodMs)` (un seul `setInterval` partagé), uniquement dans des composants feuilles.
- Couleurs d'agents = palette catégorielle validée (outil dataviz) dans un **ordre fixe**
  `AGENT_ORDER` (claude → antigravity → codex → generic) ; ne jamais réordonner par rang. Texte jamais coloré
  avec la couleur de série ; identité jamais portée par la couleur seule (toujours un libellé).

## Moteur d'agents (Phase 2)

- `AgentAdapter::start(&SessionSpec) -> SessionHandle` : lance **un processus longue durée par thread**
  (commandes via `mpsc`, `AdapterEvent`s en sortie). Parsing = fonction pure testée sur des flux réels
  (`agents/claude/fixtures/*.jsonl`, nettoyés des chemins/infos perso).
- Claude Code : `claude -p --input-format stream-json --output-format stream-json --verbose
  --include-partial-messages --permission-prompts host --permission-prompt-tool stdio --permission-mode <m>
  [--model] [--resume <session_id>]`. Permissions : `control_request can_use_tool` ⇄ `control_response allow/deny`.
  Arrêt : `control_request interrupt`, puis kill de l'arbre de processus après 5 s.
- `AgentRegistry` (dans `AppState`) : sessions par thread + une tâche *pump* par session qui persiste
  (messages / tool_calls partagent `seq`, `token_usage`, statut) puis émet sur `agent://event`.
  Au démarrage, les threads restés actifs repassent `idle` ; à la fermeture, tous les processus sont tués.
- **Antigravity** : `agy --input-format stream-json --output-format stream-json [--mode …] [--model] [--effort]
  [--conversation <id>] -p ""` (process longue durée, entrées `{"event":"user",…}`, sorties `init` / `step_update` /
  `result` ; pas d'approbation interactive ; Stop = kill puis reprise via `--conversation`).
- **Codex** : `codex exec --json --skip-git-repo-check --sandbox … [-m] [-c model_reasoning_effort="…"]
  [resume <thread_id>] -- <prompt>` — **un processus par tour** (la boucle de session de l'adaptateur le masque au
  registre) ; pas d'approbation : sandbox `workspace-write` (lecture seule en mode Plan).
- Plomberie commune des process NDJSON : `agents/process.rs`. Catalogue de modèles (`list_models`) lu depuis les CLI
  (`codex debug models`, `agy models`), cache 10 min. Tests live (ignorés par défaut) :
  `NEURON_LIVE_DIR=<dossier jetable> cargo test --test live_agents -- --ignored`.
- **Contexte projet (Phase 3)** : figé dans `threads.context` à la création d'un chat de projet. Claude reçoit
  `--append-system-prompt` (adaptateur `supports_system_prompt() = true`) ; les autres CLI reçoivent
  `context::as_preamble` devant le premier message uniquement. Ne jamais créer `.neuron/` dans un dossier absent.
- **Mémoire (Phase 4)** : SQLite `memories` = source de vérité, miroir `~/.neuron/memory.md` (import des éditions
  via hash dans `settings`, réécrit après chaque changement ; `<NEURON_DATA_DIR>/.neuron` en dev). Injectée dans chaque
  nouveau chat. Serveur MCP = le même exécutable lancé en `neuron --mcp-memory --db … --memory-file … --agent …`
  (logs sur stderr, stdout = protocole). Claude : `--mcp-config=` + `--allowedTools=` ; Codex : `-c mcp_servers.neuron.*` ;
  Antigravity : pas de MCP par session → inscription `agy mcp add` déclenchée **par l'utilisateur** depuis Paramètres → Agents & MCP.
  Événement `memory://changed` (watcher de memory.md) en plus de `agent://event`.
- **Présentation de Neuron** (`context::neuron_intro`) : chaque agent apprend qu'il tourne dans Neuron, qu'il peut
  lire / ajouter / corriger / supprimer des souvenirs et tenir à jour `.neuron/context.md` (outils MCP
  `neuron_memory_*`, `neuron_project_context_*` ; `--project` passé au serveur pour les chats de projet).
- **CLI génériques (Phase 5)** : profils dans Paramètres (`GenericCliProfile` : commande, args avec `{prompt}` sinon
  stdin, `pty`). Le chat `generic` stocke l'id du profil dans `model`. Un processus par message, sortie streamée en
  texte (ANSI retiré via `vte`). PTY = `portable-pty` (ConPTY) : **répondre à la requête de position du curseur
  `ESC[6n` par `ESC[1;1R`**, sinon le programme ne démarre jamais sous Windows.
- **Arrêt des inactifs** : `AgentRegistry::reap_idle` (tâche toutes les 60 s, `idleShutdownMinutes`) ; le chat reprend
  au message suivant comme après un redémarrage.
- **Notifications natives** (`tauri-plugin-notification`, mineure alignée crate/npm) : envoyées par
  `useAgentEventBridge` sur transition de statut (terminé / autorisation / erreur) quand la fenêtre n'a pas le focus.
- Vues chargées à la demande (`React.lazy` dans `AppShell`, préchargées au repos) : garder les imports lourds
  (markdown, highlight.js, recharts) hors du bundle principal.
- **Coûts** : Claude Code communique son coût ; Codex/Antigravity sont estimés par `pricing.rs` (liste LiteLLM
  téléchargée ≤ 1×/jour, cache `<data_dir>/prices.json`, entrées des éditeurs uniquement, repli sur la table intégrée).
  Affichage via `components/ui/CostLabel` (« ≈ » pour les estimations). C'est le seul appel réseau de l'app.
- `rate_limit_event` (fenêtres 5h / 7j de l'abonnement Claude) → `settings.claude.rate_limits` → `ProviderUsage.live`.
- **Quotas Antigravity** : `agy --print /quota --output-format json` (répondu par le CLI, 0 token, **refusé dans une
  session stream-json**) → groupes de modèles × fenêtres 5 h / hebdo (`antigravity/quota.rs`), rafraîchi après chaque
  tour agy et toutes les 15 min, événement `quotas://changed`. Dans un chat agy, `/quota`, `/usage`, `/credits` sont
  interceptés par `send_prompt` et exécutés de la même façon (carte de commande).
- **Modes** (`manual`, `acceptEdits`, `auto`, `plan`, `bypassPermissions`) : Claude change de mode **à chaud**
  (`control_request set_permission_mode`, `manual` ⇄ `default` côté Claude) au lieu de redémarrer ; `system/status`
  `permissionMode` → `AgentEvent::PermissionModeChanged` (persisté). Plan mode Claude : `ExitPlanMode` = demande
  d'autorisation → `PlanBlock` (plan en Markdown) + `PlanApproval` ; approuver renvoie `updatedPermissions setMode`
  (Claude exécute aussitôt), refuser = continuer à planifier. Codex / agy en Plan : `PlanFollowUp` (« Exécuter le
  plan » = repasse en éditions auto + message). Codex : `auto` = `workspace-write` ; agy : `--mode auto`.
- **Questions** : Claude `AskUserQuestion` = demande d'autorisation → `QuestionCard` ; réponses renvoyées dans
  `updatedInput.answers` (`{ question: réponse }`, choix multiples joints par « , »). agy saute `ask_question` en print.
- **Diffs des fichiers modifiés** (`agents/file_changes.rs`) : agy et Codex ne transmettent que les chemins → le
  pump lit chaque fichier au début de l'outil d'édition (les CLI annoncent avant d'écrire) et à la fin, diff unifié
  (`similar`) stocké dans `tool_calls.changes_json` et envoyé dans `ToolCallResult.changes`. UI : `FileEditBlock`
  (bloc de code ouvert dans la conversation), repli sur l'entrée Claude `Edit`/`Write` pour l'historique ancien.
- **Commandes locales** (Claude `/usage`, `/context`… repérées par `local_command` dans `result`) : `ChatItem::Command`,
  pas de marqueur de fin de tour.
- Front : `useChat` (timeline par thread, événements appliqués **une fois par frame**), `ChatItem` = même type
  pour l'historique et le live.

## Dev

- `NEURON_DATA_DIR=<dossier>` : base SQLite isolée (tests manuels, captures).
- En debug, palette `Ctrl+K` → *Générer des données de démo* / *Simuler de l'activité live* / *Supprimer les données
  de démo* (commandes `dev_*`, refusées en release, lignes préfixées `demo-`).

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

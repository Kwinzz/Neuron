# Neuron — Contexte projet

> Document vivant. **Mis à jour à chaque changement** (voir règle dans `CLAUDE.md`).
> Dernière mise à jour : 2026-11-22 (shadcn + chats)

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
- [ ] **Phase 3** — Projets, `.neuron/context.md`, injection de contexte
- [ ] **Phase 4** — Mémoire globale (`~/.neuron/memory.md` + SQLite), vue Mémoire, serveur MCP embarqué
- [ ] **Phase 5** — ~~Adaptateurs Antigravity / Codex~~ (faits), Generic PTY, paramètres, raccourcis, fluidité

## Journal des changements

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

- Bundle front > 500 kB (highlight.js) : charger la vue chat à la demande (lazy) en Phase 5.
- Processus inactifs : pas encore d'arrêt après inactivité (ils restent vivants jusqu'à fermeture/suppression).

- Source des données de quotas (Claude Pro/Max, Antigravity, Codex) : saisie manuelle dans les paramètres vs lecture
  depuis les CLI quand disponible — à trancher en Phase 1/5.
- Temps de démarrage : mesurer en build release (objectif fenêtre + accueil < 50 ms côté données ; l'init WebView2
  domine le temps total).
- Connexion SQLite unique derrière un `Mutex` : suffisant aujourd'hui ; envisager une connexion lecture dédiée
  (WAL) si les dashboards concurrencent l'écriture des events en Phase 2.

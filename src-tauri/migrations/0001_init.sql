-- Neuron — initial schema.
-- Conventions: ids are UUID v4 TEXT, timestamps are INTEGER unix milliseconds.
-- Migrations are append-only: never edit this file once released, add NNNN_*.sql instead.

-- ---------------------------------------------------------------------------
-- Projects: a local directory on disk.
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
    id              TEXT PRIMARY KEY NOT NULL,
    name            TEXT NOT NULL,
    path            TEXT NOT NULL UNIQUE,
    created_at      INTEGER NOT NULL,
    last_opened_at  INTEGER
);

-- ---------------------------------------------------------------------------
-- Threads: one conversation with one agent, optionally inside a project.
-- status: idle | thinking | reading | editing | running | awaiting_approval | done | error | cancelled
-- session_ref: agent-native session id (e.g. Claude Code session_id) used to resume.
-- ---------------------------------------------------------------------------
CREATE TABLE threads (
    id              TEXT PRIMARY KEY NOT NULL,
    project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
    agent           TEXT NOT NULL,
    model           TEXT,
    title           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'idle',
    session_ref     TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    ended_at        INTEGER
);
CREATE INDEX idx_threads_project ON threads(project_id, updated_at DESC);
CREATE INDEX idx_threads_updated ON threads(updated_at DESC);

-- ---------------------------------------------------------------------------
-- Messages. role: user | assistant | system | thinking
-- content: markdown text; meta_json: agent-specific extras.
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
    id              TEXT PRIMARY KEY NOT NULL,
    thread_id       TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    seq             INTEGER NOT NULL,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL DEFAULT '',
    meta_json       TEXT,
    created_at      INTEGER NOT NULL,
    UNIQUE (thread_id, seq)
);

-- ---------------------------------------------------------------------------
-- Tool calls. status: running | ok | error | denied
-- ---------------------------------------------------------------------------
CREATE TABLE tool_calls (
    id              TEXT PRIMARY KEY NOT NULL,
    thread_id       TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    message_id      TEXT REFERENCES messages(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    input_json      TEXT,
    output          TEXT,
    status          TEXT NOT NULL DEFAULT 'running',
    started_at      INTEGER NOT NULL,
    ended_at        INTEGER
);
CREATE INDEX idx_tool_calls_thread ON tool_calls(thread_id, started_at);

-- ---------------------------------------------------------------------------
-- Token usage telemetry: one row per usage report from an agent.
-- Denormalized agent/model/project_id so dashboards never need joins.
-- ---------------------------------------------------------------------------
CREATE TABLE token_usage (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id       TEXT REFERENCES threads(id) ON DELETE SET NULL,
    project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
    agent           TEXT NOT NULL,
    model           TEXT,
    input_tokens        INTEGER NOT NULL DEFAULT 0,
    output_tokens       INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
    cost_usd        REAL NOT NULL DEFAULT 0,
    ts              INTEGER NOT NULL
);
CREATE INDEX idx_token_usage_ts ON token_usage(ts);
CREATE INDEX idx_token_usage_agent_ts ON token_usage(agent, ts);
CREATE INDEX idx_token_usage_project_ts ON token_usage(project_id, ts);
CREATE INDEX idx_token_usage_thread ON token_usage(thread_id);

-- ---------------------------------------------------------------------------
-- Providers / subscriptions & quotas (user-configurable cards on Mission Control).
-- window_kind: rolling_5h | weekly | monthly | credits | none
-- unit: tokens | messages | usd | credits | requests
-- ---------------------------------------------------------------------------
CREATE TABLE providers (
    id              TEXT PRIMARY KEY NOT NULL,
    agent           TEXT NOT NULL,
    label           TEXT NOT NULL,
    plan            TEXT,
    window_kind     TEXT NOT NULL DEFAULT 'none',
    limit_value     REAL,
    unit            TEXT NOT NULL DEFAULT 'tokens',
    alert_pct       REAL NOT NULL DEFAULT 0.8,
    config_json     TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Global memory (mirrors ~/.neuron/memory.md).
-- category: profile | tech_preferences | code_style | strict_rules | other
-- source: user | agent:<name> | import
-- ---------------------------------------------------------------------------
CREATE TABLE memories (
    id              TEXT PRIMARY KEY NOT NULL,
    category        TEXT NOT NULL,
    content         TEXT NOT NULL,
    source          TEXT NOT NULL DEFAULT 'user',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_memories_category ON memories(category);

CREATE VIRTUAL TABLE memories_fts USING fts5(
    content,
    category UNINDEXED,
    content = 'memories',
    content_rowid = 'rowid',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, category) VALUES (new.rowid, new.content, new.category);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES ('delete', old.rowid, old.content, old.category);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES ('delete', old.rowid, old.content, old.category);
    INSERT INTO memories_fts(rowid, content, category) VALUES (new.rowid, new.content, new.category);
END;

-- ---------------------------------------------------------------------------
-- Agent configurations (built-in adapters + user-defined generic CLIs).
-- kind: claude_code | antigravity | codex | generic
-- mode: stream_json | pty
-- ---------------------------------------------------------------------------
CREATE TABLE agent_configs (
    id              TEXT PRIMARY KEY NOT NULL,
    kind            TEXT NOT NULL,
    name            TEXT NOT NULL UNIQUE,
    command         TEXT NOT NULL,
    args_json       TEXT NOT NULL DEFAULT '[]',
    env_json        TEXT NOT NULL DEFAULT '{}',
    mode            TEXT NOT NULL DEFAULT 'stream_json',
    supports_mcp    INTEGER NOT NULL DEFAULT 0,
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Key/value settings (JSON values).
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
    key             TEXT PRIMARY KEY NOT NULL,
    value           TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Prompt history for the composer (↑ recall), per project or global.
-- ---------------------------------------------------------------------------
CREATE TABLE prompt_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
    text            TEXT NOT NULL,
    ts              INTEGER NOT NULL
);
CREATE INDEX idx_prompt_history_project_ts ON prompt_history(project_id, ts DESC);

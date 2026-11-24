-- Usage read from the CLIs' own logs (Claude Code transcripts, Codex rollouts), so the dashboard counts
-- everything the subscriptions consumed, not only the turns run from Neuron.
ALTER TABLE token_usage ADD COLUMN source TEXT;      -- NULL = recorded by Neuron, else 'claude_log' / 'codex_log'
ALTER TABLE token_usage ADD COLUMN dedupe_key TEXT;  -- one row per API response in the logs
CREATE UNIQUE INDEX idx_token_usage_dedupe ON token_usage(dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Read position of each log file (incremental import) and the state a Codex rollout needs across reads.
CREATE TABLE usage_import_files (
    path        TEXT PRIMARY KEY,
    offset      INTEGER NOT NULL DEFAULT 0,
    session     TEXT,
    cwd         TEXT,
    model       TEXT,
    prev_total  TEXT
);

-- First usage found in the logs, per agent: from then on the logs are the source of truth for that agent
-- (Neuron's own turns are in them too), Neuron's rows only cover the time before.
CREATE TABLE usage_log_start (
    agent  TEXT PRIMARY KEY,
    since  INTEGER NOT NULL
);

CREATE VIEW usage_effective AS
SELECT * FROM token_usage u
WHERE u.source IS NOT NULL
   OR u.ts < COALESCE((SELECT s.since FROM usage_log_start s WHERE s.agent = u.agent), 9223372036854775807);

-- Demo data of the removed « Générer des données de démo » command.
DELETE FROM token_usage WHERE thread_id LIKE 'demo-%' OR project_id LIKE 'demo-%';
DELETE FROM threads WHERE id LIKE 'demo-%';
DELETE FROM projects WHERE id LIKE 'demo-%';

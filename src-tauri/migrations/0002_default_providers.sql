-- Default quota / subscription cards. Limits are NULL until the user configures them.
INSERT OR IGNORE INTO providers (id, agent, label, plan, window_kind, limit_value, unit, alert_pct, sort_order, created_at, updated_at)
VALUES
    ('claude-5h',     'claude_code', 'Claude Code',  'Fenêtre glissante 5h', 'rolling_5h', NULL, 'tokens', 0.8, 0, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
    ('claude-weekly', 'claude_code', 'Claude Code',  'Limite hebdomadaire',  'weekly',     NULL, 'tokens', 0.8, 1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
    ('antigravity',   'antigravity', 'Antigravity',  'Quota',                'weekly',     NULL, 'tokens', 0.8, 2, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
    ('codex',         'codex',       'Codex',        'Quota',                'weekly',     NULL, 'tokens', 0.8, 3, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);

-- Cross-device workspace execution ("AI on device B, workspace on device A").
-- Columns on `threads` keep `project_id` NULL when the project belongs to another device (no cross-device FK).
-- `workspace_grants` tracks explicit per-chat authorizations issued by this device for a paired AI host.

ALTER TABLE threads ADD COLUMN workspace_device TEXT;
ALTER TABLE threads ADD COLUMN workspace_device_name TEXT;
ALTER TABLE threads ADD COLUMN workspace_cwd TEXT;
ALTER TABLE threads ADD COLUMN workspace_project_id TEXT;
ALTER TABLE threads ADD COLUMN workspace_project_name TEXT;
ALTER TABLE threads ADD COLUMN workspace_grant_id TEXT;
ALTER TABLE threads ADD COLUMN workspace_os TEXT;

CREATE TABLE workspace_grants (
    id            TEXT PRIMARY KEY NOT NULL,
    peer_node_id  TEXT NOT NULL,
    peer_name     TEXT NOT NULL DEFAULT '',
    thread_id     TEXT,
    root_cwd      TEXT NOT NULL,
    scope         TEXT NOT NULL DEFAULT 'project_only', -- project_only | full
    created_at    INTEGER NOT NULL,
    revoked_at    INTEGER
);
CREATE INDEX idx_workspace_grants_peer ON workspace_grants(peer_node_id) WHERE revoked_at IS NULL;

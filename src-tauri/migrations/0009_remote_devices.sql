-- Remote devices (see src/remote). Pairing is directional:
-- remote_clients = devices allowed to control this one; remote_hosts = devices this one controls.
CREATE TABLE remote_clients (
    node_id    TEXT PRIMARY KEY,        -- iroh endpoint id (public key, hex)
    name       TEXT NOT NULL,
    level      TEXT NOT NULL DEFAULT 'full', -- read | chat | full
    created_at INTEGER NOT NULL,
    last_seen  INTEGER
);

CREATE TABLE remote_hosts (
    node_id    TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen  INTEGER
);

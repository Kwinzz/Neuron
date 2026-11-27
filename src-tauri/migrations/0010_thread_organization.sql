-- Thread organization (pin, archive, soft delete with undo window) and full-text search over chat messages.

ALTER TABLE threads ADD COLUMN pinned_at INTEGER;
ALTER TABLE threads ADD COLUMN archived_at INTEGER;
ALTER TABLE threads ADD COLUMN deleted_at INTEGER;

CREATE INDEX idx_threads_deleted ON threads(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    content = 'messages',
    content_rowid = 'rowid',
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER messages_au AFTER UPDATE OF content ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');

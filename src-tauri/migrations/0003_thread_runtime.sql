-- Runtime data needed to (re)start agent sessions and to rebuild the chat timeline.

-- Working directory of the agent process and its permission mode
-- (claude: manual | acceptEdits | auto | plan | bypassPermissions).
ALTER TABLE threads ADD COLUMN cwd TEXT;
ALTER TABLE threads ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'manual';

-- Tool calls share the per-thread sequence with messages so the timeline can be rebuilt in order.
ALTER TABLE tool_calls ADD COLUMN seq INTEGER;
CREATE INDEX idx_tool_calls_thread_seq ON tool_calls(thread_id, seq);
CREATE INDEX idx_messages_thread_seq ON messages(thread_id, seq);

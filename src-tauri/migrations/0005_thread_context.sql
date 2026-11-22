-- Context injected when the chat was created (project context.md + git snapshot + recent files),
-- frozen with the chat so the UI shows exactly what the agent received.
ALTER TABLE threads ADD COLUMN context TEXT;
ALTER TABLE threads ADD COLUMN context_sources TEXT;

-- Reasoning effort per chat (claude: low | medium | high | xhigh | max; NULL = CLI default).
ALTER TABLE threads ADD COLUMN effort TEXT;

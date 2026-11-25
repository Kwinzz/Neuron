-- Claude Code's `total_cost_usd` is the running total of its process, and Neuron stored it as the cost of each
-- turn: chat costs and turn markers grew with every turn. Each turn gets back its own share: the difference with
-- the previous turn of the chat. A lower total means a new process (it restarts from zero): kept as is.

WITH ordered AS (
    SELECT id, cost_usd,
           LAG(cost_usd) OVER (PARTITION BY thread_id ORDER BY ts, id) AS prev
    FROM token_usage
    WHERE source IS NULL AND agent = 'claude_code' AND thread_id IS NOT NULL
)
UPDATE token_usage
SET cost_usd = token_usage.cost_usd - ordered.prev
FROM ordered
WHERE token_usage.id = ordered.id AND ordered.prev IS NOT NULL AND token_usage.cost_usd >= ordered.prev;

WITH ordered AS (
    SELECT m.id,
           json_extract(m.meta_json, '$.usage.costUsd') AS cost,
           LAG(json_extract(m.meta_json, '$.usage.costUsd')) OVER (PARTITION BY m.thread_id ORDER BY m.seq) AS prev
    FROM messages m
    JOIN threads t ON t.id = m.thread_id
    WHERE m.role = 'turn' AND t.agent = 'claude_code' AND json_valid(m.meta_json)
      AND json_type(m.meta_json, '$.usage.costUsd') IN ('real', 'integer')
)
UPDATE messages
SET meta_json = json_set(messages.meta_json, '$.usage.costUsd', ordered.cost - ordered.prev)
FROM ordered
WHERE messages.id = ordered.id AND ordered.prev IS NOT NULL AND ordered.cost >= ordered.prev;

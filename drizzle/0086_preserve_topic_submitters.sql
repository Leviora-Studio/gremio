-- Restore original submitters for existing copies using their recorded predecessor chain.
-- Session permissions remain independent; unavailable/deleted authors are not guessed.
WITH RECURSIVE lineage AS (
  SELECT id AS topic_id, created_by, previous_topic_id, ARRAY[id] AS path FROM meeting_topics
  UNION ALL
  SELECT l.topic_id, p.created_by, p.previous_topic_id, l.path || p.id
  FROM lineage l JOIN meeting_topics p ON p.id = l.previous_topic_id
  WHERE NOT p.id = ANY(l.path)
), original AS (
  SELECT DISTINCT ON (topic_id) topic_id, created_by
  FROM lineage ORDER BY topic_id, cardinality(path) DESC
)
UPDATE meeting_topics t SET created_by = original.created_by
FROM original WHERE t.id = original.topic_id AND original.created_by IS NOT NULL
AND t.created_by IS DISTINCT FROM original.created_by;

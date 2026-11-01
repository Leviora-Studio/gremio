-- Existing contact addresses become a configurable internal card field.
INSERT INTO board_card_fields (board_id, field_key, visible, position)
SELECT b.id, 'submitter_email', true,
       COALESCE((SELECT MAX(f.position) + 1 FROM board_card_fields f WHERE f.board_id = b.id), 0)
FROM boards b
ON CONFLICT (board_id, field_key) DO NOTHING;
--> statement-breakpoint
-- Repair existing active application routes without changing field ordering.
INSERT INTO board_card_fields (board_id, field_key, visible, position)
SELECT b.id, required.field_key, true,
       COALESCE((SELECT MAX(f.position) + 1 FROM board_card_fields f WHERE f.board_id = b.id), 0) + required.ordinality::integer
FROM boards b
CROSS JOIN unnest(ARRAY['applicant', 'submitter_email', 'finance_request', 'student_card', 'annex_a', 'annex_b']) WITH ORDINALITY AS required(field_key, ordinality)
WHERE EXISTS (SELECT 1 FROM locations l WHERE l.target_board_id = b.id AND l.enabled = true)
ON CONFLICT (board_id, field_key) DO UPDATE SET visible = true;

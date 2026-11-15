-- Existing boards receive no delegated management rights automatically.
CREATE TABLE board_managers (
  board_id integer NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);

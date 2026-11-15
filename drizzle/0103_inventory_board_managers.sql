-- Existing inventories receive no delegated rights automatically.
CREATE TABLE inventory_board_managers (
  board_id integer NOT NULL CONSTRAINT inventory_board_managers_board_id_inventory_boards_id_fk REFERENCES inventory_boards(id) ON DELETE CASCADE,
  user_id integer NOT NULL CONSTRAINT inventory_board_managers_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  granted_by_id integer CONSTRAINT inventory_board_managers_granted_by_id_users_id_fk REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT inventory_board_managers_board_id_user_id_pk PRIMARY KEY (board_id, user_id)
);

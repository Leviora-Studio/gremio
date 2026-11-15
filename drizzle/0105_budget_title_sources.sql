-- Existing plans, allocations, bookings and settings are preserved verbatim.
ALTER TABLE accounts ADD COLUMN finance_board_id integer REFERENCES finance_boards(id) ON DELETE RESTRICT;
ALTER TABLE cashbooks ADD COLUMN finance_board_id integer REFERENCES finance_boards(id) ON DELETE RESTRICT;
CREATE INDEX accounts_finance_board_idx ON accounts(finance_board_id);
CREATE INDEX cashbooks_finance_board_idx ON cashbooks(finance_board_id);

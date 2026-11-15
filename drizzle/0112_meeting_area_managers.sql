-- Existing areas receive no delegated settings rights automatically.
CREATE TABLE meeting_area_managers (
  area_id integer NOT NULL REFERENCES meeting_areas(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (area_id,user_id)
);
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON meeting_area_managers FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('meeting_area');
CREATE TRIGGER app_change_insert AFTER INSERT ON meeting_area_managers REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
CREATE TRIGGER app_change_delete AFTER DELETE ON meeting_area_managers REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();

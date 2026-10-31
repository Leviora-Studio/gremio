-- Include visible security settings and delivery state; ignore usage-only token heartbeats.
CREATE OR REPLACE FUNCTION notify_app_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('api_tokens','mcp_grants') THEN
    IF EXISTS (SELECT 1 FROM changed_rows n JOIN previous_rows o USING (id) WHERE (to_jsonb(n) - 'last_used_at') IS DISTINCT FROM (to_jsonb(o) - 'last_used_at')) THEN PERFORM pg_notify('app_change', ''); END IF;
  ELSIF EXISTS (SELECT 1 FROM changed_rows) THEN PERFORM pg_notify('app_change', '');
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "api_tokens" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "api_tokens" REFERENCING OLD TABLE AS previous_rows NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "api_tokens" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "api_token_boards" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "api_token_boards" REFERENCING OLD TABLE AS previous_rows NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "api_token_boards" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "mcp_grants" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "mcp_grants" REFERENCING OLD TABLE AS previous_rows NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "mcp_grants" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "mcp_grant_boards" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "mcp_grant_boards" REFERENCING OLD TABLE AS previous_rows NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "mcp_grant_boards" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "email_outbox" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "email_outbox" REFERENCING OLD TABLE AS previous_rows NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "email_outbox" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();

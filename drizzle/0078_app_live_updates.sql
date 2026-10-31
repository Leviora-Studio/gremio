-- Payload-free, commit-bound invalidations. Transition tables skip zero-row statements.
CREATE OR REPLACE FUNCTION notify_app_change() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM changed_rows) THEN PERFORM pg_notify('app_change', ''); END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "accounts" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "accounts" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "accounts" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "attachment_folders" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "attachment_folders" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "attachment_folders" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "attachments" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "attachments" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "attachments" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "board_access" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "board_access" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "board_access" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "board_archive" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "board_archive" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "board_archive" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "board_card_fields" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "board_card_fields" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "board_card_fields" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "board_email_rules" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "board_email_rules" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "board_email_rules" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "board_instruction_forms" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "board_instruction_forms" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "board_instruction_forms" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "board_numbering" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "board_numbering" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "board_numbering" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "board_office_roles" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "board_office_roles" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "board_office_roles" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "board_office_statuses" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "board_office_statuses" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "board_office_statuses" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "board_owners" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "board_owners" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "board_owners" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "board_statuses" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "board_statuses" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "board_statuses" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "board_template_statuses" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "board_template_statuses" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "board_template_statuses" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "board_templates" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "board_templates" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "board_templates" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "board_trigger_assignees" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "board_trigger_assignees" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "board_trigger_assignees" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "board_trigger_assignments" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "board_trigger_assignments" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "board_trigger_assignments" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "boards" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "boards" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "boards" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "card_activity" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "card_activity" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "card_activity" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "card_assignees" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "card_assignees" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "card_assignees" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "card_budget_positions" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "card_budget_positions" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "card_budget_positions" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "card_comments" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "card_comments" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "card_comments" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "cards" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "cards" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "cards" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "email_confirmation_settings" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "email_confirmation_settings" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "email_confirmation_settings" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "feedback_areas" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "feedback_areas" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "feedback_areas" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "feedback_submissions" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "feedback_submissions" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "feedback_submissions" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "finance_board_access" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "finance_board_access" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "finance_board_access" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "finance_board_accounts" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "finance_board_accounts" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "finance_board_accounts" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "finance_board_expense_accounts" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "finance_board_expense_accounts" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "finance_board_expense_accounts" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "finance_board_owners" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "finance_board_owners" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "finance_board_owners" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "finance_board_sources" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "finance_board_sources" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "finance_board_sources" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "finance_boards" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "finance_boards" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "finance_boards" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "finance_plan_items" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "finance_plan_items" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "finance_plan_items" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "finance_template_items" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "finance_template_items" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "finance_template_items" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "finance_templates" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "finance_templates" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "finance_templates" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "form_documents" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "form_documents" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "form_documents" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "groups" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "groups" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "groups" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "inventory_attachments" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "inventory_attachments" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "inventory_attachments" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "inventory_board_access" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "inventory_board_access" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "inventory_board_access" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "inventory_board_fields" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "inventory_board_fields" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "inventory_board_fields" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "inventory_board_owners" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "inventory_board_owners" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "inventory_board_owners" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "inventory_boards" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "inventory_boards" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "inventory_boards" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "inventory_defects" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "inventory_defects" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "inventory_defects" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "inventory_item_categories" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "inventory_item_categories" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "inventory_item_categories" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "inventory_items" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "inventory_items" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "inventory_items" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "inventory_loan_items" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "inventory_loan_items" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "inventory_loan_items" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "inventory_loans" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "inventory_loans" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "inventory_loans" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "inventory_numbering" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "inventory_numbering" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "inventory_numbering" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "inventory_options" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "inventory_options" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "inventory_options" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "inventory_overview_config" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "inventory_overview_config" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "inventory_overview_config" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "locations" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "locations" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "locations" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "meeting_area_access" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "meeting_area_access" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "meeting_area_access" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "meeting_areas" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "meeting_areas" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "meeting_areas" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "meeting_boards" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "meeting_boards" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "meeting_boards" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "meeting_documents" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "meeting_documents" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "meeting_documents" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "meeting_topic_cards" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "meeting_topic_cards" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "meeting_topic_cards" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "meeting_topics" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "meeting_topics" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "meeting_topics" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "meetings" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "meetings" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "meetings" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "priorities" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "priorities" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "priorities" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "receipt_branding" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "receipt_branding" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "receipt_branding" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "smtp_settings" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "smtp_settings" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "smtp_settings" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "user_board_order" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "user_board_order" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "user_board_order" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "user_finance_board_order" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "user_finance_board_order" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "user_finance_board_order" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "user_groups" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "user_groups" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "user_groups" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "user_inventory_board_order" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "user_inventory_board_order" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "user_inventory_board_order" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "user_task_prefs" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "user_task_prefs" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "user_task_prefs" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON "users" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON "users" REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON "users" REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();

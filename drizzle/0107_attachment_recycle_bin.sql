-- Attachment bytes remain untouched; metadata is captured in the shared trash
-- registry before removing the live reference. No existing rows are rewritten.
ALTER TABLE trash_entries DROP CONSTRAINT trash_entries_kind_check;
ALTER TABLE trash_entries ADD CONSTRAINT trash_entries_kind_check CHECK(kind in ('board','finance','inventory','cashbook','group','account','priority','location','feedback','board_template','finance_template','meeting_template','meeting','topic','attachment'));
CREATE INDEX trash_attachment_board ON trash_entries ((context->>'boardId'),deleted_at) WHERE kind='attachment' AND state in ('trashed','purging');

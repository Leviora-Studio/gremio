-- Extend every still-recoverable entry from its original deletion timestamp.
-- Preserve longer existing deadlines and completed/manual deletion history.
ALTER TABLE trash_entries DROP CONSTRAINT trash_entries_check;
UPDATE trash_entries
SET expires_at = greatest(expires_at, deleted_at + interval '720 hours')
WHERE state = 'trashed' AND expires_at < deleted_at + interval '720 hours';
ALTER TABLE trash_entries ADD CONSTRAINT trash_entries_retention_check
CHECK (state <> 'trashed' OR expires_at >= deleted_at + interval '720 hours');

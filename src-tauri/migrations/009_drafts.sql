ALTER TABLE send_queue ADD COLUMN updated_at INTEGER DEFAULT (strftime('%s','now'));

DROP TRIGGER IF EXISTS emails_fts_insert;
DROP TRIGGER IF EXISTS emails_fts_delete;
DROP TRIGGER IF EXISTS emails_fts_update;

CREATE TRIGGER emails_fts_insert AFTER INSERT ON emails BEGIN
    INSERT INTO emails_fts(rowid, subject, from_address, to_address, body_text, body_html_stripped)
    VALUES (new.id, new.subject, new.from_json, new.to_json, COALESCE(new.body_text, ''), COALESCE(new.body_text, ''));
END;

CREATE TRIGGER emails_fts_delete AFTER DELETE ON emails BEGIN
    INSERT INTO emails_fts(emails_fts, rowid, subject, from_address, to_address, body_text, body_html_stripped)
    VALUES ('delete', old.id, old.subject, old.from_json, old.to_json, COALESCE(old.body_text, ''), COALESCE(old.body_text, ''));
END;

CREATE TRIGGER emails_fts_update AFTER UPDATE ON emails
WHEN OLD.subject IS NOT NEW.subject
  OR OLD.from_json IS NOT NEW.from_json
  OR OLD.to_json IS NOT NEW.to_json
  OR OLD.body_text IS NOT NEW.body_text
BEGIN
    INSERT INTO emails_fts(emails_fts, rowid, subject, from_address, to_address, body_text, body_html_stripped)
    VALUES ('delete', old.id, old.subject, old.from_json, old.to_json, COALESCE(old.body_text, ''), COALESCE(old.body_text, ''));
    INSERT INTO emails_fts(rowid, subject, from_address, to_address, body_text, body_html_stripped)
    VALUES (new.id, new.subject, new.from_json, new.to_json, COALESCE(new.body_text, ''), COALESCE(new.body_text, ''));
END;

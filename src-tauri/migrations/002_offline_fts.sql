DROP TRIGGER IF EXISTS emails_fts_insert;
DROP TRIGGER IF EXISTS emails_fts_delete;
DROP TRIGGER IF EXISTS emails_fts_update;

ALTER TABLE send_queue ADD COLUMN next_retry_at INTEGER;

DROP TABLE emails_fts;

CREATE VIRTUAL TABLE emails_fts USING fts5(
    subject,
    from_address,
    to_address,
    body_text,
    body_html_stripped,
    content='emails',
    content_rowid='id'
);

CREATE TRIGGER emails_fts_insert AFTER INSERT ON emails BEGIN
    INSERT INTO emails_fts(rowid, subject, from_address, to_address, body_text, body_html_stripped)
    VALUES (new.id, new.subject, new.from_json, new.to_json, new.body_text, '');
END;

CREATE TRIGGER emails_fts_delete AFTER DELETE ON emails BEGIN
    INSERT INTO emails_fts(emails_fts, rowid, subject, from_address, to_address, body_text, body_html_stripped)
    VALUES ('delete', old.id, old.subject, old.from_json, old.to_json, old.body_text, '');
END;

CREATE TRIGGER emails_fts_update AFTER UPDATE ON emails BEGIN
    INSERT INTO emails_fts(emails_fts, rowid, subject, from_address, to_address, body_text, body_html_stripped)
    VALUES ('delete', old.id, old.subject, old.from_json, old.to_json, old.body_text, '');
    INSERT INTO emails_fts(rowid, subject, from_address, to_address, body_text, body_html_stripped)
    VALUES (new.id, new.subject, new.from_json, new.to_json, new.body_text, '');
END;

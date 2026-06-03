PRAGMA foreign_keys=OFF;

DROP TRIGGER IF EXISTS emails_fts_insert;
DROP TRIGGER IF EXISTS emails_fts_delete;
DROP TRIGGER IF EXISTS emails_fts_update;
DROP TABLE IF EXISTS emails_fts;

CREATE TABLE emails_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id       INTEGER REFERENCES threads(id) ON DELETE SET NULL,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    imap_uid        INTEGER,
    message_id      TEXT NOT NULL,
    in_reply_to     TEXT,
    "references"    TEXT,
    subject         TEXT,
    from_json       TEXT NOT NULL,
    to_json         TEXT NOT NULL,
    cc_json         TEXT,
    bcc_json        TEXT,
    date_rfc2822    TEXT,
    received_at     INTEGER NOT NULL,
    body_text       TEXT,
    body_html       TEXT,
    is_read         INTEGER NOT NULL DEFAULT 0,
    folder          TEXT NOT NULL DEFAULT 'INBOX',
    attachments_meta TEXT
);

INSERT INTO emails_new (
    id, thread_id, account_id, imap_uid, message_id, in_reply_to,
    "references", subject, from_json, to_json, cc_json, bcc_json,
    date_rfc2822, received_at, body_text, body_html, is_read, folder, attachments_meta
)
SELECT
    id,
    CASE WHEN thread_id IS NULL OR thread_id = 0 THEN NULL ELSE thread_id END,
    account_id, imap_uid, message_id, in_reply_to,
    "references", subject, from_json, to_json, cc_json, bcc_json,
    date_rfc2822, received_at, body_text, body_html, is_read, folder, attachments_meta
FROM emails;

DROP TABLE emails;
ALTER TABLE emails_new RENAME TO emails;

CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_account_id ON emails(account_id);
CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id);
CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at);

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

PRAGMA foreign_keys=ON;

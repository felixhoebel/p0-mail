CREATE TABLE accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_type   TEXT NOT NULL CHECK( provider_type IN ('gmail_oauth','microsoft_oauth','imap') ),
    display_name    TEXT NOT NULL,
    email_address   TEXT NOT NULL UNIQUE,
    imap_host       TEXT,
    imap_port       INTEGER,
    imap_encryption TEXT CHECK( imap_encryption IN ('SSL','STARTTLS') ),
    smtp_host       TEXT,
    smtp_port       INTEGER,
    smtp_encryption TEXT CHECK( smtp_encryption IN ('SSL','STARTTLS') ),
    access_token_key  TEXT,
    refresh_token_key TEXT,
    last_seen_uid     INTEGER DEFAULT 0,
    created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE threads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    subject         TEXT,
    latest_date     INTEGER NOT NULL,
    message_count   INTEGER NOT NULL DEFAULT 0,
    is_read         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE emails (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id       INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    imap_uid        INTEGER,
    message_id      TEXT NOT NULL,
    in_reply_to     TEXT,
    "references"   TEXT,
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

CREATE VIRTUAL TABLE emails_fts USING fts5(
    subject,
    body_text,
    body_html_stripped,
    content='emails',
    content_rowid='id'
);

CREATE TRIGGER emails_fts_insert AFTER INSERT ON emails BEGIN
    INSERT INTO emails_fts(rowid, subject, body_text, body_html_stripped)
    VALUES (new.id, new.subject, new.body_text, '');
END;

CREATE TRIGGER emails_fts_delete AFTER DELETE ON emails BEGIN
    INSERT INTO emails_fts(emails_fts, rowid, subject, body_text, body_html_stripped)
    VALUES ('delete', old.id, old.subject, old.body_text, '');
END;

CREATE TRIGGER emails_fts_update AFTER UPDATE ON emails BEGIN
    INSERT INTO emails_fts(emails_fts, rowid, subject, body_text, body_html_stripped)
    VALUES ('delete', old.id, old.subject, old.body_text, '');
    INSERT INTO emails_fts(rowid, subject, body_text, body_html_stripped)
    VALUES (new.id, new.subject, new.body_text, '');
END;

CREATE TABLE send_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    to_json         TEXT NOT NULL,
    cc_json         TEXT,
    bcc_json         TEXT,
    subject         TEXT NOT NULL,
    body_html       TEXT,
    body_text       TEXT,
    attachments_meta TEXT,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK( status IN ('pending','sent','failed') ),
    retry_count     INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    sent_at         INTEGER
);

CREATE TABLE app_settings (
    key             TEXT PRIMARY KEY,
    value           TEXT
);

CREATE INDEX idx_emails_thread_id ON emails(thread_id);
CREATE INDEX idx_emails_account_id ON emails(account_id);
CREATE INDEX idx_emails_message_id ON emails(message_id);
CREATE INDEX idx_emails_received_at ON emails(received_at);
CREATE INDEX idx_threads_account_id ON threads(account_id);
CREATE INDEX idx_threads_latest_date ON threads(latest_date);
CREATE INDEX idx_send_queue_status ON send_queue(status);

CREATE TABLE send_queue_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    to_json         TEXT NOT NULL,
    cc_json         TEXT,
    bcc_json        TEXT,
    subject         TEXT NOT NULL,
    body_html       TEXT,
    body_text       TEXT,
    attachments_meta TEXT,
    attachments_data BLOB,
    in_reply_to     TEXT,
    "references"    TEXT,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK( status IN ('pending','sending','sent','failed','draft') ),
    retry_count     INTEGER NOT NULL DEFAULT 0,
    next_retry_at   INTEGER,
    send_after      INTEGER,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at      INTEGER DEFAULT (strftime('%s','now')),
    sent_at         INTEGER
);

INSERT INTO send_queue_new (
    id, account_id, to_json, cc_json, bcc_json, subject, body_html, body_text,
    attachments_meta, attachments_data, in_reply_to, "references",
    status, retry_count, next_retry_at, send_after, created_at, updated_at, sent_at
)
SELECT
    id, account_id, to_json, cc_json, bcc_json, subject, body_html, body_text,
    attachments_meta, attachments_data, NULL, NULL,
    status, retry_count, next_retry_at, NULL, created_at, updated_at, sent_at
FROM send_queue;

DROP TABLE send_queue;
ALTER TABLE send_queue_new RENAME TO send_queue;
CREATE INDEX IF NOT EXISTS idx_send_queue_status ON send_queue(status);
CREATE INDEX IF NOT EXISTS idx_send_queue_send_after ON send_queue(send_after);

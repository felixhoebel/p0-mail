CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    imap_name TEXT NOT NULL,
    special_use TEXT,
    UNIQUE(account_id, imap_name)
);

CREATE TABLE IF NOT EXISTS folder_sync_state (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    folder TEXT NOT NULL,
    last_seen_uid INTEGER DEFAULT 0,
    PRIMARY KEY (account_id, folder)
);

INSERT INTO folder_sync_state (account_id, folder, last_seen_uid)
SELECT id, 'INBOX', last_seen_uid
FROM accounts
WHERE NOT EXISTS (
    SELECT 1 FROM folder_sync_state
    WHERE folder_sync_state.account_id = accounts.id
    AND folder_sync_state.folder = 'INBOX'
);

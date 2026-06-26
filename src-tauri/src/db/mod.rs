use once_cell::sync::OnceCell;
use rusqlite::{params, Connection, Result as SqlResult};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

fn db_path() -> PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("p0mail");
    std::fs::create_dir_all(&path).ok();
    path.push("p0mail.db");
    path
}

fn generate_hex_key() -> String {
    let a = *uuid::Uuid::new_v4().as_bytes();
    let b = *uuid::Uuid::new_v4().as_bytes();
    let mut bytes = [0u8; 32];
    bytes[..16].copy_from_slice(&a);
    bytes[16..].copy_from_slice(&b);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn get_or_create_db_key() -> Result<String, String> {
    if let Ok(key) = std::env::var("P0MAIL_DB_KEY") {
        return Ok(key);
    }
    match crate::secure::get_db_key() {
        Ok(key) if !key.is_empty() => Ok(key),
        _ => {
            let key = generate_hex_key();
            crate::secure::store_db_key(&key)?;
            Ok(key)
        }
    }
}

fn apply_key(conn: &Connection, key: &str) -> SqlResult<()> {
    exec_ignore_rows(conn, &format!("PRAGMA key = \"x'{}'\"", key))
}

fn exec_ignore_rows(conn: &Connection, sql: &str) -> SqlResult<()> {
    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query([])?;
    while rows.next()?.is_some() {}
    Ok(())
}

fn open_with_key(path: &Path, key: &str) -> SqlResult<Connection> {
    let conn = Connection::open(path)?;
    apply_key(&conn, key)?;
    Ok(conn)
}

fn migrate_plaintext(path: &Path, key: &str) -> Result<Connection, Box<dyn std::error::Error>> {
    let conn = Connection::open(path)?;
    let tmp = path.with_extension("db.mig.tmp");
    cleanup_sidecars(&tmp);
    let _ = std::fs::remove_file(&tmp);
    exec_ignore_rows(
        &conn,
        &format!(
            "ATTACH DATABASE '{}' AS enc KEY \"x'{}'\";",
            tmp.display(),
            key
        ),
    )?;
    exec_ignore_rows(&conn, "SELECT sqlcipher_export('enc');")?;
    exec_ignore_rows(&conn, "DETACH DATABASE enc;")?;
    drop(conn);

    cleanup_sidecars(path);
    std::fs::rename(&tmp, path)?;

    let conn = open_with_key(path, key)?;
    Ok(conn)
}

fn cleanup_sidecars(path: &Path) {
    let _ = std::fs::remove_file(format!("{}-wal", path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", path.display()));
    let _ = std::fs::remove_file(format!("{}-journal", path.display()));
}

fn open_or_migrate(path: &Path, key: &str) -> Result<Connection, Box<dyn std::error::Error>> {
    let conn = Connection::open(path)?;
    apply_key(&conn, key)?;
    if conn
        .query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(0))
        .is_ok()
    {
        return Ok(conn);
    }
    drop(conn);
    migrate_plaintext(path, key)
}

pub fn init() -> Result<(), Box<dyn std::error::Error>> {
    let path = db_path();
    let key = get_or_create_db_key().map_err(|e| e.to_string())?;
    let conn = open_or_migrate(&path, &key)?;

    conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| {
        row.get::<_, String>(0)
    })?;
    conn.pragma_update(None, "foreign_keys", true)?;

    register_sql_functions(&conn)?;
    run_migrations(&conn)?;

    DB.set(Mutex::new(conn)).map_err(|_| "Database already initialized")?;
    Ok(())
}

fn register_sql_functions(conn: &Connection) -> SqlResult<()> {
    conn.create_scalar_function("strip_html", 1, rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC | rusqlite::functions::FunctionFlags::SQLITE_UTF8, |ctx| {
        let html = ctx.get::<Option<String>>(0)?.unwrap_or_default();
        Ok(crate::email_parse::strip_html_tags(&html))
    })
}

fn run_migrations(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
        );",
    )?;

    let applied: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT id FROM _migrations")?;
        let rows: Vec<i64> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    let migrations: Vec<(i64, &str, &str)> = vec![
        (1, "initial", include_str!("../../migrations/001_initial.sql")),
        (2, "offline_fts", include_str!("../../migrations/002_offline_fts.sql")),
        (
            3,
            "thread_id_nullable",
            include_str!("../../migrations/003_thread_id_nullable.sql"),
        ),
        (
            4,
            "labels",
            include_str!("../../migrations/004_labels.sql"),
        ),
        (
            5,
            "sync_enabled",
            include_str!("../../migrations/005_sync_enabled.sql"),
        ),
        (
            6,
            "fts_body_index",
            include_str!("../../migrations/006_fts_body_index.sql"),
        ),
        (
            7,
            "attachments_data",
            include_str!("../../migrations/007_attachments_data.sql"),
        ),
        (
            8,
            "folders",
            include_str!("../../migrations/008_folders.sql"),
        ),
        (
            9,
            "drafts",
            include_str!("../../migrations/009_drafts.sql"),
        ),
        (
            10,
            "sync_health",
            include_str!("../../migrations/010_sync_health.sql"),
        ),
        (
            11,
            "fts_conditional_triggers",
            include_str!("../../migrations/011_fts_conditional_triggers.sql"),
        ),
        (
            12,
            "fts_html_stripped",
            include_str!("../../migrations/012_fts_html_stripped.sql"),
        ),
        (
            13,
            "undo_send",
            include_str!("../../migrations/013_undo_send.sql"),
        ),
    ];

    for (id, name, sql) in migrations {
        if !applied.contains(&id) {
            conn.execute_batch(sql)?;
            conn.execute(
                "INSERT INTO _migrations (id, name) VALUES (?1, ?2)",
                params![id, name],
            )?;
        }
    }

    Ok(())
}

pub fn get() -> Result<std::sync::MutexGuard<'static, Connection>, String> {
    DB.get()
        .ok_or("Database not initialized".to_string())
        .and_then(|m| m.lock().map_err(|e| e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn temp_path(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(name);
        cleanup_sidecars(&path);
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn migrations_apply_with_wal_pragma() {
        let path = std::env::temp_dir().join("p0mail_migrations_test.db");
        cleanup_sidecars(&path);
        let _ = std::fs::remove_file(&path);
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))
            .unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        register_sql_functions(&conn).unwrap();
        run_migrations(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 13);
    }

    #[test]
    fn migration_005_adds_sync_enabled() {
        let path = temp_path("p0mail_mig5.db");
        let conn = open_with_key(&path, &"00".repeat(32)).unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        run_migrations(&conn).unwrap();
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(accounts)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(cols.iter().any(|c| c == "sync_enabled"), "sync_enabled column missing: {:?}", cols);
    }

    #[test]
    fn migration_008_creates_folders_tables() {
        let path = temp_path("p0mail_mig8.db");
        let conn = open_with_key(&path, &"00".repeat(32)).unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        run_migrations(&conn).unwrap();

        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(tables.iter().any(|t| t == "folders"), "folders table missing");
        assert!(tables.iter().any(|t| t == "folder_sync_state"), "folder_sync_state table missing");
    }

    #[test]
    fn fts_indexes_html_body_via_strip_html() {
        let path = temp_path("p0mail_fts_html.db");
        let conn = open_with_key(&path, &"00".repeat(32)).unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        register_sql_functions(&conn).unwrap();
        run_migrations(&conn).unwrap();

        conn.execute(
            "INSERT INTO accounts (provider_type, display_name, email_address, last_seen_uid) \
             VALUES ('imap', 't', 'a@b.com', 0)",
            [],
        )
        .unwrap();
        let account_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO threads (account_id, subject, latest_date, message_count, is_read) \
             VALUES (?1, 's', 0, 1, 0)",
            params![account_id],
        )
        .unwrap();
        let thread_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO emails (thread_id, account_id, message_id, from_json, to_json, \
             received_at, body_text, body_html, folder, is_read, labels) \
             VALUES (?1, ?2, 'm1', '[]', '[]', 0, NULL, \
             '<p>uniquewordhtml</p>', 'INBOX', 0, '[]')",
            params![thread_id, account_id],
        )
        .unwrap();

        let hit: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM emails_fts WHERE emails_fts MATCH 'uniquewordhtml'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hit, 1, "HTML body should be indexed after strip_html");
    }

    #[test]
    fn migration_007_009_add_send_queue_columns() {
        let path = temp_path("p0mail_mig7_9.db");
        let conn = open_with_key(&path, &"00".repeat(32)).unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        run_migrations(&conn).unwrap();
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(send_queue)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(cols.iter().any(|c| c == "attachments_data"), "attachments_data column missing");
        assert!(cols.iter().any(|c| c == "updated_at"), "updated_at column missing");
    }

    #[test]
    fn migration_013_allows_draft_and_sending_status_and_adds_send_after() {
        let path = temp_path("p0mail_mig13.db");
        let conn = open_with_key(&path, &"00".repeat(32)).unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        register_sql_functions(&conn).unwrap();
        run_migrations(&conn).unwrap();

        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(send_queue)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(cols.iter().any(|c| c == "send_after"), "send_after column missing: {:?}", cols);
        assert!(cols.iter().any(|c| c == "in_reply_to"), "in_reply_to column missing: {:?}", cols);
        assert!(cols.iter().any(|c| c == "references"), "references column missing: {:?}", cols);

        conn.execute(
            "INSERT INTO accounts (provider_type, display_name, email_address, last_seen_uid) \
             VALUES ('imap','t','a@b.com',0)",
            [],
        )
        .unwrap();
        let account_id = conn.last_insert_rowid();

        for status in ["draft", "sending", "pending", "sent", "failed"] {
            conn.execute(
                "INSERT INTO send_queue (account_id, to_json, subject, status) \
                 VALUES (?1, 'x', 's', ?2)",
                params![account_id, status],
            )
            .unwrap_or_else(|e| panic!("status '{}' should be allowed: {}", status, e));
        }

        let bad = conn.execute(
            "INSERT INTO send_queue (account_id, to_json, subject, status) \
             VALUES (?1, 'x', 's', 'bogus')",
            params![account_id],
        );
        assert!(bad.is_err(), "unknown status should be rejected by CHECK");
    }

    #[test]
    fn fresh_db_is_encrypted_with_key() {
        let path = temp_path("p0mail_fresh_enc.db");
        let key = "ab".repeat(32);
        {
            let conn = open_or_migrate(&path, &key).unwrap();
            conn.execute_batch("CREATE TABLE t(x); INSERT INTO t VALUES(42);")
                .unwrap();
        }
        // Reading without key must fail.
        let conn = Connection::open(&path).unwrap();
        let r = conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(0));
        assert!(r.is_err(), "encrypted DB should be unreadable without key");
        // Reading with key must succeed.
        let conn = open_with_key(&path, &key).unwrap();
        let v: i64 = conn.query_row("SELECT x FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 42);
    }

    #[test]
    fn plaintext_db_migrates_to_encrypted() {
        let path = temp_path("p0mail_migrate.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch("CREATE TABLE t(x); INSERT INTO t VALUES(7);")
                .unwrap();
        }
        let key = "cd".repeat(32);
        {
            let conn = open_or_migrate(&path, &key).unwrap();
            let v: i64 = conn.query_row("SELECT x FROM t", [], |r| r.get(0)).unwrap();
            assert_eq!(v, 7);
        }
        // After migration, reading without key must fail.
        let conn = Connection::open(&path).unwrap();
        let r = conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(0));
        assert!(r.is_err(), "migrated DB should be unreadable without key");
    }

    #[test]
    fn wrong_key_cannot_read_encrypted_db() {
        let path = temp_path("p0mail_wrong_key.db");
        let key = "ef".repeat(32);
        {
            let conn = open_or_migrate(&path, &key).unwrap();
            conn.execute_batch("CREATE TABLE t(x); INSERT INTO t VALUES(1);")
                .unwrap();
        }
        let wrong = "11".repeat(32);
        let conn = open_with_key(&path, &wrong).unwrap();
        let r = conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(0));
        assert!(r.is_err(), "wrong key should not decrypt the DB");
    }
}


use once_cell::sync::OnceCell;
use rusqlite::{params, Connection, Result as SqlResult};
use std::path::PathBuf;
use std::sync::Mutex;

static DB: OnceCell<Mutex<Connection>> = OnceCell::new();

fn db_path() -> PathBuf {
    let mut path = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    path.push("p0mail");
    std::fs::create_dir_all(&path).ok();
    path.push("p0mail.db");
    path
}

pub fn init() -> Result<(), Box<dyn std::error::Error>> {
    let path = db_path();
    let conn = Connection::open(&path)?;

    conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| {
        row.get::<_, String>(0)
    })?;
    conn.pragma_update(None, "foreign_keys", true)?;

    run_migrations(&conn)?;

    DB.set(Mutex::new(conn)).map_err(|_| "Database already initialized")?;
    Ok(())
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

    #[test]
    fn migrations_apply_with_wal_pragma() {
        let path = std::env::temp_dir().join("p0mail_migrations_test.db");
        let _ = std::fs::remove_file(&path);
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))
            .unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        run_migrations(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 4);
    }
}

use crate::db;
use tauri::{AppHandle, Runtime};
use tauri_plugin_notification::NotificationExt;

const LAST_NOTIFIED_PREFIX: &str = "last_notified_at_";
const MAX_PER_CYCLE: i64 = 5;

pub fn notify_new_mail<R: Runtime>(app: &AppHandle<R>, account_ids: &[i64]) {
    for &account_id in account_ids {
        if let Err(e) = notify_account(app, account_id) {
            log::warn!("Notification failed for account {}: {}", account_id, e);
        }
    }
}

fn get_setting_i64(key: &str) -> Result<Option<i64>, String> {
    let conn = db::get()?;
    let v: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get(0),
        )
        .ok();
    Ok(v.and_then(|s| s.parse::<i64>().ok()))
}

fn set_setting_i64(key: &str, value: i64) -> Result<(), String> {
    let conn = db::get()?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn notify_account<R: Runtime>(app: &AppHandle<R>, account_id: i64) -> Result<(), String> {
    let key = format!("{}{}", LAST_NOTIFIED_PREFIX, account_id);
    let now = chrono::Utc::now().timestamp();
    let last_ts = get_setting_i64(&key)?;

    let last_ts = match last_ts {
        Some(ts) => ts,
        None => {
            set_setting_i64(&key, now)?;
            return Ok(());
        }
    };

    let conn = db::get()?;
    let mut stmt = conn
        .prepare(
            "SELECT e.subject, e.from_json \
             FROM emails e \
             WHERE e.account_id = ?1 AND e.is_read = 0 AND e.received_at > ?2 \
             ORDER BY e.received_at ASC LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(Option<String>, String)> = stmt
        .query_map(rusqlite::params![account_id, last_ts, MAX_PER_CYCLE], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    if rows.is_empty() {
        return Ok(());
    }

    for (subject, from_json) in &rows {
        let sender = sender_display(from_json);
        let body = subject
            .clone()
            .unwrap_or_else(|| "(no subject)".to_string());
        let _ = app
            .notification()
            .builder()
            .title(&sender)
            .body(&body)
            .show();
    }

    set_setting_i64(&key, now)?;
    Ok(())
}

fn sender_display(from_json: &str) -> String {
    let addrs: Vec<serde_json::Value> = match serde_json::from_str(from_json) {
        Ok(v) => v,
        Err(_) => return "New mail".to_string(),
    };
    if let Some(first) = addrs.first() {
        let name = first.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let address = first.get("address").and_then(|v| v.as_str()).unwrap_or("");
        if !name.is_empty() {
            return name.to_string();
        }
        if !address.is_empty() {
            return address.to_string();
        }
    }
    "New mail".to_string()
}

mod ai;
mod commands;
mod compose;
mod db;
mod email_parse;
mod imap_client;
mod oauth;
mod search;
mod secure;
mod smtp_client;
mod sync;
mod threading;

use commands::models;
use serde::Deserialize;

fn decode_subject(value: Option<String>) -> Option<String> {
    value.map(|s| email_parse::decode_header(&s))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImapAccountParams {
    display_name: String,
    email_address: String,
    imap_host: String,
    imap_port: i64,
    imap_encryption: String,
    smtp_host: String,
    smtp_port: i64,
    smtp_encryption: String,
    username: String,
    password: String,
}

#[tauri::command]
fn list_accounts() -> Result<Vec<models::Account>, String> {
    let conn = db::get()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, provider_type, display_name, email_address, \
             imap_host, imap_port, imap_encryption, \
             smtp_host, smtp_port, smtp_encryption, \
             last_seen_uid, created_at FROM accounts",
        )
        .map_err(|e| e.to_string())?;
    let accounts = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let provider_type: String = row.get(1)?;
            let oauth = provider_type == "gmail_oauth" || provider_type == "microsoft_oauth";
            Ok(models::Account {
                id,
                provider_type,
                display_name: row.get(2)?,
                email_address: row.get(3)?,
                imap_host: row.get(4)?,
                imap_port: row.get(5)?,
                imap_encryption: row.get(6)?,
                smtp_host: row.get(7)?,
                smtp_port: row.get(8)?,
                smtp_encryption: row.get(9)?,
                last_seen_uid: row.get(10)?,
                created_at: row.get(11)?,
                needs_reauth: oauth && !secure::has_access_token(id),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(accounts)
}

#[tauri::command]
async fn add_oauth_account(
    _app: tauri::AppHandle,
    provider: String,
) -> Result<models::Account, String> {
    let oauth_provider = oauth::OAuthProvider::from_str(&provider)
        .ok_or_else(|| format!("Invalid provider type: {}", provider))?;

    if oauth_provider.client_id().is_empty() {
        return Err(format!(
            "OAuth client ID not configured for {}. Set GOOGLE_CLIENT_ID or MICROSOFT_CLIENT_ID environment variables.",
            oauth_provider.display_name()
        ));
    }

    let port = oauth::find_available_port()?;
    let state = oauth::generate_state();
    let flow = oauth::OAuthFlow::new(oauth_provider.clone());

    let rx = flow.listen_for_callback(port, state.clone())?;

    let auth_url = flow.authorization_url(port, &state);

    tauri_plugin_opener::open_url(&auth_url, None::<&str>)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    let (code, _redirect_port) = rx
        .recv_timeout(std::time::Duration::from_secs(120))
        .map_err(|_| "OAuth flow timed out after 120 seconds".to_string())?
        .map_err(|e| format!("OAuth callback error: {}", e))?;

    let tokens = flow.exchange_code(&code, port).await?;

    let email = tokens
        .email
        .clone()
        .unwrap_or_else(|| "unknown@unknown.com".to_string());

    let account_id = {
        let conn = db::get()?;
        conn.execute(
            "INSERT INTO accounts \
             (provider_type, display_name, email_address, \
              imap_host, imap_port, imap_encryption, \
              smtp_host, smtp_port, smtp_encryption) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                oauth_provider.as_str(),
                oauth_provider.display_name(),
                email,
                oauth_provider.imap_host(),
                oauth_provider.imap_port(),
                oauth_provider.imap_encryption(),
                oauth_provider.smtp_host(),
                oauth_provider.smtp_port(),
                oauth_provider.smtp_encryption(),
            ],
        )
        .map_err(|e| e.to_string())?;
        conn.last_insert_rowid()
    };

    secure::store_access_token(account_id, &tokens.access_token)?;
    if let Some(refresh_token) = &tokens.refresh_token {
        secure::store_refresh_token(account_id, refresh_token)?;
    }

    let email = oauth::ensure_oauth_email(account_id, &oauth_provider, &email).await?;

    let sync_engine = sync::SyncEngine::new();
    sync_engine.sync_account(account_id).await?;

    Ok(models::Account {
        id: account_id,
        provider_type: oauth_provider.as_str().to_string(),
        display_name: oauth_provider.display_name().to_string(),
        email_address: email,
        imap_host: Some(oauth_provider.imap_host().to_string()),
        imap_port: Some(oauth_provider.imap_port()),
        imap_encryption: Some(oauth_provider.imap_encryption().to_string()),
        smtp_host: Some(oauth_provider.smtp_host().to_string()),
        smtp_port: Some(oauth_provider.smtp_port()),
        smtp_encryption: Some(oauth_provider.smtp_encryption().to_string()),
        last_seen_uid: 0,
        created_at: chrono::Utc::now().timestamp(),
        needs_reauth: false,
    })
}

#[tauri::command]
fn add_imap_account(params: ImapAccountParams) -> Result<models::Account, String> {
    let conn = db::get()?;
    conn.execute(
        "INSERT INTO accounts \
         (provider_type, display_name, email_address, \
          imap_host, imap_port, imap_encryption, \
          smtp_host, smtp_port, smtp_encryption) \
         VALUES ('imap', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            params.display_name,
            params.email_address,
            params.imap_host,
            params.imap_port,
            params.imap_encryption,
            params.smtp_host,
            params.smtp_port,
            params.smtp_encryption,
        ],
    )
    .map_err(|e| e.to_string())?;

    let account_id = conn.last_insert_rowid();
    secure::store_imap_password(account_id, &params.password)?;

    Ok(models::Account {
        id: account_id,
        provider_type: "imap".to_string(),
        display_name: params.display_name,
        email_address: params.email_address,
        imap_host: Some(params.imap_host),
        imap_port: Some(params.imap_port),
        imap_encryption: Some(params.imap_encryption),
        smtp_host: Some(params.smtp_host),
        smtp_port: Some(params.smtp_port),
        smtp_encryption: Some(params.smtp_encryption),
        last_seen_uid: 0,
        created_at: chrono::Utc::now().timestamp(),
        needs_reauth: false,
    })
}

#[tauri::command]
async fn reauth_oauth_account(
    _app: tauri::AppHandle,
    account_id: i64,
) -> Result<models::Account, String> {
    let (provider_type, stored_email) = {
        let conn = db::get()?;
        conn.query_row(
            "SELECT provider_type, email_address FROM accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|e| format!("Account not found: {}", e))?
    };

    let oauth_provider = oauth::OAuthProvider::from_str(&provider_type)
        .ok_or_else(|| format!("Account {} is not an OAuth account", account_id))?;

    if oauth_provider.client_id().is_empty() {
        return Err(format!(
            "OAuth client ID not configured for {}.",
            oauth_provider.display_name()
        ));
    }

    let port = oauth::find_available_port()?;
    let state = oauth::generate_state();
    let flow = oauth::OAuthFlow::new(oauth_provider.clone());

    let rx = flow.listen_for_callback(port, state.clone())?;

    let auth_url = flow.authorization_url(port, &state);

    tauri_plugin_opener::open_url(&auth_url, None::<&str>)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    let (code, _redirect_port) = rx
        .recv_timeout(std::time::Duration::from_secs(120))
        .map_err(|_| "OAuth flow timed out after 120 seconds".to_string())?
        .map_err(|e| format!("OAuth callback error: {}", e))?;

    let tokens = flow.exchange_code(&code, port).await?;

    secure::store_access_token(account_id, &tokens.access_token)?;
    if let Some(refresh_token) = &tokens.refresh_token {
        secure::store_refresh_token(account_id, refresh_token)?;
    }

    let email = tokens
        .email
        .clone()
        .unwrap_or_else(|| stored_email.clone());

    if email != stored_email {
        let conn = db::get()?;
        conn.execute(
            "UPDATE accounts SET email_address = ?1 WHERE id = ?2",
            rusqlite::params![email, account_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let (row,): (i64,) = {
        let conn = db::get()?;
        conn.query_row(
            "SELECT last_seen_uid FROM accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |row| Ok((row.get::<_, i64>(0)?,)),
        )
        .map_err(|e| e.to_string())?
    };

    Ok(models::Account {
        id: account_id,
        provider_type: oauth_provider.as_str().to_string(),
        display_name: oauth_provider.display_name().to_string(),
        email_address: email,
        imap_host: Some(oauth_provider.imap_host().to_string()),
        imap_port: Some(oauth_provider.imap_port()),
        imap_encryption: Some(oauth_provider.imap_encryption().to_string()),
        smtp_host: Some(oauth_provider.smtp_host().to_string()),
        smtp_port: Some(oauth_provider.smtp_port()),
        smtp_encryption: Some(oauth_provider.smtp_encryption().to_string()),
        last_seen_uid: row,
        created_at: chrono::Utc::now().timestamp(),
        needs_reauth: false,
    })
}

#[tauri::command]
fn remove_account(account_id: i64) -> Result<(), String> {
    let conn = db::get()?;
    conn.execute(
        "DELETE FROM accounts WHERE id = ?1",
        rusqlite::params![account_id],
    )
    .map_err(|e| e.to_string())?;
    let _ = secure::delete_secret(&format!("account_{}_access_token", account_id));
    let _ = secure::delete_secret(&format!("account_{}_refresh_token", account_id));
    let _ = secure::delete_secret(&format!("account_{}_imap_password", account_id));
    Ok(())
}

#[tauri::command]
async fn trigger_sync(account_id: Option<i64>) -> Result<(), String> {
    let engine = sync::SyncEngine::new();
    match account_id {
        Some(id) => engine.sync_account(id).await,
        None => engine.sync_all().await,
    }
}

#[tauri::command]
fn list_threads(
    account_id: Option<i64>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<models::Thread>, String> {
    let conn = db::get()?;
    let limit = limit.unwrap_or(100);
    let offset = offset.unwrap_or(0);

    let sql = match account_id {
        Some(_) => "SELECT id, account_id, subject, latest_date, message_count, is_read, is_flagged \
                     FROM threads WHERE account_id = ?1 \
                     ORDER BY latest_date DESC LIMIT ?2 OFFSET ?3",
        None => "SELECT id, account_id, subject, latest_date, message_count, is_read, is_flagged \
                 FROM threads ORDER BY latest_date DESC LIMIT ?1 OFFSET ?2",
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let threads: Vec<models::Thread> = match account_id {
        Some(aid) => stmt
            .query_map(rusqlite::params![aid, limit, offset], |row| {
                Ok(models::Thread {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    subject: decode_subject(row.get(2)?),
                    latest_date: row.get(3)?,
                    message_count: row.get(4)?,
                    is_read: row.get::<_, i64>(5)? != 0,
                    is_flagged: row.get::<_, i64>(6)? != 0,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect(),
        None => stmt
            .query_map(rusqlite::params![limit, offset], |row| {
                Ok(models::Thread {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    subject: decode_subject(row.get(2)?),
                    latest_date: row.get(3)?,
                    message_count: row.get(4)?,
                    is_read: row.get::<_, i64>(5)? != 0,
                    is_flagged: row.get::<_, i64>(6)? != 0,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect(),
    };

    Ok(threads)
}

#[tauri::command]
fn get_emails(thread_id: i64) -> Result<Vec<models::Email>, String> {
    let conn = db::get()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, thread_id, account_id, imap_uid, message_id, \
             in_reply_to, \"references\", subject, from_json, to_json, \
             cc_json, bcc_json, date_rfc2822, received_at, body_text, \
             body_html, is_read, folder, attachments_meta, labels \
             FROM emails WHERE thread_id = ?1 ORDER BY received_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let emails: Vec<models::Email> = stmt
        .query_map(rusqlite::params![thread_id], |row| {
            let refs_str: Option<String> = row.get(6)?;
            let refs: Option<Vec<String>> = refs_str
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok());
            let from_str: String = row.get(8)?;
            let to_str: String = row.get(9)?;
            let cc_str: Option<String> = row.get(10)?;
            let bcc_str: Option<String> = row.get(11)?;
            let att_str: Option<String> = row.get(18)?;
            let labels_str: String = row.get(19)?;
            let labels: Vec<String> = serde_json::from_str(&labels_str).unwrap_or_default();

            Ok(models::Email {
                id: row.get(0)?,
                thread_id: row.get(1)?,
                account_id: row.get(2)?,
                imap_uid: row.get(3)?,
                message_id: row.get(4)?,
                in_reply_to: row.get(5)?,
                references_field: refs,
                subject: decode_subject(row.get(7)?),
                from_field: serde_json::from_str(&from_str).unwrap_or_default(),
                to_field: serde_json::from_str(&to_str).unwrap_or_default(),
                cc_field: cc_str.as_deref().and_then(|s| serde_json::from_str(s).ok()),
                bcc_field: bcc_str.as_deref().and_then(|s| serde_json::from_str(s).ok()),
                date_rfc2822: row.get(12)?,
                received_at: row.get(13)?,
                body_text: row.get(14)?,
                body_html: row.get(15)?,
                is_read: row.get::<_, i64>(16)? != 0,
                folder: row.get(17)?,
                labels,
                attachments_meta: att_str.as_deref().and_then(|s| serde_json::from_str(s).ok()),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(emails)
}

#[tauri::command]
fn get_email(email_id: i64) -> Result<models::Email, String> {
    let conn = db::get()?;
    conn.query_row(
        "SELECT id, thread_id, account_id, imap_uid, message_id, \
         in_reply_to, \"references\", subject, from_json, to_json, \
         cc_json, bcc_json, date_rfc2822, received_at, body_text, \
         body_html, is_read, folder, attachments_meta, labels \
         FROM emails WHERE id = ?1",
        rusqlite::params![email_id],
        |row| {
            let refs_str: Option<String> = row.get(6)?;
            let refs: Option<Vec<String>> = refs_str
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok());
            let from_str: String = row.get(8)?;
            let to_str: String = row.get(9)?;
            let cc_str: Option<String> = row.get(10)?;
            let bcc_str: Option<String> = row.get(11)?;
            let att_str: Option<String> = row.get(18)?;
            let labels_str: String = row.get(19)?;
            let labels: Vec<String> = serde_json::from_str(&labels_str).unwrap_or_default();

            Ok(models::Email {
                id: row.get(0)?,
                thread_id: row.get(1)?,
                account_id: row.get(2)?,
                imap_uid: row.get(3)?,
                message_id: row.get(4)?,
                in_reply_to: row.get(5)?,
                references_field: refs,
                subject: decode_subject(row.get(7)?),
                from_field: serde_json::from_str(&from_str).unwrap_or_default(),
                to_field: serde_json::from_str(&to_str).unwrap_or_default(),
                cc_field: cc_str.as_deref().and_then(|s| serde_json::from_str(s).ok()),
                bcc_field: bcc_str.as_deref().and_then(|s| serde_json::from_str(s).ok()),
                date_rfc2822: row.get(12)?,
                received_at: row.get(13)?,
                body_text: row.get(14)?,
                body_html: row.get(15)?,
                is_read: row.get::<_, i64>(16)? != 0,
                folder: row.get(17)?,
                labels,
                attachments_meta: att_str.as_deref().and_then(|s| serde_json::from_str(s).ok()),
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn search_emails(query: String) -> Result<Vec<models::Email>, String> {
    let service = search::SearchService::new();
    let ids = service.search(&query, 50)?;
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let conn = db::get()?;
    let placeholders: Vec<String> = ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
    let sql = format!(
        "SELECT id, thread_id, account_id, imap_uid, message_id, \
         in_reply_to, \"references\", subject, from_json, to_json, \
         cc_json, bcc_json, date_rfc2822, received_at, body_text, \
         body_html, is_read, folder, attachments_meta, labels \
         FROM emails WHERE id IN ({})",
        placeholders.join(",")
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params: Vec<Box<dyn rusqlite::types::ToSql>> = ids
        .iter()
        .map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>)
        .collect();
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let emails: Vec<models::Email> = stmt
        .query_map(param_refs.as_slice(), |row| {
            let refs_str: Option<String> = row.get(6)?;
            let refs: Option<Vec<String>> = refs_str.as_deref().and_then(|s| serde_json::from_str(s).ok());
            let from_str: String = row.get(8)?;
            let to_str: String = row.get(9)?;
            let cc_str: Option<String> = row.get(10)?;
            let bcc_str: Option<String> = row.get(11)?;
            let att_str: Option<String> = row.get(18)?;
            let labels_str: String = row.get(19)?;
            let labels: Vec<String> = serde_json::from_str(&labels_str).unwrap_or_default();
            Ok(models::Email {
                id: row.get(0)?,
                thread_id: row.get(1)?,
                account_id: row.get(2)?,
                imap_uid: row.get(3)?,
                message_id: row.get(4)?,
                in_reply_to: row.get(5)?,
                references_field: refs,
                subject: decode_subject(row.get(7)?),
                from_field: serde_json::from_str(&from_str).unwrap_or_default(),
                to_field: serde_json::from_str(&to_str).unwrap_or_default(),
                cc_field: cc_str.as_deref().and_then(|s| serde_json::from_str(s).ok()),
                bcc_field: bcc_str.as_deref().and_then(|s| serde_json::from_str(s).ok()),
                date_rfc2822: row.get(12)?,
                received_at: row.get(13)?,
                body_text: row.get(14)?,
                body_html: row.get(15)?,
                is_read: row.get::<_, i64>(16)? != 0,
                folder: row.get(17)?,
                labels,
                attachments_meta: att_str.as_deref().and_then(|s| serde_json::from_str(s).ok()),
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(emails)
}

#[tauri::command]
async fn mark_read(email_id: i64, read: bool) -> Result<(), String> {
    let (account_id, provider_type, imap_host, imap_port, imap_encryption, email_address, uid, folder) = {
        let conn = db::get()?;
        conn.query_row(
            "SELECT e.account_id, a.provider_type, a.imap_host, a.imap_port, a.imap_encryption, \
                    a.email_address, e.imap_uid, e.folder \
             FROM emails e JOIN accounts a ON e.account_id = a.id \
             WHERE e.id = ?1",
            rusqlite::params![email_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
    };

    {
        let conn = db::get()?;
        let read_val: i64 = if read { 1 } else { 0 };
        conn.execute(
            "UPDATE emails SET is_read = ?1 WHERE id = ?2",
            rusqlite::params![read_val, email_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let host = match imap_host {
        Some(h) => h,
        None => return Ok(()),
    };
    let port = match imap_port {
        Some(p) => p,
        None => return Ok(()),
    };
    let encryption = match imap_encryption {
        Some(e) => e,
        None => return Ok(()),
    };
    let imap_uid = match uid {
        Some(u) => u,
        None => return Ok(()),
    };

    let session_result = if provider_type == "gmail_oauth" || provider_type == "microsoft_oauth" {
        let provider = match oauth::OAuthProvider::from_str(&provider_type) {
            Some(p) => p,
            None => return Ok(()),
        };
        imap_client::ImapConnection::connect_oauth(account_id, &provider, &email_address).await
    } else {
        imap_client::ImapConnection::connect_plain(account_id, &host, port, &encryption, &email_address).await
    };

    if let Ok(mut session) = session_result {
        if session.select(&folder).await.is_ok() {
            let flag_op = if read { "+FLAGS (\\Seen)" } else { "-FLAGS (\\Seen)" };
            let _stream = session.uid_store(format!("{}", imap_uid), flag_op).await;
        }
    }

    Ok(())
}

#[tauri::command]
async fn archive_email(email_id: i64) -> Result<(), String> {
    let (account_id, provider_type, imap_host, imap_port, imap_encryption, email_address, uid, folder) = {
        let conn = db::get()?;
        conn.query_row(
            "SELECT e.account_id, a.provider_type, a.imap_host, a.imap_port, a.imap_encryption, \
                    a.email_address, e.imap_uid, e.folder \
             FROM emails e JOIN accounts a ON e.account_id = a.id \
             WHERE e.id = ?1",
            rusqlite::params![email_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
    };

    let host = imap_host.ok_or("No IMAP host")?;
    let port = imap_port.ok_or("No IMAP port")?;
    let encryption = imap_encryption.ok_or("No IMAP encryption")?;
    let imap_uid = uid.ok_or("No IMAP UID")?;

    let mut session = if provider_type == "gmail_oauth" || provider_type == "microsoft_oauth" {
        let provider = oauth::OAuthProvider::from_str(&provider_type)
            .ok_or_else(|| format!("Invalid provider: {}", provider_type))?;
        imap_client::ImapConnection::connect_oauth(account_id, &provider, &email_address).await?
    } else {
        imap_client::ImapConnection::connect_plain(account_id, &host, port, &encryption, &email_address).await?
    };

    session
        .select(&folder)
        .await
        .map_err(|e| format!("SELECT failed: {:?}", e))?;

    if provider_type == "gmail_oauth" {
        let stream = session
            .uid_store(format!("{}", imap_uid), "+X-GM-LABELS ()")
            .await
            .map_err(|e| format!("Gmail archive failed: {:?}", e))?;
        futures::StreamExt::collect::<Vec<_>>(stream).await;
        let stream = session
            .uid_store(format!("{}", imap_uid), "-X-GM-LABELS (\\INBOX)")
            .await
            .map_err(|e| format!("Gmail remove INBOX label failed: {:?}", e))?;
        futures::StreamExt::collect::<Vec<_>>(stream).await;
    } else {
        let archive_result = session.select("Archive").await;
        if archive_result.is_err() {
            session
                .create("Archive")
                .await
                .map_err(|e| format!("CREATE Archive failed: {:?}", e))?;
        }
        session
            .select(&folder)
            .await
            .map_err(|e| format!("SELECT failed: {:?}", e))?;
        let _ = session
            .uid_copy(format!("{}", imap_uid), "Archive")
            .await
            .map_err(|e| format!("COPY to Archive failed: {:?}", e))?;
        let stream = session
            .uid_store(format!("{}", imap_uid), "+FLAGS (\\Deleted)")
            .await
            .map_err(|e| format!("DELETE flag failed: {:?}", e))?;
        futures::StreamExt::collect::<Vec<_>>(stream).await;
        let stream = session
            .expunge()
            .await
            .map_err(|e| format!("EXPUNGE failed: {:?}", e))?;
        futures::StreamExt::collect::<Vec<_>>(stream).await;
    }

    {
        let conn = db::get()?;
        conn.execute("DELETE FROM emails WHERE id = ?1", rusqlite::params![email_id])
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn delete_email(email_id: i64) -> Result<(), String> {
    let (account_id, provider_type, imap_host, imap_port, imap_encryption, email_address, uid, folder) = {
        let conn = db::get()?;
        conn.query_row(
            "SELECT e.account_id, a.provider_type, a.imap_host, a.imap_port, a.imap_encryption, \
                    a.email_address, e.imap_uid, e.folder \
             FROM emails e JOIN accounts a ON e.account_id = a.id \
             WHERE e.id = ?1",
            rusqlite::params![email_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
    };

    let host = imap_host.ok_or("No IMAP host")?;
    let port = imap_port.ok_or("No IMAP port")?;
    let encryption = imap_encryption.ok_or("No IMAP encryption")?;
    let imap_uid = uid.ok_or("No IMAP UID")?;

    let mut session = if provider_type == "gmail_oauth" || provider_type == "microsoft_oauth" {
        let provider = oauth::OAuthProvider::from_str(&provider_type)
            .ok_or_else(|| format!("Invalid provider: {}", provider_type))?;
        imap_client::ImapConnection::connect_oauth(account_id, &provider, &email_address).await?
    } else {
        imap_client::ImapConnection::connect_plain(account_id, &host, port, &encryption, &email_address).await?
    };

    session
        .select(&folder)
        .await
        .map_err(|e| format!("SELECT failed: {:?}", e))?;

    let stream = session
        .uid_store(format!("{}", imap_uid), "+FLAGS (\\Deleted)")
        .await
        .map_err(|e| format!("DELETE flag failed: {:?}", e))?;
    futures::StreamExt::collect::<Vec<_>>(stream).await;
    let stream = session
        .expunge()
        .await
        .map_err(|e| format!("EXPUNGE failed: {:?}", e))?;
    futures::StreamExt::collect::<Vec<_>>(stream).await;

    {
        let conn = db::get()?;
        conn.execute("DELETE FROM emails WHERE id = ?1", rusqlite::params![email_id])
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn send_email(
    account_id: i64,
    to: String,
    cc: Option<String>,
    bcc: Option<String>,
    subject: String,
    body_html: String,
    body_text: String,
    attachments: Option<Vec<String>>,
    in_reply_to: Option<String>,
    references: Option<Vec<String>>,
) -> Result<(), String> {
    let service = compose::ComposeService::new();
    service
        .send_email(
            account_id,
            &to,
            cc.as_deref(),
            bcc.as_deref(),
            &subject,
            &body_html,
            &body_text,
            attachments,
            in_reply_to.as_deref(),
            references,
        )
        .await
}

#[tauri::command]
fn get_send_queue() -> Result<Vec<models::SendQueueItem>, String> {
    let conn = db::get()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, account_id, to_json, cc_json, bcc_json, subject, \
             body_html, body_text, attachments_meta, status, retry_count, \
             created_at, sent_at FROM send_queue ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let items: Vec<models::SendQueueItem> = stmt
        .query_map([], |row| {
            let to_str: String = row.get(2)?;
            let cc_str: Option<String> = row.get(3)?;
            let bcc_str: Option<String> = row.get(4)?;
            let att_str: Option<String> = row.get(8)?;
            Ok(models::SendQueueItem {
                id: row.get(0)?,
                account_id: row.get(1)?,
                to_field: serde_json::from_str(&to_str).unwrap_or_default(),
                cc_field: cc_str.as_deref().and_then(|s| serde_json::from_str(s).ok()),
                bcc_field: bcc_str.as_deref().and_then(|s| serde_json::from_str(s).ok()),
                subject: row.get(5)?,
                body_html: row.get(6)?,
                body_text: row.get(7)?,
                attachments_meta: att_str.as_deref().and_then(|s| serde_json::from_str(s).ok()),
                status: row.get(9)?,
                retry_count: row.get(10)?,
                created_at: row.get(11)?,
                sent_at: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(items)
}

#[tauri::command]
async fn retry_send_queue_item(queue_id: i64) -> Result<(), String> {
    let _ = queue_id;
    let service = compose::ComposeService::new();
    service.process_queue().await
}

#[tauri::command]
fn get_ai_config() -> Result<Option<models::AiConfig>, String> {
    let conn = db::get()?;
    let base_url: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'ai_base_url'",
            [],
            |row| row.get(0),
        )
        .ok();
    let model: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'ai_model'",
            [],
            |row| row.get(0),
        )
        .ok();
    let default_tone: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'ai_default_tone'",
            [],
            |row| row.get(0),
        )
        .ok();
    let output_language: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'ai_output_language'",
            [],
            |row| row.get(0),
        )
        .ok();
    let custom_instructions: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'ai_custom_instructions'",
            [],
            |row| row.get(0),
        )
        .ok();

    match base_url {
        Some(bu) if !bu.is_empty() => {
            let api_key = secure::get_ai_api_key().unwrap_or_default();
            Ok(Some(models::AiConfig {
                base_url: bu,
                api_key,
                model: model.unwrap_or_default(),
                default_tone: default_tone.unwrap_or_else(|| "Professional".to_string()),
                output_language: output_language.unwrap_or_else(|| "en".to_string()),
                custom_instructions: custom_instructions.unwrap_or_default(),
            }))
        }
        _ => Ok(None),
    }
}

#[tauri::command]
fn set_ai_config(config: models::AiConfig) -> Result<(), String> {
    let conn = db::get()?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('ai_base_url', ?1)",
        rusqlite::params![config.base_url],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('ai_model', ?1)",
        rusqlite::params![config.model],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('ai_default_tone', ?1)",
        rusqlite::params![config.default_tone],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('ai_output_language', ?1)",
        rusqlite::params![config.output_language],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('ai_custom_instructions', ?1)",
        rusqlite::params![config.custom_instructions],
    )
    .map_err(|e| e.to_string())?;
    secure::store_ai_api_key(&config.api_key)?;
    Ok(())
}

#[tauri::command]
async fn validate_ai_endpoint() -> Result<bool, String> {
    let config = get_ai_config()?;
    match config {
        Some(c) => {
            let service = ai::AiService::new();
            service.validate_endpoint(&c.base_url, &c.api_key).await
        }
        None => Ok(false),
    }
}

#[tauri::command]
async fn stream_summarize_thread(
    app: tauri::AppHandle,
    stream_id: String,
    thread_id: i64,
    email_ids: Vec<i64>,
    tone: String,
) -> Result<(), String> {
    ai::AiService::new()
        .stream_summarize_thread(&app, &stream_id, thread_id, &email_ids, &tone)
        .await
}

#[tauri::command]
async fn stream_draft_reply(
    app: tauri::AppHandle,
    stream_id: String,
    thread_id: i64,
    email_ids: Vec<i64>,
    tone: String,
) -> Result<(), String> {
    ai::AiService::new()
        .stream_draft_reply(&app, &stream_id, thread_id, &email_ids, &tone)
        .await
}

#[tauri::command]
async fn stream_ai_transform(
    app: tauri::AppHandle,
    stream_id: String,
    instruction: String,
    subject: String,
    text: String,
    tone: String,
) -> Result<(), String> {
    ai::AiService::new()
        .stream_ai_transform(&app, &stream_id, &tone, &instruction, &subject, &text)
        .await
}

#[tauri::command]
fn is_online() -> Result<bool, String> {
    Ok(reqwest::blocking::Client::new()
        .head("https://www.google.com")
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .is_ok())
}

#[tauri::command]
async fn validate_imap_connection(params: ImapAccountParams) -> Result<bool, String> {
    let port = oauth::find_available_port()?;
    let _ = port;

    let account_id: i64 = 0;
    secure::store_imap_password(account_id, &params.password)?;

    let result = imap_client::ImapConnection::connect_plain(
        account_id,
        &params.imap_host,
        params.imap_port,
        &params.imap_encryption,
        &params.username,
    )
    .await;

    let _ = secure::delete_secret(&format!("account_{}_imap_password", account_id));

    match result {
        Ok(mut session) => {
            let _ = session.logout().await;
            Ok(true)
        }
        Err(e) => Err(format!("IMAP connection failed: {}", e)),
    }
}

#[tauri::command]
async fn fetch_email_body(email_id: i64) -> Result<(), String> {
    let info: Option<(i64, String, Option<String>, Option<i64>, Option<String>, String, Option<i64>, String)> = {
        let conn = db::get()?;
        conn.query_row(
            "SELECT e.account_id, a.provider_type, a.imap_host, a.imap_port, a.imap_encryption, \
                    a.email_address, e.imap_uid, e.folder \
             FROM emails e JOIN accounts a ON e.account_id = a.id \
             WHERE e.id = ?1 AND e.body_html IS NULL AND e.body_text IS NULL",
            rusqlite::params![email_id],
            |row| {
                Ok(Some((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                )))
            },
        )
        .ok()
        .flatten()
    };

    let (account_id, provider_type, imap_host, imap_port, imap_encryption, email_address, imap_uid, folder) = match info {
        Some(i) => i,
        None => return Ok(()),
    };

    let host = match imap_host {
        Some(h) => h,
        None => return Ok(()),
    };
    let port = match imap_port {
        Some(p) => p,
        None => return Ok(()),
    };
    let encryption = match imap_encryption {
        Some(e) => e,
        None => return Ok(()),
    };
    let uid = match imap_uid {
        Some(u) => u,
        None => return Ok(()),
    };

    let mut session = if provider_type == "gmail_oauth" || provider_type == "microsoft_oauth" {
        let provider = oauth::OAuthProvider::from_str(&provider_type)
            .ok_or_else(|| format!("Invalid provider: {}", provider_type))?;
        imap_client::ImapConnection::connect_oauth(account_id, &provider, &email_address).await?
    } else {
        imap_client::ImapConnection::connect_plain(account_id, &host, port, &encryption, &email_address).await?
    };

    session
        .select(&folder)
        .await
        .map_err(|e| format!("SELECT failed: {:?}", e))?;

    let raw = imap_client::fetch_uid_message_raw(&mut session, uid as u32).await?;
    drop(session);
    email_parse::apply_raw_message(email_id, &raw)?;
    Ok(())
}

#[tauri::command]
async fn fetch_recent_bodies(account_id: i64, limit: i64) -> Result<i64, String> {
    let (provider_type, imap_host, imap_port, imap_encryption, email_address) = {
        let conn = db::get()?;
        conn.query_row(
            "SELECT provider_type, imap_host, imap_port, imap_encryption, email_address \
             FROM accounts WHERE id = ?1",
            rusqlite::params![account_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
    };

    let host = imap_host.ok_or("No IMAP host")?;
    let port = imap_port.ok_or("No IMAP port")?;
    let encryption = imap_encryption.ok_or("No IMAP encryption")?;

    let email_ids: Vec<(i64, i64, String)> = {
        let conn = db::get()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, imap_uid, folder FROM emails \
                 WHERE account_id = ?1 AND body_html IS NULL AND body_text IS NULL \
                 ORDER BY received_at DESC LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<(i64, i64, String)> = stmt
            .query_map(rusqlite::params![account_id, limit], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    if email_ids.is_empty() {
        return Ok(0);
    }

    let mut session = if provider_type == "gmail_oauth" || provider_type == "microsoft_oauth" {
        let provider = oauth::OAuthProvider::from_str(&provider_type)
            .ok_or_else(|| format!("Invalid provider: {}", provider_type))?;
        imap_client::ImapConnection::connect_oauth(account_id, &provider, &email_address).await?
    } else {
        imap_client::ImapConnection::connect_plain(account_id, &host, port, &encryption, &email_address).await?
    };

    let mut fetched: i64 = 0;
    let mut current_folder = String::new();

    for (email_id, uid, folder) in &email_ids {
        if *folder != current_folder {
            session
                .select(folder)
                .await
                .map_err(|e| format!("SELECT {} failed: {:?}", folder, e))?;
            current_folder = folder.clone();
        }

        match imap_client::fetch_uid_message_raw(&mut session, *uid as u32).await {
            Ok(raw) => {
                if email_parse::apply_raw_message(*email_id, &raw).is_ok() {
                    fetched += 1;
                }
            }
            Err(e) => log::warn!("Body fetch failed for email {}: {}", email_id, e),
        }
    }

    drop(session);
    Ok(fetched)
}

#[tauri::command]
async fn queue_email(
    account_id: i64,
    to: String,
    cc: Option<String>,
    bcc: Option<String>,
    subject: String,
    body_html: String,
    body_text: String,
    in_reply_to: Option<String>,
    references: Option<Vec<String>>,
) -> Result<(), String> {
    let service = compose::ComposeService::new();
    service
        .queue_email(
            account_id,
            &to,
            cc.as_deref(),
            bcc.as_deref(),
            &subject,
            &body_html,
            &body_text,
            None,
            in_reply_to.as_deref(),
            references,
        )
        .await
}

#[tauri::command]
async fn process_send_queue() -> Result<(), String> {
    let service = compose::ComposeService::new();
    service.process_queue().await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();
    let _ = env_logger::try_init();
    db::init().expect("Failed to initialize database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            list_accounts,
            add_oauth_account,
            reauth_oauth_account,
            add_imap_account,
            remove_account,
            trigger_sync,
            list_threads,
            get_emails,
            get_email,
            search_emails,
            mark_read,
            archive_email,
            delete_email,
            send_email,
            fetch_email_body,
            fetch_recent_bodies,
            queue_email,
            process_send_queue,
            get_send_queue,
            retry_send_queue_item,
            get_ai_config,
            set_ai_config,
            validate_ai_endpoint,
            stream_summarize_thread,
            stream_draft_reply,
            stream_ai_transform,
            is_online,
            validate_imap_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use crate::db;
use crate::email_parse;
use crate::imap_client::ImapConnection;
use crate::oauth::OAuthProvider;
use crate::threading::ThreadingService;
use futures::StreamExt;
use std::time::Duration;

const INITIAL_SYNC_LIMIT: u32 = 500;
const MAX_EMAILS_PER_ACCOUNT: i64 = 50000;
const SELECT_TIMEOUT: Duration = Duration::from_secs(10);
const LIST_TIMEOUT: Duration = Duration::from_secs(10);
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

pub struct AccountSyncResult {
    pub account_id: i64,
    pub new_count: i64,
}

pub struct SyncEngine;

pub struct FolderInfo {
    pub imap_name: String,
}

impl SyncEngine {
    pub fn new() -> Self {
        SyncEngine
    }

    async fn discover_folders(
        &self,
        session: &mut crate::imap_client::ImapSession,
        account_id: i64,
    ) -> Result<(), String> {
        let existing: Vec<(String, String, Option<String>)> = {
            let conn = db::get()?;
            let mut stmt = conn
                .prepare("SELECT name, imap_name, special_use FROM folders WHERE account_id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params![account_id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect::<Vec<_>>();
            rows
        };

        if !existing.is_empty() {
            return Ok(());
        }

        let mut folders: Vec<(String, String, Option<String>)> = Vec::new();
        folders.push(("Inbox".to_string(), "INBOX".to_string(), Some("inbox".to_string())));

        let list_result = tokio::time::timeout(LIST_TIMEOUT, session.list(None, Some("*"))).await;
        if let Ok(Ok(list_stream)) = list_result {
            let names_result = tokio::time::timeout(LIST_TIMEOUT, list_stream.collect::<Vec<_>>()).await;
            let names = names_result.unwrap_or_default();
            for name_result in names {
                if let Ok(name) = name_result {
                    let imap_name = name.name().to_string();
                    if imap_name.eq_ignore_ascii_case("INBOX") {
                        continue;
                    }
                    if name
                        .attributes()
                        .iter()
                        .any(|a| matches!(a, async_imap::types::NameAttribute::NoSelect))
                    {
                        continue;
                    }
                    let special_use = name
                        .attributes()
                        .iter()
                        .find_map(|attr| match attr {
                            async_imap::types::NameAttribute::Sent => Some("sent".to_string()),
                            async_imap::types::NameAttribute::Drafts => Some("drafts".to_string()),
                            async_imap::types::NameAttribute::Trash => Some("trash".to_string()),
                            async_imap::types::NameAttribute::Junk => Some("spam".to_string()),
                            async_imap::types::NameAttribute::Archive => Some("archive".to_string()),
                            _ => None,
                        });

                    let display_name = special_use
                        .as_ref()
                        .map(|s| s.clone())
                        .unwrap_or_else(|| imap_name.clone());

                    folders.push((display_name, imap_name, special_use));
                }
            }
        } else {
            log::warn!("Folder LIST failed for account {}, falling back to INBOX only", account_id);
        }

        let conn = db::get()?;
        for (name, imap_name, special_use) in &folders {
            conn.execute(
                "INSERT OR IGNORE INTO folders (account_id, name, imap_name, special_use) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![account_id, name, imap_name, special_use],
            )
            .map_err(|e| format!("Failed to insert folder: {}", e))?;
        }

        Ok(())
    }

    fn get_folders(&self, account_id: i64) -> Result<Vec<FolderInfo>, String> {
        let conn = db::get()?;
        let mut stmt = conn
            .prepare("SELECT id, name, imap_name, special_use FROM folders WHERE account_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![account_id], |row| {
                let imap_name: String = row.get(2)?;
                Ok(FolderInfo { imap_name })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    fn get_folder_last_uid(&self, account_id: i64, folder: &str) -> Result<i64, String> {
        let conn = db::get()?;
        Ok(conn
            .query_row(
                "SELECT last_seen_uid FROM folder_sync_state WHERE account_id = ?1 AND folder = ?2",
                rusqlite::params![account_id, folder],
                |row| row.get(0),
            )
            .unwrap_or(0))
    }

    fn set_folder_last_uid(&self, account_id: i64, folder: &str, uid: i64) -> Result<(), String> {
        let conn = db::get()?;
        conn.execute(
            "INSERT INTO folder_sync_state (account_id, folder, last_seen_uid) VALUES (?1, ?2, ?3) \
             ON CONFLICT(account_id, folder) DO UPDATE SET last_seen_uid = ?3",
            rusqlite::params![account_id, folder, uid],
        )
        .map_err(|e| format!("Failed to update folder UID: {}", e))?;
        Ok(())
    }

    async fn sync_folder(
        &self,
        session: &mut crate::imap_client::ImapSession,
        account_id: i64,
        folder: &FolderInfo,
    ) -> Result<i64, String> {
        let mailbox = match tokio::time::timeout(SELECT_TIMEOUT, session.select(&folder.imap_name))
            .await
        {
            Ok(Ok(m)) => m,
            Ok(Err(e)) => {
                log::warn!(
                    "Failed to select folder '{}' for account {}: {:?}",
                    folder.imap_name,
                    account_id,
                    e
                );
                return Ok(0);
            }
            Err(_) => {
                log::warn!(
                    "Select folder '{}' timed out for account {}",
                    folder.imap_name,
                    account_id
                );
                return Ok(0);
            }
        };

        let last_uid = self.get_folder_last_uid(account_id, &folder.imap_name)?;
        let fetch_query = "(UID FLAGS ENVELOPE BODY.PEEK[HEADER.FIELDS (REFERENCES)])";

        let collected: Vec<_> = if last_uid > 0 {
            let criteria = format!("{}:*", last_uid + 1);
            let fetch_stream = tokio::time::timeout(FETCH_TIMEOUT, session.uid_fetch(&criteria, fetch_query))
                .await
                .map_err(|_| format!("UID FETCH timed out after {FETCH_TIMEOUT:?}"))?
                .map_err(|e| format!("UID FETCH failed: {:?}", e))?;
            tokio::time::timeout(FETCH_TIMEOUT, fetch_stream.collect::<Vec<_>>())
                .await
                .map_err(|_| format!("UID FETCH stream timed out after {FETCH_TIMEOUT:?}"))?
        } else if mailbox.exists == 0 {
            return Ok(0);
        } else {
            let seq_start = mailbox
                .exists
                .saturating_sub(INITIAL_SYNC_LIMIT.saturating_sub(1))
                .max(1);
            let criteria = format!("{seq_start}:*");
            log::info!(
                "Initial sync account {}/{}: fetching last {} of {} messages (seq {}:*)",
                account_id,
                folder.imap_name,
                INITIAL_SYNC_LIMIT.min(mailbox.exists),
                mailbox.exists,
                seq_start
            );
            let fetch_stream = tokio::time::timeout(FETCH_TIMEOUT, session.fetch(&criteria, fetch_query))
                .await
                .map_err(|_| format!("FETCH timed out after {FETCH_TIMEOUT:?}"))?
                .map_err(|e| format!("FETCH failed: {:?}", e))?;
            tokio::time::timeout(FETCH_TIMEOUT, fetch_stream.collect::<Vec<_>>())
                .await
                .map_err(|_| format!("FETCH stream timed out after {FETCH_TIMEOUT:?}"))?
        };

        let mut max_uid: i64 = last_uid;
        let mut new_count: i64 = 0;

        struct PendingEmail {
            uid: i64,
            message_id: String,
            in_reply_to: Option<String>,
            references_json: Option<String>,
            subject: Option<String>,
            from_json: String,
            to_json: String,
            cc_json: String,
            bcc_json: String,
            date_rfc2822: Option<String>,
            received_at: i64,
            is_read: bool,
            labels_json: String,
        }

        let mut pending: Vec<PendingEmail> = Vec::new();

        for fetch_result in collected {
            let fetch = match fetch_result {
                Ok(f) => f,
                Err(e) => {
                    log::warn!("FETCH error: {:?}", e);
                    continue;
                }
            };
            let uid = match fetch.uid {
                Some(u) => u as i64,
                None => continue,
            };

            if uid <= last_uid {
                continue;
            }

            let envelope = match fetch.envelope() {
                Some(e) => e,
                None => continue,
            };

            let message_id = envelope
                .message_id
                .as_ref()
                .map(|v| String::from_utf8_lossy(v).to_string())
                .unwrap_or_else(|| format!("<no-message-id-{}>", uid));

            let subject = envelope
                .subject
                .as_ref()
                .map(|v| email_parse::decode_header(&String::from_utf8_lossy(v)));
            let in_reply_to = envelope
                .in_reply_to
                .as_ref()
                .map(|v| String::from_utf8_lossy(v).to_string());
            let references = Self::extract_references_from_body(fetch.body());
            let from_json = Self::addresses_to_json(envelope.from.as_ref());
            let to_json = Self::addresses_to_json(envelope.to.as_ref());
            let cc_json = Self::addresses_to_json(envelope.cc.as_ref());
            let bcc_json = Self::addresses_to_json(envelope.bcc.as_ref());
            let date_rfc2822 = envelope
                .date
                .as_ref()
                .map(|v| String::from_utf8_lossy(v).to_string());

            let received_at = fetch
                .internal_date()
                .map(|dt| dt.timestamp())
                .unwrap_or_else(|| chrono::Utc::now().timestamp());

            let is_read = fetch.flags().any(|f| f == async_imap::types::Flag::Seen);

            let labels: Vec<String> = fetch
                .flags()
                .filter_map(|f| match f {
                    async_imap::types::Flag::Flagged => Some("\\Flagged".to_string()),
                    async_imap::types::Flag::Answered => Some("\\Answered".to_string()),
                    async_imap::types::Flag::Draft => Some("\\Draft".to_string()),
                    async_imap::types::Flag::Deleted => Some("\\Deleted".to_string()),
                    async_imap::types::Flag::Custom(ref k) => Some(k.to_string()),
                    _ => None,
                })
                .collect();
            let labels_json = serde_json::to_string(&labels).unwrap_or_else(|_| "[]".to_string());

            let references_json = references
                .as_ref()
                .map(|r| serde_json::to_string(r).unwrap_or_default());

            if uid > max_uid {
                max_uid = uid;
            }

            pending.push(PendingEmail {
                uid,
                message_id,
                in_reply_to,
                references_json,
                subject,
                from_json,
                to_json,
                cc_json,
                bcc_json,
                date_rfc2822,
                received_at,
                is_read,
                labels_json,
            });
        }

        if !pending.is_empty() {
            let existing_ids: std::collections::HashSet<String> = {
                let conn = db::get()?;
                let mut ids: std::collections::HashSet<String> = std::collections::HashSet::new();
                for chunk in pending.chunks(500) {
                    let placeholders = std::iter::repeat("?")
                        .take(chunk.len())
                        .collect::<Vec<_>>()
                        .join(", ");
                    let sql = format!(
                        "SELECT message_id FROM emails WHERE account_id = ?1 AND message_id IN ({})",
                        placeholders
                    );
                    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
                    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> =
                        vec![Box::new(account_id)];
                    for p in chunk {
                        params.push(Box::new(p.message_id.clone()));
                    }
                    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                        params.iter().map(|p| p.as_ref()).collect();
                    let chunk_ids: std::collections::HashSet<String> = stmt
                        .query_map(param_refs.as_slice(), |row| row.get::<_, String>(0))
                        .map_err(|e| e.to_string())?
                        .filter_map(|r| r.ok())
                        .collect();
                    ids.extend(chunk_ids);
                }
                ids
            };

            let to_insert: Vec<&PendingEmail> = pending
                .iter()
                .filter(|p| !existing_ids.contains(&p.message_id))
                .collect();

            if !to_insert.is_empty() {
                let mut conn = db::get()?;
                let tx = conn.transaction().map_err(|e| e.to_string())?;
                {
                    let mut stmt = tx.prepare(
                        "INSERT INTO emails \
                         (thread_id, account_id, imap_uid, message_id, in_reply_to, \
                          \"references\", subject, from_json, to_json, cc_json, bcc_json, \
                         date_rfc2822, received_at, body_text, body_html, is_read, folder, labels) \
                         VALUES (NULL, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                    ).map_err(|e| e.to_string())?;
                    for p in &to_insert {
                        stmt.execute(rusqlite::params![
                            account_id,
                            p.uid,
                            p.message_id,
                            p.in_reply_to,
                            p.references_json,
                            p.subject,
                            p.from_json,
                            p.to_json,
                            p.cc_json,
                            p.bcc_json,
                            p.date_rfc2822,
                            p.received_at,
                            None::<String>,
                            None::<String>,
                            p.is_read as i64,
                            folder.imap_name,
                            p.labels_json,
                        ])
                        .map_err(|e| format!("Failed to insert email: {}", e))?;
                    }
                }
                tx.commit().map_err(|e| e.to_string())?;
                new_count = to_insert.len() as i64;
            }
        }

        if max_uid > last_uid {
            self.set_folder_last_uid(account_id, &folder.imap_name, max_uid)?;
        }

        log::info!(
            "Synced account {}/{}: {} new emails, max UID {}",
            account_id,
            folder.imap_name,
            new_count,
            max_uid
        );

        Ok(new_count)
    }

    pub async fn sync_account(&self, account_id: i64) -> Result<i64, String> {
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

        let host = imap_host.ok_or("No IMAP host configured")?;
        let port = imap_port.ok_or("No IMAP port configured")?;
        let encryption = imap_encryption.ok_or("No IMAP encryption configured")?;

        let mut session = if provider_type == "gmail_oauth" || provider_type == "microsoft_oauth"
        {
            let provider = OAuthProvider::from_str(&provider_type)
                .ok_or_else(|| format!("Invalid provider: {}", provider_type))?;
            ImapConnection::connect_oauth(account_id, &provider, &email_address).await?
        } else {
            ImapConnection::connect_plain(account_id, &host, port, &encryption, &email_address)
                .await?
        };

        self.discover_folders(&mut session, account_id).await?;

        let folders = self.get_folders(account_id)?;
        let mut total_new: i64 = 0;

        for folder in &folders {
            let new = self.sync_folder(&mut session, account_id, folder).await?;
            total_new += new;
        }

        crate::imap_client::logout_session(&mut session).await;

        if total_new > 0 {
            let threading = ThreadingService::new();
            let account_id_clone = account_id;
            tokio::task::spawn_blocking(move || {
                threading.rebuild_threads_for_account(account_id_clone)
            })
            .await
            .map_err(|e| format!("Threading task panicked: {}", e))??;

            let self_clone = SyncEngine::new();
            tokio::task::spawn_blocking(move || {
                self_clone.enforce_email_limit(account_id)
            })
            .await
            .map_err(|e| format!("Enforce limit task panicked: {}", e))??;
        }

        log::info!(
            "Synced account {}: {} new emails across {} folders",
            account_id,
            total_new,
            folders.len()
        );

        Ok(total_new)
    }

    pub async fn sync_all(&self) -> Result<Vec<AccountSyncResult>, String> {
        let account_ids: Vec<i64> = {
            let conn = db::get()?;
            let mut stmt = conn
                .prepare("SELECT id FROM accounts WHERE sync_enabled = 1")
                .map_err(|e| e.to_string())?;
            let ids: Vec<i64> = stmt
                .query_map([], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            ids
        };

        let mut results: Vec<AccountSyncResult> = Vec::new();
        let mut errors: Vec<String> = Vec::new();
        for id in account_ids {
            match self.sync_account(id).await {
                Ok(new_count) => {
                    Self::clear_sync_error(id).ok();
                    results.push(AccountSyncResult {
                        account_id: id,
                        new_count,
                    });
                }
                Err(e) => {
                    log::error!("Sync failed for account {}: {}", id, e);
                    Self::set_sync_error(id, &e).ok();
                    errors.push(format!("Account {id}: {e}"));
                }
            }
        }

        if errors.is_empty() {
            Ok(results)
        } else {
            Err(errors.join("; "))
        }
    }

    pub fn set_sync_error(account_id: i64, error: &str) -> Result<(), String> {
        let conn = db::get()?;
        conn.execute(
            "UPDATE accounts SET sync_error = ?1, sync_error_at = ?2 WHERE id = ?3",
            rusqlite::params![error, chrono::Utc::now().timestamp(), account_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn clear_sync_error(account_id: i64) -> Result<(), String> {
        let conn = db::get()?;
        conn.execute(
            "UPDATE accounts SET sync_error = NULL, sync_error_at = NULL WHERE id = ?1",
            rusqlite::params![account_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn extract_references_from_body(body: Option<&[u8]>) -> Option<Vec<String>> {
        let body_bytes = body?;
        let header_str = String::from_utf8_lossy(body_bytes);
        let refs_line = header_str
            .lines()
            .find(|l| l.to_lowercase().starts_with("references:"))?;
        let refs_value = refs_line
            .splitn(2, ':')
            .nth(1)
            .unwrap_or("")
            .trim();
        let refs: Vec<String> = refs_value
            .split_whitespace()
            .map(|s| s.to_string())
            .filter(|s| s.starts_with('<') && s.ends_with('>'))
            .collect();
        if refs.is_empty() {
            None
        } else {
            Some(refs)
        }
    }

    fn addresses_to_json(
        addrs: Option<&Vec<imap_proto::types::Address<'_>>>,
    ) -> String {
        let result: Vec<serde_json::Value> = addrs
            .map(|vec| {
                vec.iter()
                    .map(|a| {
                        let name = a
                            .name
                            .as_ref()
                            .map(|v| {
                                email_parse::decode_header(&String::from_utf8_lossy(v))
                            })
                            .unwrap_or_default();
                        let mailbox = a
                            .mailbox
                            .as_ref()
                            .map(|v| String::from_utf8_lossy(v).to_string())
                            .unwrap_or_default();
                        let host = a
                            .host
                            .as_ref()
                            .map(|v| String::from_utf8_lossy(v).to_string())
                            .unwrap_or_default();
                        let address = if host.is_empty() {
                            mailbox
                        } else {
                            format!("{}@{}", mailbox, host)
                        };
                        serde_json::json!({
                            "name": name,
                            "address": address
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        serde_json::to_string(&result).unwrap_or("[]".to_string())
    }

    fn enforce_email_limit(&self, account_id: i64) -> Result<(), String> {
        let conn = db::get()?;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM emails WHERE account_id = ?1",
                rusqlite::params![account_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if count <= MAX_EMAILS_PER_ACCOUNT {
            return Ok(());
        }

        let excess = count - MAX_EMAILS_PER_ACCOUNT;
        conn.execute(
            "DELETE FROM emails WHERE id IN (\
             SELECT e.id FROM emails e \
             WHERE e.account_id = ?1 \
             ORDER BY e.received_at ASC LIMIT ?2)",
            rusqlite::params![account_id, excess],
        )
        .map_err(|e| format!("Failed to purge old emails: {}", e))?;

        log::info!(
            "Purged {} old emails for account {}",
            excess,
            account_id
        );
        Ok(())
    }
}

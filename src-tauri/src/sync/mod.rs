use crate::db;
use crate::email_parse;
use crate::imap_client::ImapConnection;
use crate::oauth::OAuthProvider;
use crate::threading::ThreadingService;
use futures::StreamExt;

const INITIAL_SYNC_LIMIT: u32 = 100;
const MAX_EMAILS_PER_ACCOUNT: i64 = 100;

pub struct SyncEngine;

impl SyncEngine {
    pub fn new() -> Self {
        SyncEngine
    }

    pub async fn sync_account(&self, account_id: i64) -> Result<(), String> {
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

        let mailbox = session
            .select("INBOX")
            .await
            .map_err(|e| format!("Failed to select INBOX: {:?}", e))?;

        let last_uid = self.get_last_uid(account_id)?;
        let fetch_query = "(UID FLAGS ENVELOPE BODY.PEEK[HEADER.FIELDS (REFERENCES)])";

        let collected: Vec<_> = if last_uid > 0 {
            let criteria = format!("{}:*", last_uid + 1);
            session
                .uid_fetch(&criteria, fetch_query)
                .await
                .map_err(|e| format!("UID FETCH failed: {:?}", e))?
                .collect::<Vec<_>>()
                .await
        } else if mailbox.exists == 0 {
            return Ok(());
        } else {
            let seq_start = mailbox
                .exists
                .saturating_sub(INITIAL_SYNC_LIMIT.saturating_sub(1))
                .max(1);
            let criteria = format!("{seq_start}:*");
            log::info!(
                "Initial sync account {}: fetching last {} of {} messages (seq {}:*)",
                account_id,
                INITIAL_SYNC_LIMIT.min(mailbox.exists),
                mailbox.exists,
                seq_start
            );
            session
                .fetch(&criteria, fetch_query)
                .await
                .map_err(|e| format!("FETCH failed: {:?}", e))?
                .collect::<Vec<_>>()
                .await
        };

        drop(session);

        let mut max_uid: i64 = last_uid;
        let mut new_count: i64 = 0;

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

            let existing = {
                let conn = db::get()?;
                let count: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM emails WHERE account_id = ?1 AND message_id = ?2",
                        rusqlite::params![account_id, message_id],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);
                count
            };
            if existing > 0 {
                if uid > max_uid {
                    max_uid = uid;
                }
                continue;
            }

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

            let body_text: Option<String> = None;
            let body_html: Option<String> = None;

            let references_json = references
                .as_ref()
                .map(|r| serde_json::to_string(r).unwrap_or_default());

            {
                let conn = db::get()?;
                conn.execute(
                    "INSERT INTO emails \
                      (thread_id, account_id, imap_uid, message_id, in_reply_to, \
                       \"references\", subject, from_json, to_json, cc_json, bcc_json, \
                      date_rfc2822, received_at, body_text, body_html, is_read, folder) \
                     VALUES (NULL, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 'INBOX')",
                    rusqlite::params![
                        account_id,
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
                        body_text,
                        body_html,
                        is_read as i64,
                    ],
                )
                .map_err(|e| format!("Failed to insert email: {}", e))?;
            }

            if uid > max_uid {
                max_uid = uid;
            }
            new_count += 1;
        }

        if max_uid > last_uid {
            let conn = db::get()?;
            conn.execute(
                "UPDATE accounts SET last_seen_uid = ?1 WHERE id = ?2",
                rusqlite::params![max_uid, account_id],
            )
            .map_err(|e| e.to_string())?;
        }

        if new_count > 0 {
            let threading = ThreadingService::new();
            threading.rebuild_threads_for_account(account_id)?;

            self.enforce_email_limit(account_id)?;
        }

        log::info!(
            "Synced account {}: {} new emails, max UID {}",
            account_id,
            new_count,
            max_uid
        );

        Ok(())
    }

    pub async fn sync_all(&self) -> Result<(), String> {
        let account_ids: Vec<i64> = {
            let conn = db::get()?;
            let mut stmt = conn
                .prepare("SELECT id FROM accounts")
                .map_err(|e| e.to_string())?;
            let ids: Vec<i64> = stmt
                .query_map([], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            ids
        };

        let mut errors: Vec<String> = Vec::new();
        for id in account_ids {
            if let Err(e) = self.sync_account(id).await {
                log::error!("Sync failed for account {}: {}", id, e);
                errors.push(format!("Account {id}: {e}"));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }

    fn get_last_uid(&self, account_id: i64) -> Result<i64, String> {
        let conn = db::get()?;
        Ok(conn
            .query_row(
                "SELECT last_seen_uid FROM accounts WHERE id = ?1",
                rusqlite::params![account_id],
                |row| row.get(0),
            )
            .unwrap_or(0))
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

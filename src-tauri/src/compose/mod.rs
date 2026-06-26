use crate::commands::models::AttachmentPayload;
use crate::db;
use crate::oauth::{ensure_oauth_email, OAuthProvider};
use crate::smtp_client::SmtpConnection;
use crate::threading::ThreadingService;

const MAX_ATTACHMENT_TOTAL_BYTES: usize = 25 * 1024 * 1024;

struct QueueRow {
    id: i64,
    account_id: i64,
    to: String,
    cc: Option<String>,
    bcc: Option<String>,
    subject: String,
    body_html: Option<String>,
    body_text: Option<String>,
    retry_count: i64,
    attachments_data: Option<Vec<u8>>,
    in_reply_to: Option<String>,
    references_json: Option<String>,
}

pub struct ComposeService;

impl ComposeService {
    pub fn new() -> Self {
        ComposeService
    }

    pub async fn send_email(
        &self,
        account_id: i64,
        to: &str,
        cc: Option<&str>,
        bcc: Option<&str>,
        subject: &str,
        body_html: &str,
        body_text: &str,
        attachments: Option<Vec<AttachmentPayload>>,
        in_reply_to: Option<&str>,
        references: Option<Vec<String>>,
    ) -> Result<(), String> {
        if let Some(ref atts) = attachments {
            let total: usize = atts.iter().map(|a| a.data.len()).sum();
            if total > MAX_ATTACHMENT_TOTAL_BYTES {
                return Err(format!(
                    "Attachments total {} bytes, exceeding the 25MB limit ({} bytes)",
                    total, MAX_ATTACHMENT_TOTAL_BYTES
                ));
            }
        }

        let (provider_type, smtp_host, smtp_port, smtp_encryption, email_address) = {
            let conn = db::get()?;
            conn.query_row(
                "SELECT provider_type, smtp_host, smtp_port, smtp_encryption, email_address \
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

        let host = smtp_host.ok_or("No SMTP host configured")?;
        let port = smtp_port.ok_or("No SMTP port configured")?;
        let encryption = smtp_encryption.ok_or("No SMTP encryption configured")?;

        if provider_type == "gmail_oauth" || provider_type == "microsoft_oauth" {
            let provider = OAuthProvider::from_str(&provider_type)
                .ok_or_else(|| format!("Invalid provider: {}", provider_type))?;
            let email_address =
                ensure_oauth_email(account_id, &provider, &email_address).await?;
            SmtpConnection::send_oauth(
                account_id,
                &host,
                port,
                &encryption,
                &email_address,
                to,
                cc,
                bcc,
                subject,
                body_html,
                body_text,
                attachments.as_deref(),
                in_reply_to,
                references.as_deref(),
            )
            .await
        } else {
            SmtpConnection::send_plain(
                account_id,
                &host,
                port,
                &encryption,
                &email_address,
                to,
                cc,
                bcc,
                subject,
                body_html,
                body_text,
                attachments.as_deref(),
                in_reply_to,
                references.as_deref(),
            )
            .await
        }
    }

    pub async fn queue_email(
        &self,
        account_id: i64,
        to: &str,
        cc: Option<&str>,
        bcc: Option<&str>,
        subject: &str,
        body_html: &str,
        body_text: &str,
        attachments: Option<Vec<AttachmentPayload>>,
        in_reply_to: Option<&str>,
        references: Option<&[String]>,
        defer_seconds: Option<i64>,
    ) -> Result<i64, String> {
        let (attachments_json, attachments_blob) = match &attachments {
            Some(atts) if !atts.is_empty() => {
                let metas: Vec<serde_json::Value> = atts
                    .iter()
                    .map(|a| {
                        serde_json::json!({
                            "filename": a.filename,
                            "mime_type": a.mime_type,
                            "size_bytes": a.data.len(),
                        })
                    })
                    .collect();
                let meta_json = serde_json::to_string(&metas).unwrap_or_else(|_| "[]".to_string());
                let blob = serde_json::to_vec(atts).map_err(|e| format!("Serialize attachments: {}", e))?;
                (Some(meta_json), Some(blob))
            }
            _ => (None, None),
        };

        let now = chrono::Utc::now().timestamp();
        let (status, send_after) = match defer_seconds {
            Some(secs) if secs > 0 => ("sending", Some(now + secs)),
            _ => ("pending", None),
        };
        let refs_json = references.map(|r| serde_json::to_string(r).unwrap_or_else(|_| "[]".to_string()));

        let conn = db::get()?;
        conn.execute(
            "INSERT INTO send_queue \
             (account_id, to_json, cc_json, bcc_json, subject, body_html, body_text, \
              attachments_meta, attachments_data, in_reply_to, \"references\", status, \
              send_after, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
            rusqlite::params![
                account_id,
                to,
                cc,
                bcc,
                subject,
                body_html,
                body_text,
                attachments_json,
                attachments_blob,
                in_reply_to,
                refs_json,
                status,
                send_after,
                now,
            ],
        )
        .map_err(|e| format!("Failed to queue email: {}", e))?;
        Ok(conn.last_insert_rowid())
    }

    pub async fn process_queue(&self) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp();
        let items: Vec<QueueRow> = {
            let conn = db::get()?;
            let mut stmt = conn
                .prepare(
                    "SELECT id, account_id, to_json, cc_json, bcc_json, subject, \
                     body_html, body_text, retry_count, attachments_data, \
                     in_reply_to, \"references\" \
                     FROM send_queue WHERE status IN ('pending','sending') AND retry_count < 5 \
                     AND (next_retry_at IS NULL OR next_retry_at <= ?1) \
                     AND (send_after IS NULL OR send_after <= ?1) \
                     ORDER BY send_after IS NOT NULL, id",
                )
                .map_err(|e| e.to_string())?;

            let rows: Vec<_> = stmt
                .query_map(rusqlite::params![now], |row| {
                    Ok(QueueRow {
                        id: row.get(0)?,
                        account_id: row.get(1)?,
                        to: row.get(2)?,
                        cc: row.get(3)?,
                        bcc: row.get(4)?,
                        subject: row.get(5)?,
                        body_html: row.get(6)?,
                        body_text: row.get(7)?,
                        retry_count: row.get(8)?,
                        attachments_data: row.get(9)?,
                        in_reply_to: row.get(10)?,
                        references_json: row.get(11)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.map_err(|e| log::warn!("queue row map: {e}")).ok())
                .collect();
            rows
        };

        for row in items {
            self.process_queue_row(&row).await?;
        }

        Ok(())
    }

    async fn process_queue_row(&self, row: &QueueRow) -> Result<(), String> {
        self.process_queue_item(
            row.id,
            row.account_id,
            row.to.clone(),
            row.cc.clone(),
            row.bcc.clone(),
            row.subject.clone(),
            row.body_html.clone(),
            row.body_text.clone(),
            row.retry_count,
            row.attachments_data.clone(),
            row.in_reply_to.clone(),
            row.references_json.clone(),
        )
        .await
    }

    pub async fn process_queue_item(
        &self,
        id: i64,
        account_id: i64,
        to: String,
        cc: Option<String>,
        bcc: Option<String>,
        subject: String,
        body_html: Option<String>,
        body_text: Option<String>,
        retry_count: i64,
        attachments_data: Option<Vec<u8>>,
        in_reply_to: Option<String>,
        references_json: Option<String>,
    ) -> Result<(), String> {
        let attachments: Option<Vec<AttachmentPayload>> = attachments_data
            .as_deref()
            .and_then(|blob| serde_json::from_slice(blob).ok());

        let references: Option<Vec<String>> = references_json
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok());

        let result = self
            .send_email(
                account_id,
                &to,
                cc.as_deref(),
                bcc.as_deref(),
                &subject,
                body_html.as_deref().unwrap_or(""),
                body_text.as_deref().unwrap_or(""),
                attachments,
                in_reply_to.as_deref(),
                references.clone(),
            )
            .await;

        match result {
            Ok(()) => {
                {
                    let conn = db::get()?;
                    conn.execute(
                        "UPDATE send_queue SET status = 'sent', sent_at = strftime('%s','now') WHERE id = ?1",
                        rusqlite::params![id],
                    )
                    .map_err(|e| e.to_string())?;
                }

                let to_for_sent = to.clone();
                let cc_for_sent = cc.clone();
                let bcc_for_sent = bcc.clone();
                let subject_for_sent = subject.clone();
                let body_html_for_sent = body_html.clone().unwrap_or_default();
                let body_text_for_sent = body_text.clone().unwrap_or_default();
                let in_reply_to_for_sent = in_reply_to.clone();
                let refs_for_sent = references.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    crate::insert_sent_copy(
                        account_id,
                        &to_for_sent,
                        cc_for_sent.as_deref(),
                        bcc_for_sent.as_deref(),
                        &subject_for_sent,
                        &body_html_for_sent,
                        &body_text_for_sent,
                        in_reply_to_for_sent.as_deref(),
                        refs_for_sent.as_deref(),
                    )
                })
                .await;
                let _ = tokio::task::spawn_blocking(move || {
                    ThreadingService::new().rebuild_threads_for_account(account_id)
                })
                .await;
            }
            Err(e) => {
                log::warn!("Send queue item {} failed: {}", id, e);
                let new_retry = retry_count + 1;
                let backoff_secs = std::cmp::min(2i64.pow(new_retry as u32), 300);
                let next_retry = chrono::Utc::now().timestamp() + backoff_secs;
                let conn = db::get()?;
                if new_retry >= 5 {
                    conn.execute(
                        "UPDATE send_queue SET status = 'failed', retry_count = ?1 WHERE id = ?2",
                        rusqlite::params![new_retry, id],
                    )
                    .map_err(|e| e.to_string())?;
                } else {
                    conn.execute(
                        "UPDATE send_queue SET retry_count = ?1, next_retry_at = ?2 WHERE id = ?3",
                        rusqlite::params![new_retry, next_retry, id],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }

        Ok(())
    }
}

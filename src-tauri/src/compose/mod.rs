use crate::db;
use crate::oauth::{ensure_oauth_email, OAuthProvider};
use crate::smtp_client::SmtpConnection;

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
        _attachments: Option<Vec<String>>,
        in_reply_to: Option<&str>,
        references: Option<Vec<String>>,
    ) -> Result<(), String> {
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
        _attachments: Option<Vec<String>>,
        _in_reply_to: Option<&str>,
        _references: Option<Vec<String>>,
    ) -> Result<(), String> {
        let conn = db::get()?;
        conn.execute(
            "INSERT INTO send_queue \
             (account_id, to_json, cc_json, bcc_json, subject, body_html, body_text, status) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending')",
            rusqlite::params![
                account_id,
                to,
                cc,
                bcc,
                subject,
                body_html,
                body_text,
            ],
        )
        .map_err(|e| format!("Failed to queue email: {}", e))?;
        Ok(())
    }

    pub async fn process_queue(&self) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp();
        let items: Vec<(i64, i64, String, Option<String>, Option<String>, String, Option<String>, Option<String>, i64)> = {
            let conn = db::get()?;
            let mut stmt = conn
                .prepare(
                    "SELECT id, account_id, to_json, cc_json, bcc_json, subject, \
                     body_html, body_text, retry_count \
                     FROM send_queue WHERE status = 'pending' AND retry_count < 5 \
                     AND (next_retry_at IS NULL OR next_retry_at <= ?1)",
                )
                .map_err(|e| e.to_string())?;

            let rows: Vec<_> = stmt
                .query_map(rusqlite::params![now], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            rows
        };

        for (id, account_id, to, cc, bcc, subject, body_html, body_text, retry_count) in items {
            let result = self
                .send_email(
                    account_id,
                    &to,
                    cc.as_deref(),
                    bcc.as_deref(),
                    &subject,
                    body_html.as_deref().unwrap_or(""),
                    body_text.as_deref().unwrap_or(""),
                    None,
                    None,
                    None,
                )
                .await;

            match result {
                Ok(()) => {
                    let conn = db::get()?;
                    conn.execute(
                        "UPDATE send_queue SET status = 'sent', sent_at = strftime('%s','now') WHERE id = ?1",
                        rusqlite::params![id],
                    )
                    .map_err(|e| e.to_string())?;
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
        }

        Ok(())
    }
}

use crate::{db, imap_client, oauth};
use crate::imap_client::ImapSession;

pub struct ImapContext {
    pub account_id: i64,
    pub provider_type: String,
    pub imap_host: Option<String>,
    pub imap_port: Option<i64>,
    pub imap_encryption: Option<String>,
    pub email_address: String,
    pub imap_uid: Option<i64>,
    pub folder: String,
    pub thread_id: Option<i64>,
}

pub fn load_email_imap_context(email_id: i64) -> Result<ImapContext, String> {
    let conn = db::get()?;
    conn.query_row(
        "SELECT e.account_id, a.provider_type, a.imap_host, a.imap_port, a.imap_encryption, \
                a.email_address, e.imap_uid, e.folder, e.thread_id \
         FROM emails e JOIN accounts a ON e.account_id = a.id \
         WHERE e.id = ?1",
        rusqlite::params![email_id],
        |row| {
            Ok(ImapContext {
                account_id: row.get(0)?,
                provider_type: row.get(1)?,
                imap_host: row.get(2)?,
                imap_port: row.get(3)?,
                imap_encryption: row.get(4)?,
                email_address: row.get(5)?,
                imap_uid: row.get(6)?,
                folder: row.get(7)?,
                thread_id: row.get(8)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

pub async fn open_session(
    account_id: i64,
    provider_type: &str,
    host: &str,
    port: i64,
    encryption: &str,
    email_address: &str,
) -> Result<ImapSession, String> {
    if provider_type == "gmail_oauth" || provider_type == "microsoft_oauth" {
        let provider = oauth::OAuthProvider::from_str(provider_type)
            .ok_or_else(|| format!("Invalid provider: {}", provider_type))?;
        imap_client::ImapConnection::connect_oauth(account_id, &provider, email_address).await
    } else {
        imap_client::ImapConnection::connect_plain(account_id, host, port, encryption, email_address).await
    }
}

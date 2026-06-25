use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Folder {
    pub id: i64,
    pub account_id: i64,
    pub name: String,
    pub imap_name: String,
    pub special_use: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Account {
    pub id: i64,
    pub provider_type: String,
    pub display_name: String,
    pub email_address: String,
    pub imap_host: Option<String>,
    pub imap_port: Option<i64>,
    pub imap_encryption: Option<String>,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<i64>,
    pub smtp_encryption: Option<String>,
    pub last_seen_uid: i64,
    pub created_at: i64,
    pub needs_reauth: bool,
    pub sync_error: Option<String>,
    pub sync_error_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Thread {
    pub id: i64,
    pub account_id: i64,
    pub subject: Option<String>,
    pub latest_date: i64,
    pub message_count: i64,
    pub is_read: bool,
    pub is_flagged: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EmailAddress {
    pub name: String,
    pub address: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AttachmentMeta {
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub local_path: Option<String>,
    pub part_index: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AttachmentPayload {
    pub filename: String,
    pub mime_type: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Email {
    pub id: i64,
    pub thread_id: i64,
    pub account_id: i64,
    pub imap_uid: Option<i64>,
    pub message_id: String,
    pub in_reply_to: Option<String>,
    #[serde(rename = "references")]
    pub references_field: Option<Vec<String>>,
    pub subject: Option<String>,
    #[serde(rename = "from")]
    pub from_field: Vec<EmailAddress>,
    #[serde(rename = "to")]
    pub to_field: Vec<EmailAddress>,
    #[serde(rename = "cc")]
    pub cc_field: Option<Vec<EmailAddress>>,
    #[serde(rename = "bcc")]
    pub bcc_field: Option<Vec<EmailAddress>>,
    pub date_rfc2822: Option<String>,
    pub received_at: i64,
    pub body_text: Option<String>,
    pub body_html: Option<String>,
    pub is_read: bool,
    pub folder: String,
    pub labels: Vec<String>,
    pub attachments_meta: Option<Vec<AttachmentMeta>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SendQueueItem {
    pub id: i64,
    pub account_id: i64,
    #[serde(rename = "to")]
    pub to_field: Vec<EmailAddress>,
    #[serde(rename = "cc")]
    pub cc_field: Option<Vec<EmailAddress>>,
    #[serde(rename = "bcc")]
    pub bcc_field: Option<Vec<EmailAddress>>,
    pub subject: String,
    pub body_html: Option<String>,
    pub body_text: Option<String>,
    pub attachments_meta: Option<Vec<AttachmentMeta>>,
    pub status: String,
    pub retry_count: i64,
    pub created_at: i64,
    pub sent_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AiConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub default_tone: String,
    pub output_language: String,
    pub custom_instructions: String,
}

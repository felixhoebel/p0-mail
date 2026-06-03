export type ProviderType = "gmail_oauth" | "microsoft_oauth" | "imap";
export type EncryptionType = "SSL" | "STARTTLS";
export type SendStatus = "pending" | "sent" | "failed";
export type AiTone = "Professional" | "Friendly" | "Concise";

export interface Account {
  id: number;
  provider_type: ProviderType;
  display_name: string;
  email_address: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_encryption: EncryptionType | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_encryption: EncryptionType | null;
  last_seen_uid: number;
  created_at: number;
  needs_reauth: boolean;
}

export interface Thread {
  id: number;
  account_id: number;
  subject: string | null;
  latest_date: number;
  message_count: number;
  is_read: boolean;
}

export interface EmailAddress {
  name: string;
  address: string;
}

export interface AttachmentMeta {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  localPath?: string;
}

export interface Email {
  id: number;
  thread_id: number;
  account_id: number;
  imap_uid: number | null;
  message_id: string;
  in_reply_to: string | null;
  references: string[] | null;
  subject: string | null;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[] | null;
  bcc: EmailAddress[] | null;
  date_rfc2822: string | null;
  received_at: number;
  body_text: string | null;
  body_html: string | null;
  is_read: boolean;
  folder: string;
  attachments_meta: AttachmentMeta[] | null;
}

export interface SendQueueItem {
  id: number;
  account_id: number;
  to: EmailAddress[];
  cc: EmailAddress[] | null;
  bcc: EmailAddress[] | null;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  attachments_meta: AttachmentMeta[] | null;
  status: SendStatus;
  retry_count: number;
  created_at: number;
  sent_at: number | null;
}

export interface AiConfig {
  base_url: string;
  api_key: string;
  model: string;
  default_tone: AiTone;
}

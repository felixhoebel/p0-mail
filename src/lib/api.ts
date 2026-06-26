import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Account,
  Folder,
  Thread,
  Email,
  SendQueueItem,
  AiConfig,
  AiStreamEvent,
  ProviderType,
  EncryptionType,
  AiTone,
  AttachmentPayload,
} from "@/types";

// Account Management
export async function listAccounts(): Promise<Account[]> {
  return invoke("list_accounts");
}

export async function addOauthAccount(
  provider: ProviderType,
): Promise<Account> {
  return invoke("add_oauth_account", { provider });
}

export async function addImapAccount(params: {
  displayName: string;
  emailAddress: string;
  imapHost: string;
  imapPort: number;
  imapEncryption: EncryptionType;
  smtpHost: string;
  smtpPort: number;
  smtpEncryption: EncryptionType;
  username: string;
  password: string;
}): Promise<Account> {
  return invoke("add_imap_account", params);
}

export async function removeAccount(accountId: number): Promise<void> {
  return invoke("remove_account", { accountId });
}

export async function listFolders(accountId: number): Promise<Folder[]> {
  return invoke("list_folders", { accountId });
}

export async function reauthOauthAccount(accountId: number): Promise<Account> {
  return invoke("reauth_oauth_account", { accountId });
}

// Sync
export async function triggerSync(accountId?: number): Promise<void> {
  return invoke("trigger_sync", { accountId });
}

export async function setAccountSyncEnabled(
  accountId: number,
  enabled: boolean,
): Promise<void> {
  return invoke("set_account_sync_enabled", { accountId, enabled });
}

export interface MailSyncedEvent {
  account_id: number;
  new_count: number;
}

export function onMailSynced(
  callback: (event: MailSyncedEvent) => void,
): Promise<UnlistenFn> {
  return listen("mail-synced", (e) =>
    callback(e.payload as MailSyncedEvent),
  );
}

export function onOpenThread(
  callback: (threadId: number) => void,
): Promise<UnlistenFn> {
  return listen("open-thread", (e) => callback(Number(e.payload)));
}

export function onAiConfigChanged(callback: () => void): Promise<UnlistenFn> {
  return listen("ai-config-changed", () => callback());
}

// Threads & Emails
export async function listThreads(params: {
  accountId?: number;
  folder?: string;
  limit?: number;
  offset?: number;
}): Promise<Thread[]> {
  return invoke("list_threads", params);
}

export async function getEmails(threadId: number): Promise<Email[]> {
  return invoke("get_emails", { threadId });
}

export async function getEmail(emailId: number): Promise<Email> {
  return invoke("get_email", { emailId });
}

// Search
export async function searchEmails(query: string): Promise<Thread[]> {
  return invoke("search_emails", { query });
}

export async function reindexAccount(accountId: number): Promise<void> {
  return invoke("reindex_account", { accountId });
}

// Mail Actions
export async function markRead(emailId: number, read: boolean): Promise<void> {
  return invoke("mark_read", { emailId, read });
}

export async function markAllRead(params: {
  accountId?: number;
  folder?: string;
}): Promise<number> {
  return invoke("mark_all_read", params);
}

export async function archiveEmail(emailId: number): Promise<void> {
  return invoke("archive_email", { emailId });
}

export async function deleteEmail(emailId: number): Promise<void> {
  return invoke("delete_email", { emailId });
}

// Compose & Send
export async function sendEmail(params: {
  accountId: number;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  attachments?: AttachmentPayload[];
  inReplyTo?: string;
  references?: string[];
}): Promise<void> {
  return invoke("send_email", params);
}

export async function queueEmail(params: {
  accountId: number;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  attachments?: AttachmentPayload[];
  inReplyTo?: string;
  references?: string[];
}): Promise<void> {
  return invoke("queue_email", params);
}

export async function processSendQueue(): Promise<void> {
  return invoke("process_send_queue");
}

export async function getSendQueue(): Promise<SendQueueItem[]> {
  return invoke("get_send_queue");
}

export async function retrySendQueueItem(queueId: number): Promise<void> {
  return invoke("retry_send_queue_item", { queueId });
}

export async function saveDraft(params: {
  accountId: number;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  draftId?: number;
}): Promise<number> {
  return invoke("save_draft", params);
}

export async function listDrafts(accountId?: number): Promise<SendQueueItem[]> {
  return invoke("list_drafts", { accountId });
}

export async function deleteDraft(draftId: number): Promise<void> {
  return invoke("delete_draft", { draftId });
}

// Body Fetch
export async function fetchEmailBody(emailId: number): Promise<void> {
  return invoke("fetch_email_body", { emailId });
}

export async function fetchThreadBodies(threadId: number): Promise<number> {
  return invoke("fetch_thread_bodies", { threadId });
}

export async function downloadAttachment(
  emailId: number,
  partIndex: string,
  downloadDir: string,
): Promise<string> {
  return invoke("download_attachment", { emailId, partIndex, downloadDir });
}

export async function fetchRecentBodies(
  accountId: number,
  limit: number,
): Promise<number> {
  return invoke("fetch_recent_bodies", { accountId, limit });
}

// AI
export async function getAiConfig(): Promise<AiConfig | null> {
  return invoke("get_ai_config");
}

export async function setAiConfig(config: AiConfig): Promise<void> {
  return invoke("set_ai_config", { config });
}

export async function validateAiEndpoint(): Promise<boolean> {
  return invoke("validate_ai_endpoint");
}

export async function listAiModels(): Promise<string[]> {
  return invoke("list_ai_models");
}

export async function streamSummarizeThread(
  streamId: string,
  threadId: number,
  emailIds: number[],
  tone: AiTone,
): Promise<void> {
  return invoke("stream_summarize_thread", { streamId, threadId, emailIds, tone });
}

export async function streamDraftReply(
  streamId: string,
  threadId: number,
  emailIds: number[],
  tone: AiTone,
  summary?: string,
): Promise<void> {
  return invoke("stream_draft_reply", { streamId, threadId, emailIds, tone, summary });
}

export async function streamAiTransform(
  streamId: string,
  instruction: string,
  subject: string,
  text: string,
  tone: AiTone,
): Promise<void> {
  return invoke("stream_ai_transform", { streamId, instruction, subject, text, tone });
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function streamChatAboutEmails(
  streamId: string,
  emailIds: number[],
  question: string,
  history: ChatMessage[],
  tone: AiTone,
): Promise<void> {
  return invoke("stream_chat_about_emails", { streamId, emailIds, question, history, tone });
}

function normalizeAiStreamEvent(raw: Record<string, unknown>): AiStreamEvent {
  const kind = raw.tokenKind ?? raw.token_kind ?? "content";
  return {
    streamId: String(raw.streamId ?? raw.stream_id ?? ""),
    token: String(raw.token ?? ""),
    tokenKind: kind === "thinking" ? "thinking" : "content",
    done: Boolean(raw.done),
  };
}

export function onAiStream(
  callback: (event: AiStreamEvent) => void,
): Promise<UnlistenFn> {
  return listen("ai-stream", (e) =>
    callback(normalizeAiStreamEvent(e.payload as Record<string, unknown>)),
  );
}

export function onAiStreamError(
  callback: (event: AiStreamEvent) => void,
): Promise<UnlistenFn> {
  return listen("ai-stream-error", (e) =>
    callback(normalizeAiStreamEvent(e.payload as Record<string, unknown>)),
  );
}

// Connectivity
export async function isOnline(): Promise<boolean> {
  return invoke("is_online");
}

export async function validateImapConnection(params: {
  displayName: string;
  emailAddress: string;
  imapHost: string;
  imapPort: number;
  imapEncryption: EncryptionType;
  smtpHost: string;
  smtpPort: number;
  smtpEncryption: EncryptionType;
  username: string;
  password: string;
}): Promise<boolean> {
  return invoke("validate_imap_connection", params);
}

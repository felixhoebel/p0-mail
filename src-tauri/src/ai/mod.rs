use crate::db;
use crate::email_parse;
use crate::imap_client::ImapConnection;
use crate::oauth::OAuthProvider;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: i64,
    stream: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelInfo {
    id: String,
    capabilities: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct AddressJson {
    name: Option<String>,
    address: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiStreamEvent {
    pub stream_id: String,
    pub token: String,
    pub token_kind: String,
    pub done: bool,
}

struct AiSettings {
    base_url: String,
    api_key: String,
    model: String,
    tone: String,
    output_language: String,
    custom_instructions: String,
}

pub struct AiService;

impl AiService {
    pub fn new() -> Self {
        AiService
    }

    pub async fn validate_endpoint(
        &self,
        base_url: &str,
        api_key: &str,
    ) -> Result<bool, String> {
        let url = format!("{}/v1/models", base_url.trim_end_matches('/'));
        let client = reqwest::Client::new();
        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;

        if resp.status().is_success() {
            let _: ModelsResponse = resp
                .json()
                .await
                .map_err(|e| format!("Invalid response: {}", e))?;
            Ok(true)
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            Err(format!("Endpoint returned {}: {}", status, body))
        }
    }

    pub async fn list_models(
        &self,
        base_url: &str,
        api_key: &str,
    ) -> Result<Vec<String>, String> {
        let url = format!("{}/v1/models", base_url.trim_end_matches('/'));
        let client = reqwest::Client::new();
        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Endpoint returned {}: {}", status, body));
        }

        let models: ModelsResponse = resp
            .json()
            .await
            .map_err(|e| format!("Invalid response: {}", e))?;

        let chat_models: Vec<String> = models
            .data
            .into_iter()
            .filter(|m| {
                m.capabilities
                    .as_ref()
                    .map(|caps| caps.iter().any(|c| c == "chat" || c == "completions"))
                    .unwrap_or(true)
            })
            .map(|m| m.id)
            .collect();

        Ok(chat_models)
    }

    pub async fn stream_summarize_thread(
        &self,
        app: &AppHandle,
        stream_id: &str,
        thread_id: i64,
        email_ids: &[i64],
        tone: &str,
    ) -> Result<(), String> {
        let settings = self.get_settings(tone).map_err(|e| {
            emit_stream_error(app, stream_id, &e);
            e
        })?;
        self.ensure_bodies_loaded(thread_id, email_ids)
            .await
            .map_err(|e| {
                emit_stream_error(app, stream_id, &e);
                e
            })?;
        let emails = self.resolve_thread_emails(thread_id, email_ids).map_err(|e| {
            emit_stream_error(app, stream_id, &e);
            e
        })?;
        validate_thread_has_content(&emails).map_err(|e| {
            emit_stream_error(app, stream_id, &e);
            e
        })?;
        let prompt = self.build_summary_prompt(&emails, &settings);
        self.stream_chat(
            app,
            stream_id,
            &settings.base_url,
            &settings.api_key,
            &settings.model,
            prompt,
            4096,
        )
        .await
    }

    pub async fn stream_draft_reply(
        &self,
        app: &AppHandle,
        stream_id: &str,
        thread_id: i64,
        email_ids: &[i64],
        tone: &str,
        summary: Option<&str>,
    ) -> Result<(), String> {
        let settings = self.get_settings(tone).map_err(|e| {
            emit_stream_error(app, stream_id, &e);
            e
        })?;
        self.ensure_bodies_loaded(thread_id, email_ids)
            .await
            .map_err(|e| {
                emit_stream_error(app, stream_id, &e);
                e
            })?;
        let emails = self.resolve_thread_emails(thread_id, email_ids).map_err(|e| {
            emit_stream_error(app, stream_id, &e);
            e
        })?;
        validate_thread_has_content(&emails).map_err(|e| {
            emit_stream_error(app, stream_id, &e);
            e
        })?;
        let prompt = self.build_reply_prompt(&emails, &settings, summary);
        self.stream_chat(
            app,
            stream_id,
            &settings.base_url,
            &settings.api_key,
            &settings.model,
            prompt,
            8192,
        )
        .await
    }

    pub async fn stream_ai_transform(
        &self,
        app: &AppHandle,
        stream_id: &str,
        tone: &str,
        instruction: &str,
        subject: &str,
        text: &str,
    ) -> Result<(), String> {
        let text = text.trim();
        if text.is_empty() {
            let err = "Select some text to transform.".to_string();
            emit_stream_error(app, stream_id, &err);
            return Err(err);
        }

        let settings = self.get_settings(tone).map_err(|e| {
            emit_stream_error(app, stream_id, &e);
            e
        })?;
        let prompt = self.build_ai_transform_prompt(&settings, instruction, subject, text);
        self.stream_chat(
            app,
            stream_id,
            &settings.base_url,
            &settings.api_key,
            &settings.model,
            prompt,
            4096,
        )
        .await
    }

    pub async fn stream_chat_about_emails(
        &self,
        app: &AppHandle,
        stream_id: &str,
        email_ids: &[i64],
        question: &str,
        history: Vec<ChatMessage>,
        tone: &str,
    ) -> Result<(), String> {
        let question = question.trim();
        if question.is_empty() {
            let err = "Please enter a question.".to_string();
            emit_stream_error(app, stream_id, &err);
            return Err(err);
        }

        let settings = self.get_settings(tone).map_err(|e| {
            emit_stream_error(app, stream_id, &e);
            e
        })?;

        let emails = self.fetch_emails_by_ids(email_ids).map_err(|e| {
            emit_stream_error(app, stream_id, &e);
            e
        })?;

        validate_thread_has_content(&emails).map_err(|e| {
            emit_stream_error(app, stream_id, &e);
            e
        })?;

        let email_context = self.format_thread(&emails);
        let language = output_language_name(&settings.output_language);

        let mut system = format!(
            "You are an email assistant. The user has selected one or more emails and wants to chat about them. \
             Answer the user's questions based on the email content below. \
             If the answer is not in the emails, say so clearly. \
             Write your response entirely in {}. \
             Tone: {}. \
             Be concise and helpful. \
             \n\n--- EMAILS ---\n{}",
            language, settings.tone, email_context
        );
        append_custom_instructions(&mut system, &settings.custom_instructions);

        let mut messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: system,
            },
        ];
        messages.extend(history);
        messages.push(ChatMessage {
            role: "user".to_string(),
            content: question.to_string(),
        });

        self.stream_chat(
            app,
            stream_id,
            &settings.base_url,
            &settings.api_key,
            &settings.model,
            messages,
            4096,
        )
        .await
    }

    fn get_settings(&self, tone: &str) -> Result<AiSettings, String> {
        let conn = db::get()?;
        let base_url: String = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'ai_base_url'",
                [],
                |row| row.get(0),
            )
            .map_err(|_| "AI endpoint not configured".to_string())?;
        let model: String = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'ai_model'",
                [],
                |row| row.get(0),
            )
            .map_err(|_| "AI model not configured".to_string())?;
        let output_language: String = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'ai_output_language'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "en".to_string());
        let custom_instructions: String = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'ai_custom_instructions'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();
        let api_key = crate::secure::get_ai_api_key().unwrap_or_default();
        if api_key.is_empty() {
            return Err("AI API key not configured".to_string());
        }
        Ok(AiSettings {
            base_url,
            api_key,
            model,
            tone: tone.to_string(),
            output_language,
            custom_instructions,
        })
    }

    async fn ensure_bodies_loaded(
        &self,
        thread_id: i64,
        email_ids: &[i64],
    ) -> Result<(), String> {
        let missing: Vec<(i64, i64, String)> = {
            let conn = db::get()?;
            if email_ids.is_empty() {
                let mut stmt = conn
                    .prepare(
                        "SELECT e.id, e.account_id, e.folder \
                         FROM emails e \
                         WHERE e.thread_id = ?1 AND e.body_text IS NULL AND e.body_html IS NULL",
                    )
                    .map_err(|e| e.to_string())?;
                let rows: Vec<(i64, i64, String)> = stmt
                    .query_map(rusqlite::params![thread_id], |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                    })
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();
                rows
            } else {
                let placeholders = std::iter::repeat("?")
                    .take(email_ids.len())
                    .collect::<Vec<_>>()
                    .join(", ");
                let sql = format!(
                    "SELECT e.id, e.account_id, e.folder \
                     FROM emails e \
                     WHERE (e.thread_id = ?1 OR e.id IN ({})) \
                     AND e.body_text IS NULL AND e.body_html IS NULL",
                    placeholders
                );
                let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
                let mut params: Vec<Box<dyn rusqlite::types::ToSql>> =
                    vec![Box::new(thread_id)];
                for id in email_ids {
                    params.push(Box::new(*id));
                }
                let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                    params.iter().map(|p| p.as_ref()).collect();
                let rows: Vec<(i64, i64, String)> = stmt
                    .query_map(param_refs.as_slice(), |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                    })
                    .map_err(|e| e.to_string())?
                    .filter_map(|r| r.ok())
                    .collect();
                rows
            }
        };

        if missing.is_empty() {
            return Ok(());
        }

        let (provider_type, imap_host, imap_port, imap_encryption, email_address) = {
            let conn = db::get()?;
            let account_id = missing.first().map(|m| m.1).ok_or("No account")?;
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

        let mut session = if provider_type == "gmail_oauth" || provider_type == "microsoft_oauth"
        {
            let provider = OAuthProvider::from_str(&provider_type)
                .ok_or_else(|| format!("Invalid provider: {}", provider_type))?;
            ImapConnection::connect_oauth(missing[0].1, &provider, &email_address).await?
        } else {
            ImapConnection::connect_plain(
                missing[0].1,
                &host,
                port,
                &encryption,
                &email_address,
            )
            .await?
        };

        for (email_id, _, folder) in &missing {
            let uid: Option<i64> = {
                let conn = db::get()?;
                conn.query_row(
                    "SELECT imap_uid FROM emails WHERE id = ?1",
                    rusqlite::params![email_id],
                    |row| row.get(0),
                )
                .ok()
            };
            let uid = match uid {
                Some(u) => u,
                None => continue,
            };

            if tokio::time::timeout(std::time::Duration::from_secs(10), session.select(folder))
                .await
                .map(|r| r.is_ok())
                .unwrap_or(false)
            {
                if let Ok(raw) =
                    crate::imap_client::fetch_uid_message_raw(&mut session, uid as u32).await
                {
                    let _ = email_parse::apply_raw_message(*email_id, &raw);
                }
            }
        }

        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), session.logout()).await;
        Ok(())
    }

    fn resolve_thread_emails(
        &self,
        thread_id: i64,
        email_ids: &[i64],
    ) -> Result<Vec<ThreadEmail>, String> {
        let by_thread = self.fetch_thread_emails(thread_id)?;
        if !by_thread.is_empty() {
            return Ok(by_thread);
        }
        if !email_ids.is_empty() {
            return self.fetch_emails_by_ids(email_ids);
        }
        Err(
            "No emails found in thread. Sync your inbox and open the thread again."
                .to_string(),
        )
    }

    fn fetch_thread_emails(&self, thread_id: i64) -> Result<Vec<ThreadEmail>, String> {
        if thread_id <= 0 {
            return Ok(Vec::new());
        }
        let conn = db::get()?;
        let mut stmt = conn
            .prepare(
                "SELECT from_json, to_json, date_rfc2822, subject, body_text, body_html \
                 FROM emails WHERE thread_id = ?1 ORDER BY received_at ASC",
            )
            .map_err(|e| e.to_string())?;
        self.map_thread_email_rows(&mut stmt, rusqlite::params![thread_id])
    }

    fn fetch_emails_by_ids(&self, email_ids: &[i64]) -> Result<Vec<ThreadEmail>, String> {
        let conn = db::get()?;
        let placeholders = std::iter::repeat("?")
            .take(email_ids.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT from_json, to_json, date_rfc2822, subject, body_text, body_html \
             FROM emails WHERE id IN ({}) ORDER BY received_at ASC",
            placeholders
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let params: Vec<Box<dyn rusqlite::types::ToSql>> =
            email_ids.iter().map(|id| Box::new(*id) as Box<dyn rusqlite::types::ToSql>).collect();
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let emails = self.map_thread_email_rows(&mut stmt, param_refs.as_slice())?;
        if emails.is_empty() {
            return Err("No emails found in thread".to_string());
        }
        Ok(emails)
    }

    fn map_thread_email_rows<P: rusqlite::Params>(
        &self,
        stmt: &mut rusqlite::Statement<'_>,
        params: P,
    ) -> Result<Vec<ThreadEmail>, String> {
        let emails: Vec<ThreadEmail> = stmt
            .query_map(params, |row| {
                let from_str: String = row.get(0)?;
                let to_str: String = row.get(1)?;
                Ok(ThreadEmail {
                    from: format_address_json(&from_str),
                    to: format_address_json(&to_str),
                    date: row.get(2)?,
                    subject: row.get(3)?,
                    body_text: row.get(4)?,
                    body_html: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        Ok(emails)
    }

    fn build_summary_prompt(&self, emails: &[ThreadEmail], settings: &AiSettings) -> Vec<ChatMessage> {
        let thread_text = self.format_thread(emails);
        let language = output_language_name(&settings.output_language);

        let mut system = format!(
            "You are an email assistant. The email thread below may be in any language. \
             Summarize it into 3-5 concise bullet points written entirely in {}. \
             Tone: {}. \
             Do not add information not present in the thread. \
             Output only the bullet points, each starting with '•'. \
             Put your complete answer in the message content field.",
            language, settings.tone
        );
        append_custom_instructions(&mut system, &settings.custom_instructions);

        vec![
            ChatMessage {
                role: "system".to_string(),
                content: system,
            },
            ChatMessage {
                role: "user".to_string(),
                content: thread_text,
            },
        ]
    }

    fn build_reply_prompt(
        &self,
        emails: &[ThreadEmail],
        settings: &AiSettings,
        summary: Option<&str>,
    ) -> Vec<ChatMessage> {
        let thread_text = self.format_thread(emails);
        let language = output_language_name(&settings.output_language);

        let mut system = format!(
            "You are drafting an email reply on behalf of the user. \
             The thread below may be in any language. \
             Write a complete reply email in {} with salutation, body, and a signature placeholder. \
             Tone: {}. \
             Do not hallucinate facts not present in the thread. \
             Do not auto-send — the user will review and edit before sending. \
             Put your complete reply in the message content field.",
            language, settings.tone
        );
        append_custom_instructions(&mut system, &settings.custom_instructions);

        let mut user_content = String::new();
        if let Some(s) = summary {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                user_content.push_str(
                    "The following is an AI-generated summary of this thread. \
                     Use it as additional context when drafting the reply and refer to it where it helps:\n\n",
                );
                user_content.push_str(trimmed);
                user_content.push_str("\n\n--- THREAD ---\n\n");
            }
        }
        user_content.push_str(&thread_text);

        vec![
            ChatMessage {
                role: "system".to_string(),
                content: system,
            },
            ChatMessage {
                role: "user".to_string(),
                content: user_content,
            },
        ]
    }

    fn build_ai_transform_prompt(
        &self,
        settings: &AiSettings,
        instruction: &str,
        subject: &str,
        text: &str,
    ) -> Vec<ChatMessage> {
        let language = output_language_name(&settings.output_language);
        let subject_hint = if subject.trim().is_empty() {
            "(no subject)".to_string()
        } else {
            subject.trim().to_string()
        };

        let instruction_text = match instruction {
            "polish" => "Polish and improve the writing. Fix grammar, improve flow, and make it more natural and readable.",
            "shorten" => "Make it shorter while keeping all key points and intent. Be concise.",
            "expand" => "Expand on the ideas with more detail and elaboration.",
            "friendly" => "Rewrite in a friendly, warm, and approachable tone.",
            "professional" => "Rewrite in a professional, formal tone.",
            "concise" => "Rewrite to be concise, direct, and to the point.",
            _ => instruction,
        };

        let mut system = format!(
            "You are an email writing assistant. Transform the given text according to the instruction. \
             Write the output entirely in {}. \
             Preserve the user's intent and every fact — do not invent names, dates, or details. \
             Output only the transformed text, no explanations, no preamble, no quotation marks. \
             Put your complete output in the message content field.",
            language
        );
        append_custom_instructions(&mut system, &settings.custom_instructions);

        let user = format!(
            "Subject (for context): {}\nInstruction: {}\n\nText to transform:\n{}",
            subject_hint, instruction_text, text
        );

        vec![
            ChatMessage {
                role: "system".to_string(),
                content: system,
            },
            ChatMessage {
                role: "user".to_string(),
                content: user,
            },
        ]
    }

    fn format_thread(&self, emails: &[ThreadEmail]) -> String {
        let mut parts: Vec<String> = Vec::new();
        let mut total_chars: usize = 0;
        let char_budget: usize = 100_000;

        for email in emails.iter().rev() {
            let from = &email.from;
            let date = email.date.as_deref().unwrap_or("unknown date");
            let subject = email.subject.as_deref().unwrap_or("(no subject)");
            let body = email_body_text(email);
            let body = if body.trim().is_empty() {
                "(no body)".to_string()
            } else {
                body
            };

            let entry = format!(
                "From: {}\nDate: {}\nSubject: {}\n\n{}",
                from, date, subject, body
            );

            total_chars += entry.len();
            if total_chars > char_budget {
                parts.push("[... earlier messages truncated ...]".to_string());
                break;
            }

            parts.push(entry);
        }

        parts.reverse();
        parts.join("\n\n---\n\n")
    }

    async fn stream_chat(
        &self,
        app: &AppHandle,
        stream_id: &str,
        base_url: &str,
        api_key: &str,
        model: &str,
        messages: Vec<ChatMessage>,
        max_tokens: i64,
    ) -> Result<(), String> {
        let url = format!(
            "{}/v1/chat/completions",
            base_url.trim_end_matches('/')
        );

        let request = ChatRequest {
            model: model.to_string(),
            messages,
            temperature: 0.3,
            max_tokens,
            stream: true,
        };

        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .timeout(std::time::Duration::from_secs(120))
            .send()
            .await
            .map_err(|e| {
                let err = format!("AI request failed: {}", e);
                emit_stream_error(app, stream_id, &err);
                err
            })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let err = format!("AI API error {}: {}", status, body);
            emit_stream_error(app, stream_id, &err);
            return Err(err);
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();

        loop {
            let chunk_result = match tokio::time::timeout(
                std::time::Duration::from_secs(60),
                stream.next(),
            )
            .await
            {
                Ok(opt) => match opt {
                    Some(r) => r,
                    None => break,
                },
                Err(_) => {
                    let err = "AI stream chunk timed out after 60s".to_string();
                    emit_stream_error(app, stream_id, &err);
                    return Err(err);
                }
            };

            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    let err = format!("Stream error: {}", e);
                    emit_stream_error(app, stream_id, &err);
                    return Err(err);
                }
            };

            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(line_end) = buffer.find('\n') {
                let line = buffer[..line_end].to_string();
                buffer = buffer[line_end + 1..].to_string();

                if process_stream_line(app, stream_id, &line)? {
                    return Ok(());
                }
            }
        }

        if !buffer.trim().is_empty() {
            for line in buffer.lines() {
                if process_stream_line(app, stream_id, line)? {
                    return Ok(());
                }
            }
        }

        emit_stream_token(app, stream_id, "", "content", true);
        Ok(())
    }
}

fn emit_stream_token(app: &AppHandle, stream_id: &str, token: &str, token_kind: &str, done: bool) {
    let _ = app.emit(
        "ai-stream",
        AiStreamEvent {
            stream_id: stream_id.to_string(),
            token: token.to_string(),
            token_kind: token_kind.to_string(),
            done,
        },
    );
}

fn emit_stream_error(app: &AppHandle, stream_id: &str, message: &str) {
    let _ = app.emit(
        "ai-stream-error",
        AiStreamEvent {
            stream_id: stream_id.to_string(),
            token: message.to_string(),
            token_kind: "content".to_string(),
            done: true,
        },
    );
}

fn extract_stream_parts(json_str: &str) -> (Option<String>, Option<String>) {
    let v: serde_json::Value = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return (None, None),
    };

    let thinking = read_json_str(
        &v,
        &[
            "/choices/0/delta/reasoning_content",
            "/choices/0/message/reasoning_content",
            "/delta/reasoning_content",
        ],
    );

    let content = read_json_str(
        &v,
        &[
            "/choices/0/delta/content",
            "/choices/0/delta/text",
            "/choices/0/text",
            "/choices/0/message/content",
            "/delta/content",
            "/delta/text",
            "/content",
            "/text",
        ],
    );

    (content, thinking)
}

fn read_json_str(v: &serde_json::Value, pointers: &[&str]) -> Option<String> {
    for pointer in pointers {
        if let Some(s) = v.pointer(pointer).and_then(|c| c.as_str()) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

fn process_stream_line(app: &AppHandle, stream_id: &str, line: &str) -> Result<bool, String> {
    let line = line.trim();
    if line.is_empty() || line.starts_with(':') {
        return Ok(false);
    }

    let json_str = if let Some(payload) = line.strip_prefix("data:") {
        let payload = payload.trim();
        if payload.is_empty() {
            return Ok(false);
        }
        if payload == "[DONE]" {
            emit_stream_token(app, stream_id, "", "content", true);
            return Ok(true);
        }
        payload
    } else if line.starts_with('{') {
        line
    } else {
        return Ok(false);
    };

    let (content, thinking) = extract_stream_parts(json_str);
    if let Some(token) = thinking {
        emit_stream_token(app, stream_id, &token, "thinking", false);
    }
    if let Some(token) = content {
        emit_stream_token(app, stream_id, &token, "content", false);
    }

    Ok(false)
}

fn email_body_text(email: &ThreadEmail) -> String {
    match (
        email.body_text.as_deref(),
        email.body_html.as_deref(),
    ) {
        (Some(t), _) if !t.trim().is_empty() => t.to_string(),
        (_, Some(h)) => email_parse::strip_html_tags(h),
        _ => String::new(),
    }
}

fn validate_thread_has_content(emails: &[ThreadEmail]) -> Result<(), String> {
    let has_body = emails.iter().any(|e| !email_body_text(e).trim().is_empty());
    if has_body {
        return Ok(());
    }
    Err(
        "Email bodies are empty. Wait for messages to load or run Sync, then try again."
            .to_string(),
    )
}

fn output_language_name(code: &str) -> &'static str {
    match code {
        "de" => "German",
        "no" => "Norwegian",
        _ => "English",
    }
}

fn append_custom_instructions(system: &mut String, instructions: &str) {
    let trimmed = instructions.trim();
    if trimmed.is_empty() {
        return;
    }
    system.push_str("\n\nAdditional instructions from the user:\n");
    system.push_str(trimmed);
}

fn format_address_json(json: &str) -> String {
    if let Ok(addrs) = serde_json::from_str::<Vec<AddressJson>>(json) {
        if !addrs.is_empty() {
            return addrs
                .iter()
                .map(|a| match &a.name {
                    Some(name) if !name.is_empty() => format!("{} <{}>", name, a.address),
                    _ => a.address.clone(),
                })
                .collect::<Vec<_>>()
                .join(", ");
        }
    }
    json.to_string()
}

struct ThreadEmail {
    from: String,
    #[allow(dead_code)]
    to: String,
    date: Option<String>,
    subject: Option<String>,
    body_text: Option<String>,
    body_html: Option<String>,
}

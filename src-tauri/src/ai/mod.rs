use crate::db;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    #[allow(dead_code)]
    data: Vec<serde_json::Value>,
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

    pub async fn summarize_thread(
        &self,
        thread_id: i64,
        tone: &str,
    ) -> Result<String, String> {
        let (base_url, api_key, model) = self.get_config()?;
        let emails = self.get_thread_emails(thread_id)?;
        let prompt = self.build_summary_prompt(&emails, tone);
        let content = self
            .chat_completion(&base_url, &api_key, &model, prompt, 1024)
            .await?;
        Ok(content)
    }

    pub async fn draft_reply(
        &self,
        thread_id: i64,
        tone: &str,
    ) -> Result<String, String> {
        let (base_url, api_key, model) = self.get_config()?;
        let emails = self.get_thread_emails(thread_id)?;
        let prompt = self.build_reply_prompt(&emails, tone);
        let content = self
            .chat_completion(&base_url, &api_key, &model, prompt, 2048)
            .await?;
        Ok(content)
    }

    fn get_config(&self) -> Result<(String, String, String), String> {
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
        let api_key = crate::secure::get_ai_api_key().unwrap_or_default();
        if api_key.is_empty() {
            return Err("AI API key not configured".to_string());
        }
        Ok((base_url, api_key, model))
    }

    fn get_thread_emails(&self, thread_id: i64) -> Result<Vec<ThreadEmail>, String> {
        let conn = db::get()?;
        let mut stmt = conn
            .prepare(
                "SELECT from_json, to_json, date_rfc2822, subject, body_text \
                 FROM emails WHERE thread_id = ?1 ORDER BY received_at ASC",
            )
            .map_err(|e| e.to_string())?;

        let emails: Vec<ThreadEmail> = stmt
            .query_map(rusqlite::params![thread_id], |row| {
                let from_str: String = row.get(0)?;
                let to_str: String = row.get(1)?;
                Ok(ThreadEmail {
                    from: from_str,
                    to: to_str,
                    date: row.get(2)?,
                    subject: row.get(3)?,
                    body_text: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        if emails.is_empty() {
            return Err("No emails found in thread".to_string());
        }

        Ok(emails)
    }

    fn build_summary_prompt(&self, emails: &[ThreadEmail], tone: &str) -> Vec<ChatMessage> {
        let thread_text = self.format_thread(emails);
        let last_lang_hint = self.detect_language_hint(emails);

        let system = format!(
            "You are an email assistant. Summarize the following email thread into 3-5 concise bullet points. \
             Match the language of the conversation{}. \
             Tone: {}. \
             Do not add information not present in the thread. \
             Output only the bullet points, each starting with '•'.",
            last_lang_hint, tone
        );

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

    fn build_reply_prompt(&self, emails: &[ThreadEmail], tone: &str) -> Vec<ChatMessage> {
        let thread_text = self.format_thread(emails);
        let last_lang_hint = self.detect_language_hint(emails);

        let system = format!(
            "You are drafting an email reply on behalf of the user. \
             Based on the thread below, write a complete reply email with salutation, body, and a signature placeholder. \
             Match the language of the conversation{}. \
             Tone: {}. \
             Do not hallucinate facts not present in the thread. \
             Do not auto-send — the user will review and edit before sending.",
            last_lang_hint, tone
        );

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

    fn format_thread(&self, emails: &[ThreadEmail]) -> String {
        let mut parts: Vec<String> = Vec::new();
        let mut total_chars: usize = 0;
        let char_budget: usize = 100_000;

        for email in emails.iter().rev() {
            let from = &email.from;
            let date = email.date.as_deref().unwrap_or("unknown date");
            let subject = email.subject.as_deref().unwrap_or("(no subject)");
            let body = email.body_text.as_deref().unwrap_or("(no body)");

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

    fn detect_language_hint(&self, emails: &[ThreadEmail]) -> String {
        if let Some(last) = emails.last() {
            let body = last.body_text.as_deref().unwrap_or("");
            if !body.is_empty() {
                return ". Respond in the same language as the last message".to_string();
            }
        }
        String::new()
    }

    async fn chat_completion(
        &self,
        base_url: &str,
        api_key: &str,
        model: &str,
        messages: Vec<ChatMessage>,
        max_tokens: i64,
    ) -> Result<String, String> {
        let url = format!(
            "{}/v1/chat/completions",
            base_url.trim_end_matches('/')
        );

        let request = ChatRequest {
            model: model.to_string(),
            messages,
            temperature: 0.3,
            max_tokens,
        };

        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| format!("AI request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("AI API error {}: {}", status, body));
        }

        let chat_resp: ChatResponse = resp
            .json()
            .await
            .map_err(|e| format!("Invalid AI response: {}", e))?;

        chat_resp
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .ok_or_else(|| "No response from AI".to_string())
    }
}

struct ThreadEmail {
    from: String,
    #[allow(dead_code)]
    to: String,
    date: Option<String>,
    subject: Option<String>,
    body_text: Option<String>,
}

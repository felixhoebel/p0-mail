use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::time::Duration;

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

pub const GOOGLE_AUTH_URL: &str =
    "https://accounts.google.com/o/oauth2/v2/auth";
pub const GOOGLE_TOKEN_URL: &str =
    "https://oauth2.googleapis.com/token";
pub const GOOGLE_SCOPE: &str = "openid email https://mail.google.com/";

pub const MICROSOFT_AUTH_URL: &str =
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
pub const MICROSOFT_TOKEN_URL: &str =
    "https://login.microsoftonline.com/common/oauth2/v2.0/token";
pub const MICROSOFT_SCOPE: &str =
    "openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send";

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

pub fn google_client_id() -> String {
    env_or("GOOGLE_CLIENT_ID", "")
}

pub fn google_client_secret() -> String {
    env_or("GOOGLE_CLIENT_SECRET", "")
}

pub fn microsoft_client_id() -> String {
    env_or("MICROSOFT_CLIENT_ID", "")
}

pub fn microsoft_client_secret() -> String {
    env_or("MICROSOFT_CLIENT_SECRET", "")
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum OAuthProvider {
    Gmail,
    Microsoft,
}

impl OAuthProvider {
    pub fn as_str(&self) -> &'static str {
        match self {
            OAuthProvider::Gmail => "gmail_oauth",
            OAuthProvider::Microsoft => "microsoft_oauth",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "gmail_oauth" => Some(OAuthProvider::Gmail),
            "microsoft_oauth" => Some(OAuthProvider::Microsoft),
            _ => None,
        }
    }

    pub fn client_id(&self) -> String {
        match self {
            OAuthProvider::Gmail => google_client_id(),
            OAuthProvider::Microsoft => microsoft_client_id(),
        }
    }

    pub fn client_secret(&self) -> String {
        match self {
            OAuthProvider::Gmail => google_client_secret(),
            OAuthProvider::Microsoft => microsoft_client_secret(),
        }
    }

    pub fn auth_url(&self) -> &'static str {
        match self {
            OAuthProvider::Gmail => GOOGLE_AUTH_URL,
            OAuthProvider::Microsoft => MICROSOFT_AUTH_URL,
        }
    }

    pub fn token_url(&self) -> &'static str {
        match self {
            OAuthProvider::Gmail => GOOGLE_TOKEN_URL,
            OAuthProvider::Microsoft => MICROSOFT_TOKEN_URL,
        }
    }

    pub fn scope(&self) -> &'static str {
        match self {
            OAuthProvider::Gmail => GOOGLE_SCOPE,
            OAuthProvider::Microsoft => MICROSOFT_SCOPE,
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            OAuthProvider::Gmail => "Google",
            OAuthProvider::Microsoft => "Microsoft",
        }
    }

    pub fn imap_host(&self) -> &'static str {
        match self {
            OAuthProvider::Gmail => "imap.gmail.com",
            OAuthProvider::Microsoft => "outlook.office365.com",
        }
    }

    pub fn imap_port(&self) -> i64 {
        993
    }

    pub fn imap_encryption(&self) -> &'static str {
        "SSL"
    }

    pub fn smtp_host(&self) -> &'static str {
        match self {
            OAuthProvider::Gmail => "smtp.gmail.com",
            OAuthProvider::Microsoft => "smtp.office365.com",
        }
    }

    pub fn smtp_port(&self) -> i64 {
        587
    }

    pub fn smtp_encryption(&self) -> &'static str {
        "STARTTLS"
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
    pub email: Option<String>,
}

pub fn generate_state() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", ts)
}

pub fn find_available_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local addr: {}", e))?
        .port();
    drop(listener);
    Ok(port)
}

pub struct OAuthFlow {
    provider: OAuthProvider,
}

impl OAuthFlow {
    pub fn new(provider: OAuthProvider) -> Self {
        OAuthFlow { provider }
    }

    pub fn authorization_url(&self, redirect_port: u16, state: &str) -> String {
        let client_id = self.provider.client_id();
        let auth_url = self.provider.auth_url();
        let scope = self.provider.scope();
        let redirect_uri = format!("http://127.0.0.1:{}", redirect_port);

        format!(
            "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent&state={}",
            auth_url,
            urlencoding::encode(&client_id),
            urlencoding::encode(&redirect_uri),
            urlencoding::encode(scope),
            state,
        )
    }

    pub async fn exchange_code(
        &self,
        code: &str,
        redirect_port: u16,
    ) -> Result<OAuthTokens, String> {
        let redirect_uri = format!("http://127.0.0.1:{}", redirect_port);
        let client = http_client()?;

        let mut params = vec![
            ("code", code.to_string()),
            ("client_id", self.provider.client_id()),
            ("client_secret", self.provider.client_secret()),
            ("redirect_uri", redirect_uri),
            ("grant_type", "authorization_code".to_string()),
        ];

        if matches!(self.provider, OAuthProvider::Microsoft) {
            params.push(("scope", self.provider.scope().to_string()));
        }

        let resp = client
            .post(self.provider.token_url())
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("Token request failed: {}", e))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Token exchange failed: {}", body));
        }

        #[derive(Deserialize)]
        struct TokenResponse {
            access_token: String,
            refresh_token: Option<String>,
            expires_in: Option<i64>,
            id_token: Option<String>,
        }

        let token_resp: TokenResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse token response: {}", e))?;

        let email = match self.provider {
            OAuthProvider::Gmail => resolve_google_email(
                &token_resp.access_token,
                token_resp.id_token.as_deref(),
            )
            .await
            .ok(),
            _ => self.fetch_user_email(&token_resp.access_token).await.ok(),
        };

        Ok(OAuthTokens {
            access_token: token_resp.access_token,
            refresh_token: token_resp.refresh_token,
            expires_in: token_resp.expires_in,
            email,
        })
    }

    async fn fetch_user_email(
        &self,
        access_token: &str,
    ) -> Result<String, String> {
        match self.provider {
            OAuthProvider::Gmail => {
                resolve_google_email(access_token, None).await
            }
            OAuthProvider::Microsoft => {
                let client = http_client()?;
                let resp = client
                    .get("https://graph.microsoft.com/v1.0/me")
                    .bearer_auth(access_token)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                if !resp.status().is_success() {
                    let body = resp.text().await.unwrap_or_default();
                    return Err(format!("Microsoft profile request failed: {}", body));
                }
                #[derive(Deserialize)]
                struct UserInfo {
                    mail: Option<String>,
                    user_principal_name: Option<String>,
                }
                let info: UserInfo = resp.json().await.map_err(|e| e.to_string())?;
                info.mail
                    .or(info.user_principal_name)
                    .filter(|e| !e.is_empty())
                    .ok_or_else(|| "Microsoft profile returned no email".to_string())
            }
        }
    }

    pub fn listen_for_callback(
        &self,
        port: u16,
        state: String,
    ) -> Result<mpsc::Receiver<Result<(String, u16), String>>, String> {
        let listener = TcpListener::bind(format!("127.0.0.1:{}", port))
            .map_err(|e| format!("Failed to bind port {}: {}", port, e))?;
        let (tx, rx) = mpsc::channel();

        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = match stream {
                    Ok(s) => s,
                    Err(_) => continue,
                };

                let reader = BufReader::new(&mut stream);
                let mut request_line = String::new();

                for line in reader.lines() {
                    match line {
                        Ok(l) if l.is_empty() => break,
                        Ok(l) if request_line.is_empty() => request_line = l,
                        _ => {}
                    }
                }

                let response = if let Some(query) =
                    request_line.split('?').nth(1)
                {
                    let params: std::collections::HashMap<&str, &str> = query
                        .split('&')
                        .filter_map(|pair| {
                            let mut kv = pair.splitn(2, '=');
                            Some((kv.next()?, kv.next()?))
                        })
                        .collect();

                    let resp_state = params.get("state").unwrap_or(&"");
                    if resp_state != &state {
                        let _ = tx.send(Err("State mismatch".to_string()));
                        "HTTP/1.1 400 Bad Request\r\n\r\nAuthorization failed: state mismatch".to_string()
                    } else if let Some(code) = params.get("code") {
                        let _ = tx.send(Ok((code.to_string(), port)));
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n\
                         <html><body><h2>Authorization successful!</h2>\
                         <p>You can close this tab and return to p0mail.</p></body></html>"
                            .to_string()
                    } else {
                        let error = params.get("error").unwrap_or(&"unknown");
                        let _ = tx.send(Err(format!("OAuth error: {}", error)));
                        format!(
                            "HTTP/1.1 400 Bad Request\r\n\r\nAuthorization failed: {}",
                            error
                        )
                    }
                } else {
                    "HTTP/1.1 400 Bad Request\r\n\r\nNo query parameters".to_string()
                };

                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
                break;
            }
        });

        Ok(rx)
    }
}

pub async fn refresh_access_token(
    provider: &OAuthProvider,
    refresh_token: &str,
) -> Result<OAuthTokens, String> {
    let client = http_client()?;
    let mut params = vec![
        ("client_id", provider.client_id()),
        ("client_secret", provider.client_secret()),
        ("refresh_token", refresh_token.to_string()),
        ("grant_type", "refresh_token".to_string()),
    ];

    if matches!(provider, OAuthProvider::Microsoft) {
        params.push(("scope", provider.scope().to_string()));
    }

    let resp = client
        .post(provider.token_url())
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Refresh token request failed: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Token refresh failed: {}", body));
    }

    #[derive(Deserialize)]
    struct RefreshResponse {
        access_token: String,
        expires_in: Option<i64>,
    }

    let token_resp: RefreshResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

    Ok(OAuthTokens {
        access_token: token_resp.access_token,
        refresh_token: Some(refresh_token.to_string()),
        expires_in: token_resp.expires_in,
        email: None,
    })
}

fn email_from_id_token(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    use base64::Engine;
    let padded = match payload.len() % 4 {
        2 => format!("{payload}=="),
        3 => format!("{payload}="),
        _ => payload.to_string(),
    };
    let bytes = base64::engine::general_purpose::URL_SAFE
        .decode(padded)
        .ok()?;
    #[derive(Deserialize)]
    struct Claims {
        email: Option<String>,
    }
    serde_json::from_slice::<Claims>(&bytes)
        .ok()?
        .email
        .filter(|e| !e.is_empty())
}

pub async fn fetch_google_userinfo_email(access_token: &str) -> Result<String, String> {
    let client = http_client()?;
    let resp = client
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Google userinfo failed: {}", body));
    }
    #[derive(Deserialize)]
    struct UserInfo {
        email: String,
    }
    let info: UserInfo = resp.json().await.map_err(|e| e.to_string())?;
    if info.email.is_empty() {
        return Err("Google userinfo returned empty email".to_string());
    }
    Ok(info.email)
}

pub async fn resolve_google_email(
    access_token: &str,
    id_token: Option<&str>,
) -> Result<String, String> {
    if let Some(token) = id_token {
        if let Some(email) = email_from_id_token(token) {
            return Ok(email);
        }
    }
    match fetch_gmail_email(access_token).await {
        Ok(email) => Ok(email),
        Err(gmail_err) => fetch_google_userinfo_email(access_token)
            .await
            .map_err(|userinfo_err| {
                format!(
                    "Could not resolve Gmail address. Enable the Gmail API in Google Cloud Console, then reconnect. Gmail API: {gmail_err}; userinfo: {userinfo_err}"
                )
            }),
    }
}

pub async fn fetch_gmail_email(access_token: &str) -> Result<String, String> {
    let client = http_client()?;
    let resp = client
        .get("https://gmail.googleapis.com/gmail/v1/users/me/profile")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Gmail profile request failed: {}", body));
    }

    #[derive(Deserialize)]
    struct GmailProfile {
        #[serde(rename = "emailAddress")]
        email_address: String,
    }

    let profile: GmailProfile = resp.json().await.map_err(|e| e.to_string())?;
    if profile.email_address.is_empty() {
        return Err("Gmail profile returned empty email".to_string());
    }
    Ok(profile.email_address)
}

pub fn update_account_email(account_id: i64, email: &str) -> Result<(), String> {
    let conn = crate::db::get()?;
    let updated = conn
        .execute(
            "UPDATE accounts SET email_address = ?1 WHERE id = ?2",
            rusqlite::params![email, account_id],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err(format!("Account {} not found", account_id));
    }
    Ok(())
}

pub async fn ensure_oauth_email(
    account_id: i64,
    provider: &OAuthProvider,
    email: &str,
) -> Result<String, String> {
    if email != "unknown@unknown.com" && !email.is_empty() {
        return Ok(email.to_string());
    }

    let access_token = crate::secure::get_access_token(account_id)?;
    let resolved = match provider {
        OAuthProvider::Gmail => resolve_google_email(&access_token, None).await?,
        OAuthProvider::Microsoft => {
            let client = http_client()?;
            let resp = client
                .get("https://graph.microsoft.com/v1.0/me")
                .bearer_auth(&access_token)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                let body = resp.text().await.unwrap_or_default();
                return Err(format!("Microsoft profile request failed: {}", body));
            }
            #[derive(Deserialize)]
            struct UserInfo {
                mail: Option<String>,
                user_principal_name: Option<String>,
            }
            let info: UserInfo = resp.json().await.map_err(|e| e.to_string())?;
            info.mail
                .or(info.user_principal_name)
                .filter(|e| !e.is_empty())
                .ok_or_else(|| "Microsoft profile returned no email".to_string())?
        }
    };

    update_account_email(account_id, &resolved)?;
    Ok(resolved)
}

pub fn build_xoauth2_string(
    email: &str,
    access_token: &str,
) -> String {
    format!(
        "user={}\x01auth=Bearer {}\x01\x01",
        email, access_token
    )
}

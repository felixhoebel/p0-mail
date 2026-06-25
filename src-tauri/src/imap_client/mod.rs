use crate::oauth::{build_xoauth2_string, ensure_oauth_email, refresh_access_token, OAuthProvider};
use crate::secure;
use futures::StreamExt;
use std::time::Duration;

type TlsStream = tokio_native_tls::TlsStream<tokio::net::TcpStream>;
pub type ImapSession = async_imap::Session<TlsStream>;

const UID_FETCH_QUERIES: &[&str] = &["(BODY.PEEK[])", "RFC822"];
const TCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TLS_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const GREETING_TIMEOUT: Duration = Duration::from_secs(10);
const AUTH_TIMEOUT: Duration = Duration::from_secs(15);
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

const LOGOUT_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn logout_session(session: &mut ImapSession) {
    let _ = tokio::time::timeout(LOGOUT_TIMEOUT, session.logout()).await;
}

pub async fn fetch_uid_message_raw(session: &mut ImapSession, uid: u32) -> Result<Vec<u8>, String> {
    let uid_set = uid.to_string();
    for query in UID_FETCH_QUERIES {
        let fetches = tokio::time::timeout(
            FETCH_TIMEOUT,
            session.uid_fetch(&uid_set, query),
        )
        .await
        .map_err(|_| format!("UID FETCH {uid_set} {query} timed out after {FETCH_TIMEOUT:?}"))?
        .map_err(|e| format!("UID FETCH {uid_set} {query} failed: {:?}", e))?;

        let collected: Vec<_> = tokio::time::timeout(
            FETCH_TIMEOUT,
            fetches.collect::<Vec<_>>(),
        )
        .await
        .map_err(|_| format!("UID FETCH {uid_set} stream timed out after {FETCH_TIMEOUT:?}"))?;

        for fetch_result in collected {
            let fetch = fetch_result.map_err(|e| format!("FETCH stream error: {:?}", e))?;
            if let Some(raw) = fetch.body() {
                if !raw.is_empty() {
                    return Ok(raw.to_vec());
                }
            }
        }
    }
    Err(format!("No message body returned for IMAP UID {uid}"))
}

pub struct ImapConnection;

impl ImapConnection {
    pub async fn connect_oauth(
        account_id: i64,
        provider: &OAuthProvider,
        email: &str,
    ) -> Result<ImapSession, String> {
        let email = ensure_oauth_email(account_id, provider, email).await?;
        let access_token = secure::get_access_token(account_id)?;

        let session = Self::connect_and_auth_oauth(provider, &email, &access_token).await;

        match session {
            Ok(s) => Ok(s),
            Err(_first_err) => {
                log::warn!("XOAUTH2 login failed, attempting token refresh");

                let refresh_token = match secure::get_refresh_token(account_id) {
                    Ok(t) => t,
                    Err(_) => {
                        return Err(format!(
                            "OAuth session expired and no refresh token found. \
                             Please reconnect your {} account in Settings.",
                            provider.display_name()
                        ));
                    }
                };

                let new_tokens = match refresh_access_token(provider, &refresh_token).await {
                    Ok(t) => t,
                    Err(refresh_err) => {
                        return Err(format!(
                            "OAuth token refresh failed: {}. \
                             Please reconnect your {} account in Settings.",
                            refresh_err,
                            provider.display_name()
                        ));
                    }
                };

                secure::store_access_token(account_id, &new_tokens.access_token)?;

                Self::connect_and_auth_oauth(provider, &email, &new_tokens.access_token)
                    .await
                    .map_err(|e| {
                        format!(
                            "IMAP XOAUTH2 auth failed after refresh: {:?}. \
                             Please reconnect your {} account in Settings.",
                            e,
                            provider.display_name()
                        )
                    })
            }
        }
    }

    async fn connect_and_auth_oauth(
        provider: &OAuthProvider,
        email: &str,
        access_token: &str,
    ) -> Result<ImapSession, String> {
        let tls = Self::make_tls_connector()?;
        let tcp_stream = tokio::time::timeout(
            TCP_CONNECT_TIMEOUT,
            tokio::net::TcpStream::connect(format!(
                "{}:{}",
                provider.imap_host(),
                provider.imap_port()
            )),
        )
        .await
        .map_err(|_| format!("IMAP TCP connect timed out after {TCP_CONNECT_TIMEOUT:?}"))?
        .map_err(|e| format!("IMAP TCP connect failed: {}", e))?;

        let tls_stream = tokio::time::timeout(
            TLS_HANDSHAKE_TIMEOUT,
            tls.connect(provider.imap_host(), tcp_stream),
        )
        .await
        .map_err(|_| format!("IMAP TLS handshake timed out after {TLS_HANDSHAKE_TIMEOUT:?}"))?
        .map_err(|e| format!("IMAP TLS handshake failed: {}", e))?;

        let mut client = async_imap::Client::new(tls_stream);

        let _greeting = tokio::time::timeout(GREETING_TIMEOUT, client.read_response())
            .await
            .map_err(|_| format!("IMAP greeting timed out after {GREETING_TIMEOUT:?}"))?
            .map_err(|e| format!("IMAP read greeting failed: {}", e))?;

        let auth_string = build_xoauth2_string(email, access_token);
        let auth = XOAuth2Auth { string: auth_string };

        tokio::time::timeout(AUTH_TIMEOUT, client.authenticate("XOAUTH2", auth))
            .await
            .map_err(|_| format!("IMAP XOAUTH2 auth timed out after {AUTH_TIMEOUT:?}"))?
            .map_err(|(e, _)| format!("IMAP XOAUTH2 auth failed: {:?}", e))
    }

    pub async fn connect_plain(
        account_id: i64,
        host: &str,
        port: i64,
        encryption: &str,
        username: &str,
    ) -> Result<ImapSession, String> {
        let password = secure::get_imap_password(account_id)?;
        Self::connect_plain_with_password(host, port, encryption, username, &password).await
    }

    pub async fn connect_plain_with_password(
        host: &str,
        port: i64,
        encryption: &str,
        username: &str,
        password: &str,
    ) -> Result<ImapSession, String> {
        let addr = format!("{}:{}", host, port);
        let tls = Self::make_tls_connector()?;

        match encryption {
            "SSL" => {
                let tcp_stream = tokio::time::timeout(
                    TCP_CONNECT_TIMEOUT,
                    tokio::net::TcpStream::connect(&addr),
                )
                .await
                .map_err(|_| format!("IMAP TCP connect to {addr} timed out after {TCP_CONNECT_TIMEOUT:?}"))?
                .map_err(|e| format!("IMAP TCP connect to {} failed: {}", addr, e))?;

                let tls_stream = tokio::time::timeout(
                    TLS_HANDSHAKE_TIMEOUT,
                    tls.connect(host, tcp_stream),
                )
                .await
                .map_err(|_| format!("IMAP TLS handshake timed out after {TLS_HANDSHAKE_TIMEOUT:?}"))?
                .map_err(|e| format!("IMAP TLS failed: {}", e))?;

                let mut client = async_imap::Client::new(tls_stream);

                let _greeting = tokio::time::timeout(GREETING_TIMEOUT, client.read_response())
                    .await
                    .map_err(|_| format!("IMAP greeting timed out after {GREETING_TIMEOUT:?}"))?
                    .map_err(|e| format!("IMAP read greeting failed: {}", e))?;

                tokio::time::timeout(AUTH_TIMEOUT, client.login(username, password))
                    .await
                    .map_err(|_| format!("IMAP login timed out after {AUTH_TIMEOUT:?}"))?
                    .map_err(|(e, _)| format!("IMAP login failed: {}", e))
            }
            "STARTTLS" => {
                let tcp_stream = tokio::time::timeout(
                    TCP_CONNECT_TIMEOUT,
                    tokio::net::TcpStream::connect(&addr),
                )
                .await
                .map_err(|_| format!("IMAP TCP connect to {addr} timed out after {TCP_CONNECT_TIMEOUT:?}"))?
                .map_err(|e| format!("IMAP TCP connect to {} failed: {}", addr, e))?;

                let mut client = async_imap::Client::new(tcp_stream);

                let _greeting = tokio::time::timeout(GREETING_TIMEOUT, client.read_response())
                    .await
                    .map_err(|_| format!("IMAP greeting timed out after {GREETING_TIMEOUT:?}"))?
                    .map_err(|e| format!("IMAP read greeting failed: {}", e))?;

                tokio::time::timeout(AUTH_TIMEOUT, client.run_command_and_check_ok("STARTTLS", None))
                    .await
                    .map_err(|_| format!("STARTTLS command timed out after {AUTH_TIMEOUT:?}"))?
                    .map_err(|e| format!("STARTTLS command failed: {}", e))?;

                let inner_stream = client.into_inner();

                let tls_stream = tokio::time::timeout(
                    TLS_HANDSHAKE_TIMEOUT,
                    tls.connect(host, inner_stream),
                )
                .await
                .map_err(|_| format!("STARTTLS handshake timed out after {TLS_HANDSHAKE_TIMEOUT:?}"))?
                .map_err(|e| format!("STARTTLS handshake failed: {}", e))?;

                let tls_client = async_imap::Client::new(tls_stream);

                tokio::time::timeout(AUTH_TIMEOUT, tls_client.login(username, password))
                    .await
                    .map_err(|_| format!("IMAP login timed out after {AUTH_TIMEOUT:?}"))?
                    .map_err(|(e, _)| format!("IMAP login failed: {:?}", e))
            }
            _ => Err(format!("Unknown encryption type: {}", encryption)),
        }
    }

    fn make_tls_connector() -> Result<tokio_native_tls::TlsConnector, String> {
        let connector = native_tls::TlsConnector::builder()
            .build()
            .map_err(|e| format!("TLS connector build failed: {}", e))?;
        Ok(tokio_native_tls::TlsConnector::from(connector))
    }
}

struct XOAuth2Auth {
    string: String,
}

impl async_imap::Authenticator for XOAuth2Auth {
    type Response = String;

    fn process(&mut self, _data: &[u8]) -> Self::Response {
        self.string.clone()
    }
}

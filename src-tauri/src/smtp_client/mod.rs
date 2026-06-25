use crate::commands::models::AttachmentPayload;
use crate::secure;
use lettre::message::header::{ContentType, InReplyTo, References};
use lettre::message::{Attachment as LettreAttachment, MultiPart, SinglePart};
use lettre::transport::smtp::authentication::{Credentials, Mechanism};
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use std::time::Duration;

const SMTP_TIMEOUT: Duration = Duration::from_secs(30);

pub struct SmtpConnection;

impl SmtpConnection {
    pub async fn send_oauth(
        account_id: i64,
        host: &str,
        port: i64,
        encryption: &str,
        email: &str,
        to: &str,
        cc: Option<&str>,
        bcc: Option<&str>,
        subject: &str,
        body_html: &str,
        body_text: &str,
        attachments: Option<&[AttachmentPayload]>,
        in_reply_to: Option<&str>,
        references: Option<&[String]>,
    ) -> Result<(), String> {
        let access_token = secure::get_access_token(account_id)?;
        let creds = Credentials::new(email.to_string(), access_token);

        let mailer = build_oauth_smtp_transport(host, port, encryption, &creds)?;

        let message = build_message(email, to, cc, bcc, subject, body_html, body_text, attachments, in_reply_to, references)?;

        tokio::time::timeout(SMTP_TIMEOUT, mailer.send(message))
            .await
            .map_err(|_| format!("SMTP send timed out after {SMTP_TIMEOUT:?}"))?
            .map_err(|e| format!("SMTP send failed: {}", e))?;

        Ok(())
    }

    pub async fn send_plain(
        account_id: i64,
        host: &str,
        port: i64,
        encryption: &str,
        username: &str,
        to: &str,
        cc: Option<&str>,
        bcc: Option<&str>,
        subject: &str,
        body_html: &str,
        body_text: &str,
        attachments: Option<&[AttachmentPayload]>,
        in_reply_to: Option<&str>,
        references: Option<&[String]>,
    ) -> Result<(), String> {
        let password = secure::get_imap_password(account_id)?;
        let creds = Credentials::new(username.to_string(), password);

        let mailer = build_smtp_transport(host, port, encryption, &creds)?;

        let message = build_message(username, to, cc, bcc, subject, body_html, body_text, attachments, in_reply_to, references)?;

        tokio::time::timeout(SMTP_TIMEOUT, mailer.send(message))
            .await
            .map_err(|_| format!("SMTP send timed out after {SMTP_TIMEOUT:?}"))?
            .map_err(|e| format!("SMTP send failed: {}", e))?;

        Ok(())
    }
}

fn build_oauth_smtp_transport(
    host: &str,
    port: i64,
    encryption: &str,
    creds: &Credentials,
) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
    let mechanisms = vec![Mechanism::Xoauth2];
    match encryption {
        "SSL" => Ok(AsyncSmtpTransport::<Tokio1Executor>::relay(host)
            .map_err(|e| format!("SMTP TLS relay error: {}", e))?
            .port(port as u16)
            .timeout(Some(SMTP_TIMEOUT))
            .credentials(creds.clone())
            .authentication(mechanisms)
            .build()),
        "STARTTLS" => Ok(AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)
            .map_err(|e| format!("SMTP STARTTLS relay error: {}", e))?
            .port(port as u16)
            .timeout(Some(SMTP_TIMEOUT))
            .credentials(creds.clone())
            .authentication(mechanisms)
            .build()),
        _ => Err(format!("Unknown encryption: {}", encryption)),
    }
}

fn build_smtp_transport(
    host: &str,
    port: i64,
    encryption: &str,
    creds: &Credentials,
) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
    match encryption {
        "SSL" => Ok(AsyncSmtpTransport::<Tokio1Executor>::relay(host)
            .map_err(|e| format!("SMTP TLS relay error: {}", e))?
            .port(port as u16)
            .timeout(Some(SMTP_TIMEOUT))
            .credentials(creds.clone())
            .build()),
        "STARTTLS" => Ok(AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)
            .map_err(|e| format!("SMTP STARTTLS relay error: {}", e))?
            .port(port as u16)
            .timeout(Some(SMTP_TIMEOUT))
            .credentials(creds.clone())
            .build()),
        _ => Err(format!("Unknown encryption: {}", encryption)),
    }
}

fn build_message(
    from: &str,
    to: &str,
    cc: Option<&str>,
    bcc: Option<&str>,
    subject: &str,
    body_html: &str,
    body_text: &str,
    attachments: Option<&[AttachmentPayload]>,
    in_reply_to: Option<&str>,
    references: Option<&[String]>,
) -> Result<Message, String> {
    let to_addrs: Vec<lettre::Address> = to
        .split(',')
        .filter_map(|a| a.trim().parse().ok())
        .collect();
    if to_addrs.is_empty() {
        return Err("No valid To addresses".to_string());
    }

    let from_addr: lettre::Address = from
        .parse()
        .map_err(|e| format!("Invalid from address: {}", e))?;

    let mut builder = Message::builder()
        .from(from_addr.into())
        .subject(subject.to_string());

    for addr in &to_addrs {
        builder = builder.to(addr.clone().into());
    }

    if let Some(cc_str) = cc {
        for addr in cc_str.split(',').filter_map(|a| a.trim().parse::<lettre::Address>().ok()) {
            builder = builder.cc(addr.into());
        }
    }

    if let Some(bcc_str) = bcc {
        for addr in bcc_str.split(',').filter_map(|a| a.trim().parse::<lettre::Address>().ok()) {
            builder = builder.bcc(addr.into());
        }
    }

    if let Some(irt) = in_reply_to {
        builder = builder.header(InReplyTo::from(irt.to_string()));
    }
    if let Some(refs) = references {
        let refs_str = refs.join(" ");
        builder = builder.header(References::from(refs_str));
    }

    let alternative = MultiPart::alternative()
        .singlepart(
            SinglePart::builder()
                .header(ContentType::TEXT_PLAIN)
                .body(body_text.to_string()),
        )
        .singlepart(
            SinglePart::builder()
                .header(ContentType::TEXT_HTML)
                .body(body_html.to_string()),
        );

    let body = match attachments {
        Some(atts) if !atts.is_empty() => {
            let mut mixed = MultiPart::mixed().multipart(alternative);
            for att in atts {
                let content_type = ContentType::parse(&att.mime_type)
                    .unwrap_or(ContentType::TEXT_PLAIN);
                let attachment = LettreAttachment::new(att.filename.clone())
                    .body(att.data.clone(), content_type);
                mixed = mixed.singlepart(attachment);
            }
            mixed
        }
        _ => alternative,
    };

    builder
        .multipart(body)
        .map_err(|e| format!("Failed to build message: {}", e))
}

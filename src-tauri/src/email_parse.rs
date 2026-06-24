use mailparse::ParsedMail;

pub fn decode_header(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let header_line = format!("X-Decode: {trimmed}\r\n");
    match mailparse::parse_header(header_line.as_bytes()) {
        Ok((header, _)) => header.get_value(),
        Err(_) => trimmed.to_string(),
    }
}

pub struct ParsedBodies {
    pub text: Option<String>,
    pub html: Option<String>,
}

fn sanitize_html(html: &str) -> String {
    ammonia::Builder::new()
        .tags(std::collections::HashSet::from([
            "a", "b", "br", "blockquote", "code", "div", "em", "h1", "h2", "h3",
            "hr", "i", "img", "li", "ol", "p", "pre", "span", "strong", "table",
            "tbody", "td", "th", "thead", "tr", "ul", "font", "center",
        ]))
        .tag_attributes(std::collections::HashMap::from([
            ("a", std::collections::HashSet::from(["href"])),
            ("img", std::collections::HashSet::from(["src", "alt", "width", "height"])),
            ("td", std::collections::HashSet::from(["colspan", "rowspan", "align", "valign", "bgcolor"])),
            ("th", std::collections::HashSet::from(["colspan", "rowspan", "align", "valign", "bgcolor"])),
            ("table", std::collections::HashSet::from(["width", "border", "cellpadding", "cellspacing", "align"])),
            ("font", std::collections::HashSet::from(["color", "size", "face"])),
            ("div", std::collections::HashSet::from(["align"])),
            ("p", std::collections::HashSet::from(["align"])),
            ("hr", std::collections::HashSet::from(["width", "align"])),
        ]))
        .link_rel(Some("noopener noreferrer"))
        .strip_comments(true)
        .clean(html)
        .to_string()
}

pub fn extract_bodies(raw: &[u8]) -> Result<ParsedBodies, String> {
    let parsed = mailparse::parse_mail(raw).map_err(|e| format!("MIME parse failed: {e}"))?;
    let mut text = None;
    let mut html = None;
    collect_parts(&parsed, &mut text, &mut html);
    Ok(ParsedBodies { text, html })
}

fn part_body_string(part: &ParsedMail) -> Option<String> {
    part.get_body()
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            part.get_body_raw()
                .ok()
                .map(|raw| String::from_utf8_lossy(&raw).trim().to_string())
                .filter(|s| !s.is_empty())
        })
}

fn collect_parts(part: &ParsedMail, text: &mut Option<String>, html: &mut Option<String>) {
    let mime = part.ctype.mimetype.to_ascii_lowercase();

    if mime == "text/plain" {
        if let Some(decoded) = part_body_string(part) {
            if text.as_ref().map(|t| t.len()).unwrap_or(0) < decoded.len() {
                *text = Some(decoded);
            }
        }
    } else if mime == "text/html" {
        if let Some(decoded) = part_body_string(part) {
            if html.as_ref().map(|h| h.len()).unwrap_or(0) < decoded.len() {
                *html = Some(decoded);
            }
        }
    }

    for sub in &part.subparts {
        collect_parts(sub, text, html);
    }
}

pub fn store_bodies(
    email_id: i64,
    bodies: &ParsedBodies,
) -> Result<(), String> {
    let conn = crate::db::get()?;
    let sanitized_html = bodies.html.as_ref().map(|h| sanitize_html(h));
    conn.execute(
        "UPDATE emails SET body_html = ?1, body_text = ?2 WHERE id = ?3",
        rusqlite::params![sanitized_html, bodies.text, email_id],
    )
    .map_err(|e| format!("Failed to update email body: {e}"))?;
    Ok(())
}

pub fn apply_raw_message(email_id: i64, raw: &[u8]) -> Result<(), String> {
    match extract_bodies(raw) {
        Ok(bodies) if bodies.text.is_some() || bodies.html.is_some() => {
            store_bodies(email_id, &bodies)
        }
        Ok(_) => Err("Message contained no text or HTML body".to_string()),
        Err(e) => Err(e),
    }
}

pub fn strip_html_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut chars = html.chars().peekable();
    let mut in_tag = false;
    let mut tag_buf = String::new();
    while let Some(ch) = chars.next() {
        if ch == '<' {
            in_tag = true;
            tag_buf.clear();
            tag_buf.push(ch);
            continue;
        }
        if in_tag {
            tag_buf.push(ch);
            if ch == '>' {
                in_tag = false;
                let tag_lower = tag_buf.to_lowercase();
                if tag_lower.starts_with("</p")
                    || tag_lower.starts_with("</div")
                    || tag_lower.starts_with("</h")
                    || tag_lower.starts_with("<br")
                    || tag_lower.starts_with("</li")
                {
                    out.push('\n');
                } else {
                    out.push(' ');
                }
            }
            continue;
        }
        out.push(ch);
    }
    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    decoded
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_rfc2047_subject() {
        let raw = "=?UTF-8?Q?Hello_World?=";
        assert_eq!(decode_header(raw), "Hello World");
    }

    #[test]
    fn decodes_folded_utf8_subject() {
        let raw = "=?UTF-8?Q?AI_Needs_More_Than_Models_=F0=9F=96=A5=EF=B8=8F,_Patch,_Gove?= =?UTF-8?Q?rn,_Repeat_=F0=9F=94=A7,_Core_Systems_Still_Matter_=F0=9F=8F=A2?=";
        let decoded = decode_header(raw);
        assert!(decoded.contains("AI Needs More Than Models"));
        assert!(!decoded.contains("=?UTF-8"));
    }

    #[test]
    fn extracts_multipart_bodies() {
        let raw = concat!(
            "From: a@b.com\r\n",
            "To: c@d.com\r\n",
            "Subject: hi\r\n",
            "MIME-Version: 1.0\r\n",
            "Content-Type: multipart/alternative; boundary=abc\r\n",
            "\r\n",
            "--abc\r\n",
            "Content-Type: text/plain; charset=utf-8\r\n",
            "\r\n",
            "Hello plain\r\n",
            "--abc\r\n",
            "Content-Type: text/html; charset=utf-8\r\n",
            "\r\n",
            "<p>Hello html</p>\r\n",
            "--abc--\r\n",
        );
        let bodies = extract_bodies(raw.as_bytes()).unwrap();
        assert_eq!(bodies.text.as_deref(), Some("Hello plain"));
        assert!(bodies.html.as_ref().unwrap().contains("Hello html"));
    }

    #[test]
    fn sanitizes_script_tags() {
        let html = r#"<p>Hello</p><script>alert('xss')</script>"#;
        let clean = sanitize_html(html);
        assert!(clean.contains("Hello"));
        assert!(!clean.contains("script"));
        assert!(!clean.contains("alert"));
    }

    #[test]
    fn sanitizes_inline_event_handlers() {
        let html = r#"<p onclick="steal()" onerror="x()">Text</p>"#;
        let clean = sanitize_html(html);
        assert!(clean.contains("Text"));
        assert!(!clean.contains("onclick"));
        assert!(!clean.contains("onerror"));
    }

    #[test]
    fn sanitizes_style_tags() {
        let html = r#"<style>@import url(http://evil/track.css)</style><p>Hi</p>"#;
        let clean = sanitize_html(html);
        assert!(clean.contains("Hi"));
        assert!(!clean.contains("style"));
        assert!(!clean.contains("@import"));
    }

    #[test]
    fn sanitizes_javascript_uris() {
        let html = r#"<a href="javascript:alert(1)">click</a>"#;
        let clean = sanitize_html(html);
        assert!(clean.contains("click"));
        assert!(!clean.contains("javascript:"));
    }

    #[test]
    fn preserves_safe_links() {
        let html = r#"<a href="https://example.com">link</a>"#;
        let clean = sanitize_html(html);
        assert!(clean.contains("https://example.com"));
        assert!(clean.contains("link"));
    }

    #[test]
    fn strips_iframe_and_object() {
        let html = r#"<iframe src="evil"></iframe><object data="x"></object><p>safe</p>"#;
        let clean = sanitize_html(html);
        assert!(clean.contains("safe"));
        assert!(!clean.contains("iframe"));
        assert!(!clean.contains("object"));
    }
}

import DOMPurify from "dompurify";

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    "a", "b", "br", "blockquote", "code", "div", "em", "h1", "h2", "h3",
    "hr", "i", "img", "li", "ol", "p", "pre", "span", "strong", "table",
    "tbody", "td", "th", "thead", "tr", "ul", "font", "center",
  ],
  ALLOWED_ATTR: [
    "href", "class", "width", "height", "align", "valign",
    "bgcolor", "color", "size", "face", "cellpadding", "cellspacing",
    "border", "colspan", "rowspan", "src", "alt",
  ],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data:image\/(?:png|gif|jpeg|jpg|webp);base64,)|cid:)/i,
};

function quoteDepth(line: string): number {
  let depth = 0;
  for (const ch of line) {
    if (ch === ">") depth++;
    else if (ch === " ") continue;
    else break;
  }
  return depth;
}

export function trimTextQuotes(text: string, maxDepth = 3): string {
  return text
    .split("\n")
    .filter((line) => quoteDepth(line) <= maxDepth)
    .join("\n");
}

export function trimHtmlQuotes(html: string, maxDepth = 3): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (node: Element, depth: number) => {
    const blockquotes = Array.from(node.querySelectorAll(":scope > blockquote"));
    for (const bq of blockquotes) {
      if (depth + 1 > maxDepth) {
        bq.remove();
      } else {
        walk(bq, depth + 1);
      }
    }
  };
  walk(doc.body, 0);
  return doc.body.innerHTML;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatAddressLine(label: string, addrs: { name: string; address: string }[]): string {
  if (!addrs || addrs.length === 0) return "";
  const formatted = addrs
    .map((a) => (a.name ? `${escapeHtml(a.name)} &lt;${escapeHtml(a.address)}&gt;` : escapeHtml(a.address)))
    .join(", ");
  return `<div><strong>${escapeHtml(label)}:</strong> ${formatted}</div>`;
}

export interface ForwardQuoteInput {
  from: { name: string; address: string }[];
  to: { name: string; address: string }[];
  cc?: { name: string; address: string }[] | null;
  subject: string | null;
  date_rfc2822: string | null;
  body_html: string | null;
  body_text: string | null;
}

export function buildForwardBody(email: ForwardQuoteInput): string {
  const header = [
    `<div>---------- Forwarded message ----------</div>`,
    formatAddressLine("From", email.from),
    formatAddressLine("Date", email.date_rfc2822 ? [{ name: "", address: "" }] : []),
    email.date_rfc2822 ? `<div><strong>Date:</strong> ${escapeHtml(email.date_rfc2822)}</div>` : "",
    email.subject ? `<div><strong>Subject:</strong> ${escapeHtml(email.subject)}</div>` : "",
    formatAddressLine("To", email.to),
    email.cc && email.cc.length > 0 ? formatAddressLine("Cc", email.cc) : "",
    `<br>`,
  ].filter(Boolean).join("");

  let body = "";
  if (email.body_html) {
    body = trimHtmlQuotes(email.body_html);
  } else if (email.body_text) {
    body = `<pre>${escapeHtml(trimTextQuotes(email.body_text))}</pre>`;
  }

  const clean = DOMPurify.sanitize(`${header}<blockquote>${body}</blockquote>`, SANITIZE_CONFIG);
  return clean;
}

export function buildReplyQuoteBody(email: ForwardQuoteInput): string {
  let body = "";
  if (email.body_html) {
    body = trimHtmlQuotes(email.body_html);
  } else if (email.body_text) {
    body = `<pre>${escapeHtml(trimTextQuotes(email.body_text))}</pre>`;
  }
  if (!body) return "";
  return DOMPurify.sanitize(`<blockquote>${body}</blockquote>`, SANITIZE_CONFIG);
}

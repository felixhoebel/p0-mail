import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import DOMPurify from "dompurify";
import { openExternalUrl, resolveEmailLink } from "@/lib/openExternal";
import type { Email } from "@/types";

interface EmailViewerProps {
  email: Email;
}

function LabelPill({ label }: { label: string }) {
  if (label === "\\Flagged") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-600">
        &#9733; Flagged
      </span>
    );
  }
  if (label === "\\Answered") {
    return (
      <span className="inline-flex items-center text-[10px] font-medium text-emerald-600">
        &#8617; Answered
      </span>
    );
  }
  if (label === "\\Draft") {
    return (
      <span className="inline-flex items-center px-1.5 text-[10px] font-medium text-muted-foreground border border-border rounded">
        Draft
      </span>
    );
  }
  if (label === "\\Deleted" || label.startsWith("\\Seen") || label === "\\Recent" || label === "\\MayCreate") {
    return null;
  }
  if (label.startsWith("\\")) return null;
  return (
    <span className="inline-flex items-center px-1.5 text-[10px] font-medium text-muted-foreground border border-border rounded">
      {label}
    </span>
  );
}

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

function hardenEmailLinks(node: Element) {
  if (node.tagName !== "A") return;
  node.setAttribute("rel", "noopener noreferrer");
  node.removeAttribute("target");
}

function stripImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, '<div class="blocked-image" style="border:1px dashed #999;padding:8px;margin:4px 0;color:#999;font-size:12px;border-radius:4px;">[Image blocked — click "Show Images" to load]</div>');
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAddresses(addrs: { name: string; address: string }[]): string {
  return addrs
    .map((a) => (a.name ? `${a.name} <${a.address}>` : a.address))
    .join(", ");
}

const AVATAR_COLORS = [
  "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
];

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.split(/[\s@]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function EmailViewer({ email }: EmailViewerProps) {
  const [showImages, setShowImages] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const hasBody = Boolean(email.body_html || email.body_text);

  const sanitizedHtml = useMemo(() => {
    if (!hasBody) {
      return "<em class=\"text-muted-foreground\">Loading content…</em>";
    }
    const raw = email.body_html || email.body_text?.replace(/\n/g, "<br>") || "<em>No content</em>";
    let html = showImages ? raw : stripImages(raw);
    DOMPurify.addHook("afterSanitizeAttributes", hardenEmailLinks);
    const clean = DOMPurify.sanitize(html, SANITIZE_CONFIG);
    DOMPurify.removeHook("afterSanitizeAttributes", hardenEmailLinks);
    return clean;
  }, [email.body_html, email.body_text, showImages, hasBody]);

  const handleClickInIframe = useCallback(async (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a");
    if (!anchor) return;
    e.preventDefault();
    e.stopPropagation();
    const href = anchor.getAttribute("href");
    if (!href) return;
    const url = resolveEmailLink(href);
    if (!url) return;
    await openExternalUrl(url);
  }, []);

  const hasImages = useMemo(() => {
    const raw = email.body_html || "";
    return /<img\b/i.test(raw);
  }, [email.body_html]);

  const senderName = email.from?.[0]?.name || email.from?.[0]?.address || "Unknown";

  const iframeDoc = useMemo(() => {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<base target="_blank">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: hsl(var(--foreground)); background: hsl(var(--background)); font-size: 14px; line-height: 1.6; margin: 0; padding: 0; word-wrap: break-word; }
  a { color: #7c3aed; text-decoration: none; }
  a:hover { text-decoration: underline; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; max-width: 100%; }
  pre { overflow-x: auto; }
  .blocked-image { border: 1px dashed #999; padding: 8px; margin: 4px 0; color: #999; font-size: 12px; border-radius: 4px; }
  blockquote { border-left: 3px solid hsl(var(--border)); margin: 0; padding-left: 12px; color: hsl(var(--muted-foreground)); }
</style>
</head>
<body>${sanitizedHtml}</body>
</html>`;
  }, [sanitizedHtml]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.srcdoc = iframeDoc;
  }, [iframeDoc]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        doc.addEventListener("click", handleClickInIframe);

        const body = doc.body;
        const resize = () => {
          iframe.style.height = `${body.scrollHeight + 20}px`;
        };
        resize();
        const observer = new MutationObserver(resize);
        observer.observe(body, { childList: true, subtree: true, attributes: true });
        return () => {
          doc.removeEventListener("click", handleClickInIframe);
          observer.disconnect();
        };
      } catch {
        // cross-origin — skip
      }
    };

    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [handleClickInIframe, iframeDoc]);

  return (
    <div className="flex flex-col">
      {/* Email header */}
      <div className="px-6 pt-5 pb-3 space-y-2.5">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-medium ${avatarColor(senderName)}`}>
            {initials(senderName)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold leading-tight">
              {email.subject || "(no subject)"}
            </h2>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-sm font-medium text-foreground truncate">
                {senderName}
              </span>
              <span className="text-xs text-muted-foreground truncate">
                {email.from?.[0]?.address}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hasImages && !showImages && (
              <button
                onClick={() => setShowImages(true)}
                className="text-[11px] text-muted-foreground hover:text-foreground border border-border rounded-md px-2 py-1 transition-colors"
              >
                Show images
              </button>
            )}
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              {formatDate(email.received_at)}
            </span>
          </div>
        </div>
        {email.to && email.to.length > 0 && (
          <div className="text-xs text-muted-foreground pl-12">
            <span className="text-muted-foreground/60">to </span>
            {formatAddresses(email.to)}
          </div>
        )}
        {email.cc && email.cc.length > 0 && (
          <div className="text-xs text-muted-foreground pl-12">
            <span className="text-muted-foreground/60">cc </span>
            {formatAddresses(email.cc)}
          </div>
        )}
        {email.labels.length > 0 && (
          <div className="flex items-center gap-1.5 pl-12 flex-wrap">
            {email.labels.map((label) => (
              <LabelPill key={label} label={label} />
            ))}
          </div>
        )}
      </div>

      {/* Email body — sandboxed iframe for isolation */}
      <div className="px-6 pb-6 pt-1">
        <iframe
          ref={iframeRef}
          sandbox="allow-same-origin"
          className="w-full border-0"
          style={{ minHeight: "200px" }}
          title="Email content"
        />
      </div>
    </div>
  );
}

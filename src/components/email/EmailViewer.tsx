import { useCallback, useMemo, useState } from "react";
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
    "tbody", "td", "th", "thead", "tr", "ul", "font", "center", "style",
  ],
  ALLOWED_ATTR: [
    "href", "style", "class", "width", "height", "align", "valign",
    "bgcolor", "color", "size", "face", "cellpadding", "cellspacing",
    "border", "colspan", "rowspan",
  ],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: [
    "script", "iframe", "object", "embed", "form", "input", "textarea", "select",
    "base", "meta",
  ],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
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

  const handleBodyClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    const url = resolveEmailLink(href);
    if (!url) return;
    e.preventDefault();
    e.stopPropagation();
    await openExternalUrl(url);
  }, []);

  const hasImages = useMemo(() => {
    const raw = email.body_html || "";
    return /<img\b/i.test(raw);
  }, [email.body_html]);

  const senderName = email.from?.[0]?.name || email.from?.[0]?.address || "Unknown";

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

      {/* Email body */}
      <div className="px-6 pb-6 pt-1">
        <div
          className="prose prose-sm max-w-none prose-headings:font-semibold prose-a:text-violet-600 prose-a:no-underline hover:prose-a:underline prose-blockquote:border-l-muted-foreground/30"
          onClick={handleBodyClick}
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      </div>
    </div>
  );
}

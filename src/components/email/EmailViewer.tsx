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
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-[10px] font-medium bg-yellow-50 text-yellow-700 border border-yellow-200">
        &#9733; Flagged
      </span>
    );
  }
  if (label === "\\Answered") {
    return (
      <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-green-50 text-green-700 border border-green-200">
        &#8617; Answered
      </span>
    );
  }
  if (label === "\\Draft") {
    return (
      <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-gray-50 text-gray-600 border border-gray-200">
        Draft
      </span>
    );
  }
  if (label === "\\Deleted" || label.startsWith("\\Seen") || label === "\\Recent" || label === "\\MayCreate") {
    return null;
  }
  if (label.startsWith("\\")) return null;
  return (
    <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
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

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-4 py-3 space-y-1 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold leading-tight">
            {email.subject || "(no subject)"}
          </h2>
          {hasImages && !showImages && (
            <button
              onClick={() => setShowImages(true)}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1"
            >
              Show Images
            </button>
          )}
        </div>
        <div className="text-sm text-muted-foreground space-y-0.5">
          <div>
            <span className="font-medium text-foreground">From:</span>{" "}
            {formatAddresses(email.from)}
          </div>
          <div>
            <span className="font-medium text-foreground">To:</span>{" "}
            {formatAddresses(email.to)}
          </div>
          {email.cc && email.cc.length > 0 && (
            <div>
              <span className="font-medium text-foreground">Cc:</span>{" "}
              {formatAddresses(email.cc)}
            </div>
          )}
          <div className="text-xs">{formatDate(email.received_at)}</div>
        {email.labels.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {email.labels.map((label) => (
              <LabelPill key={label} label={label} />
            ))}
          </div>
        )}
      </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div
          className="prose prose-sm max-w-none [&_a]:text-primary [&_a]:underline [&_a]:cursor-pointer"
          onClick={handleBodyClick}
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      </div>
    </div>
  );
}

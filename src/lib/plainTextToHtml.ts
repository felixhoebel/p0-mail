function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMarkdown(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__(.+?)__/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return out;
}

function isBulletLine(line: string): boolean {
  const t = line.trim();
  return /^[-*•]\s+/.test(t) || /^\d+\.\s+/.test(t);
}

function stripBulletPrefix(line: string): string {
  return line.trim().replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, "");
}

function blockToHtml(block: string): string {
  const lines = block.split("\n");
  const trimmedLines = lines.map((l) => l.trimEnd());
  const nonEmpty = trimmedLines.filter((l) => l.trim().length > 0);

  if (nonEmpty.length === 0) return "";

  const allBullets = nonEmpty.every((l) => isBulletLine(l));
  if (allBullets) {
    const items = nonEmpty
      .map((l) => `<li>${inlineMarkdown(stripBulletPrefix(l))}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  }

  const paragraphs: string[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    const html = buffer.map((l) => inlineMarkdown(l)).join("<br>");
    paragraphs.push(`<p>${html}</p>`);
    buffer = [];
  };

  for (const line of trimmedLines) {
    if (line.trim() === "") {
      flushBuffer();
      continue;
    }
    if (isBulletLine(line)) {
      flushBuffer();
      paragraphs.push(`<ul><li>${inlineMarkdown(stripBulletPrefix(line))}</li></ul>`);
      continue;
    }
    buffer.push(line.trim());
  }
  flushBuffer();

  return paragraphs.join("");
}

export function plainTextToHtml(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const blocks = normalized.split(/\n{2,}/);
  const html = blocks.map(blockToHtml).filter(Boolean).join("");

  return html || `<p>${inlineMarkdown(normalized.replace(/\n/g, "<br>"))}</p>`;
}

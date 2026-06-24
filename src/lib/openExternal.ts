import { openUrl } from "@tauri-apps/plugin-opener";

export function resolveEmailLink(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed === "#") {
    return null;
  }
  const normalized = trimmed.replace(/[\x00-\x20]+/g, "").toLowerCase();
  const scheme = normalized.split(":")[0];
  if (["javascript", "vbscript", "data", "file"].includes(scheme)) {
    return null;
  }
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (/^www\./i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

export async function openExternalUrl(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

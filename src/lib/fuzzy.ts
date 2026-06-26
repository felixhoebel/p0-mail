export interface FuzzyResult {
  score: number;
  matches: number[];
}

const WORD_BOUNDARY = /[\s._\-/@:,;]/;

export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  if (!query) return { score: 0, matches: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const matches: number[] = [];
  let qi = 0;
  let prev = -2;
  let consecutive = 0;
  let score = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      matches.push(ti);
      if (ti === 0 || WORD_BOUNDARY.test(t[ti - 1])) score += 12;
      if (ti === prev + 1) {
        consecutive += 1;
        score += 5 * consecutive;
      } else {
        consecutive = 0;
      }
      score += 2;
      prev = ti;
      qi += 1;
    }
  }

  if (qi < q.length) return null;
  score -= (t.length - q.length) * 0.15;
  if (q.length === t.length) score += 20;
  return { score, matches };
}

export function highlightSegments(
  text: string,
  matches: number[],
): { text: string; match: boolean }[] {
  if (matches.length === 0) return [{ text, match: false }];
  const segments: { text: string; match: boolean }[] = [];
  let cursor = 0;
  for (const idx of matches) {
    if (idx > cursor) segments.push({ text: text.slice(cursor, idx), match: false });
    segments.push({ text: text[idx], match: true });
    cursor = idx + 1;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

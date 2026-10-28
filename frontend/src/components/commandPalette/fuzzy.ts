/**
 * Ranking for the command palette: prefix matches beat word-start matches, which beat
 * substring matches, which beat loose subsequence matches. Accents and case are ignored.
 */

const TIER = { prefix: 4000, wordStart: 3000, substring: 2000, subsequence: 1000 } as const;

export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function subsequenceScore(query: string, text: string): number | null {
  let qi = 0;
  let streak = 0;
  let bonus = 0;
  let first = -1;
  let last = -1;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) {
      if (first < 0) first = ti;
      last = ti;
      streak += 1;
      bonus += streak;
      qi += 1;
    } else {
      streak = 0;
    }
  }
  if (qi < query.length) return null;
  // Letters scattered across a long title are noise ("glow" in "lights ... low")
  if (last - first + 1 > Math.max(query.length * 4, 8)) return null;
  return TIER.subsequence + bonus * 4 - first;
}

/** Score of `query` against one string, or null when it does not match at all. */
export function scoreText(query: string, text: string): number | null {
  const q = normalizeForSearch(query);
  if (!q) return 0;
  const t = normalizeForSearch(text);
  if (!t) return null;
  // Shorter candidates win ties so "Play" ranks above "Playback speed 0.5x"
  const lengthPenalty = Math.min(t.length, 200) * 0.5;
  if (t.startsWith(q)) return TIER.prefix - lengthPenalty;
  const wordStart = t.search(new RegExp(`(^|[\\s/·\\-_(])${escapeRegExp(q)}`));
  if (wordStart >= 0) return TIER.wordStart - wordStart - lengthPenalty;
  const index = t.indexOf(q);
  if (index >= 0) return TIER.substring - index - lengthPenalty;
  const loose = subsequenceScore(q, t);
  return loose === null ? null : loose - lengthPenalty;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface Searchable {
  title: string;
  subtitle?: string;
  keywords?: string[];
}

/** Best score across the title, keywords and subtitle (secondary fields rank lower). */
export function scoreItem(query: string, item: Searchable): number | null {
  let best = scoreText(query, item.title);
  const consider = (text: string | undefined, penalty: number) => {
    if (!text) return;
    const s = scoreText(query, text);
    if (s !== null && (best === null || s - penalty > best)) best = s - penalty;
  };
  item.keywords?.forEach((k) => consider(k, 150));
  consider(item.subtitle, 400);
  return best;
}

/** Filters and orders items for a query, keeping at most `limit` results. */
export function rankItems<T extends Searchable>(query: string, items: T[], limit = 50): T[] {
  if (!normalizeForSearch(query)) return items.slice(0, limit);
  return items
    .map((item, order) => ({ item, order, score: scoreItem(query, item) }))
    .filter((r): r is { item: T; order: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((r) => r.item);
}

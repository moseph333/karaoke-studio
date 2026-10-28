/**
 * Recently run palette commands, most recent first (stored per browser).
 */

export const PALETTE_RECENT_STORAGE_KEY = 'karaoke_palette_recent';
const MAX_RECENT = 8;

export function loadRecentCommandIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PALETTE_RECENT_STORAGE_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

export function rememberRecentCommand(id: string): void {
  try {
    const next = [id, ...loadRecentCommandIds().filter((existing) => existing !== id)];
    localStorage.setItem(PALETTE_RECENT_STORAGE_KEY, JSON.stringify(next.slice(0, MAX_RECENT)));
  } catch {
    // Storage unavailable: recents are a convenience only
  }
}

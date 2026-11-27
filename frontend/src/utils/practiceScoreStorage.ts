/**
 * The best whole-song practice score of each song, kept in this browser only. Scores are the
 * singer's own: nothing about them is sent to the server.
 */

export const PRACTICE_SCORES_KEY = 'karaoke_practice_scores_v1';
/** Songs remembered: the oldest go first. */
const MAX_SONGS = 200;

type Stored = Record<string, number>;

function read(): Stored {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PRACTICE_SCORES_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Stored = {};
    for (const [song, share] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof share === 'number' && share >= 0 && share <= 1) out[song] = share;
    }
    return out;
  } catch {
    return {};
  }
}

/** The best share of the whole song sung in tune (0 to 1), or null when there is none yet. */
export function bestSongScore(songId: string): number | null {
  return read()[songId] ?? null;
}

/** Keeps `share` when it beats the song's best; returns the best after. */
export function keepSongScore(songId: string, share: number): number {
  const stored = read();
  const best = Math.max(stored[songId] ?? 0, Math.min(1, Math.max(0, share)));
  // Written last, so the song practised most recently is the last to be forgotten
  delete stored[songId];
  stored[songId] = best;
  const songs = Object.keys(stored);
  for (const old of songs.slice(0, Math.max(0, songs.length - MAX_SONGS))) delete stored[old];
  try {
    window.localStorage.setItem(PRACTICE_SCORES_KEY, JSON.stringify(stored));
  } catch {
    // Not remembered: the score still shows for this visit
  }
  return best;
}

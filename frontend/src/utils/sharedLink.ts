/**
 * Share target: on Android the installed app appears in the system share sheet (see
 * `share_target` in public/manifest.json), and a share opens `/?title=…&text=…&url=…`.
 * The YouTube app puts the video link in `text` (sometimes after the video title), other
 * apps use `url`. This picks what to put in the song search box: a YouTube link when the
 * share has one, otherwise the shared words as search terms (e.g. a song title shared from
 * a music app).
 */

/** Query parameters the manifest's share_target maps a share into. */
export const SHARE_PARAMS = ['title', 'text', 'url'] as const;

const YOUTUBE_LINK = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:youtube\.com|youtu\.be)\/[^\s<>"']+/i;
const ANY_LINK = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const MAX_SEARCH_LENGTH = 200;

function withScheme(link: string): string {
  return /^https?:\/\//i.test(link) ? link : `https://${link}`;
}

/** The search-box text for a share, or null when the URL carries no share. */
export function sharedIntakeQuery(params: URLSearchParams): string | null {
  const values = SHARE_PARAMS.map((key) => params.get(key)?.trim() ?? '').filter(Boolean);
  if (values.length === 0) return null;

  for (const key of ['url', 'text', 'title'] as const) {
    const match = params.get(key)?.match(YOUTUBE_LINK);
    if (match) return withScheme(match[0]);
  }

  for (const key of ['title', 'text'] as const) {
    const words = (params.get(key) ?? '').replace(ANY_LINK, ' ').replace(/\s+/g, ' ').trim();
    if (words) return words.slice(0, MAX_SEARCH_LENGTH);
  }
  return null;
}

/** The current address without the share parameters (kept: ?project, ?t and the hash). */
export function urlWithoutShareParams(location: Pick<Location, 'pathname' | 'search' | 'hash'>) {
  const params = new URLSearchParams(location.search);
  SHARE_PARAMS.forEach((key) => params.delete(key));
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
}

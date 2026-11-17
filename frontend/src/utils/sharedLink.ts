/**
 * Share target: on Android the installed app appears in the system share sheet (see
 * `share_target` in public/manifest.json), and a share opens `/?title=…&text=…&url=…`.
 * The YouTube app puts the video link in `text` (sometimes after the video title), other
 * apps use `url`. This picks what to put in the song search box: a song link from a
 * supported site (YouTube, SoundCloud, Bandcamp, Vimeo, Internet Archive, Spotify, Apple
 * Music, TIDAL) when the share has one, otherwise the shared words as search terms (e.g. a
 * song title shared from another music app).
 */

import { linkSite } from './mediaLinks';

/** Query parameters the manifest's share_target maps a share into. */
export const SHARE_PARAMS = ['title', 'text', 'url'] as const;

const ANY_LINK = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
// A link with or without its scheme (the YouTube app has shared "youtu.be/…")
const SITE_LINK = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"']*/gi;
const MAX_SEARCH_LENGTH = 200;

function withScheme(link: string): string {
  return /^https?:\/\//i.test(link) ? link : `https://${link}`;
}

/** The search-box text for a share, or null when the URL carries no share. */
export function sharedIntakeQuery(params: URLSearchParams): string | null {
  const values = SHARE_PARAMS.map((key) => params.get(key)?.trim() ?? '').filter(Boolean);
  if (values.length === 0) return null;

  for (const key of ['url', 'text', 'title'] as const) {
    const links = params.get(key)?.match(SITE_LINK) ?? [];
    const songLink = links.find((link) => linkSite(link));
    if (songLink) return withScheme(songLink);
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

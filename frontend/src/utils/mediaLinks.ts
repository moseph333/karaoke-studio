/**
 * Song links the intake accepts, from `@shared/media_sites.json`, which the backend reads too
 * (`backend/services/media_links.py`): YouTube, SoundCloud, Bandcamp, Vimeo and the Internet
 * Archive, whose audio the server downloads, and Spotify, Apple Music and TIDAL, whose songs
 * it finds on YouTube. The studio only tells a supported site's link from search words and
 * other sites; the server decides whether the link is one song (not a profile, an album or a
 * playlist) and says what to paste instead.
 */

import mediaSites from '@shared/media_sites.json';

export interface MediaSite {
  id: string;
  name: string;
  domains: string[];
  example: string;
  /** `download`: the server downloads the audio. `lookup`: it finds the song on YouTube. */
  kind: string;
}

export const MEDIA_SITES: readonly MediaSite[] = mediaSites.sites;

function sentence(names: string[], last: string): string {
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} ${last} ${names[names.length - 1]}`;
}

const namesOf = (kind?: string) =>
  MEDIA_SITES.filter((site) => !kind || site.kind === kind).map((site) => site.name);

/** "YouTube, SoundCloud, Bandcamp, Vimeo, Internet Archive, Spotify, Apple Music or TIDAL" */
export const SUPPORTED_SITES_SENTENCE = sentence(namesOf(), 'or');
/** "YouTube, SoundCloud, Bandcamp, Vimeo and Internet Archive" */
export const DOWNLOAD_SITES_SENTENCE = sentence(namesOf('download'), 'and');
/** "Spotify, Apple Music and TIDAL" */
export const LOOKUP_SITES_SENTENCE = sentence(namesOf('lookup'), 'and');

/** A site's display name ("Spotify") from its id. */
export function siteName(id: string): string {
  return MEDIA_SITES.find((site) => site.id === id)?.name ?? id;
}

/** The supported site a link points to, or null for search words, a bare video id or a
 * link to another site. Same rule as `media_links.link_site`. */
export function linkSite(text: string): string | null {
  const clean = text.trim();
  if (!clean || /\s/.test(clean) || !clean.includes('.')) return null;
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(clean) ? clean : `https://${clean}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  const site = MEDIA_SITES.find((s) =>
    s.domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
  );
  return site ? site.id : null;
}

/** Whether the text looks like a link at all (to any site), rather than search words. */
export function looksLikeLink(text: string): boolean {
  const clean = text.trim();
  return (
    /^https?:\/\//i.test(clean) ||
    /^www\./i.test(clean) ||
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}\/\S*$/i.test(clean)
  );
}

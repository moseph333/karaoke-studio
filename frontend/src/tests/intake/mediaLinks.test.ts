/**
 * Which pasted text is a song link the intake takes (YouTube, SoundCloud, Bandcamp, Vimeo,
 * Internet Archive, and Spotify, Apple Music, TIDAL and Deezer, found on YouTube): the same sites and host rule as the backend, through the shared
 * cases in backend/assets/shared/media_sites.json.
 */

import { describe, it, expect } from 'vitest';
import mediaSites from '@shared/media_sites.json';
import {
  DOWNLOAD_SITES_SENTENCE,
  LOOKUP_SITES_SENTENCE,
  MEDIA_SITES,
  SUPPORTED_SITES_SENTENCE,
  siteName,
  linkSite,
  looksLikeLink,
} from '../../utils/mediaLinks';

describe('song links', () => {
  it.each(mediaSites.host_cases)('$text is a $site link', ({ text, site }) => {
    expect(linkSite(text)).toBe(site);
  });

  it('lists every site in one sentence, in the shared order', () => {
    expect(MEDIA_SITES.map((site) => site.id)).toEqual([
      'youtube',
      'soundcloud',
      'bandcamp',
      'vimeo',
      'archive',
      'spotify',
      'applemusic',
      'tidal',
      'deezer',
    ]);
    expect(SUPPORTED_SITES_SENTENCE).toBe(
      'YouTube, SoundCloud, Bandcamp, Vimeo, Internet Archive, Spotify, Apple Music, TIDAL or Deezer'
    );
    expect(DOWNLOAD_SITES_SENTENCE).toBe(
      'YouTube, SoundCloud, Bandcamp, Vimeo and Internet Archive'
    );
    expect(LOOKUP_SITES_SENTENCE).toBe('Spotify, Apple Music, TIDAL and Deezer');
    expect(siteName('applemusic')).toBe('Apple Music');
  });

  it('tells a link to another site from search words', () => {
    expect(looksLikeLink('https://open.spotify.com/track/1')).toBe(true);
    expect(looksLikeLink('www.deezer.com/track/1')).toBe(true);
    expect(looksLikeLink('music.apple.com/us/album/x')).toBe(true);
    expect(looksLikeLink('Bohemian Rhapsody Queen')).toBe(false);
    expect(looksLikeLink('Mr. Brightside')).toBe(false);
    expect(looksLikeLink('dQw4w9WgXcQ')).toBe(false);
  });
});

/**
 * Which pasted text is a song link the intake can download (YouTube, SoundCloud, Bandcamp,
 * Vimeo, Internet Archive): the same sites and host rule as the backend, through the shared
 * cases in backend/assets/shared/media_sites.json.
 */

import { describe, it, expect } from 'vitest';
import mediaSites from '@shared/media_sites.json';
import {
  MEDIA_SITES,
  SUPPORTED_SITES_SENTENCE,
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
    ]);
    expect(SUPPORTED_SITES_SENTENCE).toBe(
      'YouTube, SoundCloud, Bandcamp, Vimeo or Internet Archive'
    );
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

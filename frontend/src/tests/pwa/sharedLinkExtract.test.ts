/**
 * Shares into the installed app (Android share sheet → /?title=…&text=…&url=…) become the
 * song search text: a song link from a supported site when there is one, otherwise the
 * shared words.
 */

import { describe, it, expect } from 'vitest';
import { sharedIntakeQuery, urlWithoutShareParams } from '../../utils/sharedLink';

const query = (params: Record<string, string>) => sharedIntakeQuery(new URLSearchParams(params));

describe('sharedIntakeQuery', () => {
  it('returns null when the address carries no share', () => {
    expect(query({})).toBeNull();
    expect(query({ project: 'abc' })).toBeNull();
    expect(query({ text: '   ' })).toBeNull();
  });

  it('takes the link the YouTube app puts after the title in text', () => {
    expect(
      query({
        title: 'Song (Official Video)',
        text: 'Song (Official Video) https://youtu.be/abc123?si=x',
      })
    ).toBe('https://youtu.be/abc123?si=x');
  });

  it('prefers the url parameter and accepts YouTube Music and mobile hosts', () => {
    expect(
      query({ url: 'https://music.youtube.com/watch?v=abc', text: 'https://youtu.be/other' })
    ).toBe('https://music.youtube.com/watch?v=abc');
    expect(query({ text: 'https://m.youtube.com/watch?v=xyz' })).toBe(
      'https://m.youtube.com/watch?v=xyz'
    );
  });

  it('adds https:// to a bare youtu.be link', () => {
    expect(query({ text: 'listen youtu.be/abc' })).toBe('https://youtu.be/abc');
  });

  it('does not mistake look-alike hosts for YouTube', () => {
    expect(query({ text: 'https://notyoutube.com.evil/watch' })).toBeNull();
  });

  it('takes links shared from SoundCloud, Bandcamp, Vimeo and the Internet Archive', () => {
    expect(
      query({
        text: 'Listen to Flickermood by Forss on #SoundCloud https://on.soundcloud.com/Ab12',
      })
    ).toBe('https://on.soundcloud.com/Ab12');
    expect(query({ url: 'https://artist.bandcamp.com/track/a-song' })).toBe(
      'https://artist.bandcamp.com/track/a-song'
    );
    expect(query({ text: 'vimeo.com/76979871' })).toBe('https://vimeo.com/76979871');
    expect(query({ url: 'https://archive.org/details/item/track.mp3' })).toBe(
      'https://archive.org/details/item/track.mp3'
    );
  });

  it('skips a link to another site for a song link later in the share', () => {
    expect(
      query({ text: 'https://example.com/blog then https://soundcloud.com/forss/flickermood' })
    ).toBe('https://soundcloud.com/forss/flickermood');
  });

  it('falls back to the shared words, without other links, as search terms', () => {
    expect(
      query({ title: 'Bohemian Rhapsody - Queen', text: 'https://open.spotify.com/track/1' })
    ).toBe('Bohemian Rhapsody - Queen');
    expect(query({ text: 'Dancing Queen  ABBA https://example.com/x' })).toBe('Dancing Queen ABBA');
  });

  it('caps very long shared text', () => {
    expect(query({ text: 'a'.repeat(500) })?.length).toBe(200);
  });
});

describe('urlWithoutShareParams', () => {
  it('removes title, text and url and keeps the rest', () => {
    expect(
      urlWithoutShareParams({
        pathname: '/',
        search: '?text=hi&project=p1&url=x&title=t',
        hash: '#h',
      })
    ).toBe('/?project=p1#h');
    expect(urlWithoutShareParams({ pathname: '/', search: '?text=hi', hash: '' })).toBe('/');
  });
});

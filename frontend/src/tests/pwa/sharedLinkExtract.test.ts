/**
 * Shares into the installed app (Android share sheet → /?title=…&text=…&url=…) become the
 * song search text: a YouTube link when there is one, otherwise the shared words.
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

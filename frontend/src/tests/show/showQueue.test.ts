/**
 * A show's queue: who sings what, in order; how it is kept across a reload; and the small
 * rules beside it (which words YouTube is searched with, what a pasted link is, how a video
 * that cannot be embedded gets on stage).
 */

import { describe, expect, it } from 'vitest';
import { videoMode } from '../../hooks/useShowPlayer';
import { videoNote, type ShowVideoInfo } from '../../hooks/useShowVideos';
import {
  DEFAULT_SHOW_TITLE,
  SHOW_QUEUE_STORAGE_KEY,
  billingOf,
  cleanShowTitle,
  finishedEntries,
  loadShowQueue,
  loadShowTitle,
  playingEntry,
  saveShowQueue,
  saveShowTitle,
  showQueueReducer,
  waitingEntries,
  type ShowAction,
  type ShowQueue,
  type ShowSource,
} from '../../utils/showQueue';
import { isShowUrl, isStageWindowUrl } from '../../utils/stageLink';
import { karaokeQuery, youtubeVideoId } from '../../utils/youtube';

const video = (title: string): ShowSource => ({
  kind: 'youtube',
  videoId: 'dQw4w9WgXcQ',
  title,
  artist: 'Sing King',
});
const song = (title: string): ShowSource => ({
  kind: 'library',
  projectId: 'demo',
  title,
  artist: 'The Midnight Static',
});

const run = (actions: ShowAction[], start: ShowQueue = []): ShowQueue =>
  actions.reduce(showQueueReducer, start);

const three = run([
  { type: 'add', id: 'a', singer: 'Alex', source: video('Dancing Queen') },
  { type: 'add', id: 'b', singer: 'Bo', source: song('Neon Skyline') },
  { type: 'add', id: 'c', singer: 'Cy', source: video('Halo') },
]);
const singers = (queue: ShowQueue) => waitingEntries(queue).map((e) => e.singer);

describe('adding singers', () => {
  it('queues them in the order they were added', () => {
    expect(singers(three)).toEqual(['Alex', 'Bo', 'Cy']);
    expect(playingEntry(three)).toBeNull();
  });

  it('tidies the name and refuses an empty one', () => {
    const queue = run([
      { type: 'add', id: 'a', singer: '  Alex   B  ', source: song('Halo') },
      { type: 'add', id: 'b', singer: '   ', source: song('Halo') },
    ]);
    expect(queue.map((e) => e.singer)).toEqual(['Alex B']);
  });

  it('lets one singer be in the queue twice', () => {
    const queue = run([{ type: 'add', id: 'd', singer: 'Alex', source: song('Halo') }], three);
    expect(singers(queue)).toEqual(['Alex', 'Bo', 'Cy', 'Alex']);
  });
});

describe('the order of the queue', () => {
  it('moves a singer earlier or later among those waiting', () => {
    expect(singers(run([{ type: 'move', id: 'c', by: -1 }], three))).toEqual(['Alex', 'Cy', 'Bo']);
    expect(singers(run([{ type: 'move', id: 'a', by: 1 }], three))).toEqual(['Bo', 'Alex', 'Cy']);
  });

  it('leaves the first and the last where they are at the ends', () => {
    expect(run([{ type: 'move', id: 'a', by: -1 }], three)).toBe(three);
    expect(run([{ type: 'move', id: 'c', by: 1 }], three)).toBe(three);
  });

  it('moves past singers who have already been on', () => {
    const queue = run(
      [
        { type: 'start', id: 'b' },
        { type: 'finish', id: 'b' },
        { type: 'move', id: 'c', by: -1 },
      ],
      three
    );
    expect(singers(queue)).toEqual(['Cy', 'Alex']);
  });

  it('takes a singer off', () => {
    expect(singers(run([{ type: 'remove', id: 'b' }], three))).toEqual(['Alex', 'Cy']);
  });
});

describe('who is on stage', () => {
  it('is the entry that was started', () => {
    const queue = run([{ type: 'start', id: 'b' }], three);
    expect(playingEntry(queue)?.singer).toBe('Bo');
    expect(singers(queue)).toEqual(['Alex', 'Cy']);
  });

  it('is one singer at a time: starting another ends the first', () => {
    const queue = run(
      [
        { type: 'start', id: 'a' },
        { type: 'start', id: 'c' },
      ],
      three
    );
    expect(playingEntry(queue)?.singer).toBe('Cy');
    expect(finishedEntries(queue).map((e) => [e.singer, e.status])).toEqual([['Alex', 'done']]);
  });

  it('lists those who have been on latest first, the skipped among them', () => {
    const queue = run(
      [
        { type: 'start', id: 'a' },
        { type: 'finish', id: 'a' },
        { type: 'start', id: 'b' },
        { type: 'skip', id: 'b' },
      ],
      three
    );
    expect(finishedEntries(queue).map((e) => [e.singer, e.status])).toEqual([
      ['Bo', 'skipped'],
      ['Alex', 'done'],
    ]);
  });

  it('puts a singer who has been on at the end of the line to go again', () => {
    const queue = run(
      [
        { type: 'start', id: 'a' },
        { type: 'finish', id: 'a' },
        { type: 'again', id: 'a' },
      ],
      three
    );
    expect(singers(queue)).toEqual(['Bo', 'Cy', 'Alex']);
    expect(finishedEntries(queue)).toEqual([]);
  });

  it('clears those who have been on and keeps the rest', () => {
    const queue = run(
      [
        { type: 'start', id: 'a' },
        { type: 'finish', id: 'a' },
        { type: 'start', id: 'b' },
        { type: 'clear-finished' },
      ],
      three
    );
    expect(queue.map((e) => e.singer)).toEqual(['Bo', 'Cy']);
  });
});

describe('the cards on the stage', () => {
  it('name a library song with its artist', () => {
    expect(billingOf(three[1])).toEqual({
      singer: 'Bo',
      title: 'Neon Skyline',
      artist: 'The Midnight Static',
    });
  });

  it('leave out a video’s uploader, who is not the artist', () => {
    expect(billingOf(three[0])).toEqual({ singer: 'Alex', title: 'Dancing Queen' });
  });
});

describe('the queue across a reload', () => {
  it('comes back as it was saved', () => {
    saveShowQueue(three);
    expect(loadShowQueue()).toEqual(three);
  });

  it('puts the singer who was on back at the head of the line: the song stopped', () => {
    saveShowQueue(run([{ type: 'start', id: 'c' }], three));

    const loaded = loadShowQueue();

    expect(playingEntry(loaded)).toBeNull();
    expect(singers(loaded)).toEqual(['Cy', 'Alex', 'Bo']);
  });

  it('keeps those who have sung where they were', () => {
    saveShowQueue(
      run(
        [
          { type: 'start', id: 'a' },
          { type: 'finish', id: 'a' },
          { type: 'start', id: 'b' },
        ],
        three
      )
    );

    const loaded = loadShowQueue();

    expect(singers(loaded)).toEqual(['Bo', 'Cy']);
    expect(finishedEntries(loaded).map((e) => e.singer)).toEqual(['Alex']);
  });

  it('drops what is not an entry and survives a broken save', () => {
    localStorage.setItem(
      SHOW_QUEUE_STORAGE_KEY,
      JSON.stringify([three[0], { id: 'x', singer: 'No song' }, 'nonsense', null])
    );
    expect(loadShowQueue()).toEqual([three[0]]);

    localStorage.setItem(SHOW_QUEUE_STORAGE_KEY, '{not json');
    expect(loadShowQueue()).toEqual([]);
  });
});

describe('the name of the night', () => {
  it('has a default, and an empty name falls back to it', () => {
    expect(loadShowTitle()).toBe(DEFAULT_SHOW_TITLE);
    expect(cleanShowTitle('   ')).toBe(DEFAULT_SHOW_TITLE);
  });

  it('is kept across a reload', () => {
    saveShowTitle('  Thursday   at the bar ');
    expect(loadShowTitle()).toBe('Thursday at the bar');
  });
});

describe('what YouTube is searched with', () => {
  it('is the song as a karaoke video', () => {
    expect(karaokeQuery('  dancing   queen ')).toBe('dancing queen karaoke');
  });

  it('is left alone when it already says karaoke', () => {
    expect(karaokeQuery('Halo Karaoke version')).toBe('Halo Karaoke version');
  });
});

describe('a pasted YouTube link', () => {
  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?t=10',
    'https://m.youtube.com/watch?list=PL1&v=dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
  ])('gives its video: %s', (link) => {
    expect(youtubeVideoId(link)).toBe('dQw4w9WgXcQ');
  });

  it.each([
    'dancing queen',
    'dQw4w9WgXcQ',
    'https://www.youtube.com/playlist?list=PL1',
    'https://www.youtube.com/watch?v=short',
    'https://vimeo.com/123456',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
  ])('is not taken for a video: %s', (text) => {
    expect(youtubeVideoId(text)).toBeNull();
  });
});

describe('the address of a show', () => {
  it('is the app with ?show, and a stage window is not a show', () => {
    expect(isShowUrl('?show=1')).toBe(true);
    expect(isShowUrl('?project=abc')).toBe(false);
    expect(isStageWindowUrl('?show=1')).toBe(false);
  });
});

describe('how a video gets on stage', () => {
  const info = (over: Partial<ShowVideoInfo>): ShowVideoInfo => ({
    embeddable: true,
    status: 'none',
    progress: 0,
    url: null,
    error: null,
    downloads: true,
    ...over,
  });

  it('plays in YouTube’s player when YouTube allows it, or has not said', () => {
    expect(videoMode(info({ embeddable: true }), false)).toBe('embed');
    expect(videoMode(info({ embeddable: null }), false)).toBe('embed');
    expect(videoMode(undefined, false)).toBe('embed');
  });

  it('plays from the server’s copy when the uploader does not allow embedding', () => {
    const ready = info({ embeddable: false, status: 'ready', url: '/api/show/videos/x/file' });
    expect(videoMode(ready, false)).toBe('file');
  });

  it('waits for the copy while it is fetched', () => {
    expect(videoMode(info({ embeddable: false, status: 'fetching' }), false)).toBe('copy');
    expect(videoMode(info({ embeddable: false, status: 'none' }), false)).toBe('copy');
  });

  it('takes the copy for a video YouTube refused only when it was played', () => {
    expect(videoMode(info({ embeddable: true, status: 'fetching' }), true)).toBe('copy');
    const ready = info({ embeddable: true, status: 'ready', url: '/api/show/videos/x/file' });
    expect(videoMode(ready, true)).toBe('file');
  });

  it('cannot be played when the copy failed or the server keeps none', () => {
    expect(videoMode(info({ embeddable: false, status: 'failed' }), false)).toBe('failed');
    expect(videoMode(info({ embeddable: false, downloads: false }), false)).toBe('failed');
  });

  it('says in the queue what stands in a blocked video’s way', () => {
    expect(videoNote(info({ embeddable: true }))).toBeNull();
    expect(videoNote(undefined)).toBeNull();
    expect(videoNote(info({ embeddable: false, status: 'fetching', progress: 41.6 }))).toBe(
      'Fetching a copy, 42%'
    );
    expect(videoNote(info({ embeddable: false, status: 'ready' }))).toBe('Plays from a copy');
    expect(videoNote(info({ embeddable: false, status: 'failed' }))).toMatch(/Cannot be played/);
    expect(videoNote(info({ embeddable: false, downloads: false }))).toMatch(/Only plays on/);
  });
});

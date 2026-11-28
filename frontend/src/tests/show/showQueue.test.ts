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
  joinPlace,
  loadShowQueue,
  loadShowTitle,
  loadShowTurns,
  playingEntry,
  saveShowQueue,
  saveShowTitle,
  saveShowTurns,
  showQueueReducer,
  turnPlace,
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

  it('puts a singer at any place in the line', () => {
    expect(singers(run([{ type: 'place', id: 'c', at: 0 }], three))).toEqual(['Cy', 'Alex', 'Bo']);
    expect(singers(run([{ type: 'place', id: 'a', at: 2 }], three))).toEqual(['Bo', 'Cy', 'Alex']);
    expect(singers(run([{ type: 'place', id: 'a', at: 1 }], three))).toEqual(['Bo', 'Alex', 'Cy']);
  });

  it('takes a place past either end as that end, and the same place as no move', () => {
    expect(singers(run([{ type: 'place', id: 'a', at: 9 }], three))).toEqual(['Bo', 'Cy', 'Alex']);
    expect(singers(run([{ type: 'place', id: 'c', at: -3 }], three))).toEqual(['Cy', 'Alex', 'Bo']);
    expect(run([{ type: 'place', id: 'b', at: 1 }], three)).toBe(three);
    expect(run([{ type: 'place', id: 'nobody', at: 0 }], three)).toBe(three);
  });

  it('counts places among those waiting, and leaves the singer on stage alone', () => {
    const queue = run(
      [
        { type: 'add', id: 'd', singer: 'Di', source: song('Halo') },
        { type: 'start', id: 'a' },
        { type: 'finish', id: 'a' },
        { type: 'start', id: 'b' },
      ],
      three
    );
    const placed = run([{ type: 'place', id: 'd', at: 0 }], queue);
    expect(singers(placed)).toEqual(['Di', 'Cy']);
    expect(playingEntry(placed)?.singer).toBe('Bo');
    expect(finishedEntries(placed).map((e) => e.singer)).toEqual(['Alex']);
    expect(run([{ type: 'place', id: 'b', at: 1 }], queue)).toBe(queue);
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

describe('singers taking turns', () => {
  /** A song that joins the line by turns. */
  const joins = (id: string, singer: string): ShowAction => ({
    type: 'add',
    id,
    singer,
    source: song(`Song ${id}`),
    turns: true,
  });
  const ids = (queue: ShowQueue) => waitingEntries(queue).map((e) => e.id);

  it('puts a singer’s second song behind everyone’s first', () => {
    const queue = run([joins('a2', 'Alex')], three);
    expect(ids(queue)).toEqual(['a', 'b', 'c', 'a2']);
  });

  it('puts a singer new to the line ahead of the second songs', () => {
    const queue = run([joins('a2', 'Alex'), joins('d', 'Dee')], three);
    expect(ids(queue)).toEqual(['a', 'b', 'c', 'd', 'a2']);
  });

  it('spreads songs added together over as many rounds', () => {
    const queue = run([
      joins('a1', 'Alex'),
      joins('a2', 'Alex'),
      joins('a3', 'Alex'),
      joins('b1', 'Bo'),
      joins('c1', 'Cy'),
      joins('b2', 'Bo'),
    ]);
    expect(ids(queue)).toEqual(['a1', 'b1', 'c1', 'a2', 'b2', 'a3']);
  });

  it('keeps the order of arrival among singers with one song each', () => {
    const queue = run([joins('a', 'Alex'), joins('b', 'Bo'), joins('c', 'Cy')]);
    expect(ids(queue)).toEqual(['a', 'b', 'c']);
  });

  it('counts the song on stage as the singer’s turn of this round', () => {
    // Alex is on with another song waiting: Bo, who has not been on, goes first
    const queue = run([
      joins('a1', 'Alex'),
      { type: 'start', id: 'a1' },
      joins('a2', 'Alex'),
      joins('b1', 'Bo'),
    ]);
    expect(ids(queue)).toEqual(['b1', 'a2']);
  });

  it('puts nobody ahead of the singer called while nobody is on', () => {
    // The stage window already says Alex is up next
    const queue = run([
      joins('a1', 'Alex'),
      { type: 'start', id: 'a1' },
      joins('a2', 'Alex'),
      { type: 'finish', id: 'a1' },
      joins('b1', 'Bo'),
    ]);
    expect(ids(queue)).toEqual(['a2', 'b1']);
  });

  it('takes two spellings of a name for one singer', () => {
    const queue = run([joins('a1', 'Alex B'), joins('b1', 'Bo'), joins('a2', '  alex   b ')]);
    expect(ids(queue)).toEqual(['a1', 'b1', 'a2']);
    expect(ids(run([joins('c1', 'Cy')], queue))).toEqual(['a1', 'b1', 'c1', 'a2']);
  });

  it('puts a singer who goes again where a new song of theirs would go', () => {
    const sung = run(
      [{ type: 'start', id: 'a' }, { type: 'finish', id: 'a' }, joins('b2', 'Bo')],
      three
    );
    expect(ids(sung)).toEqual(['b', 'c', 'b2']);

    expect(ids(run([{ type: 'again', id: 'a', turns: true }], sung))).toEqual([
      'b',
      'c',
      'a',
      'b2',
    ]);
    expect(ids(run([{ type: 'again', id: 'a' }], sung))).toEqual(['b', 'c', 'b2', 'a']);
  });

  it('moves nobody who is already waiting', () => {
    // The host put both of Alex’s songs ahead of Bo: they stay there
    const moved = run([
      joins('a1', 'Alex'),
      joins('b1', 'Bo'),
      joins('a2', 'Alex'),
      { type: 'move', id: 'a2', by: -1 },
    ]);
    expect(ids(moved)).toEqual(['a1', 'a2', 'b1']);
    expect(ids(run([joins('c1', 'Cy')], moved))).toEqual(['a1', 'a2', 'b1', 'c1']);
  });

  it('leaves those who have been on where they were listed', () => {
    const queue = run(
      [
        { type: 'start', id: 'a' },
        { type: 'finish', id: 'a' },
        joins('b2', 'Bo'),
        joins('d', 'Dee'),
      ],
      three
    );
    expect(ids(queue)).toEqual(['b', 'c', 'd', 'b2']);
    expect(finishedEntries(queue).map((e) => e.id)).toEqual(['a']);
  });

  it('says where a song would go before it is added', () => {
    const queue = run([joins('a2', 'Alex')], three);
    expect(turnPlace(queue, 'Dee')).toBe(3);
    expect(turnPlace(queue, 'Alex')).toBe(4);
    expect(joinPlace(queue, 'Dee', true)).toBe(3);
    expect(joinPlace(queue, 'Dee', false)).toBe(4);
    expect(turnPlace([], 'Dee')).toBe(0);
  });

  it('is on until the host turns it off, and that is kept across a reload', () => {
    expect(loadShowTurns()).toBe(true);
    saveShowTurns(false);
    expect(loadShowTurns()).toBe(false);
    saveShowTurns(true);
    expect(loadShowTurns()).toBe(true);
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

describe('taking back what the host did by hand', () => {
  it('sets a waiting singer aside instead of losing them', () => {
    const queue = run([{ type: 'set-aside', id: 'b' }], three);

    expect(singers(queue)).toEqual(['Alex', 'Cy']);
    expect(finishedEntries(queue).map((e) => e.singer)).toEqual(['Bo']);
    expect(queue.find((e) => e.id === 'b')?.status).toBe('skipped');
  });

  it('sets aside only a singer who is waiting', () => {
    const queue = run([{ type: 'start', id: 'a' }], three);

    expect(run([{ type: 'set-aside', id: 'a' }], queue)).toBe(queue);
    expect(run([{ type: 'set-aside', id: 'nobody' }], queue)).toBe(queue);
  });

  it('recalls a singer set aside to where they stood', () => {
    const queue = run(
      [
        { type: 'set-aside', id: 'b' },
        { type: 'recall', id: 'b' },
      ],
      three
    );

    expect(singers(queue)).toEqual(['Alex', 'Bo', 'Cy']);
  });

  it('leaves alone what happened between the action and its undo', () => {
    const queue = run(
      [
        { type: 'set-aside', id: 'b' },
        { type: 'add', id: 'd', singer: 'Di', source: video('Jolene') },
        { type: 'start', id: 'a' },
        { type: 'recall', id: 'b' },
      ],
      three
    );

    expect(playingEntry(queue)?.singer).toBe('Alex');
    expect(singers(queue)).toEqual(['Bo', 'Cy', 'Di']);
  });

  it('recalls the singer whose song was ended as the next to sing', () => {
    const queue = run(
      [
        { type: 'start', id: 'c' },
        { type: 'finish', id: 'c' },
        { type: 'recall', id: 'c', head: true },
      ],
      three
    );

    expect(singers(queue)).toEqual(['Cy', 'Alex', 'Bo']);
    expect(finishedEntries(queue)).toEqual([]);
  });

  it('recalls a skipped singer as the next to sing, too', () => {
    const queue = run(
      [
        { type: 'start', id: 'b' },
        { type: 'skip', id: 'b' },
        { type: 'recall', id: 'b', head: true },
      ],
      three
    );

    expect(singers(queue)).toEqual(['Bo', 'Alex', 'Cy']);
  });

  it('calls a recalled singer next even while somebody else is on', () => {
    const queue = run(
      [
        { type: 'start', id: 'a' },
        { type: 'finish', id: 'a' },
        { type: 'start', id: 'b' },
        { type: 'recall', id: 'a', head: true },
      ],
      three
    );

    expect(playingEntry(queue)?.singer).toBe('Bo');
    expect(singers(queue)).toEqual(['Alex', 'Cy']);
  });

  it('recalls nobody who is waiting, on stage or unknown', () => {
    const queue = run([{ type: 'start', id: 'a' }], three);

    expect(run([{ type: 'recall', id: 'a', head: true }], queue)).toBe(queue);
    expect(run([{ type: 'recall', id: 'b' }], queue)).toBe(queue);
    expect(run([{ type: 'recall', id: 'nobody' }], queue)).toBe(queue);
  });

  it('undoes twice over without one undo touching the other', () => {
    const queue = run(
      [
        { type: 'set-aside', id: 'a' },
        { type: 'set-aside', id: 'c' },
        // The older undo first
        { type: 'recall', id: 'a' },
      ],
      three
    );
    expect(singers(queue)).toEqual(['Alex', 'Bo']);

    expect(singers(run([{ type: 'recall', id: 'c' }], queue))).toEqual(['Alex', 'Bo', 'Cy']);
  });
});

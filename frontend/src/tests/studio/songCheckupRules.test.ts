/**
 * Song check-up rules: which rows a song gets from what the server stored about it, in
 * which order, and which tool each row points at.
 */

import { describe, expect, it } from 'vitest';
import type { LyricLine, ProjectState } from '../../types';
import { checkupFixCount, firstUncoveredVocalStart, songCheckup } from '../../utils/songCheckup';

const line = (id: number, start: number, extra: Partial<LyricLine> = {}): LyricLine => ({
  id,
  text: 'la la la',
  start_time: start,
  end_time: start + 3,
  words: [
    { word: 'la', start_time: start, end_time: start + 1 },
    { word: 'la', start_time: start + 1, end_time: start + 2 },
    { word: 'la', start_time: start + 2, end_time: start + 3 },
  ],
  confidence: 0.9,
  align_method: 'ctc',
  ...extra,
});

const song = (extra: Partial<ProjectState> = {}): ProjectState => ({
  id: 'song',
  status: 'ready',
  progress: 100,
  title: 'Song',
  artist: 'Singer',
  lines: [line(1, 5), line(2, 10)],
  semitones: 0,
  guide_volume: 0,
  lyric_timing: 'aligned',
  separation: { preset: 'balanced', label: 'Balanced · Mel-Band RoFormer' },
  sync_report: { version: 1, engine: 'ctc', lines_total: 2, mean_confidence: 0.9 },
  ...extra,
});

const ids = (project: ProjectState, options = {}) =>
  songCheckup(project, options).map((row) => `${row.level}:${row.id}`);

describe('a song with nothing wrong', () => {
  it('gets one fine row for the lyrics and one for the stems', () => {
    const rows = songCheckup(song());
    expect(rows.map((row) => `${row.level}:${row.id}`)).toEqual(['ok:lyrics-ok', 'ok:stems-ok']);
    expect(rows[0].detail).toBe('Timed word by word, 90% average confidence');
    expect(rows[1].detail).toBe('Balanced · Mel-Band RoFormer');
    expect(rows.every((row) => !row.action)).toBe(true);
    expect(checkupFixCount(song())).toBe(0);
  });
});

describe('lyrics', () => {
  it('points a song without lyrics at the lyric search, and says when none was found', () => {
    const rows = songCheckup(song({ lines: [], lyric_source: 'none', lyric_timing: 'none' }));
    expect(rows[0]).toMatchObject({ id: 'no-lyrics', level: 'fix', action: 'find-lyrics' });
    expect(rows[0].detail).toMatch(/No lyrics listing matched/);
    // Nothing else is said about lyrics that are not there
    expect(rows.map((row) => row.id)).toEqual(['no-lyrics', 'stems-ok']);
  });

  it('offers to time lyrics whose lines all sit at zero', () => {
    const untimed = [1, 2].map((id) => ({
      id,
      text: 'la',
      start_time: 0,
      end_time: 0,
      words: [],
    }));
    expect(songCheckup(song({ lines: untimed }))[0]).toMatchObject({
      id: 'untimed-lyrics',
      action: 'realign-all',
      actionLabel: 'Time the lyrics',
    });
  });

  it('counts the lines the timeline flags for review', () => {
    const project = song({
      lines: [line(1, 5, { confidence: 0.41 }), line(2, 10), line(3, 15, { confidence: 0.2 })],
    });
    const row = songCheckup(project).find((r) => r.id === 'review-lines');
    expect(row).toMatchObject({ level: 'fix', action: 'review-lines' });
    expect(row?.title).toBe('2 lines may be out of time');
    expect(checkupFixCount(project)).toBe(1);
  });

  it('suggests other lyrics first when the whole song aligned badly', () => {
    const project = song({
      lines: [line(1, 5, { confidence: 0.3 }), line(2, 10, { confidence: 0.4 })],
      sync_report: { version: 1, engine: 'ctc', lines_total: 2, mean_confidence: 0.35 },
    });
    expect(ids(project).slice(0, 2)).toEqual(['fix:shaky-timing', 'fix:review-lines']);
    const shaky = songCheckup(project)[0];
    expect(shaky.detail).toMatch(/35%/);
    expect(shaky).toMatchObject({ action: 'find-lyrics', actionLabel: 'Try other lyrics' });
  });

  it('lists singing that no line covers and where the first stretch starts', () => {
    const project = song({
      sync_report: {
        version: 1,
        engine: 'ctc',
        lines_total: 2,
        mean_confidence: 0.9,
        vocal_regions: [
          [4.8, 13.2],
          [44, 62.5],
          [80, 95],
        ],
      },
    });
    const row = songCheckup(project).find((r) => r.id === 'uncovered-vocals');
    expect(row?.title).toBe('2 sung parts have no lyrics');
    expect(row?.detail).toMatch(/0:44/);
    expect(row).toMatchObject({ action: 'uncovered-vocals', actionLabel: 'Go to the first one' });
    expect(firstUncoveredVocalStart(project)).toBe(44);
    expect(firstUncoveredVocalStart(song())).toBeNull();
  });

  it('names why the basic aligner timed the words, as a tip', () => {
    const project = song({
      sync_report: {
        version: 1,
        engine: 'dsp',
        lines_total: 2,
        mean_confidence: 0.8,
        fallback_reason: 'the alignment model is not downloaded',
      },
    });
    const rows = songCheckup(project);
    const tip = rows.find((r) => r.id === 'basic-aligner');
    expect(tip).toMatchObject({ level: 'tip' });
    expect(tip?.detail).toMatch(/the alignment model is not downloaded/);
    // A tip is not something to fix: the lyrics still count as fine
    expect(rows.map((r) => r.id)).toContain('lyrics-ok');
    expect(checkupFixCount(project)).toBe(0);
  });

  it('reports a re-timing that failed, and one that is running', () => {
    const failed = song({
      sync_job: {
        id: 'j1',
        status: 'error',
        mode: 'lines',
        progress: 40,
        detail: 'Could not re-align the lyrics; they keep their previous timing',
        error: 'worker exited',
      },
    });
    expect(songCheckup(failed)[0]).toMatchObject({
      id: 'sync-failed',
      level: 'fix',
      action: 'realign-all',
      detail: 'Could not re-align the lyrics; they keep their previous timing (worker exited)',
    });

    const running = song({
      sync_job: { id: 'j2', status: 'running', mode: 'lines', progress: 37.6 },
    });
    expect(songCheckup(running).find((r) => r.id === 'sync-running')?.title).toBe(
      'The lyrics are being re-timed (38%)'
    );
  });
});

describe('stems', () => {
  it('says which quality was asked for when the stems fell back, and why', () => {
    const project = song({
      separation: {
        preset: 'fast',
        label: 'Fast · Demucs',
        requested: 'best',
        fallback_reason: 'skipped, the cloud GPU is unavailable',
      },
    });
    const row = songCheckup(project)[0];
    expect(row).toMatchObject({ id: 'stems-fell-back', level: 'fix', action: 'improve-stems' });
    expect(row.title).toBe('The stems are Fast quality, not the Best you asked for');
    expect(row.detail).toMatch(/skipped, the cloud GPU is unavailable/);
  });

  it('tips that Fast stems can be re-made, unless the server has nothing better', () => {
    const fast = song({ separation: { preset: 'fast' } });
    expect(ids(fast)).toEqual(['tip:stems-fast', 'ok:lyrics-ok']);
    expect(ids(fast, { betterStemsAvailable: true })).toContain('tip:stems-fast');
    expect(ids(fast, { betterStemsAvailable: false })).toEqual(['ok:lyrics-ok', 'ok:stems-ok']);
    // Songs from before stem presets were recorded were made with Fast
    expect(ids(song({ separation: null }))).toContain('tip:stems-fast');
    expect(checkupFixCount(fast)).toBe(0);
  });

  it('reports a re-separation that failed, and one that is running', () => {
    const failed = song({
      separation_job: {
        id: 's1',
        status: 'error',
        quality: 'best',
        progress: 12,
        detail: 'Could not re-make the stems; the song keeps its previous stems',
        error: 'out of memory',
      },
    });
    expect(songCheckup(failed)[0]).toMatchObject({
      id: 'stems-failed',
      level: 'fix',
      action: 'improve-stems',
      detail: 'Could not re-make the stems; the song keeps its previous stems (out of memory)',
    });

    const running = song({
      separation_job: { id: 's2', status: 'queued', quality: 'best', progress: 0 },
    });
    expect(ids(running)).toEqual(['tip:stems-running', 'ok:lyrics-ok']);
  });
});

describe('order', () => {
  it('puts what to fix first, then tips, then what is fine', () => {
    const project = song({
      lines: [line(1, 5, { confidence: 0.3 }), line(2, 10)],
      separation: { preset: 'fast' },
    });
    expect(ids(project)).toEqual(['fix:review-lines', 'tip:stems-fast']);
    const mixed = song({ separation: { preset: 'fast' } });
    expect(ids(mixed)).toEqual(['tip:stems-fast', 'ok:lyrics-ok']);
  });
});

describe('a song found on YouTube from Spotify, Apple Music or TIDAL', () => {
  const match = {
    site: 'spotify',
    title: 'Never Gonna Give You Up',
    artist: 'Rick Astley',
    duration: 214,
    youtube_title: 'Rick Astley - Never Gonna Give You Up (Official Video)',
  };

  it('says which upload stood in for the song', () => {
    const rows = songCheckup(song({ song_match: match, duration: 213 }));
    expect(rows.map((row) => `${row.level}:${row.id}`)).toEqual([
      'ok:lyrics-ok',
      'ok:stems-ok',
      'ok:matched-ok',
    ]);
    expect(rows[2].title).toBe('Found on YouTube from Spotify');
    expect(rows[2].detail).toBe(
      '“Rick Astley - Never Gonna Give You Up (Official Video)” stood in for “Never Gonna Give You Up” by Rick Astley.'
    );
  });

  it('tips that an upload of another length may be another edit', () => {
    const rows = songCheckup(song({ song_match: { ...match, site: 'tidal' }, duration: 226 }));
    expect(rows[0]).toMatchObject({
      id: 'matched-length',
      level: 'tip',
      title: 'The YouTube upload is 12 s longer than the TIDAL song',
    });
    expect(checkupFixCount(song({ song_match: match, duration: 226 }))).toBe(0);
  });

  it('adds nothing for a song from any other link', () => {
    expect(ids(song())).toEqual(['ok:lyrics-ok', 'ok:stems-ok']);
  });
});

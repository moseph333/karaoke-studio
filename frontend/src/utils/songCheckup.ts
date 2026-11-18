/**
 * Song check-up: what looks off about the open song and which tool fixes it, read from what
 * the server already stored (the lines' confidence, the sync report, the stems' record, the
 * background jobs). The studio's header, the first-song card and the check-up dialog show
 * the rows; each row's action is a `GuideAction`.
 */

import type { ProjectState, SeparationPreset } from '../types';
import type { GuideAction } from './guideActions';
import { formatTime } from './format';
import { siteName } from './mediaLinks';
import { PRESET_NAMES, stemsLabel } from './quality';
import { getLyricSyncFidelity } from './syncStatus';
import { LOW_CONFIDENCE_THRESHOLD, collectLineIssues } from './timelineReview';
import { uncoveredVocals } from './uncoveredVocals';
import { isActiveJobStatus } from './jobs';

/** `fix`: something is likely wrong. `tip`: it works, and could be better. `ok`: fine. */
export type CheckupLevel = 'fix' | 'tip' | 'ok';

export interface CheckupRow {
  id: string;
  level: CheckupLevel;
  title: string;
  detail: string;
  action?: GuideAction;
  /** The action button's text, when the action's usual label would not say enough. */
  actionLabel?: string;
}

export interface CheckupOptions {
  /** Whether this server can run a better stem preset than the song's. Unknown when left out
   * (the server has not said yet): a Fast song still gets the tip. */
  betterStemsAvailable?: boolean;
}

const LEVEL_ORDER: Record<CheckupLevel, number> = { fix: 0, tip: 1, ok: 2 };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const jobFailure = (job: { detail?: string; error?: string | null }, fallback: string) =>
  [job.detail || fallback, job.error ? `(${job.error})` : ''].filter(Boolean).join(' ');

function lyricRows(project: ProjectState): CheckupRow[] {
  const lines = project.lines ?? [];
  const report = project.sync_report;
  const job = project.sync_job;
  const rows: CheckupRow[] = [];

  if (job && isActiveJobStatus(job.status)) {
    rows.push({
      id: 'sync-running',
      level: 'tip',
      title: `The lyrics are being re-timed (${Math.round(job.progress)}%)`,
      detail: 'The song stays playable. The new timing loads when it is ready.',
    });
  } else if (job?.status === 'error') {
    rows.push({
      id: 'sync-failed',
      level: 'fix',
      title: 'The last re-timing did not finish',
      detail: jobFailure(job, 'The lyrics keep their previous timing.'),
      action: 'realign-all',
      actionLabel: 'Re-time the lyrics again',
    });
  }

  if (lines.length === 0) {
    rows.push({
      id: 'no-lyrics',
      level: 'fix',
      title: 'No lyrics were found for this song',
      detail:
        project.lyric_source === 'none'
          ? 'No lyrics listing matched its title and artist. Search under another spelling, or paste the lyrics: the studio times them to the singing.'
          : 'Search for the lyrics or paste them: the studio times them to the singing.',
      action: 'find-lyrics',
    });
    return rows;
  }

  const timed = lines.some((l) => (l.start_time || 0) > 0 || (l.end_time || 0) > 0);
  if (!timed) {
    rows.push({
      id: 'untimed-lyrics',
      level: 'fix',
      title: 'The lyrics have no timing yet',
      detail: 'The words are there, but nothing says when each is sung.',
      action: 'realign-all',
      actionLabel: 'Time the lyrics',
    });
    return rows;
  }

  const mean = report?.mean_confidence;
  if (typeof mean === 'number' && Number.isFinite(mean) && mean < LOW_CONFIDENCE_THRESHOLD) {
    rows.push({
      id: 'shaky-timing',
      level: 'fix',
      title: 'The timing looks unreliable across the song',
      detail: `Average confidence is ${Math.round(mean * 100)}%. The lyrics may belong to another version of the song (live, remix, radio edit). Try another listing before fixing lines one by one.`,
      action: 'find-lyrics',
      actionLabel: 'Try other lyrics',
    });
  }

  const flagged = collectLineIssues(lines).size;
  if (flagged > 0) {
    rows.push({
      id: 'review-lines',
      level: 'fix',
      title: `${plural(flagged, 'line', 'lines')} may be out of time`,
      detail:
        'They are marked in the timeline. Open a line’s menu and choose “Re-align this line”, or nudge it by hand.',
      action: 'review-lines',
    });
  }

  const uncovered = uncoveredVocals(report?.vocal_regions, lines);
  if (uncovered.length > 0) {
    rows.push({
      id: 'uncovered-vocals',
      level: 'fix',
      title: `${plural(uncovered.length, 'sung part has', 'sung parts have')} no lyrics`,
      detail: `The first is at ${formatTime(uncovered[0].start)}. It is often a chorus the lyrics wrote down once. Listen, then add the missing lines in the timeline.`,
      action: 'uncovered-vocals',
      actionLabel: uncovered.length === 1 ? 'Go to it' : 'Go to the first one',
    });
  }

  if (report?.engine === 'dsp' && report.fallback_reason) {
    rows.push({
      id: 'basic-aligner',
      level: 'tip',
      title: 'The words were timed by the basic aligner',
      detail: `The more accurate neural aligner was not available (${report.fallback_reason}), so more lines may need a touch-up.`,
    });
  }

  if (!rows.some((row) => row.level === 'fix')) {
    const sync = getLyricSyncFidelity(project);
    rows.push({
      id: 'lyrics-ok',
      level: 'ok',
      title: 'Lyrics and timing look good',
      detail: [
        sync.label === 'Line Synced' ? 'Timed line by line' : 'Timed word by word',
        sync.quality !== null ? `${sync.quality}% average confidence` : null,
      ]
        .filter(Boolean)
        .join(', '),
    });
  }
  return rows;
}

const presetName = (preset?: SeparationPreset | 'custom' | null) =>
  preset && preset !== 'custom' ? PRESET_NAMES[preset] : null;

function stemRows(project: ProjectState, options: CheckupOptions): CheckupRow[] {
  const separation = project.separation;
  const job = project.separation_job;
  const rows: CheckupRow[] = [];
  // Songs from before stem presets existed were all made with Fast
  const preset = separation?.preset ?? 'fast';

  if (job && isActiveJobStatus(job.status)) {
    rows.push({
      id: 'stems-running',
      level: 'tip',
      title: `The stems are being re-made (${Math.round(job.progress)}%)`,
      detail: 'The song plays on its current stems until the new ones are ready.',
    });
    return rows;
  }
  if (job?.status === 'error') {
    rows.push({
      id: 'stems-failed',
      level: 'fix',
      title: 'Re-making the stems did not finish',
      detail: jobFailure(job, 'The song keeps its previous stems.'),
      action: 'improve-stems',
      actionLabel: 'Try re-making the stems',
    });
  }

  const reason = separation?.fallback_reason;
  if (reason) {
    const made = presetName(preset) ?? stemsLabel(separation);
    const asked = presetName(separation?.requested);
    rows.push({
      id: 'stems-fell-back',
      level: 'fix',
      title:
        asked && asked !== made
          ? `The stems are ${made} quality, not the ${asked} you asked for`
          : `The stems fell back to ${made} quality`,
      detail: `Why: ${reason}. Re-make them once the better model can run.`,
      action: 'improve-stems',
    });
  } else if (preset === 'fast' && options.betterStemsAvailable !== false) {
    rows.push({
      id: 'stems-fast',
      level: 'tip',
      title: 'The stems are Fast quality',
      detail:
        'Fast can leave a little of the singer in the backing track. Balanced and Best are cleaner and take longer.',
      action: 'improve-stems',
    });
  }

  if (rows.length === 0) {
    rows.push({
      id: 'stems-ok',
      level: 'ok',
      title: 'The stems look good',
      detail: stemsLabel(separation),
    });
  }
  return rows;
}

// A matched upload this many seconds longer or shorter may be another edit of the song
const MATCH_LENGTH_TIP_SEC = 4;

/** A Spotify, Apple Music, TIDAL or Deezer song: which YouTube upload stood in for it. */
function matchRows(project: ProjectState): CheckupRow[] {
  const match = project.song_match;
  if (!match) return [];
  const site = siteName(match.site);
  const upload = match.youtube_title ? `“${match.youtube_title}”` : 'An upload';
  const song = `“${match.title}” by ${match.artist}`;
  const off =
    match.duration && project.duration ? Math.round(project.duration - match.duration) : 0;
  if (Math.abs(off) > MATCH_LENGTH_TIP_SEC) {
    return [
      {
        id: 'matched-length',
        level: 'tip',
        title: `The YouTube upload is ${Math.abs(off)} s ${off > 0 ? 'longer' : 'shorter'} than the ${site} song`,
        detail: `${upload} stood in for ${song}. It may be another edit; if the words drift, search for the song and pick another upload.`,
      },
    ];
  }
  return [
    {
      id: 'matched-ok',
      level: 'ok',
      title: `Found on YouTube from ${site}`,
      detail: `${upload} stood in for ${song}.`,
    },
  ];
}

/** Every row for the song, the ones to fix first. */
export function songCheckup(project: ProjectState, options: CheckupOptions = {}): CheckupRow[] {
  return [...lyricRows(project), ...stemRows(project, options), ...matchRows(project)]
    .map((row, index) => ({ row, index }))
    .sort((a, b) => LEVEL_ORDER[a.row.level] - LEVEL_ORDER[b.row.level] || a.index - b.index)
    .map(({ row }) => row);
}

/** How many rows say something is likely wrong. Does not depend on `CheckupOptions`. */
export function checkupFixCount(project: ProjectState): number {
  return songCheckup(project).filter((row) => row.level === 'fix').length;
}

/** Where the first stretch of singing without lyrics starts, or null when there is none. */
export function firstUncoveredVocalStart(project: ProjectState): number | null {
  const spans = uncoveredVocals(project.sync_report?.vocal_regions, project.lines ?? []);
  return spans.length > 0 ? spans[0].start : null;
}

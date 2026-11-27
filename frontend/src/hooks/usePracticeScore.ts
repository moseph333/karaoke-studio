/**
 * Scoring practice: how much of each pass was sung in tune.
 *
 * While the song plays with the microphone on, every reading is tallied against the melody
 * (`utils/practiceScore`). A pass ends when a repeat goes round or playback stops; its score
 * is shown, each line's latest score is kept for the part rows, and the best of the same
 * stretch (and, for the whole song, the best ever in this browser) is shown beside it.
 *
 * Readings are tallied in a ref: only the end of a pass is React state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LyricLine, MelodyData } from '../types';
import type { MicReading } from './useMicPitch';
import type { PlaybackClock } from './usePlaybackClock';
import {
  newTally,
  scorableLines,
  scorePass,
  tallySung,
  type LineScore,
  type PassScore,
  type PassTally,
} from '../utils/practiceScore';
import { bestSongScore, keepSongScore } from '../utils/practiceScoreStorage';

export interface UsePracticeScoreOptions {
  /** The microphone is on and the song has a melody: there is something to score. */
  enabled: boolean;
  songId: string | undefined;
  lines: LyricLine[];
  melody: MelodyData | null;
  /** The key the song plays in, in semitones from the original. */
  semitones: number;
  playbackRate: number;
  isPlaying: boolean;
  clock: PlaybackClock;
  /** The microphone's readings (`useMicPitch.subscribe`). */
  subscribe: (listener: (reading: MicReading) => void) => () => void;
}

export interface UsePracticeScoreReturn {
  /** The pass that ended last, or null before the first. */
  last: PassScore | null;
  /** The best share for the stretch `last` covered (0 to 1): this visit's, or for the whole
   *  song the best this browser remembers. */
  best: number | null;
  /** Each line's latest score, by its index in the song's lines. */
  lineScores: Readonly<Record<number, LineScore>>;
  /** The lines that can be scored at all (enough of the melody is sung in them). */
  scorable: readonly number[];
  /** Ends the pass now (a repeat went round). */
  endPass: () => void;
}

const NO_SCORES: Readonly<Record<number, LineScore>> = {};
const NO_LINES: readonly number[] = [];

export function usePracticeScore({
  enabled,
  songId,
  lines,
  melody,
  semitones,
  playbackRate,
  isPlaying,
  clock,
  subscribe,
}: UsePracticeScoreOptions): UsePracticeScoreReturn {
  const [last, setLast] = useState<PassScore | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [lineScores, setLineScores] = useState(NO_SCORES);
  const scorable = useMemo(
    () => (melody ? scorableLines(melody, lines) : NO_LINES),
    [melody, lines]
  );

  // Another song, another melody or another key: what was scored was scored against the old
  const scope = `${songId ?? ''}|${melody?.project_id ?? ''}|${melody?.midi.length ?? 0}|${semitones}`;
  const [scoredScope, setScoredScope] = useState(scope);
  if (scoredScope !== scope) {
    setScoredScope(scope);
    setLast(null);
    setBest(null);
    setLineScores(NO_SCORES);
  }

  const tallyRef = useRef<PassTally | null>(null);
  /** This visit's best share of each stretch, by "first-last" line. */
  const bestsRef = useRef(new Map<string, number>());
  const latest = useRef({ songId, lines, melody, semitones, playbackRate, isPlaying, scorable });
  latest.current = { songId, lines, melody, semitones, playbackRate, isPlaying, scorable };

  useEffect(() => {
    tallyRef.current = null;
    bestsRef.current = new Map();
  }, [scope]);

  const endPass = useCallback(() => {
    const state = latest.current;
    const tally = tallyRef.current;
    tallyRef.current = null;
    if (!tally || !state.melody) return;
    const score = scorePass(tally, state.melody, state.lines);
    if (!score) return;
    setLast(score);
    setLineScores((kept) => {
      const next = { ...kept };
      for (const line of score.lines) next[line.line] = line;
      return next;
    });
    const stretch = `${score.firstLine}-${score.lastLine}`;
    let top = Math.max(bestsRef.current.get(stretch) ?? 0, score.share);
    bestsRef.current.set(stretch, top);
    // The whole song: every line that can be scored was in the pass
    const whole = score.lines.length === state.scorable.length;
    if (whole && state.songId) top = keepSongScore(state.songId, score.share);
    setBest(top);
  }, []);

  // Tally every reading while the song plays
  useEffect(() => {
    if (!enabled) return;
    return subscribe((reading) => {
      const state = latest.current;
      if (!state.melody || !state.isPlaying) return;
      const tally = (tallyRef.current ??= newTally(state.melody));
      const time = clock.now() - reading.delay * state.playbackRate;
      tallySung(tally, state.melody, time, reading.midi, {
        semitones: state.semitones,
        rate: state.playbackRate,
      });
    });
  }, [enabled, subscribe, clock]);

  // Playback stopping ends the pass; so does the microphone going
  const wasPlaying = useRef(isPlaying);
  useEffect(() => {
    if (wasPlaying.current && !isPlaying) endPass();
    wasPlaying.current = isPlaying;
  }, [isPlaying, endPass]);
  useEffect(() => {
    if (!enabled) tallyRef.current = null;
  }, [enabled]);

  // The best this browser remembers for the whole song, shown before the first pass ends
  const remembered = useMemo(
    () => (enabled && songId ? bestSongScore(songId) : null),
    [enabled, songId]
  );

  return useMemo(
    () => ({ last, best: best ?? (last ? null : remembered), lineScores, scorable, endPass }),
    [last, best, remembered, lineScores, scorable, endPass]
  );
}

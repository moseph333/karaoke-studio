/**
 * Repeating a stretch of the song in practice: the part being sung, or a stretch picked line
 * by line. The rule is `utils/practiceLoop`; this hook watches the playback clock and sends
 * playback back to the start of the stretch when a pass ends.
 *
 * The clock ticks about four times a second, so the turn itself is aimed with a timer set
 * from the last tick: without it a pass would end up to a quarter of a second late.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LyricLine } from '../types';
import type { PlaybackClock } from './usePlaybackClock';
import { insideLoop, loopStart, loopStep, loopTurn } from '../utils/practiceLoop';
import {
  partAt,
  practiceParts,
  stretchOf,
  type PracticePart,
  type PracticeStretch,
} from '../utils/practiceSections';

/** `part`: the stretch follows the part the listener moves to. `custom`: it stays put. */
export type PracticeLoopMode = 'off' | 'part' | 'custom';

export interface UsePracticeLoopOptions {
  /** Practice is on; turning it off stops the repeat. */
  enabled: boolean;
  /** The open song; another song starts with nothing repeating. */
  songId: string | undefined;
  lines: LyricLine[];
  duration: number;
  clock: PlaybackClock;
  isPlaying: boolean;
  playbackRate: number;
  onSeek: (time: number) => void;
  /** A pass just ended and playback is about to go round again. */
  onPassEnd?: (stretch: PracticeStretch) => void;
}

export interface UsePracticeLoopReturn {
  parts: PracticePart[];
  mode: PracticeLoopMode;
  /** The stretch that repeats, or null. */
  range: PracticeStretch | null;
  /** Repeats the part under the playhead, or stops repeating. */
  toggleCurrentPart: () => void;
  /** Repeats a part (by its number) from its start. */
  repeatPart: (number: number) => void;
  /** Repeats from one line to another, by their index in the song's lines. */
  setStretch: (fromLine: number, toLine: number) => void;
  clear: () => void;
}

/** A timer is set only this close to the turn (seconds of wall time). */
const AIM_WITHIN_SEC = 1;
/** The timer may fire this early (song seconds) and still count as the turn. */
const AIM_SLACK_SEC = 0.08;

interface LoopState {
  mode: PracticeLoopMode;
  range: PracticeStretch | null;
}

const OFF: LoopState = { mode: 'off', range: null };

const sameStretch = (a: PracticeStretch | null, b: PracticeStretch | null) =>
  a?.firstLine === b?.firstLine &&
  a?.lastLine === b?.lastLine &&
  a?.start === b?.start &&
  a?.end === b?.end;

export function usePracticeLoop({
  enabled,
  songId,
  lines,
  duration,
  clock,
  isPlaying,
  playbackRate,
  onSeek,
  onPassEnd,
}: UsePracticeLoopOptions): UsePracticeLoopReturn {
  const parts = useMemo(() => (enabled ? practiceParts(lines) : []), [enabled, lines]);
  const [state, setState] = useState<LoopState>(OFF);

  // Leaving practice or opening another song stops the repeat (during render, so the old
  // stretch never reaches the new song's scrubber)
  const [tracked, setTracked] = useState({ enabled, songId });
  if (tracked.enabled !== enabled || tracked.songId !== songId) {
    setTracked({ enabled, songId });
    if (state.mode !== 'off') setState(OFF);
  }

  const latest = useRef({ onSeek, onPassEnd, lines, parts });
  latest.current = { onSeek, onPassEnd, lines, parts };
  /** The next seek on the clock is the loop's own, not the listener moving. */
  const ownSeekRef = useRef(false);

  const seekTo = useCallback((time: number) => {
    ownSeekRef.current = true;
    latest.current.onSeek(time);
    ownSeekRef.current = false;
  }, []);

  const { mode, range } = state;
  useEffect(() => {
    if (!range) return;
    let timer: number | undefined;
    let lastSeekId = clock.getState().seekId;
    const turn = loopTurn(range, duration);

    const goRound = () => {
      latest.current.onPassEnd?.(range);
      seekTo(loopStart(range));
    };
    const check = () => {
      window.clearTimeout(timer);
      const { seekId } = clock.getState();
      const sought = seekId !== lastSeekId;
      lastSeekId = seekId;
      const now = clock.now();
      if (sought) {
        // The listener went to another part: repeat that one instead
        if (!ownSeekRef.current && mode === 'part' && !insideLoop(range, now, duration)) {
          const part = partAt(latest.current.parts, now);
          if (part && !sameStretch(part, range)) {
            setState({ mode: 'part', range: part });
            return;
          }
        }
      } else if (isPlaying && loopStep(range, now, duration)) {
        goRound();
        return;
      }
      if (!isPlaying) return;
      const wait = (turn - now) / Math.max(0.1, playbackRate);
      if (wait <= 0 || wait > AIM_WITHIN_SEC) return;
      timer = window.setTimeout(() => {
        if (clock.now() >= turn - AIM_SLACK_SEC) goRound();
        else check();
      }, wait * 1000);
    };

    check();
    const unsubscribe = clock.subscribe(check);
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [range, mode, clock, duration, isPlaying, playbackRate, seekTo]);

  const repeat = useCallback(
    (next: LoopState, { jump }: { jump: boolean }) => {
      setState(next);
      if (jump && next.range) seekTo(loopStart(next.range));
    },
    [seekTo]
  );

  const toggleCurrentPart = useCallback(() => {
    if (state.mode !== 'off') {
      setState(OFF);
      return;
    }
    const part = partAt(latest.current.parts, clock.now());
    if (part) repeat({ mode: 'part', range: part }, { jump: false });
  }, [state.mode, clock, repeat]);

  const repeatPart = useCallback(
    (number: number) => {
      const part = latest.current.parts.find((candidate) => candidate.number === number);
      if (part) repeat({ mode: 'part', range: part }, { jump: true });
    },
    [repeat]
  );

  const setStretch = useCallback(
    (fromLine: number, toLine: number) => {
      const stretch = stretchOf(latest.current.lines, fromLine, toLine);
      if (stretch) repeat({ mode: 'custom', range: stretch }, { jump: true });
    },
    [repeat]
  );

  const clear = useCallback(() => setState(OFF), []);

  return useMemo(
    () => ({ parts, mode, range, toggleCurrentPart, repeatPart, setStretch, clear }),
    [parts, mode, range, toggleCurrentPart, repeatPart, setStretch, clear]
  );
}

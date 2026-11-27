/**
 * Practice's pitch lane: the song's melody around the playhead, the notes sung into the
 * microphone trailing behind it, the matching ones lit, all drawn without re-rendering.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PracticePitchLane } from '../../components/practice/PracticePitchLane';
import type { MicReading } from '../../hooks/useMicPitch';
import { PlaybackClockContext, createPlaybackClock } from '../../hooks/usePlaybackClock';
import type { MelodyData } from '../../types';
import type { SungPoint } from '../../utils/pitchLane';
import { PRACTICE_MELODY } from '../helpers/practiceFixtures';

/** A microphone the test sings into. */
function fakeReadings() {
  const listeners = new Set<(reading: MicReading) => void>();
  return {
    subscribe: (listener: (reading: MicReading) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    sing: (midi: number | null, delay = 0) =>
      act(() => listeners.forEach((listener) => listener({ midi, delay }))),
    listeners,
  };
}

function setup({
  melody = PRACTICE_MELODY as MelodyData | null,
  time = 11,
  semitones = 0,
  playbackRate = 1,
} = {}) {
  const clock = createPlaybackClock();
  clock.setTime(time);
  const mic = fakeReadings();
  const onSung = vi.fn<(point: SungPoint, matched: boolean | null) => void>();
  const view = render(
    <PlaybackClockContext.Provider value={clock}>
      <PracticePitchLane
        melody={melody}
        semitones={semitones}
        playbackRate={playbackRate}
        subscribe={mic.subscribe}
        onSung={onSung}
      />
    </PlaybackClockContext.Provider>
  );
  /** Lets the lane draw a frame. */
  const frame = () => act(() => void vi.advanceTimersByTime(20));
  frame();
  return { ...view, clock, mic, onSung, frame };
}

const path = (id: string) => screen.getByTestId(id).getAttribute('d') ?? '';
const dot = () => screen.getByTestId('pitch-lane-dot');

describe('PracticePitchLane', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is a picture with a name, not a set of controls', () => {
    setup();
    const lane = screen.getByRole('img', { name: 'Your pitch against the song’s melody' });
    expect(lane).toBe(screen.getByTestId('practice-pitch-lane'));
    expect(lane.querySelector('button, input, a')).toBeNull();
  });

  it('draws the melody around the playhead', () => {
    // The first line is sung from 10 s to 12.5 s: in view at 11 s
    setup({ time: 11 });
    expect(path('pitch-lane-melody')).toMatch(/^M[\d.]+ [\d.]+L/);
  });

  it('draws no melody in a stretch where nothing is sung', () => {
    // 64 s in: the last line ended long before
    setup({ time: 80 });
    expect(path('pitch-lane-melody')).toBe('');
  });

  it('moves the melody as the song plays', () => {
    const { clock, frame } = setup({ time: 11 });
    const before = path('pitch-lane-melody');
    act(() => clock.setTime(12));
    frame();
    expect(path('pitch-lane-melody')).not.toBe(before);
  });

  it('shows the note being sung at the now line, lit when it matches', () => {
    const { mic, frame } = setup({ time: 11 });
    expect(dot()).toHaveAttribute('visibility', 'hidden');

    mic.sing(57);
    frame();
    expect(dot()).toHaveAttribute('visibility', 'visible');
    expect(dot()).toHaveAttribute('data-hit', 'true');
    expect(path('pitch-lane-hit')).not.toBe('');
    expect(path('pitch-lane-sung')).not.toBe('');

    // A third above the melody: sung, drawn, not lit
    mic.sing(61);
    frame();
    expect(dot()).toHaveAttribute('data-hit', 'false');
  });

  it('counts the right note in another octave', () => {
    const { mic, onSung } = setup({ time: 11 });
    mic.sing(45);
    const [point, matched] = onSung.mock.calls[0];
    expect(matched).toBe(true);
    // Drawn on the melody's line, not an octave below it
    expect(point.note).toBe(57);
  });

  it('hides the dot when the singer stops', () => {
    const { mic, frame } = setup();
    mic.sing(57);
    frame();
    mic.sing(null);
    frame();
    expect(dot()).toHaveAttribute('visibility', 'hidden');
  });

  it('places a note where it was sung, a moment before it was read', () => {
    const { mic, onSung } = setup({ time: 11 });
    mic.sing(57, 0.05);
    expect(onSung.mock.calls[0][0].time).toBeCloseTo(10.95);
  });

  it('counts less of a slowed song for the same delay', () => {
    const { mic, onSung } = setup({ time: 11, playbackRate: 0.5 });
    mic.sing(57, 0.05);
    expect(onSung.mock.calls[0][0].time).toBeCloseTo(10.975);
  });

  it('matches against the key the song plays in', () => {
    const { mic, onSung } = setup({ time: 11, semitones: 2 });
    mic.sing(57);
    mic.sing(59);
    expect(onSung.mock.calls.map(([, matched]) => matched)).toEqual([false, true]);
  });

  it('has nothing to match in a pause', () => {
    // The third line ends at 18.5 s and the fourth starts at 26 s: nothing is sung here
    const { mic, onSung } = setup({ time: 20.9 });
    mic.sing(57);
    expect(onSung.mock.calls[0][1]).toBeNull();
    expect(path('pitch-lane-hit')).toBe('');
  });

  it('draws the singer alone for a song without a melody', () => {
    const { mic, frame, onSung } = setup({ melody: null });
    expect(
      screen.getByRole('img', { name: 'Your pitch. This song has no melody to show.' })
    ).toBeInTheDocument();
    mic.sing(57);
    frame();
    expect(path('pitch-lane-melody')).toBe('');
    expect(path('pitch-lane-sung')).not.toBe('');
    expect(onSung.mock.calls[0][1]).toBeNull();
  });

  it('forgets the trail when the key changes', () => {
    const { mic, frame, rerender, clock } = setup({ time: 11 });
    mic.sing(57);
    frame();
    expect(path('pitch-lane-sung')).not.toBe('');

    rerender(
      <PlaybackClockContext.Provider value={clock}>
        <PracticePitchLane
          melody={PRACTICE_MELODY}
          semitones={3}
          playbackRate={1}
          subscribe={mic.subscribe}
        />
      </PlaybackClockContext.Provider>
    );
    frame();
    expect(path('pitch-lane-sung')).toBe('');
  });

  it('stops listening and drawing when it goes', () => {
    const { mic, unmount } = setup();
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    unmount();
    expect(mic.listeners.size).toBe(0);
    expect(cancel).toHaveBeenCalled();
  });

  it('uses only the app’s own colours, with the matching notes in the lit one', () => {
    setup();
    expect(screen.getByTestId('pitch-lane-melody')).toHaveClass('stroke-theme-text-muted');
    expect(screen.getByTestId('pitch-lane-sung')).toHaveClass('stroke-theme-text');
    expect(screen.getByTestId('pitch-lane-hit')).toHaveClass('stroke-theme-accent');
  });
});

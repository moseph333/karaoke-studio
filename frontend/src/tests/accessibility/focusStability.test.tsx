/**
 * Focus stays where the user works while a song plays: keyboard focus in the timeline holds
 * auto-scroll, the chord editor survives playback moving on, and chord cues are buttons.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LyricTimelineEditor } from '../../components/LyricTimelineEditor';
import { ChordBar } from '../../components/ChordBar';
import { createPlaybackClock, PlaybackClockContext } from '../../hooks/usePlaybackClock';
import { ChordSegment, LyricLine } from '../../types';

// A line every 5 s
const lines: LyricLine[] = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  text: `Line ${i + 1}`,
  start_time: i * 5,
  end_time: i * 5 + 4.5,
  words: [{ word: `Word${i + 1}`, start_time: i * 5, end_time: i * 5 + 4.5 }],
}));

const renderPlayingEditor = () => {
  const clock = createPlaybackClock();
  render(
    <>
      <PlaybackClockContext.Provider value={clock}>
        <LyricTimelineEditor
          lines={lines}
          duration={60}
          isPlaying
          onSeek={vi.fn()}
          onSaveLines={vi.fn()}
        />
      </PlaybackClockContext.Provider>
      <button type="button">Outside</button>
    </>
  );
  const container = screen.getByTestId('timeline-scroll-container');
  const scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options === 'object') container.scrollTop = options.top ?? 0;
  });
  container.scrollTo = scrollTo as unknown as typeof container.scrollTo;
  return { clock, container, scrollTo };
};

describe('timeline auto-scroll and keyboard focus', () => {
  it('holds while keyboard focus is inside the list, and resumes when it leaves', () => {
    const { clock, scrollTo } = renderPlayingEditor();
    act(() => clock.setTime(11));
    const scrollsBefore = scrollTo.mock.calls.length;

    // Tab onto a row control
    fireEvent.keyDown(document, { key: 'Tab' });
    act(() => screen.getByRole('button', { name: 'Delete line 4' }).focus());
    expect(screen.getByText(/Auto-scroll paused/i)).toBeInTheDocument();

    act(() => clock.setTime(36));
    expect(scrollTo).toHaveBeenCalledTimes(scrollsBefore);

    // Focus leaves the list: auto-scroll catches up with the playing line
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();
    expect(scrollTo.mock.calls.length).toBeGreaterThan(scrollsBefore);
  });

  it('does not hold for focus that follows a click', () => {
    const { clock, scrollTo } = renderPlayingEditor();
    act(() => clock.setTime(11));
    const row = screen.getByRole('button', { name: 'Delete line 4' });

    fireEvent.mouseDown(row);
    act(() => row.focus());
    expect(screen.queryByText(/Auto-scroll paused/i)).not.toBeInTheDocument();

    const scrollsBefore = scrollTo.mock.calls.length;
    act(() => clock.setTime(36));
    expect(scrollTo.mock.calls.length).toBeGreaterThan(scrollsBefore);
  });
});

describe('chord bar', () => {
  const chords: ChordSegment[] = [
    { chord: 'C', start: 0, end: 2 },
    { chord: 'G', start: 2, end: 4 },
    { chord: 'Am', start: 4, end: 6 },
    { chord: 'F', start: 6, end: 8 },
  ];

  it('keeps the chord editor and what was typed while playback moves to the next chord', () => {
    const onEditChord = vi.fn();
    const { rerender } = render(
      <ChordBar chords={chords} currentTime={1} onEditChord={onEditChord} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit chord C' }));
    fireEvent.change(screen.getByTestId('chord-edit-input'), { target: { value: 'Cmaj7' } });

    rerender(<ChordBar chords={chords} currentTime={2.5} onEditChord={onEditChord} />);
    rerender(<ChordBar chords={chords} currentTime={4.5} onEditChord={onEditChord} />);

    const input = screen.getByTestId('chord-edit-input');
    expect(input).toHaveValue('Cmaj7');
    fireEvent.keyDown(input, { key: 'Enter' });
    // The chord that was being edited, not the one playing now
    expect(onEditChord).toHaveBeenCalledWith(0, 'Cmaj7');
  });

  it('finds the edited chord again when the list changes underneath', () => {
    const onEditChord = vi.fn();
    const { rerender } = render(
      <ChordBar chords={chords} currentTime={2.5} onEditChord={onEditChord} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit chord G' }));
    fireEvent.change(screen.getByTestId('chord-edit-input'), { target: { value: 'G7' } });

    // A chord is inserted before it (index 1 becomes 2)
    const changed = [chords[0], { chord: 'Em', start: 1, end: 2 }, ...chords.slice(1)];
    rerender(<ChordBar chords={changed} currentTime={2.5} onEditChord={onEditChord} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm chord edit' }));

    expect(onEditChord).toHaveBeenCalledWith(2, 'G7');
  });

  it('shows upcoming chords as 44 px buttons that seek', () => {
    const onSeek = vi.fn();
    render(<ChordBar chords={chords} currentTime={1} onSeek={onSeek} />);

    const cue = screen.getByRole('button', { name: 'Seek to chord G at 0:02' });
    expect(cue.className).toContain('min-h-[44px]');
    expect(cue.className).toContain('min-w-[44px]');
    fireEvent.click(cue);
    expect(onSeek).toHaveBeenCalledWith(2);
  });

  it('shows cues as plain text when they cannot seek', () => {
    render(<ChordBar chords={chords} currentTime={1} />);
    expect(screen.queryByRole('button', { name: /Seek to chord/ })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('upcoming-chord-cue').length).toBeGreaterThan(0);
  });
});

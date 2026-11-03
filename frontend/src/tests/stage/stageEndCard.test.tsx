/**
 * The stage's end card: once the last line has left the stage, "Song over" with the
 * song's title and artist replaces the instrumental break and the replayed first line.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LyricDisplay } from '../../components/LyricDisplay';
import { LyricTimelineEditor } from '../../components/LyricTimelineEditor';
import { LyricLine } from '../../types';

const line = (id: number, text: string, start: number, end: number): LyricLine => ({
  id,
  text,
  start_time: start,
  end_time: end,
  words: [],
});

// The last line ends at 10s, so it leaves the stage at 11s
const songLines: LyricLine[] = [
  line(1, 'Sing with passion', 2, 5),
  line(2, 'Feel the rhythm', 7, 10),
];

const renderStage = (
  currentTime: number,
  props: Partial<React.ComponentProps<typeof LyricDisplay>> = {}
) =>
  render(
    <LyricDisplay
      lines={songLines}
      currentTime={currentTime}
      trackTitle="Closing Time"
      trackArtist="Semisonic"
      {...props}
    />
  );

describe('stage end card', () => {
  it('keeps the last line on the stage until its lead-out ends', () => {
    for (const t of [10.5, 11.0]) {
      const { unmount } = renderStage(t);
      expect(screen.getByTestId('active-lyrics-line')).toHaveTextContent('Feel the rhythm');
      expect(screen.getByText('-- End of song --')).toBeInTheDocument();
      expect(screen.queryByTestId('stage-end-card')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('shows the title and artist after the last line instead of a break and line 1', () => {
    renderStage(11.01);
    const card = screen.getByTestId('stage-end-card');
    expect(within(card).getByText('Song over')).toBeInTheDocument();
    expect(screen.getByTestId('stage-end-card-title')).toHaveTextContent('Closing Time');
    expect(screen.getByTestId('stage-end-card-artist')).toHaveTextContent('Semisonic');

    expect(screen.queryByText('♪ Instrumental Break ♪')).not.toBeInTheDocument();
    expect(screen.queryByTestId('upcoming-lyrics-line')).not.toBeInTheDocument();
    expect(screen.queryByText('-- End of song --')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gap-countdown-indicator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('countdown-cue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('active-lyrics-line')).not.toBeInTheDocument();
    expect(screen.queryByText('Sing with passion')).not.toBeInTheDocument();
  });

  it('stays on the stage after playback has reached the end of the song', () => {
    renderStage(999, { duration: 30 });
    expect(screen.getByTestId('stage-end-card')).toBeInTheDocument();
    expect(screen.getByTestId('stage-end-card-title')).toHaveTextContent('Closing Time');
  });

  it('shows only "Song over" when the song has no title or artist', () => {
    const { unmount } = renderStage(12, { trackTitle: undefined, trackArtist: undefined });
    expect(within(screen.getByTestId('stage-end-card')).getByText('Song over')).toBeInTheDocument();
    expect(screen.queryByTestId('stage-end-card-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-end-card-artist')).not.toBeInTheDocument();
    expect(screen.queryByText('-- End of song --')).not.toBeInTheDocument();
    unmount();

    renderStage(12, { trackTitle: '   ', trackArtist: '' });
    expect(screen.getByTestId('stage-end-card')).toHaveTextContent(/^Song over$/);
    expect(screen.queryByTestId('stage-end-card-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-end-card-artist')).not.toBeInTheDocument();
  });

  it('leaves out the placeholder artist the backend stores for unknown songs', () => {
    renderStage(12, { trackArtist: 'unknown artist' });
    expect(screen.getByTestId('stage-end-card-title')).toHaveTextContent('Closing Time');
    expect(screen.queryByTestId('stage-end-card-artist')).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown artist/i)).not.toBeInTheDocument();
  });

  it('trims the title and artist', () => {
    renderStage(12, { trackTitle: '  Closing Time ', trackArtist: ' Semisonic  ' });
    expect(screen.getByTestId('stage-end-card-title').textContent).toBe('Closing Time');
    expect(screen.getByTestId('stage-end-card-artist').textContent).toBe('Semisonic');
  });

  it('goes away when playback is scrubbed back into the song', () => {
    const { rerender } = renderStage(11.5);
    expect(screen.getByTestId('stage-end-card')).toBeInTheDocument();

    rerender(
      <LyricDisplay
        lines={songLines}
        currentTime={8.0}
        trackTitle="Closing Time"
        trackArtist="Semisonic"
      />
    );
    expect(screen.queryByTestId('stage-end-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-end-card-artist')).not.toBeInTheDocument();
    expect(screen.getByTestId('active-lyrics-line')).toHaveTextContent('Feel the rhythm');
  });

  it('is not shown for a song without lyrics, which keeps its break text', () => {
    renderStage(50, { lines: [] });
    expect(screen.queryByTestId('stage-end-card')).not.toBeInTheDocument();
    expect(screen.getByText('♪ Instrumental Break ♪')).toBeInTheDocument();
    expect(screen.getByText('-- End of song --')).toBeInTheDocument();
  });

  it('is not shown for untimed lyrics that are all at 0s', () => {
    renderStage(30, { lines: [line(1, 'Untimed one', 0, 0), line(2, 'Untimed two', 0, 0)] });
    expect(screen.queryByTestId('stage-end-card')).not.toBeInTheDocument();
    expect(screen.getByText('♪ Instrumental Break ♪')).toBeInTheDocument();
  });

  it('has no controls or headings and fades in only when motion is allowed', () => {
    renderStage(12);
    const card = screen.getByTestId('stage-end-card');
    const artist = screen.getByTestId('stage-end-card-artist');
    for (const el of [card, artist]) {
      expect(within(el).queryAllByRole('button')).toHaveLength(0);
      expect(within(el).queryAllByRole('heading')).toHaveLength(0);
    }
    expect(card.className).toContain('motion-safe:animate-fade-in');
    expect(card.className).not.toMatch(/(^|\s)animate-/);
  });
});

describe('upcoming line in a short break', () => {
  it('shows the next line rather than the first line of the song', () => {
    render(
      <LyricDisplay
        lines={[line(1, 'First verse line', 2, 5), line(2, 'Second verse line', 8.9, 12)]}
        currentTime={6.5}
      />
    );
    expect(screen.getByText('♪ Instrumental Break ♪')).toBeInTheDocument();
    expect(screen.getByTestId('upcoming-lyrics-line')).toHaveTextContent('Second verse line');
    expect(screen.queryByTestId('stage-end-card')).not.toBeInTheDocument();
  });

  it('shows the line that starts soonest when the lines are out of order', () => {
    render(
      <LyricDisplay
        lines={[
          line(3, 'Third verse line', 14, 16),
          line(1, 'First verse line', 2, 5),
          line(2, 'Second verse line', 8.9, 12),
        ]}
        currentTime={6.5}
      />
    );
    expect(screen.getByTestId('upcoming-lyrics-line')).toHaveTextContent('Second verse line');
  });
});

describe('end card in the timeline editor', () => {
  const editorProps = {
    lines: songLines,
    currentTime: 20,
    duration: 30,
    onSeek: vi.fn(),
    onSaveLines: vi.fn(),
  };

  it("passes the song's title and artist through to the stage", () => {
    render(
      <LyricTimelineEditor {...editorProps} trackTitle="Closing Time" trackArtist="Semisonic" />
    );
    const stage = screen.getByTestId('lyric-display-stage');
    const card = within(stage).getByTestId('stage-end-card');
    expect(within(card).getByText('Song over')).toBeInTheDocument();
    expect(within(card).getByTestId('stage-end-card-title')).toHaveTextContent('Closing Time');
    expect(within(stage).getByTestId('stage-end-card-artist')).toHaveTextContent('Semisonic');
  });

  it("never shows the editor's placeholder title and artist on the card", () => {
    render(<LyricTimelineEditor {...editorProps} />);
    const stage = screen.getByTestId('lyric-display-stage');
    const card = within(stage).getByTestId('stage-end-card');
    expect(card).toHaveTextContent(/^Song over$/);
    expect(within(stage).queryByTestId('stage-end-card-title')).not.toBeInTheDocument();
    expect(within(stage).queryByTestId('stage-end-card-artist')).not.toBeInTheDocument();
    expect(within(stage).queryByText('Track')).not.toBeInTheDocument();
    expect(within(stage).queryByText('Artist')).not.toBeInTheDocument();
  });
});

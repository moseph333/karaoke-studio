/**
 * The stage's end card: 1.5 s after the last line ends, the song's title and artist take the
 * stage until the song is over, as they do in the video.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LyricDisplay } from '../../components/LyricDisplay';
import { LyricTimelineEditor } from '../../components/LyricTimelineEditor';
import { getStageLook } from '../../theme/stageLooks';
import { LyricLine } from '../../types';

// KTV draws text as it is written (the default look sets capitals)
const KTV = getStageLook('ktv');

const line = (id: number, text: string, start: number, end: number): LyricLine => ({
  id,
  text,
  start_time: start,
  end_time: end,
  words: [],
});

// The last line ends at 10s: it leaves the stage at 11.2s and the card comes on at 11.5s
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
      duration={30}
      trackTitle="Closing Time"
      trackArtist="Semisonic"
      selectedTheme={KTV}
      {...props}
    />
  );

/** The words of the line being sung (each word is drawn twice: once to sing, once sung). */
const drawn = (row: HTMLElement) =>
  Array.from(row.querySelectorAll('.ks-word > span:first-child'), (word) => word.textContent).join(
    ''
  );

const alpha = (row: HTMLElement) => Number(row.style.getPropertyValue('--alpha'));

describe('stage end card', () => {
  it('keeps the last line on the stage until its lead-out ends', () => {
    for (const t of [10.5, 11.19]) {
      const { unmount } = renderStage(t);
      expect(drawn(screen.getByTestId('active-lyrics-line'))).toBe('Feel the rhythm');
      expect(screen.queryByTestId('stage-end-card-title')).not.toBeInTheDocument();
      unmount();
    }
    // Then the stage is clear for a moment before the card
    for (const t of [11.2, 11.49]) {
      const { unmount } = renderStage(t);
      expect(screen.queryByTestId('active-lyrics-line')).not.toBeInTheDocument();
      expect(screen.queryByTestId('stage-end-card-title')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('shows the title and artist after the last line instead of a break and line 1', () => {
    renderStage(11.5);
    expect(screen.getByTestId('stage-end-card-title')).toHaveTextContent('Closing Time');
    expect(screen.getByTestId('stage-end-card-artist')).toHaveTextContent('Semisonic');

    expect(screen.queryByTestId('stage-break-marker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-count-in')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-countin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('active-lyrics-line')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-line')).not.toBeInTheDocument();
    expect(screen.queryByText('Sing with passion')).not.toBeInTheDocument();
  });

  it('stays on the stage after playback has reached the end of the song', () => {
    // A player that has played the song through rests at the song's length
    for (const t of [30, 999]) {
      const { unmount } = renderStage(t, { duration: 30 });
      expect(screen.getByTestId('stage-end-card-title')).toHaveTextContent('Closing Time');
      unmount();
    }
  });

  it('shows no card when the song has no title or artist', () => {
    const { unmount } = renderStage(12, { trackTitle: undefined, trackArtist: undefined });
    expect(screen.queryByTestId('stage-end-card-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-end-card-artist')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-scrim')).not.toBeInTheDocument();
    unmount();

    renderStage(12, { trackTitle: '   ', trackArtist: '' });
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
    expect(screen.getByTestId('stage-end-card-title')).toBeInTheDocument();

    rerender(
      <LyricDisplay
        lines={songLines}
        currentTime={8.0}
        duration={30}
        trackTitle="Closing Time"
        trackArtist="Semisonic"
        selectedTheme={KTV}
      />
    );
    expect(screen.queryByTestId('stage-end-card-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-end-card-artist')).not.toBeInTheDocument();
    expect(drawn(screen.getByTestId('active-lyrics-line'))).toBe('Feel the rhythm');
  });

  it('is not shown for a song without lyrics', () => {
    renderStage(20, { lines: [] });
    expect(screen.queryByTestId('stage-end-card-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-end-card-artist')).not.toBeInTheDocument();
  });

  it('is not shown for untimed lyrics that are all at 0s', () => {
    const untimed = [line(1, 'Untimed one', 0, 0), line(2, 'Untimed two', 0, 0)];
    for (const t of [1.5, 20, 29]) {
      const { unmount } = renderStage(t, { lines: untimed });
      expect(screen.queryByTestId('stage-end-card-title')).not.toBeInTheDocument();
      expect(screen.queryByTestId('stage-end-card-artist')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('has no controls or headings and fades in as the video does', () => {
    const { unmount } = renderStage(12);
    const title = screen.getByTestId('stage-end-card-title');
    const artist = screen.getByTestId('stage-end-card-artist');
    for (const el of [title, artist]) {
      expect(within(el).queryAllByRole('button')).toHaveLength(0);
      expect(within(el).queryAllByRole('heading')).toHaveLength(0);
      expect(alpha(el)).toBe(1);
    }
    unmount();

    // Half way through the 0.4 s fade
    renderStage(11.7);
    expect(alpha(screen.getByTestId('stage-end-card-title'))).toBeCloseTo(0.5, 2);
    expect(alpha(screen.getByTestId('stage-end-card-artist'))).toBeCloseTo(0.5, 2);
  });
});

describe('upcoming line in a short break', () => {
  it('shows the next line rather than the first line of the song', () => {
    // The default look keeps the line to come under the reading place
    render(
      <LyricDisplay
        lines={[line(1, 'First verse line', 2, 5), line(2, 'Second verse line', 8.9, 12)]}
        currentTime={6.5}
        duration={30}
        trackTitle="Closing Time"
      />
    );
    expect(
      screen.getByRole('button', { name: 'Jump playback to line at 8.90 seconds' })
    ).toHaveTextContent('Second verse line');
    expect(screen.queryByText(/first verse line/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-break-marker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stage-end-card-title')).not.toBeInTheDocument();
  });
});

describe('end card in the timeline editor', () => {
  const editorProps = {
    lines: songLines,
    currentTime: 20,
    duration: 30,
    onSeek: vi.fn(),
    onSaveLines: vi.fn(),
    selectedTheme: KTV,
  };

  it("passes the song's title and artist through to the stage", () => {
    render(
      <LyricTimelineEditor {...editorProps} trackTitle="Closing Time" trackArtist="Semisonic" />
    );
    const stage = screen.getByTestId('lyric-display-stage');
    expect(within(stage).getByTestId('stage-end-card-title')).toHaveTextContent('Closing Time');
    expect(within(stage).getByTestId('stage-end-card-artist')).toHaveTextContent('Semisonic');
  });

  it("never shows the editor's placeholder title and artist on the card", () => {
    render(<LyricTimelineEditor {...editorProps} />);
    const stage = screen.getByTestId('lyric-display-stage');
    expect(within(stage).queryByTestId('stage-end-card-title')).not.toBeInTheDocument();
    expect(within(stage).queryByTestId('stage-end-card-artist')).not.toBeInTheDocument();
    expect(within(stage).queryByText('Track')).not.toBeInTheDocument();
    expect(within(stage).queryByText('Artist')).not.toBeInTheDocument();
  });
});

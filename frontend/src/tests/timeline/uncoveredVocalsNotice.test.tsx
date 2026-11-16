import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricTimelineEditor } from '../../components/LyricTimelineEditor';
import { uncoveredVocals } from '../../utils/uncoveredVocals';
import type { LyricLine, SyncReport } from '../../types';

const hook: LyricLine = {
  id: 1,
  text: "It's a good day",
  start_time: 39.9,
  end_time: 43,
  words: [],
};

const report = {
  version: 1,
  engine: 'dsp',
  lines_total: 1,
  vocal_regions: [
    [39.8, 43.2],
    [44, 62.5],
  ],
} as SyncReport;

describe('vocals without lyrics', () => {
  it('are the vocal regions no line covers, at least 2.5 s long', () => {
    expect(uncoveredVocals(report.vocal_regions, [hook])).toEqual([{ start: 44, end: 62.5 }]);
    expect(uncoveredVocals([[10, 12]], [])).toEqual([]);
    expect(uncoveredVocals(undefined, [hook])).toEqual([]);
  });

  it('follow the lines as they are edited', () => {
    const repeat: LyricLine = { ...hook, id: 2, start_time: 46, end_time: 49 };
    expect(uncoveredVocals(report.vocal_regions, [hook, repeat])).toEqual([
      { start: 49.3, end: 62.5 },
    ]);
  });

  it('are listed above the timeline, and a click plays them', async () => {
    const onSeek = vi.fn();
    const user = userEvent.setup();
    render(
      <LyricTimelineEditor
        lines={[hook]}
        currentTime={0}
        duration={206}
        onSeek={onSeek}
        onSaveLines={vi.fn()}
        syncReport={report}
      />
    );
    expect(screen.getByTestId('uncovered-vocals-notice')).toHaveTextContent('0:44–1:02');
    await user.click(screen.getByRole('button', { name: /Play the vocals without lyrics/ }));
    expect(onSeek).toHaveBeenCalledWith(44);
  });

  it('show nothing when every vocal stretch has a line', () => {
    render(
      <LyricTimelineEditor
        lines={[hook]}
        currentTime={0}
        duration={206}
        onSeek={vi.fn()}
        onSaveLines={vi.fn()}
        syncReport={{ ...report, vocal_regions: [[39.8, 43.2]] }}
      />
    );
    expect(screen.queryByTestId('uncovered-vocals-notice')).not.toBeInTheDocument();
  });
});

describe('repeats the server added', () => {
  it('are marked on their line', () => {
    const added: LyricLine = { ...hook, id: 7, start_time: 46, end_time: 49, added: 'repeat' };
    render(
      <LyricTimelineEditor
        lines={[hook, added]}
        currentTime={0}
        duration={206}
        onSeek={vi.fn()}
        onSaveLines={vi.fn()}
      />
    );
    expect(screen.getByTestId('line-added-repeat-7')).toHaveTextContent('Added repeat');
    expect(screen.queryByTestId('line-added-repeat-1')).not.toBeInTheDocument();
  });
});

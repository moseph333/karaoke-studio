/**
 * The timeline of a song without lyric lines: it leads to the lyric search before it offers
 * writing the lines by hand.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricTimelineEditor } from '../../components/LyricTimelineEditor';
import { ToastProvider } from '../../hooks/useToast';
import { expectTouchTarget } from '../helpers/responsiveTestUtils';

const renderEmptyTimeline = () =>
  render(
    <ToastProvider>
      <LyricTimelineEditor
        lines={[]}
        currentTime={0}
        duration={180}
        onSeek={vi.fn()}
        onSaveLines={vi.fn()}
        projectId="no-lyrics"
        trackTitle="Rare Song"
        trackArtist="Unknown Band"
      />
    </ToastProvider>
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a timeline without lyric lines', () => {
  it('offers the lyric search first, then writing the first line', () => {
    renderEmptyTimeline();

    const empty = screen.getByTestId('timeline-empty-state');
    expect(empty).toHaveTextContent('No lyric lines yet.');
    expect(empty).toHaveTextContent(/the studio times every word to the singing/);
    const buttons = within(empty).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Find or paste lyrics',
      '+ Add First Lyric Line',
    ]);
    buttons.forEach((button) => expectTouchTarget(button));
  });

  it('opens the Re-import dialog from "Find or paste lyrics"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    renderEmptyTimeline();

    await userEvent.click(screen.getByRole('button', { name: 'Find or paste lyrics' }));

    expect(screen.getByRole('dialog', { name: /Replace \/ Re-align Lyrics/i })).toBeInTheDocument();
  });

  it('goes away once a line is added', async () => {
    renderEmptyTimeline();

    await userEvent.click(screen.getByRole('button', { name: '+ Add First Lyric Line' }));

    expect(screen.queryByTestId('timeline-empty-state')).toBeNull();
  });
});

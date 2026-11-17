/**
 * Song check-up dialog: the rows it shows for a song, the header button that opens it, and
 * its buttons taking the user to the studio tool that fixes each thing.
 */

import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { SongCheckupDialog } from '../../components/studio/SongCheckupDialog';
import { StudioMetaHeader } from '../../components/StudioMetaHeader';
import { loadDeferredScreens } from '../../deferredScreens';
import { resetCapabilitiesCache } from '../../hooks/useCapabilities';
import type { LyricLine, ProjectState } from '../../types';
import { CAPABILITIES, json, mockStudioFetch } from '../helpers/qualityFixtures';
import { expectTouchTarget } from '../helpers/responsiveTestUtils';

const line = (id: number, start: number, confidence: number): LyricLine => ({
  id,
  text: `Line number ${id}`,
  start_time: start,
  end_time: start + 3,
  words: [
    { word: 'Line', start_time: start, end_time: start + 1 },
    { word: 'number', start_time: start + 1, end_time: start + 2 },
    { word: `${id}`, start_time: start + 2, end_time: start + 3 },
  ],
  confidence,
  align_method: 'ctc',
});

const project: ProjectState = {
  id: 'checkup-proj',
  title: 'Check-up Song',
  artist: 'The Doctors',
  status: 'ready',
  progress: 100,
  duration: 60,
  lines: [line(1, 5, 0.92), line(2, 10, 0.31), line(3, 15, 0.88)],
  semitones: 0,
  guide_volume: 0,
  lyric_timing: 'aligned',
  master_audio_url: '/static/output/checkup_master.wav',
  separation: {
    preset: 'fast',
    label: 'Fast · Demucs',
    requested: 'best',
    fallback_reason: 'skipped, the cloud GPU is unavailable',
  },
  sync_report: {
    version: 1,
    engine: 'ctc',
    lines_total: 3,
    mean_confidence: 0.7,
    low_confidence_lines: 1,
  },
};

beforeAll(() => loadDeferredScreens());

beforeEach(() => {
  resetCapabilitiesCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the dialog', () => {
  it('lists what to fix with a button each, and says how many there are', () => {
    mockStudioFetch();
    const onAction = vi.fn();
    render(<SongCheckupDialog isOpen onClose={vi.fn()} project={project} onAction={onAction} />);

    const dialog = screen.getByRole('dialog', { name: 'Song check-up' });
    expect(dialog).toHaveAccessibleDescription(/2 things to look at/);
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-level'))).toEqual(['fix', 'fix']);
    expect(rows[0]).toHaveTextContent('To fix: 1 line may be out of time');
    expect(rows[1]).toHaveTextContent('The stems are Fast quality, not the Best you asked for');
    expect(rows[1]).toHaveTextContent('skipped, the cloud GPU is unavailable');

    const review = within(dialog).getByRole('button', { name: 'Show the lines to review' });
    expectTouchTarget(review);
    review.click();
    within(dialog).getByRole('button', { name: 'Re-make the stems' }).click();
    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      'review-lines',
      'improve-stems',
    ]);
  });

  it('says a song is ready when nothing needs fixing', () => {
    mockStudioFetch();
    const fine: ProjectState = {
      ...project,
      lines: [line(1, 5, 0.92), line(2, 10, 0.9)],
      separation: { preset: 'balanced', label: 'Balanced · Mel-Band RoFormer' },
    };
    render(<SongCheckupDialog isOpen onClose={vi.fn()} project={fine} onAction={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Song check-up' });
    expect(dialog).toHaveAccessibleDescription(/Nothing to fix/);
    expect(within(dialog).getByText('Lyrics and timing look good')).toBeInTheDocument();
    expect(within(dialog).getByText('The stems look good')).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['', 'Close']);
  });

  it('drops the Fast stems tip once the server says it has nothing better', async () => {
    const onlyFast = {
      ...CAPABILITIES,
      separation: {
        ...CAPABILITIES.separation,
        presets: CAPABILITIES.separation.presets.map((p) => ({
          ...p,
          available: p.id === 'fast',
        })),
      },
    };
    mockStudioFetch(() => undefined, onlyFast);
    const fast: ProjectState = {
      ...project,
      lines: [line(1, 5, 0.92)],
      separation: { preset: 'fast', label: 'Fast · Demucs' },
    };
    render(<SongCheckupDialog isOpen onClose={vi.fn()} project={fast} onAction={vi.fn()} />);

    expect(screen.getByText('The stems are Fast quality')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('The stems are Fast quality')).toBeNull());
    expect(screen.getByText('The stems look good')).toBeInTheDocument();
  });

  it('renders nothing while closed', () => {
    mockStudioFetch();
    render(
      <SongCheckupDialog isOpen={false} onClose={vi.fn()} project={project} onAction={vi.fn()} />
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the song header', () => {
  it('has a button next to the status badges that counts what to fix', async () => {
    const onOpenCheckup = vi.fn();
    render(
      <StudioMetaHeader
        project={project}
        onOpenEditModal={vi.fn()}
        onOpenDeleteModal={vi.fn()}
        onOpenCheckup={onOpenCheckup}
      />
    );
    const button = screen.getByRole('button', { name: 'Song check-up: 2 to fix' });
    expectTouchTarget(button);
    expect(button).toHaveTextContent('2 to fix');
    // The badges stay plain status text beside it
    expect(screen.getByTestId('sync-status-badge')).toHaveTextContent('Synced Words');
    expect(button).not.toContainElement(screen.getByTestId('sync-status-badge'));

    await userEvent.click(button);
    expect(onOpenCheckup).toHaveBeenCalledTimes(1);
  });

  it('reads "Check-up" when there is nothing to fix, and is left out without a handler', () => {
    const fine = { ...project, lines: [line(1, 5, 0.92)], separation: { preset: 'best' as const } };
    const { rerender } = render(
      <StudioMetaHeader
        project={fine}
        onOpenEditModal={vi.fn()}
        onOpenDeleteModal={vi.fn()}
        onOpenCheckup={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Song check-up: nothing to fix' })).toHaveTextContent(
      'Check-up'
    );

    rerender(
      <StudioMetaHeader project={fine} onOpenEditModal={vi.fn()} onOpenDeleteModal={vi.fn()} />
    );
    expect(screen.queryByTestId('song-checkup-button')).toBeNull();
  });
});

describe('in the studio', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/?project=checkup-proj');
    mockStudioFetch((url) => {
      if (url.includes('/api/auth/status')) {
        return json({ auth_required: false, authenticated: true });
      }
      if (url.includes('/api/project/checkup-proj')) return json(project);
      return undefined;
    });
  });

  const openCheckup = async (user: ReturnType<typeof userEvent.setup>) => {
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Song check-up:/ }));
    return screen.findByRole('dialog', { name: 'Song check-up' });
  };

  it('shows only the flagged lines in the timeline from "Show the lines to review"', async () => {
    const user = userEvent.setup();
    const dialog = await openCheckup(user);
    expect(screen.getByTestId('timeline-review-filter')).toHaveAttribute('aria-pressed', 'false');

    await user.click(within(dialog).getByRole('button', { name: 'Show the lines to review' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('timeline-review-filter')).toHaveAttribute('aria-pressed', 'true');
    // Phones: the timeline is the tab now showing
    expect(screen.getByRole('tab', { name: /timeline/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens the stem dialog from "Re-make the stems", with focus inside it', async () => {
    const user = userEvent.setup();
    const dialog = await openCheckup(user);

    await user.click(within(dialog).getByRole('button', { name: 'Re-make the stems' }));

    const stems = await screen.findByRole('dialog', { name: 'Improve stem separation' });
    expect(screen.queryByRole('dialog', { name: 'Song check-up' })).toBeNull();
    await waitFor(() => expect(stems.contains(document.activeElement)).toBe(true));
  });

  it('is offered in the command palette with the count of things to fix', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: /^Song check-up:/ });

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await user.type(await screen.findByRole('combobox', { name: /search commands/i }), 'check-up');
    const option = await screen.findByRole('option', { name: /Song check-up: what to fix/ });
    expect(option).toHaveTextContent('2 to look at');
    await user.click(option);

    expect(await screen.findByRole('dialog', { name: 'Song check-up' })).toBeInTheDocument();
  });
});

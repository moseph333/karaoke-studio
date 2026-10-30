import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrackSearch } from '../../components/TrackSearch';
import { ProcessingView, getActivePipelineStage } from '../../components/ProcessingView';
import { ProjectState } from '../../types';

const libraryResponse = (projects: Record<string, Partial<ProjectState>>) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
    if (url.toString().includes('/api/projects')) {
      return new Response(JSON.stringify(projects), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });

const baseProcessing: ProjectState = {
  id: 'proc-1',
  title: 'Night Drive',
  artist: 'Synth Duo',
  status: 'separating',
  progress: 42,
  lines: [],
  semitones: 0,
  guide_volume: 0,
};

describe('Home intake card', () => {
  beforeEach(() => {
    libraryResponse({});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('switches intake modes through a toggle group that keeps the legacy ids', async () => {
    const user = userEvent.setup();
    render(<TrackSearch onSelectTrack={vi.fn()} isLoading={false} />);
    const group = screen.getByRole('group', { name: 'Track intake mode' });
    const youtube = within(group).getByRole('button', { name: 'YouTube Search' });
    const local = within(group).getByRole('button', { name: 'Local Audio File' });
    expect(youtube).toHaveAttribute('id', 'toggle-youtube-mode');
    expect(local).toHaveAttribute('id', 'toggle-local-mode');
    expect(youtube).toHaveAttribute('aria-pressed', 'true');

    await user.click(local);
    expect(local).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(/choose local audio file/i)).toHaveAttribute(
      'accept',
      expect.stringContaining('.opus')
    );
  });

  it('summarizes custom lyrics in the collapsed Advanced options row', async () => {
    const user = userEvent.setup();
    render(<TrackSearch onSelectTrack={vi.fn()} isLoading={false} />);
    const toggle = screen.getByRole('button', { name: 'Advanced options' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAccessibleDescription('Custom lyrics');

    await user.click(toggle);
    fireEvent.change(screen.getByLabelText(/custom plain lyrics text/i), {
      target: { value: 'line one\nline two\n\nline three' },
    });
    expect(toggle).toHaveAccessibleDescription('Custom lyrics · 3 lines');
  });

  it('announces intake errors as alerts', async () => {
    const user = userEvent.setup();
    render(<TrackSearch onSelectTrack={vi.fn()} isLoading={false} />);
    await user.type(
      screen.getByRole('textbox', { name: /Paste YouTube or YouTube Music URL/ }),
      'https://soundcloud.com/some/track'
    );
    await user.click(screen.getByRole('button', { name: /search youtube or load track/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/supports YouTube and YouTube Music/);
  });
});

describe('Song library', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows skeleton cards while the library loads', async () => {
    let release: (r: Response) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>((resolve) => (release = resolve))
    );
    const { container } = render(<TrackSearch onSelectTrack={vi.fn()} isLoading={false} />);
    expect(screen.getByText('Loading library tracks...')).toHaveClass('sr-only');
    expect(container.querySelectorAll('[aria-hidden="true"] .aspect-square').length).toBe(8);
    await act(async () => release(new Response(JSON.stringify({}), { status: 200 })));
    await waitFor(() => expect(screen.queryByText('Loading library tracks...')).toBeNull());
  });

  it('opens a song from the keyboard through the card title button', async () => {
    const onOpenProject = vi.fn();
    libraryResponse({
      a: { id: 'a', title: 'Keyboard Song', status: 'ready', created_by: 'Friend' },
    });
    const user = userEvent.setup();
    render(<TrackSearch onSelectTrack={vi.fn()} onOpenProject={onOpenProject} isLoading={false} />);
    const title = await screen.findByRole('button', { name: 'Keyboard Song' });
    title.focus();
    await user.keyboard('{Enter}');
    expect(onOpenProject).toHaveBeenCalledTimes(1);
    expect(onOpenProject.mock.calls[0][0].id).toBe('a');
  });

  it('labels card status badges by outcome', async () => {
    libraryResponse({
      r: { id: 'r', title: 'Done Song', status: 'ready', created_by: 'Friend' },
      e: { id: 'e', title: 'Broken Song', status: 'error', created_by: 'Friend' },
      w: { id: 'w', title: 'Busy Song', status: 'fetching_lyrics', created_by: 'Friend' },
    });
    const { container } = render(<TrackSearch onSelectTrack={vi.fn()} isLoading={false} />);
    await screen.findByText('Broken Song');
    const badge = (status: string) => container.querySelector(`[data-status="${status}"]`);
    expect(badge('ready')).toHaveTextContent('Ready');
    expect(badge('error')).toHaveTextContent('Error');
    expect(badge('error')?.className).toContain('bg-theme-danger/50');
    expect(badge('fetching_lyrics')).toHaveTextContent('fetching lyrics');
  });

  it('moves between library tabs with the arrow keys (roving focus)', async () => {
    libraryResponse({
      a: { id: 'a', title: 'Mine', status: 'ready', created_by: 'Friend' },
      b: { id: 'b', title: 'Theirs', status: 'ready', created_by: 'Someone' },
    });
    const user = userEvent.setup();
    render(<TrackSearch onSelectTrack={vi.fn()} isLoading={false} />);
    const mine = await screen.findByRole('tab', { name: 'My Songs (1)' });
    const all = screen.getByRole('tab', { name: 'Community Library (2)' });
    expect(mine).toHaveAttribute('tabindex', '0');
    expect(all).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', mine.id);

    mine.focus();
    await user.keyboard('{ArrowRight}');
    expect(all).toHaveAttribute('aria-selected', 'true');
    expect(all).toHaveFocus();
    expect(screen.getByText('Theirs')).toBeInTheDocument();
  });
});

describe('Processing view', () => {
  it('maps the local-upload "processing" status to the intake stage with a default detail', () => {
    expect(getActivePipelineStage('processing')).toBe(0);
    render(
      <ProcessingView
        project={{ ...baseProcessing, status: 'processing', progress: 5 }}
        onCancelProcess={vi.fn()}
        onResetProject={vi.fn()}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('processing...');
    // The detail is shown but not announced: it changes with every separation chunk
    expect(screen.getByText('Preparing audio track...')).toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent('Preparing audio track...');
  });

  it('keeps the live region to the stage heading', () => {
    render(
      <ProcessingView project={baseProcessing} onCancelProcess={vi.fn()} onResetProject={vi.fn()} />
    );
    const status = screen.getByRole('status');
    expect(within(status).getByRole('heading', { level: 1 })).toHaveTextContent('separating...');
    expect(within(status).queryByText(/% Complete/)).toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Processing progress' })).toHaveAttribute(
      'aria-valuenow',
      '42'
    );
    expect(screen.getByText('Night Drive')).toBeInTheDocument();
  });

  it('offers Retry while polling is reconnecting', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <ProcessingView
        project={baseProcessing}
        isReconnecting
        onRetryPolling={onRetry}
        onCancelProcess={vi.fn()}
        onResetProject={vi.fn()}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/Reconnecting to server/);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('marks completed and active steps in the stepper', () => {
    render(
      <ProcessingView
        project={{ ...baseProcessing, status: 'aligning' }}
        onCancelProcess={vi.fn()}
        onResetProject={vi.fn()}
      />
    );
    const steps = within(screen.getByRole('list', { name: 'Processing Stages' })).getAllByRole(
      'listitem'
    );
    expect(steps[3]).toHaveAttribute('aria-current', 'step');
    expect(
      within(steps[0]).getByLabelText('Completed: Audio Intake & Download')
    ).toBeInTheDocument();
    expect(within(steps[3]).getByLabelText('Active: Lyric Fetch & Alignment')).toBeInTheDocument();
  });
});

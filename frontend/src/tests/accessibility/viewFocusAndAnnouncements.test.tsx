import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { ProcessingView } from '../../components/ProcessingView';
import { RenderProgressAnnouncer } from '../../components/RenderProgressAnnouncer';
import { Dialog } from '../../components/ui/Dialog';
import { pageTitle } from '../../utils/pageTitle';
import { ProjectState } from '../../types';

describe('pageTitle', () => {
  it('names the open song, with its progress while it is processed', () => {
    expect(pageTitle(null)).toBe('Karaoke Studio');
    expect(pageTitle({ title: 'Neon Rain', status: 'ready', progress: 100 })).toBe(
      'Neon Rain — Karaoke Studio'
    );
    expect(pageTitle({ title: 'Neon Rain', status: 'separating', progress: 47.6 })).toBe(
      '48% · Separating — Neon Rain · Karaoke Studio'
    );
    expect(pageTitle({ title: '', status: 'error', progress: 0 })).toBe(
      'Processing failed — Untitled track · Karaoke Studio'
    );
  });
});

describe('RenderProgressAnnouncer', () => {
  const at = (render_status: ProjectState['render_status'], render_progress = 0) => (
    <RenderProgressAnnouncer project={{ id: 'p1', render_status, render_progress }} />
  );
  const region = () => screen.getByTestId('render-progress-announcer');

  it('reads out the start and each quarter once, without the per-second detail', () => {
    const { rerender } = render(at('idle'));
    expect(region()).toHaveTextContent('');
    expect(region()).toHaveAttribute('aria-live', 'polite');
    expect(region()).not.toHaveAttribute('role');

    rerender(at('queued', 5));
    expect(region()).toHaveTextContent('Video render started');
    rerender(at('rendering', 18));
    expect(region()).toHaveTextContent('Video render started');
    rerender(at('rendering', 26));
    expect(region()).toHaveTextContent('Rendering video, 25 percent');
    rerender(at('rendering', 49));
    expect(region()).toHaveTextContent('Rendering video, 25 percent');
    rerender(at('rendering', 80));
    expect(region()).toHaveTextContent('Rendering video, 75 percent');

    rerender(at('completed', 100));
    expect(region()).toHaveTextContent('');
  });
});

describe('ProcessingView announcements and focus', () => {
  const processing: ProjectState = {
    id: 'proc',
    title: 'Slow Burn',
    status: 'separating',
    progress: 40,
    status_detail: 'Mel-Band RoFormer: chunk 12/25 (48%)',
    lines: [],
    semitones: 0,
    guide_volume: 0,
  };
  const noop = () => {};

  it('announces the stage but not the per-chunk detail', () => {
    render(<ProcessingView project={processing} onCancelProcess={noop} onResetProject={noop} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/separating/i);
    expect(status).not.toHaveTextContent('chunk 12/25');
    expect(screen.getByText('Mel-Band RoFormer: chunk 12/25 (48%)')).toBeInTheDocument();
  });

  it('announces a failure', () => {
    render(
      <ProcessingView
        project={{ ...processing, status: 'error', error: 'Demucs failed (exit 1)' }}
        onCancelProcess={noop}
        onResetProject={noop}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Demucs failed (exit 1)');
  });

  it('moves focus into the cancel confirmation and back to Cancel', () => {
    render(<ProcessingView project={processing} onCancelProcess={noop} onResetProject={noop} />);

    fireEvent.click(screen.getByRole('button', { name: /Cancel & Return to Search/i }));
    expect(screen.getByRole('button', { name: 'Keep Processing' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Keep Processing' }));
    expect(screen.getByRole('button', { name: /Cancel & Return to Search/i })).toHaveFocus();
  });
});

describe('closing a dialog whose trigger is gone', () => {
  function DeleteFlow() {
    const [open, setOpen] = React.useState(false);
    const [deleted, setDeleted] = React.useState(false);
    return (
      <main>
        <h1 tabIndex={-1} data-view-heading>
          Your songs
        </h1>
        {!deleted && (
          <button type="button" onClick={() => setOpen(true)}>
            Delete song
          </button>
        )}
        <Dialog open={open} onClose={() => setOpen(false)} titleId="delete-title">
          <h2 id="delete-title">Delete this song?</h2>
          <button
            type="button"
            onClick={() => {
              setDeleted(true);
              setOpen(false);
            }}
          >
            Confirm delete
          </button>
        </Dialog>
      </main>
    );
  }

  it('returns focus to the screen heading instead of the page body', async () => {
    const user = userEvent.setup();
    render(<DeleteFlow />);

    await user.click(screen.getByRole('button', { name: 'Delete song' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

    expect(screen.getByRole('heading', { name: 'Your songs' })).toHaveFocus();
  });
});

describe('switching screens in the app', () => {
  const song: ProjectState = {
    id: 'title-test',
    title: 'Title Song',
    artist: 'Tab Band',
    status: 'ready',
    progress: 100,
    lines: [{ id: 1, text: 'Every tab has a name', start_time: 1, end_time: 3, words: [] }],
    master_audio_url: '/static/output/title-test_master.wav',
    semitones: 0,
    guide_volume: 0,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const body = url.toString().includes('/api/project/title-test') ? song : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  it('titles the tab, keeps the song in the URL and moves focus with the screen', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/?project=title-test');
    render(<App />);

    await waitFor(() => expect(document.title).toBe('Title Song — Karaoke Studio'));
    expect(new URLSearchParams(window.location.search).get('project')).toBe('title-test');
    expect(screen.getByRole('heading', { name: 'Title Song' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'New Song' }));

    await waitFor(() => expect(document.title).toBe('Karaoke Studio'));
    expect(window.location.search).toBe('');
    expect(
      screen.getByRole('heading', { level: 1, name: /Turn Any YouTube Song Into Karaoke/i })
    ).toHaveFocus();
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { formatApiDetail, readApiError } from '../api';
import { AuthModal } from '../components/AuthModal';
import { ToastProvider, useToast } from '../hooks/useToast';
import { useRenderOutcomeToast } from '../hooks/useRenderOutcomeToast';
import { ExpandedWordEditor } from '../components/timeline/ExpandedWordEditor';
import { ProjectLibrary } from '../components/track-search/ProjectLibrary';
import { ProjectState } from '../types';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('API error messages', () => {
  it('reads validation errors instead of showing [object Object]', () => {
    const detail = [
      { loc: ['body', 'title'], msg: 'String should have at most 200 characters' },
      { loc: ['body'], msg: 'Field required' },
    ];
    expect(formatApiDetail(detail, 'fallback')).toBe(
      'title: String should have at most 200 characters; Field required'
    );
    expect(formatApiDetail('Project not found', 'fallback')).toBe('Project not found');
    expect(formatApiDetail([], 'fallback')).toBe('fallback');
    expect(formatApiDetail({ detail: 1 }, 'fallback')).toBe('fallback');
  });

  it('falls back when the body is not JSON', async () => {
    expect(await readApiError(new Response('Bad gateway', { status: 502 }), 'Try again')).toBe(
      'Try again'
    );
    expect(await readApiError(json({ detail: 'Busy' }, 409), 'Try again')).toBe('Busy');
  });
});

describe('render feedback', () => {
  const song: ProjectState = {
    id: 'render-test',
    title: 'Render Song',
    artist: 'Encoders',
    status: 'ready',
    progress: 100,
    lines: [{ id: 1, text: 'Press render', start_time: 1, end_time: 3, words: [] }],
    master_audio_url: '/static/output/render-test_master.wav',
    instrumental_url: '/static/stems/render-test/instrumental.wav',
    semitones: 0,
    guide_volume: 0,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows why the server refused to start a render and doesn't pretend it is queued", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const target = url.toString();
      if (target.includes('/api/project/render-test/render') && init?.method === 'POST') {
        return json({ detail: 'A video is already rendering for this song' }, 409);
      }
      if (target.includes('/api/project/render-test') && !init?.method) return json(song);
      return json({});
    });
    window.history.replaceState(null, '', '/?project=render-test');
    render(
      <ToastProvider>
        <App />
      </ToastProvider>
    );

    await screen.findByRole('heading', { name: 'Render Song' });
    await user.click(screen.getByRole('button', { name: 'Open export dialog' }));
    await user.click(await screen.findByRole('button', { name: 'Start video render' }));

    expect(
      await screen.findByText('A video is already rendering for this song')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel Render/i })).toBeNull();
  });

  function renderOutcomeHook(project: Pick<ProjectState, 'id' | 'render_status' | 'render_error'>) {
    const openExport = vi.fn();
    const hook = renderHook(
      ({ p }) => {
        useRenderOutcomeToast(p, openExport);
        return useToast();
      },
      { initialProps: { p: project }, wrapper: ToastProvider }
    );
    return { ...hook, openExport };
  }

  it('toasts once when a render finishes, with a way back to the export', () => {
    const { result, rerender, openExport } = renderOutcomeHook({
      id: 's1',
      render_status: 'rendering',
    });
    rerender({ p: { id: 's1', render_status: 'completed' } });
    rerender({ p: { id: 's1', render_status: 'completed' } });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]).toMatchObject({
      message: 'Karaoke video rendered',
      type: 'success',
    });
    act(() => result.current.toasts[0].action?.onClick());
    expect(openExport).toHaveBeenCalled();
  });

  it('toasts a failure, but not a cancel or a render that ended before the song opened', () => {
    const { result, rerender } = renderOutcomeHook({ id: 's2', render_status: 'completed' });
    expect(result.current.toasts).toHaveLength(0);

    rerender({ p: { id: 's2', render_status: 'rendering' } });
    rerender({ p: { id: 's2', render_status: 'idle' } }); // cancelled
    expect(result.current.toasts).toHaveLength(0);

    rerender({ p: { id: 's2', render_status: 'queued' } });
    rerender({ p: { id: 's2', render_status: 'error', render_error: 'FFmpeg exited 1' } });
    expect(result.current.toasts.map((t) => t.message)).toEqual([
      'Video render failed: FFmpeg exited 1',
    ]);
  });
});

describe('switching profile', () => {
  it('can be closed when you are already signed in', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AuthModal isOpen onSuccess={vi.fn()} onClose={onClose} dismissable />);

    expect(screen.getByRole('heading', { name: 'Switch Profile' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('asks only for a nickname when the server has no passphrase', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ status: 'ok', token: 'ok', username: 'Robin' })
    );
    render(
      <AuthModal
        isOpen
        onSuccess={onSuccess}
        onClose={vi.fn()}
        dismissable
        requirePassword={false}
      />
    );

    expect(screen.queryByLabelText(/Studio Passphrase/i)).toBeNull();
    await user.type(screen.getByLabelText(/Your Nickname/i), 'Robin');
    await user.click(screen.getByRole('button', { name: /Switch Profile/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('Robin', 'ok'));
  });

  it('stays a gate that cannot be closed by default', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AuthModal isOpen onSuccess={vi.fn()} onClose={onClose} />);

    expect(screen.getByRole('heading', { name: 'Studio Access Gate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('typing a word time', () => {
  const line = {
    id: 7,
    text: 'one two three',
    start_time: 10,
    end_time: 16,
    words: [
      { word: 'one', start_time: 10, end_time: 11 },
      { word: 'two', start_time: 11.5, end_time: 13 },
      { word: 'three', start_time: 13.5, end_time: 16 },
    ],
  };
  const renderEditor = (onUpdateWordTiming = vi.fn()) => {
    render(
      <ExpandedWordEditor
        line={line}
        activeWordLoc={null}
        onWordClick={vi.fn()}
        onNudgeWord={vi.fn()}
        onNudgeWordBoundary={vi.fn()}
        onUpdateWordTiming={onUpdateWordTiming}
      />
    );
    return onUpdateWordTiming;
  };

  it('keeps what is typed as a draft and commits it once, on Enter', async () => {
    const user = userEvent.setup();
    const onUpdate = renderEditor();
    const end = screen.getByLabelText('End time for word two');

    await user.clear(end);
    await user.type(end, '13.25');
    expect(onUpdate).not.toHaveBeenCalled(); // no clamping or undo steps per keystroke
    expect(end).toHaveValue(13.25);

    await user.keyboard('{Enter}');
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(7, 1, 'end_time', 13.25);
  });

  it('clamps to the neighbouring words when committing', () => {
    const onUpdate = renderEditor();
    const start = screen.getByLabelText('Start time for word two');

    fireEvent.change(start, { target: { value: '10.2' } });
    fireEvent.blur(start);

    expect(onUpdate).toHaveBeenCalledWith(7, 1, 'start_time', 11); // the previous word ends at 11
  });

  it('restores the value on Escape and steps with the arrow keys', () => {
    const onUpdate = renderEditor();
    const start = screen.getByLabelText('Start time for word two');

    fireEvent.change(start, { target: { value: '12' } });
    fireEvent.keyDown(start, { key: 'Escape' });
    expect(start).toHaveValue(11.5);
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.keyDown(start, { key: 'ArrowUp' });
    expect(onUpdate).toHaveBeenLastCalledWith(7, 1, 'start_time', 11.55);
    fireEvent.keyDown(start, { key: 'ArrowDown', shiftKey: true });
    expect(onUpdate).toHaveBeenLastCalledWith(7, 1, 'start_time', 11.3);
  });
});

describe('the song library', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says when it could not load and offers to try again', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ detail: 'Library unavailable' }, 503))
      .mockResolvedValueOnce(
        json({ s1: { id: 's1', title: 'Back Again', status: 'ready', created_by: 'Friend' } })
      );
    render(<ProjectLibrary currentUser="Friend" />);

    expect(await screen.findByText('Your songs could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('Library unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No songs yet')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Retry loading library' }));

    expect(await screen.findByText('Back Again')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('error toasts', () => {
  it('stay twice as long, and wait while focus is inside them', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useToast(), { wrapper: ToastProvider });
      act(() => {
        result.current.error('Could not save');
      });
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByText('Could not save')).toBeInTheDocument();

      fireEvent.focus(screen.getByRole('button', { name: 'Dismiss notification' }));
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(screen.getByText('Could not save')).toBeInTheDocument();

      fireEvent.blur(screen.getByRole('button', { name: 'Dismiss notification' }));
      act(() => {
        vi.advanceTimersByTime(8000);
      });
      expect(screen.queryByText('Could not save')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

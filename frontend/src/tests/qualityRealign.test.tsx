import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricTimelineEditor } from '../components/LyricTimelineEditor';
import { LyricReplacementModal } from '../components/timeline/LyricReplacementModal';
import { SyncJobBanner } from '../components/timeline/SyncJobBanner';
import { ProcessingView } from '../components/ProcessingView';
import { CommandPaletteProvider } from '../components/commandPalette/CommandPaletteProvider';
import { useSyncJobResult } from '../hooks/useSyncJobResult';
import { resetCapabilitiesCache } from '../hooks/useCapabilities';
import { ToastProvider } from '../hooks/useToast';
import type { LyricLine, ProjectState, SyncJob } from '../types';
import { CAPABILITIES, json, mockStudioFetch } from './qualityFixtures';

const line = (id: number, text: string, start: number): LyricLine => ({
  id,
  text,
  start_time: start,
  end_time: start + 2,
  words: text.split(' ').map((word, i) => ({
    word,
    start_time: start + i * 0.5,
    end_time: start + i * 0.5 + 0.4,
  })),
});

const before = [line(1, 'hello there', 1), line(2, 'general kenobi', 5)];
const after = [line(1, 'hello there', 1.3), line(2, 'general kenobi', 5.6)];
const running: SyncJob = {
  id: 'sync1',
  status: 'running',
  mode: 'lines',
  progress: 40,
  detail: 'Aligning words (neural) 3/8',
};
const done: SyncJob = {
  ...running,
  status: 'done',
  progress: 100,
  detail: 'Lyrics re-aligned with the neural aligner',
};

describe('Background re-alignment banner', () => {
  it('shows progress with a Cancel button while the job runs', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<SyncJobBanner job={running} onCancel={onCancel} />);
    expect(
      screen.getByRole('progressbar', { name: 'Lyric re-alignment progress' })
    ).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('Aligning words (neural) 3/8')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel lyric re-alignment' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(<SyncJobBanner job={done} />);
    expect(screen.queryByTestId('sync-job-banner')).toBeNull();
  });

  it('asks before replacing unsaved edits with a finished result', async () => {
    const onLoad = vi.fn();
    const onKeep = vi.fn();
    const user = userEvent.setup();
    render(<SyncJobBanner job={done} hasReadyResult onLoadResult={onLoad} onKeepEdits={onKeep} />);
    await user.click(screen.getByRole('button', { name: 'Load re-aligned lyrics' }));
    await user.click(screen.getByRole('button', { name: 'Keep my edits' }));
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it('holds a finished result back only when the editor has unsaved edits', () => {
    const onAdopt = vi.fn();
    const hook = renderHook(
      (props: Parameters<typeof useSyncJobResult>[0]) => useSyncJobResult(props),
      {
        initialProps: { syncJob: running, lines: before, hasUnsavedChanges: true, onAdopt },
      }
    );
    hook.rerender({ syncJob: done, lines: after, hasUnsavedChanges: true, onAdopt });
    expect(hook.result.current.hasReadyResult).toBe(true);
    act(() => hook.result.current.loadResult());
    expect(onAdopt).toHaveBeenCalledWith(after);
    expect(hook.result.current.hasReadyResult).toBe(false);

    const clean = renderHook(
      (props: Parameters<typeof useSyncJobResult>[0]) => useSyncJobResult(props),
      {
        initialProps: { syncJob: running, lines: before, hasUnsavedChanges: false, onAdopt },
      }
    );
    clean.rerender({ syncJob: done, lines: after, hasUnsavedChanges: false, onAdopt });
    expect(clean.result.current.hasReadyResult).toBe(false);

    const old = renderHook(() =>
      useSyncJobResult({ syncJob: done, lines: after, hasUnsavedChanges: true, onAdopt })
    );
    expect(old.result.current.hasReadyResult).toBe(false); // finished before the editor opened
  });
});

describe('Timeline editor with a background re-alignment', () => {
  const renderEditor = (props: Partial<React.ComponentProps<typeof LyricTimelineEditor>> = {}) =>
    render(
      <ToastProvider>
        <CommandPaletteProvider>
          <LyricTimelineEditor
            lines={before}
            currentTime={0}
            duration={30}
            onSeek={vi.fn()}
            onSaveLines={vi.fn().mockResolvedValue(undefined)}
            projectId="song-1"
            {...props}
          />
        </CommandPaletteProvider>
      </ToastProvider>
    );

  it('picks up the new timing by itself when nothing is unsaved', () => {
    const { rerender } = renderEditor({ syncJob: running });
    expect(screen.getByTestId('sync-job-banner')).toBeInTheDocument();
    rerender(
      <ToastProvider>
        <CommandPaletteProvider>
          <LyricTimelineEditor
            lines={after}
            currentTime={0}
            duration={30}
            onSeek={vi.fn()}
            onSaveLines={vi.fn()}
            projectId="song-1"
            syncJob={done}
          />
        </CommandPaletteProvider>
      </ToastProvider>
    );
    expect(screen.getByTestId('timeline-line-2')).toHaveTextContent('5.6s - 7.6s');
    expect(screen.queryByTestId('sync-job-ready')).toBeNull();
  });

  it('offers re-align commands in the palette', async () => {
    const start = vi.fn().mockResolvedValue({ id: 'sync2', status: 'queued' });
    renderEditor({ onStartBackgroundRealign: start });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 're-align all' } });
    fireEvent.click(
      await screen.findByRole('option', { name: /Re-align all lines in the background/ })
    );
    await waitFor(() => expect(start).toHaveBeenCalledWith({ lines: before }));
    expect(await screen.findByText('Re-aligning every line in the background')).toBeInTheDocument();
  });

  it('offers to cancel instead while a re-alignment runs, and waits for edits to be saved', async () => {
    const start = vi.fn();
    const cancel = vi.fn();
    const { rerender } = renderEditor({
      syncJob: running,
      onStartBackgroundRealign: start,
      onCancelRealign: cancel,
    });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 're-align' } });
    expect(screen.queryByRole('option', { name: /Re-align all lines/ })).toBeNull();
    fireEvent.click(await screen.findByRole('option', { name: /Cancel lyric re-alignment/ }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));

    rerender(
      <ToastProvider>
        <CommandPaletteProvider>
          <LyricTimelineEditor
            lines={before}
            currentTime={0}
            duration={30}
            onSeek={vi.fn()}
            onSaveLines={vi.fn()}
            projectId="song-1"
            onStartBackgroundRealign={start}
          />
        </CommandPaletteProvider>
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Nudge line 1 0.2s later' }));
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 're-align all' } });
    fireEvent.click(
      await screen.findByRole('option', { name: /Re-align all lines in the background/ })
    );
    expect(
      await screen.findByText('Save your lyric edits first, then re-align')
    ).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });
});

describe('Replace / re-align dialog', () => {
  beforeEach(() => resetCapabilitiesCache());
  afterEach(() => vi.restoreAllMocks());

  const realignCalls = (spy: ReturnType<typeof mockStudioFetch>) =>
    spy.mock.calls.filter(([url]) => url.toString().endsWith('/realign-lyrics'));

  const renderModal = (props: Partial<React.ComponentProps<typeof LyricReplacementModal>> = {}) => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(
      <ToastProvider>
        <LyricReplacementModal
          isOpen
          onClose={onClose}
          projectId="song-1"
          onSuccess={onSuccess}
          currentLines={before}
          {...props}
        />
      </ToastProvider>
    );
    return { onClose, onSuccess };
  };

  it('queues new lyrics for the neural aligner when the server has it', async () => {
    const spy = mockStudioFetch();
    const start = vi.fn().mockResolvedValue({ id: 'sync3' });
    const user = userEvent.setup();
    const { onClose } = renderModal({ onStartBackground: start });
    const neural = await screen.findByRole('checkbox', { name: /Use the neural aligner/ });
    expect(neural).toBeChecked();

    fireEvent.change(screen.getByLabelText('Lyric Text or LRC Timestamps'), {
      target: { value: 'line one\nline two' },
    });
    await user.click(screen.getByRole('button', { name: 'Re-align Lyrics' }));
    expect(start).toHaveBeenCalledWith({
      custom_lyrics: 'line one\nline two',
      fetch_lrclib: false,
    });
    expect(onClose).toHaveBeenCalled();
    expect(realignCalls(spy)).toHaveLength(0);
  });

  it('aligns right away when the neural aligner is switched off or unavailable', async () => {
    const spy = mockStudioFetch((url) =>
      url.endsWith('/realign-lyrics') ? json({ lines: after }) : undefined
    );
    const start = vi.fn();
    const user = userEvent.setup();
    const { onSuccess } = renderModal({ onStartBackground: start });
    await user.click(await screen.findByRole('checkbox', { name: /Use the neural aligner/ }));
    await user.click(screen.getByRole('button', { name: 'Re-align current lyrics' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(after));
    expect(JSON.parse(String(realignCalls(spy)[0][1]?.body))).toEqual({ lines: before });
    expect(start).not.toHaveBeenCalled();
  });

  it('explains why the neural aligner is not offered', async () => {
    mockStudioFetch(undefined, {
      ...CAPABILITIES,
      alignment: {
        ...CAPABILITIES.alignment,
        effective: 'dsp',
        ctc_available: false,
        reason: 'PyTorch is not installed',
      },
    });
    renderModal({ onStartBackground: vi.fn() });
    expect(
      await screen.findByText(
        /neural aligner is not available on this server \(PyTorch is not installed\)/
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Use the neural aligner/ })).toBeNull();
  });
});

describe('Processing view', () => {
  const processing: ProjectState = {
    id: 'proc',
    title: 'Song',
    artist: 'Band',
    status: 'separating',
    progress: 20,
    lines: [],
    semitones: 0,
    guide_volume: 0,
    separation_quality: 'balanced',
    status_detail: 'Downloading model weights… (35%)',
  };

  it('names the separation model and explains a first-run download', () => {
    render(
      <ProcessingView project={processing} onCancelProcess={vi.fn()} onResetProject={vi.fn()} />
    );
    expect(screen.getByTestId('processing-stems-engine')).toHaveTextContent(
      'Stems: Balanced · Mel-Band RoFormer'
    );
    expect(screen.getByTestId('processing-model-download')).toHaveTextContent('downloaded once');
    expect(
      within(screen.getByRole('list', { name: 'Processing Stages' })).getByText(
        'AI Vocal Separation'
      )
    ).toBeInTheDocument();
  });

  it('stays quiet about downloads otherwise', () => {
    render(
      <ProcessingView
        project={{
          ...processing,
          status_detail: 'Mel-Band RoFormer: chunk 4/20',
          separation_quality: undefined,
        }}
        onCancelProcess={vi.fn()}
        onResetProject={vi.fn()}
      />
    );
    expect(screen.queryByTestId('processing-model-download')).toBeNull();
    expect(screen.queryByTestId('processing-stems-engine')).toBeNull();
  });
});

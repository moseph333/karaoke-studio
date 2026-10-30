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
import App from '../../App';
import { StemQualityControl } from '../../components/quality/StemQualityControl';
import { ReseparateDialog } from '../../components/quality/ReseparateDialog';
import { useQualityJobs } from '../../hooks/useQualityJobs';
import { resetCapabilitiesCache } from '../../hooks/useCapabilities';
import { ToastProvider } from '../../hooks/useToast';
import type { ProjectState, SeparationJob } from '../../types';
import { CAPABILITIES, json, mockStudioFetch } from '../helpers/qualityFixtures';

const job = (overrides: Partial<SeparationJob> = {}): SeparationJob => ({
  id: 'job1',
  status: 'running',
  quality: 'balanced',
  label: 'Balanced · Mel-Band RoFormer',
  progress: 42,
  detail: 'Mel-Band RoFormer: chunk 21/50',
  eta_seconds: 190,
  ...overrides,
});

const song: ProjectState = {
  id: 'stems-song',
  title: 'Stem Anthem',
  artist: 'The Splitters',
  status: 'ready',
  progress: 100,
  duration: 240,
  lines: [{ id: 1, text: 'Hello stems', start_time: 1, end_time: 3, words: [] }],
  semitones: 0,
  guide_volume: 0,
  master_audio_url: '/static/output/stems_master.wav',
  separation: { preset: 'fast', label: 'Fast · Demucs', engine: 'demucs' },
};

describe('Stems row in the Mix panel', () => {
  it('names the model behind the stems and offers to improve them', async () => {
    const onImprove = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <StemQualityControl
        separation={{
          preset: 'balanced',
          label: 'Balanced · Mel-Band RoFormer',
          requested: 'best',
          fallback_reason: 'Best: out of memory',
        }}
        onImprove={onImprove}
      />
    );
    expect(screen.getByTestId('stem-quality-label')).toHaveTextContent(
      'Balanced · Mel-Band RoFormer'
    );
    expect(
      screen.getByRole('img', { name: 'Fell back from the requested quality: Best: out of memory' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Improve stem separation' }));
    expect(onImprove).toHaveBeenCalledTimes(1);

    // Stems made before presets existed were all Demucs
    rerender(<StemQualityControl onImprove={onImprove} busyReason="Wait for the lyrics" />);
    expect(screen.getByTestId('stem-quality-label')).toHaveTextContent('Fast · Demucs');
    expect(screen.getByRole('button', { name: 'Improve stem separation' })).toBeDisabled();
  });

  it('shows a running re-separation with its progress, and cancels it', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <StemQualityControl job={job()} onImprove={vi.fn()} onCancel={onCancel} />
    );
    const bar = screen.getByRole('progressbar', { name: 'Stem re-separation progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText('42% · 3 min left')).toBeInTheDocument();
    expect(screen.getByText('Re-making with Balanced · Mel-Band RoFormer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Improve stem separation' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel stem re-separation' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <StemQualityControl
        job={job({ status: 'error', detail: 'Could not re-make the stems', error: 'exit 5' })}
        onImprove={vi.fn()}
      />
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('stem-quality-error')).toHaveTextContent(
      'Could not re-make the stems (exit 5)'
    );
  });
});

describe('Improve stem separation dialog', () => {
  beforeEach(() => resetCapabilitiesCache());
  afterEach(() => vi.restoreAllMocks());

  it('renders only while open', () => {
    render(
      <ReseparateDialog
        isOpen={false}
        onClose={vi.fn()}
        project={song}
        capabilities={CAPABILITIES.separation}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('suggests the next better quality and starts a re-separation with the chosen options', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <ReseparateDialog
        isOpen
        onClose={onClose}
        project={song}
        capabilities={CAPABILITIES.separation}
        onSubmit={onSubmit}
      />
    );
    const dialog = screen.getByRole('dialog', { name: 'Improve stem separation' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const focusable = within(dialog).getAllByRole('button');
    expect(focusable[0]).toHaveAccessibleName('Close dialog'); // close button first

    const quality = within(dialog).getByRole('group', { name: 'Quality' });
    expect(within(quality).getByRole('radio', { name: 'Balanced' })).toBeChecked();
    expect(within(quality).getByRole('radio', { name: 'Balanced' })).toHaveAccessibleDescription(
      /about 6 min on CPU/
    );
    expect(within(quality).getByText('Current')).toBeInTheDocument();
    expect(within(quality).getByRole('radio', { name: 'Best' })).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /Re-time the lyrics/ }));
    await user.click(screen.getByRole('checkbox', { name: /Detect the chords again/ }));
    await user.click(screen.getByRole('radio', { name: 'Fast' }));
    await user.click(screen.getByRole('button', { name: 'Re-make stems with Fast' }));
    expect(onSubmit).toHaveBeenCalledWith({
      quality: 'fast',
      realignLyrics: true,
      redetectChords: true,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps unsaved lyric edits safe and reports a refused request', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('This song is still being processed'));
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <ReseparateDialog
        isOpen
        onClose={onClose}
        project={{ ...song, separation: { preset: 'balanced' } }}
        capabilities={CAPABILITIES.separation}
        hasUnsavedLyricEdits
        onSubmit={onSubmit}
      />
    );
    const realign = screen.getByRole('checkbox', { name: /Re-time the lyrics/ });
    expect(realign).toBeDisabled();
    expect(realign).not.toBeChecked();
    expect(screen.getByText(/Save your lyric edits first/)).toBeInTheDocument();
    // Best is unavailable, so the best this server can do is the current Balanced
    expect(screen.getByRole('radio', { name: 'Balanced' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Re-make stems with Balanced' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This song is still being processed'
    );
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ realignLyrics: false }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks the server what it can run when opened, and follows its suggestion', async () => {
    mockStudioFetch();
    render(<ReseparateDialog isOpen onClose={vi.fn()} project={song} onSubmit={vi.fn()} />);
    // Until the answer arrives every preset is offered; then Best turns out unavailable
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Best' })).toBeDisabled());
    expect(screen.getByRole('radio', { name: 'Balanced' })).toBeChecked();
  });
});

describe('Quality jobs', () => {
  afterEach(() => vi.restoreAllMocks());

  const setup = (initial: ProjectState) => {
    let current: ProjectState | null = initial;
    const setProject = vi.fn((update: React.SetStateAction<ProjectState | null>) => {
      current = typeof update === 'function' ? update(current) : update;
    });
    const hook = renderHook(
      ({ project }: { project: ProjectState | null }) => useQualityJobs({ project, setProject }),
      {
        initialProps: { project: initial as ProjectState | null },
        wrapper: ({ children }) => <ToastProvider>{children}</ToastProvider>,
      }
    );
    return { hook, current: () => current };
  };

  it('start and cancel jobs, putting them on the project straight away', async () => {
    const requests: { url: string; body: unknown }[] = [];
    mockStudioFetch((url, init) => {
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/reseparate'))
        return json({ status: 'queued', job: job({ status: 'queued' }) }, 202);
      if (url.endsWith('/reseparate/cancel')) return json({ status: 'cancelling', job: job() });
      if (url.endsWith('/realign-lyrics')) {
        return json(
          { status: 'queued', job: { id: 's1', status: 'queued', mode: 'lines', progress: 0 } },
          202
        );
      }
      if (url.endsWith('/realign-lyrics/cancel')) {
        return json({
          status: 'idle',
          job: { id: 's1', status: 'cancelled', mode: 'lines', progress: 10 },
        });
      }
      return undefined;
    });
    const { hook, current } = setup(song);

    await act(() =>
      hook.result.current.startReseparation({
        quality: 'best',
        realignLyrics: true,
        redetectChords: false,
      })
    );
    expect(requests[0]).toEqual({
      url: '/api/project/stems-song/reseparate',
      body: { quality: 'best', realign_lyrics: true, redetect_chords: false },
    });
    expect(current()?.separation_job?.status).toBe('queued');

    await act(() => hook.result.current.cancelReseparation());
    expect(requests[1].url).toBe('/api/project/stems-song/reseparate/cancel');

    let syncJob;
    await act(async () => {
      syncJob = await hook.result.current.startBackgroundRealign({ lines: song.lines });
    });
    expect(syncJob).toMatchObject({ id: 's1', status: 'queued' });
    expect(requests[2].body).toEqual({ lines: song.lines, background: true });
    expect(current()?.sync_job?.id).toBe('s1');
    await act(() => hook.result.current.cancelRealign());
    expect(current()?.sync_job?.status).toBe('cancelled');

    act(() => hook.result.current.openReseparate());
    expect(hook.result.current.isReseparateOpen).toBe(true);
    act(() => hook.result.current.closeReseparate());
    expect(hook.result.current.isReseparateOpen).toBe(false);
  });

  it('pass on why the server refused a job', async () => {
    mockStudioFetch(() =>
      json({ detail: 'The stems for this song are already being re-made' }, 409)
    );
    const { hook } = setup(song);
    await expect(
      hook.result.current.startReseparation({
        quality: 'best',
        realignLyrics: false,
        redetectChords: false,
      })
    ).rejects.toThrow('The stems for this song are already being re-made');
  });

  it('tell the user how a job they watched ended, but not about old jobs', async () => {
    mockStudioFetch();
    const { hook } = setup({
      ...song,
      separation_job: job({ id: 'old', status: 'done', detail: 'Old news' }),
    });
    expect(screen.queryByText('Old news')).toBeNull();

    hook.rerender({ project: { ...song, separation_job: job({ status: 'running' }) } });
    hook.rerender({
      project: {
        ...song,
        separation_job: job({
          status: 'done',
          detail: 'Stems re-made with Balanced · Mel-Band RoFormer',
        }),
      },
    });
    expect(
      await screen.findByText('Stems re-made with Balanced · Mel-Band RoFormer')
    ).toBeInTheDocument();

    hook.rerender({
      project: { ...song, sync_job: { id: 's2', status: 'running', mode: 'lines', progress: 30 } },
    });
    hook.rerender({
      project: {
        ...song,
        sync_job: {
          id: 's2',
          status: 'error',
          mode: 'lines',
          progress: 30,
          detail: 'Could not re-align the lyrics',
          error: 'aligner blew up',
        },
      },
    });
    expect(
      await screen.findByText('Could not re-align the lyrics (aligner blew up)')
    ).toBeInTheDocument();
  });
});

describe('Re-making stems from the studio', () => {
  let served: ProjectState;

  beforeEach(() => {
    resetCapabilitiesCache();
    served = song;
    window.history.pushState({}, '', '/?project=stems-song');
    mockStudioFetch((url, init) => {
      if (url.includes('/api/auth/status'))
        return json({ auth_required: false, authenticated: true });
      if (url.endsWith('/reseparate') && init?.method === 'POST') {
        const queued = job({
          status: 'queued',
          progress: 0,
          detail: 'Waiting for other jobs to finish…',
        });
        served = { ...song, separation_job: queued };
        return json({ status: 'queued', job: queued }, 202);
      }
      if (url.includes('/api/project/stems-song')) return json(served);
      if (url.includes('/api/projects')) return json({ [song.id]: song });
      return undefined;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('opens the dialog from the Mix panel or the palette and tracks the job', async () => {
    render(
      <ToastProvider>
        <App />
      </ToastProvider>
    );
    await screen.findByText('Stem Anthem');
    const panel = screen.getByTestId('stem-quality');
    expect(within(panel).getByTestId('stem-quality-label')).toHaveTextContent('Fast · Demucs');

    // From the palette
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByRole('combobox', { name: /search commands/i }), {
      target: { value: 'improve stem' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /Improve stem separation/ }));
    expect(
      await screen.findByRole('dialog', { name: 'Improve stem separation' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // From the Mix panel
    fireEvent.click(within(panel).getByRole('button', { name: 'Improve stem separation' }));
    const dialog = await screen.findByRole('dialog', { name: 'Improve stem separation' });
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Best' })).toBeDisabled());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Re-make stems with Balanced' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      await screen.findByRole('progressbar', { name: 'Stem re-separation progress' })
    ).toBeInTheDocument();

    // Polling picks up the finished job
    served = {
      ...song,
      separation: { preset: 'balanced', label: 'Balanced · Mel-Band RoFormer' },
      separation_job: job({
        status: 'done',
        progress: 100,
        detail: 'Stems re-made with Balanced · Mel-Band RoFormer',
      }),
    };
    expect(
      await screen.findByText(
        'Stems re-made with Balanced · Mel-Band RoFormer',
        {},
        { timeout: 4000 }
      )
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('stem-quality-label')).toHaveTextContent(
        'Balanced · Mel-Band RoFormer'
      )
    );
    expect(screen.queryByRole('progressbar', { name: 'Stem re-separation progress' })).toBeNull();
  });
});

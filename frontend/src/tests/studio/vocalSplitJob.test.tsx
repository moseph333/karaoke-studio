import { loadDeferredScreens } from '../../deferredScreens';
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { VocalSplitControl } from '../../components/audio/VocalSplitControl';
import { useQualityJobs } from '../../hooks/useQualityJobs';
import { mergeProjectStatus } from '../../hooks/useProjectPolling';
import { resetCapabilitiesCache } from '../../hooks/useCapabilities';
import { ToastProvider } from '../../hooks/useToast';
import { vocalSplitBusyReason } from '../../utils/jobs';
import type {
  ProjectState,
  StudioCapabilities,
  VocalSplitCapability,
  VocalSplitJob,
} from '../../types';
import { CAPABILITIES, json, mockStudioFetch } from '../helpers/qualityFixtures';

const job = (overrides: Partial<VocalSplitJob> = {}): VocalSplitJob => ({
  id: 'split1',
  status: 'running',
  kind: 'lead_backing',
  label: 'Lead and backing vocals',
  progress: 42,
  detail: 'Mel-Band RoFormer: chunk 21/50',
  eta_seconds: 190,
  ...overrides,
});

const capability = (overrides: Partial<VocalSplitCapability> = {}): VocalSplitCapability => ({
  id: 'lead_backing',
  label: 'Lead and backing vocals',
  model: 'mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt',
  available: true,
  reason: null,
  ...overrides,
});

const withSplits = (splits: VocalSplitCapability[]): StudioCapabilities => ({
  ...CAPABILITIES,
  separation: { ...CAPABILITIES.separation, vocal_parts: splits },
});

const song: ProjectState = {
  id: 'split-song',
  title: 'Choir Anthem',
  artist: 'The Harmonies',
  status: 'ready',
  progress: 100,
  duration: 240,
  lines: [{ id: 1, text: 'Hello choir', start_time: 1, end_time: 3, words: [] }],
  semitones: 0,
  guide_volume: 0,
  master_audio_url: '/static/output/split_master.wav',
  separation: { preset: 'best', label: 'Best · RoFormer ensemble', engine: 'roformer' },
};

describe('Backing vocals row in the Mix panel', () => {
  it('offers to split vocals that are still one stem', async () => {
    const onSplit = vi.fn();
    const user = userEvent.setup();
    render(<VocalSplitControl capability={capability()} onSplit={onSplit} />);

    expect(screen.getByRole('heading', { name: 'Backing vocals' })).toBeInTheDocument();
    expect(screen.getByTestId('vocal-split-label')).toHaveTextContent('In one stem with the lead');
    await user.click(screen.getByRole('button', { name: 'Split lead and backing vocals' }));
    expect(onSplit).toHaveBeenCalledTimes(1);
  });

  it('says why the split cannot start, on a busy song or a server without the model', () => {
    const { rerender } = render(
      <VocalSplitControl
        capability={capability()}
        onSplit={vi.fn()}
        busyReason="Wait for the video render to finish first"
      />
    );
    const button = screen.getByRole('button', { name: 'Split lead and backing vocals' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Wait for the video render to finish first');

    rerender(
      <VocalSplitControl
        capability={capability({
          available: false,
          reason: 'audio-separator is not installed (see requirements-ml.txt)',
        })}
        onSplit={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Split lead and backing vocals' })).toBeDisabled();
    expect(screen.getByTestId('vocal-split-unavailable')).toHaveTextContent(
      'This server cannot split vocals: audio-separator is not installed (see requirements-ml.txt)'
    );

    // Not known yet (capabilities still loading): the server answers when asked
    rerender(<VocalSplitControl onSplit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Split lead and backing vocals' })).toBeEnabled();
  });

  it('shows a running split with its progress and a way to cancel', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<VocalSplitControl job={job()} onSplit={vi.fn()} onCancel={onCancel} />);

    expect(screen.queryByRole('button', { name: 'Split lead and backing vocals' })).toBeNull();
    const bar = screen.getByRole('progressbar', { name: 'Vocal split progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText('Mel-Band RoFormer: chunk 21/50')).toBeInTheDocument();
    expect(screen.getByText(/42%/)).toHaveTextContent('3 min');
    await user.click(screen.getByRole('button', { name: 'Cancel vocal split' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('explains a failed split and offers it again', () => {
    render(
      <VocalSplitControl
        job={job({
          status: 'error',
          detail: 'Could not split the vocals; the song is unchanged',
          error: 'no cloud GPU started the job',
        })}
        onSplit={vi.fn()}
      />
    );
    expect(screen.getByTestId('vocal-split-error')).toHaveTextContent(
      'Could not split the vocals; the song is unchanged (no cloud GPU started the job)'
    );
    expect(screen.getByRole('button', { name: 'Split lead and backing vocals' })).toBeEnabled();
  });

  it('shows the part controls instead of the button once the vocals are split', () => {
    render(
      <VocalSplitControl split={{ model: 'm' }} job={job({ status: 'done' })} onSplit={vi.fn()}>
        <p>part levels</p>
      </VocalSplitControl>
    );
    expect(screen.getByTestId('vocal-split-label')).toHaveTextContent('Split from the lead');
    expect(screen.queryByRole('button', { name: 'Split lead and backing vocals' })).toBeNull();
    expect(screen.getByText('part levels')).toBeInTheDocument();
  });
});

describe('What keeps a vocal split waiting', () => {
  it('is another job on the song, or a render', () => {
    expect(vocalSplitBusyReason(song)).toBeNull();
    expect(vocalSplitBusyReason({ ...song, separation_job: { ...job(), quality: 'best' } })).toBe(
      'Wait for the stems to finish re-making first'
    );
    expect(
      vocalSplitBusyReason({
        ...song,
        sync_job: { id: 's', status: 'queued', mode: 'lines', progress: 0 },
      })
    ).toBe('Wait for the lyric re-alignment to finish first');
    expect(vocalSplitBusyReason({ ...song, render_status: 'rendering' })).toBe(
      'Wait for the video render to finish first'
    );
    expect(vocalSplitBusyReason({ ...song, render_status: 'completed' })).toBeNull();
  });
});

describe('Vocal split jobs', () => {
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

  it('start and cancel, putting the job on the project straight away', async () => {
    const requests: { url: string; body: unknown }[] = [];
    mockStudioFetch((url, init) => {
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/vocal-split'))
        return json({ status: 'queued', job: job({ status: 'queued', progress: 0 }) }, 202);
      if (url.endsWith('/vocal-split/cancel'))
        return json({ status: 'cancelling', job: job({ status: 'running' }) });
      return undefined;
    });
    const { hook, current } = setup(song);

    await act(() => hook.result.current.startVocalSplit());
    expect(requests[0]).toEqual({
      url: '/api/project/split-song/vocal-split',
      body: { kind: 'lead_backing' },
    });
    expect(current()?.vocal_split_job?.status).toBe('queued');
    expect(
      await screen.findByText('Splitting the lead and backing vocals. The song stays playable.')
    ).toBeInTheDocument();

    await act(() => hook.result.current.cancelVocalSplit());
    expect(requests[1].url).toBe('/api/project/split-song/vocal-split/cancel');
    expect(current()?.vocal_split_job?.status).toBe('running');
  });

  it('show why the server refused, and put no job on the song', async () => {
    mockStudioFetch(() =>
      json({ detail: 'This server cannot split the vocals: PyTorch is not installed' }, 400)
    );
    const { hook, current } = setup(song);

    await act(() => hook.result.current.startVocalSplit());

    expect(
      await screen.findByText('This server cannot split the vocals: PyTorch is not installed')
    ).toBeInTheDocument();
    expect(current()?.vocal_split_job).toBeUndefined();
  });

  it('tell the user how a split they watched ended', async () => {
    mockStudioFetch();
    const { hook } = setup({ ...song, vocal_split_job: job() });

    hook.rerender({
      project: {
        ...song,
        vocal_split_job: job({ status: 'done', detail: 'Lead and backing vocals are split' }),
      },
    });

    expect(await screen.findByText('Lead and backing vocals are split')).toBeInTheDocument();
  });

  it('are followed by the status poll, which also carries the parts', () => {
    const polled = mergeProjectStatus(song, {
      vocal_split_job: job({ status: 'done', progress: 100 }),
      vocal_splits: { lead_backing: { model: 'm' } },
    });
    expect(polled.vocal_split_job?.status).toBe('done');
    expect(polled.vocal_splits).toEqual({ lead_backing: { model: 'm' } });
    // Re-made stems drop the parts: the cleared field is seen, not kept
    expect(mergeProjectStatus(polled, { vocal_splits: null }).vocal_splits).toBeNull();
    // The same reply twice changes nothing
    expect(mergeProjectStatus(polled, { vocal_splits: { lead_backing: { model: 'm' } } })).toBe(
      polled
    );
  });
});

describe('Splitting vocals from the studio', () => {
  let served: ProjectState;
  let splitRequests: number;

  beforeAll(() => loadDeferredScreens());

  const serve = (capabilities: StudioCapabilities) => {
    resetCapabilitiesCache();
    served = song;
    splitRequests = 0;
    window.history.pushState({}, '', '/?project=split-song');
    mockStudioFetch((url, init) => {
      if (url.includes('/api/auth/status'))
        return json({ auth_required: false, authenticated: true });
      if (url.endsWith('/vocal-split') && init?.method === 'POST') {
        splitRequests += 1;
        const queued = job({ status: 'queued', progress: 0, detail: 'Waiting for other jobs…' });
        served = { ...song, vocal_split_job: queued };
        return json({ status: 'queued', job: queued }, 202);
      }
      if (url.includes('/api/project/split-song')) return json(served);
      if (url.includes('/api/projects')) return json({ [song.id]: song });
      return undefined;
    }, capabilities);
  };

  beforeEach(() => serve(withSplits([capability()])));

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  const openStudio = async () => {
    render(
      <ToastProvider>
        <App />
      </ToastProvider>
    );
    await screen.findByText('Choir Anthem');
    return screen.getByTestId('vocal-split');
  };

  it('starts the split from the Mix panel and follows it until the parts are there', async () => {
    const panel = await openStudio();
    const button = within(panel).getByRole('button', { name: 'Split lead and backing vocals' });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);

    expect(
      await screen.findByRole('progressbar', { name: 'Vocal split progress' })
    ).toBeInTheDocument();
    expect(splitRequests).toBe(1);
    // Re-making the stems waits for the split
    expect(screen.getByRole('button', { name: 'Improve stem separation' })).toBeDisabled();

    served = {
      ...song,
      vocal_split_job: job({
        status: 'done',
        progress: 100,
        detail: 'Lead and backing vocals are split',
      }),
      vocal_splits: { lead_backing: { model: 'm' } },
    };
    await waitFor(
      () =>
        expect(screen.getByTestId('vocal-split-label')).toHaveTextContent('Split from the lead'),
      { timeout: 4000 }
    );
    expect(screen.queryByRole('progressbar', { name: 'Vocal split progress' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Improve stem separation' })).toBeEnabled();
  });

  it('starts the split from the command palette', async () => {
    await openStudio();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(await screen.findByRole('combobox', { name: /search commands/i }), {
      target: { value: 'backing vocals' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /Split lead and backing vocals/ }));

    await waitFor(() => expect(splitRequests).toBe(1));
    expect(
      await screen.findByRole('progressbar', { name: 'Vocal split progress' })
    ).toBeInTheDocument();
  });

  it('disables the split on a server that cannot run it, with the reason', async () => {
    vi.restoreAllMocks();
    serve(withSplits([capability({ available: false, reason: 'PyTorch is not installed' })]));

    const panel = await openStudio();

    await waitFor(() =>
      expect(within(panel).getByTestId('vocal-split-unavailable')).toHaveTextContent(
        'This server cannot split vocals: PyTorch is not installed'
      )
    );
    expect(
      within(panel).getByRole('button', { name: 'Split lead and backing vocals' })
    ).toBeDisabled();
  });
});

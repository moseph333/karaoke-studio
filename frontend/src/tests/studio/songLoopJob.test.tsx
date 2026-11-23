/**
 * Song loops (the looping background video made from a song's lyrics): the control in the
 * Stage look panel, the jobs behind it, and the loop as a stage background and in an export.
 */

import { loadDeferredScreens } from '../../deferredScreens';
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { SongLoopControl } from '../../components/look/SongLoopControl';
import { VisualThemePicker } from '../../components/VisualThemePicker';
import { useQualityJobs } from '../../hooks/useQualityJobs';
import { mergeProjectStatus } from '../../hooks/useProjectPolling';
import { resetCapabilitiesCache } from '../../hooks/useCapabilities';
import { ToastProvider } from '../../hooks/useToast';
import { getStageLook } from '../../theme/stageLooks';
import { STAGE_SETTINGS_STORAGE_KEY } from '../../theme/stageSettingsStorage';
import { isStageBackgroundStyle, STAGE_BACKGROUND_OPTIONS } from '../../theme/stageBackgrounds';
import { renderStyleConfig } from '../../utils/renderRequest';
import { showsSongLoop } from '../../utils/songLoop';
import type {
  ProjectState,
  SongLoop,
  SongLoopCapability,
  SongLoopJob,
  StudioCapabilities,
} from '../../types';
import { CAPABILITIES, json, mockStudioFetch } from '../helpers/qualityFixtures';

const SCENE = 'Paper lanterns drift down a dark river under a violet sky.';

const loop = (overrides: Partial<SongLoop> = {}): SongLoop => ({
  url: '/static/output/loop-song_loop.mp4?v=17',
  prompt: SCENE,
  written_from: 'lyrics',
  model: 'wan22',
  model_label: 'Wan 2.2 (5B)',
  duration: 4.04,
  ...overrides,
});

const job = (overrides: Partial<SongLoopJob> = {}): SongLoopJob => ({
  id: 'loop1',
  status: 'running',
  prompt: null,
  progress: 37,
  detail: 'Wan 2.2 (5B) drawing the loop (step 15 of 50)',
  ...overrides,
});

const capability = (overrides: Partial<SongLoopCapability> = {}): SongLoopCapability => ({
  available: true,
  reason: null,
  runs_on: 'cloud-gpu',
  model: 'wan22',
  model_label: 'Wan 2.2 (5B)',
  max_prompt_chars: 600,
  ...overrides,
});

const OFF = capability({
  available: false,
  runs_on: null,
  reason: 'it has no cloud GPU set up for them (SONG_LOOP_REMOTE)',
});

const withLoops = (song_loop: SongLoopCapability): StudioCapabilities => ({
  ...CAPABILITIES,
  song_loop,
});

const song: ProjectState = {
  id: 'loop-song',
  title: 'Paper Boats',
  artist: 'The Lanterns',
  status: 'ready',
  progress: 100,
  duration: 200,
  lines: [{ id: 1, text: 'Down by the river', start_time: 1, end_time: 3, words: [] }],
  semitones: 0,
  guide_volume: 0,
  thumbnail_url: '/static/downloads/loop-song.jpg',
  master_audio_url: '/static/output/loop_master.wav',
  instrumental_url: '/static/stems/loop-song/instrumental.wav',
};

describe('Song loop control', () => {
  it('makes a loop from the lyrics when the scene is left empty', async () => {
    const onMake = vi.fn();
    const user = userEvent.setup();
    render(<SongLoopControl capability={capability()} onMake={onMake} />);

    expect(screen.getByRole('heading', { name: 'Song loop' })).toBeInTheDocument();
    const scene = screen.getByRole('textbox', { name: 'What the loop shows' });
    expect(scene).toHaveValue('');
    expect(scene).toHaveAttribute('placeholder', 'Leave empty to have it written from the lyrics');
    expect(scene).toHaveAttribute('maxlength', '600');
    expect(screen.queryByRole('button', { name: 'Remove song loop' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Make a loop' }));
    expect(onMake).toHaveBeenCalledWith('');
  });

  it('makes a loop of the scene that was typed', async () => {
    const onMake = vi.fn();
    const user = userEvent.setup();
    render(<SongLoopControl capability={capability()} onMake={onMake} />);

    await user.type(screen.getByRole('textbox', { name: 'What the loop shows' }), '  Rain  ');
    await user.click(screen.getByRole('button', { name: 'Make a loop' }));
    expect(onMake).toHaveBeenCalledWith('Rain');
  });

  it('shows the scene of the loop the song has, to edit and make again or remove', async () => {
    const onMake = vi.fn();
    const onRemove = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <SongLoopControl
        loop={loop()}
        capability={capability()}
        onMake={onMake}
        onRemove={onRemove}
      />
    );

    const scene = screen.getByRole('textbox', { name: 'What the loop shows' });
    expect(scene).toHaveValue(SCENE);
    await user.clear(scene);
    await user.type(scene, 'A field of wheat');
    await user.click(screen.getByRole('button', { name: 'Make again' }));
    expect(onMake).toHaveBeenCalledWith('A field of wheat');

    await user.click(screen.getByRole('button', { name: 'Remove song loop' }));
    expect(onRemove).toHaveBeenCalledTimes(1);

    // The new loop brings the scene it was drawn from
    rerender(
      <SongLoopControl
        loop={loop({ prompt: 'A field of wheat under slow clouds.' })}
        capability={capability()}
        onMake={onMake}
        onRemove={onRemove}
      />
    );
    expect(scene).toHaveValue('A field of wheat under slow clouds.');
  });

  it('shows a loop being made with its progress and a way to cancel', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <SongLoopControl job={job()} capability={capability()} onMake={vi.fn()} onCancel={onCancel} />
    );

    expect(screen.queryByRole('button', { name: 'Make a loop' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'What the loop shows' })).toBeDisabled();
    const bar = screen.getByRole('progressbar', { name: 'Song loop progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '37');
    expect(screen.getByText('Wan 2.2 (5B) drawing the loop (step 15 of 50)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel song loop' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('explains a failed loop and offers it again', () => {
    render(
      <SongLoopControl
        job={job({
          status: 'error',
          detail: 'Could not make the song loop; the song is unchanged',
          error: 'no cloud GPU started the job',
        })}
        capability={capability()}
        onMake={vi.fn()}
      />
    );
    expect(screen.getByTestId('song-loop-error')).toHaveTextContent(
      'Could not make the song loop; the song is unchanged (no cloud GPU started the job)'
    );
    expect(screen.getByRole('button', { name: 'Make a loop' })).toBeEnabled();
  });

  it('says why a server set up for loops cannot make one now', () => {
    render(
      <SongLoopControl
        capability={capability({ available: false, reason: 'Modal credentials are missing' })}
        onMake={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Make a loop' })).toBeDisabled();
    expect(screen.getByTestId('song-loop-unavailable')).toHaveTextContent(
      'This server cannot make song loops: Modal credentials are missing'
    );
  });

  it('belongs on screen only where there is something to show', () => {
    expect(showsSongLoop({ capability: capability() })).toBe(true);
    // Set up for loops but unusable right now: the reason is worth showing
    expect(showsSongLoop({ capability: capability({ available: false }) })).toBe(true);
    // A server with no way to make loops shows nothing, unless the song has one already
    expect(showsSongLoop({ capability: OFF })).toBe(false);
    expect(showsSongLoop({})).toBe(false);
    expect(showsSongLoop({ capability: OFF, loop: loop() })).toBe(true);
    expect(showsSongLoop({ capability: OFF, job: job() })).toBe(true);
    expect(showsSongLoop({ capability: OFF, job: job({ status: 'error' }) })).toBe(false);
  });
});

describe('The loop as a stage background', () => {
  const renderPicker = (props: Partial<React.ComponentProps<typeof VisualThemePicker>>) =>
    render(
      <ToastProvider>
        <VisualThemePicker
          selectedTheme={getStageLook('marquee')}
          onSelectTheme={vi.fn()}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
          onBackgroundStyleChange={vi.fn()}
          {...props}
        />
      </ToastProvider>
    );

  it('is a style of its own, offered only for a song that has a loop', () => {
    expect(isStageBackgroundStyle('loop')).toBe(true);
    expect(STAGE_BACKGROUND_OPTIONS.map((option) => option.value)).not.toContain('loop');

    const onBackgroundStyleChange = vi.fn();
    const { unmount } = renderPicker({
      backgroundStyle: 'artwork',
      onBackgroundStyleChange,
      songLoop: { loop: loop(), capability: capability() },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Song loop' }));
    expect(onBackgroundStyleChange).toHaveBeenCalledWith('loop');
    unmount();

    renderPicker({
      backgroundStyle: 'artwork',
      songLoop: { capability: capability(), onMake: vi.fn() },
    });
    expect(screen.queryByRole('radio', { name: 'Song loop' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Make a loop' })).toBeInTheDocument();
  });

  it('shows as cover art on a song without a loop', () => {
    renderPicker({ backgroundStyle: 'loop', songLoop: { capability: capability() } });
    expect(screen.getByRole('radio', { name: 'Cover art' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('leaves the panel as it was on a server that cannot make loops', () => {
    renderPicker({ backgroundStyle: 'artwork', songLoop: { capability: OFF } });
    expect(screen.queryByTestId('song-loop')).toBeNull();
    renderPicker({ backgroundStyle: 'artwork' });
    expect(screen.queryByTestId('song-loop')).toBeNull();
  });

  it('is named in a render request, without colours: the server knows the file', () => {
    const config = renderStyleConfig(
      { lookId: 'marquee' },
      { style: 'loop', palette: ['#fff', '#eee', '#ddd'] }
    );
    expect(config).toEqual({ theme_id: 'marquee', background_style: 'loop' });
  });
});

describe('Song loop jobs', () => {
  afterEach(() => vi.restoreAllMocks());

  const setup = (initial: ProjectState, onSongLoopReady = vi.fn()) => {
    let current: ProjectState | null = initial;
    const setProject = vi.fn((update: React.SetStateAction<ProjectState | null>) => {
      current = typeof update === 'function' ? update(current) : update;
    });
    const hook = renderHook(
      ({ project }: { project: ProjectState | null }) =>
        useQualityJobs({ project, setProject, onSongLoopReady }),
      {
        initialProps: { project: initial as ProjectState | null },
        wrapper: ({ children }) => <ToastProvider>{children}</ToastProvider>,
      }
    );
    return { hook, current: () => current, onSongLoopReady };
  };

  it('start, cancel and remove, putting each change on the project straight away', async () => {
    const requests: { url: string; method?: string; body: unknown }[] = [];
    mockStudioFetch((url, init) => {
      requests.push({
        url,
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.endsWith('/song-loop/cancel'))
        return json({ status: 'cancelling', job: job({ status: 'running' }) });
      if (url.endsWith('/song-loop') && init?.method === 'DELETE')
        return json({ status: 'removed' });
      if (url.endsWith('/song-loop'))
        return json({ status: 'queued', job: job({ status: 'queued', progress: 0 }) }, 202);
      return undefined;
    });
    const { hook, current } = setup({ ...song, song_loop: loop() });

    await act(() => hook.result.current.startSongLoop());
    expect(requests[0]).toEqual({
      url: '/api/project/loop-song/song-loop',
      method: 'POST',
      body: {},
    });
    expect(current()?.song_loop_job?.status).toBe('queued');
    expect(
      await screen.findByText(
        'Making the song loop. This takes a few minutes; the song stays playable.'
      )
    ).toBeInTheDocument();

    await act(() => hook.result.current.startSongLoop('  Rain on a window '));
    expect(requests[1].body).toEqual({ prompt: 'Rain on a window' });

    await act(() => hook.result.current.cancelSongLoop());
    expect(requests[2].url).toBe('/api/project/loop-song/song-loop/cancel');
    expect(current()?.song_loop_job?.status).toBe('running');

    await act(() => hook.result.current.removeSongLoop());
    expect(requests[3]).toMatchObject({
      url: '/api/project/loop-song/song-loop',
      method: 'DELETE',
    });
    expect(current()?.song_loop).toBeNull();
  });

  it('show why the server refused, and put no job on the song', async () => {
    mockStudioFetch(() =>
      json({ detail: 'This server cannot make song loops: no cloud GPU' }, 400)
    );
    const { hook, current } = setup(song);

    await act(() => hook.result.current.startSongLoop());

    expect(
      await screen.findByText('This server cannot make song loops: no cloud GPU')
    ).toBeInTheDocument();
    expect(current()?.song_loop_job).toBeUndefined();
  });

  it('tell the stage when a loop made from this tab is ready', async () => {
    mockStudioFetch((url) =>
      url.endsWith('/song-loop')
        ? json({ status: 'queued', job: job({ status: 'queued', progress: 0 }) }, 202)
        : undefined
    );
    const { hook, onSongLoopReady } = setup(song);
    await act(() => hook.result.current.startSongLoop());

    hook.rerender({ project: { ...song, song_loop_job: job() } });
    expect(onSongLoopReady).not.toHaveBeenCalled();
    hook.rerender({
      project: {
        ...song,
        song_loop: loop(),
        song_loop_job: job({ status: 'done', progress: 100, detail: 'The song loop is ready' }),
      },
    });

    expect(onSongLoopReady).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('The song loop is ready')).toBeInTheDocument();
  });

  it('leave the stage alone for a loop another tab made, or one that failed', async () => {
    mockStudioFetch((url) =>
      url.endsWith('/song-loop')
        ? json({ status: 'queued', job: job({ status: 'queued', progress: 0 }) }, 202)
        : undefined
    );
    const other = setup({ ...song, song_loop_job: job({ id: 'elsewhere' }) });
    other.hook.rerender({
      project: { ...song, song_loop_job: job({ id: 'elsewhere', status: 'done' }) },
    });
    expect(other.onSongLoopReady).not.toHaveBeenCalled();

    const failed = setup(song);
    await act(() => failed.hook.result.current.startSongLoop());
    failed.hook.rerender({
      project: { ...song, song_loop_job: job({ status: 'error', error: 'out of video memory' }) },
    });
    expect(failed.onSongLoopReady).not.toHaveBeenCalled();
  });

  it('are followed by the status poll, which also carries the loop', () => {
    const polled = mergeProjectStatus(song, {
      song_loop_job: job({ status: 'done', progress: 100 }),
      song_loop: loop(),
    });
    expect(polled.song_loop_job?.status).toBe('done');
    expect(polled.song_loop?.prompt).toBe(SCENE);
    // A removed loop is seen, not kept
    expect(mergeProjectStatus(polled, { song_loop: null }).song_loop).toBeNull();
    // The same reply twice changes nothing
    expect(mergeProjectStatus(polled, { song_loop: loop() })).toBe(polled);
  });
});

describe('Song loops in the studio', () => {
  let served: ProjectState;
  let requests: { url: string; method?: string; body: unknown }[];

  beforeAll(() => loadDeferredScreens());

  const serve = (capabilities: StudioCapabilities, project: ProjectState = song) => {
    resetCapabilitiesCache();
    served = project;
    requests = [];
    window.history.pushState({}, '', '/?project=loop-song');
    mockStudioFetch((url, init) => {
      if (url.includes('/api/auth/status'))
        return json({ auth_required: false, authenticated: true });
      if (url.includes('/song-loop') || url.endsWith('/render')) {
        requests.push({
          url,
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
      }
      if (url.endsWith('/song-loop') && init?.method === 'POST') {
        const queued = job({ status: 'queued', progress: 0, detail: 'Waiting for a cloud GPU…' });
        served = { ...served, song_loop_job: queued };
        return json({ status: 'queued', job: queued }, 202);
      }
      if (url.includes('/api/project/loop-song')) return json(served);
      if (url.includes('/api/projects')) return json({ [song.id]: served });
      return undefined;
    }, capabilities);
  };

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  const openStudio = async () => {
    render(
      <ToastProvider>
        <App />
      </ToastProvider>
    );
    await screen.findByText('Paper Boats');
  };

  it('starts a loop from the Look panel and shows it being made', async () => {
    serve(withLoops(capability()));
    await openStudio();
    const panel = await screen.findByTestId('song-loop');

    fireEvent.click(within(panel).getByRole('button', { name: 'Make a loop' }));

    await waitFor(() =>
      expect(requests).toEqual([
        { url: '/api/project/loop-song/song-loop', method: 'POST', body: {} },
      ])
    );
    expect(
      await within(panel).findByRole('progressbar', { name: 'Song loop progress' })
    ).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Cancel song loop' })).toBeInTheDocument();
  });

  it('has no song loop control on a server that cannot make them', async () => {
    serve(withLoops(OFF));
    await openStudio();
    await waitFor(() =>
      expect(screen.getByRole('radiogroup', { name: 'Stage background' })).toBeInTheDocument()
    );
    expect(screen.queryByTestId('song-loop')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Song loop' })).toBeNull();
  });

  it('plays the loop behind the lyrics and names it in the export', async () => {
    localStorage.setItem(
      STAGE_SETTINGS_STORAGE_KEY,
      JSON.stringify({ v: 2, backgroundStyle: 'loop' })
    );
    serve(withLoops(capability()), { ...song, song_loop: loop() });
    await openStudio();

    const video = await screen.findByTestId('stage-custom-bg');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('src', '/static/output/loop-song_loop.mp4?v=17');
    expect(screen.getByRole('radio', { name: 'Song loop' })).toHaveAttribute(
      'aria-checked',
      'true'
    );

    fireEvent.click(screen.getByTestId('studio-export-btn'));
    fireEvent.click(await screen.findByRole('button', { name: 'Render 1080p Video' }));
    await waitFor(() => expect(requests.some(({ url }) => url.endsWith('/render'))).toBe(true));
    const body = requests.find(({ url }) => url.endsWith('/render'))!.body as {
      custom_bg_id?: string;
      style_config: Record<string, unknown>;
    };
    expect(body.custom_bg_id).toBeUndefined();
    expect(body.style_config.background_style).toBe('loop');
  });

  it('shows the cover art for the loop style on a song without a loop', async () => {
    localStorage.setItem(
      STAGE_SETTINGS_STORAGE_KEY,
      JSON.stringify({ v: 2, backgroundStyle: 'loop' })
    );
    serve(withLoops(capability()));
    await openStudio();

    expect(await screen.findByTestId('stage-album-art')).toBeInTheDocument();
    expect(screen.queryByTestId('stage-custom-bg')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Cover art' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('offers the loop in the command palette once the song has one', async () => {
    serve(withLoops(capability()), { ...song, song_loop: loop() });
    await openStudio();
    fireEvent.click(screen.getByRole('button', { name: /open command palette/i }));
    fireEvent.change(await screen.findByRole('combobox', { name: /search commands/i }), {
      target: { value: 'stage background song loop' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /Stage background: Song loop/ }));
    expect(await screen.findByTestId('stage-custom-bg')).toBeInTheDocument();
  });
});

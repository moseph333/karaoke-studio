/**
 * Background styles in the studio: the Look panel picker, what a render request carries for
 * each style, the export-matching lyric outline, and the command palette entries.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import { VisualThemePicker } from '../../components/VisualThemePicker';
import { LyricDisplay } from '../../components/LyricDisplay';
import { ToastProvider } from '../../hooks/useToast';
import { STAGE_SETTINGS_STORAGE_KEY } from '../../theme/stageSettingsStorage';
import { THEMES } from '../../theme/stagePresets';
import { ProjectState } from '../../types';

const afterglow = THEMES.find((t) => t.id === 'afterglow')!;

const renderPicker = (props: Partial<React.ComponentProps<typeof VisualThemePicker>> = {}) =>
  render(
    <ToastProvider>
      <VisualThemePicker
        selectedTheme={afterglow}
        onSelectTheme={vi.fn()}
        aspectRatio="16:9"
        onChangeAspectRatio={vi.fn()}
        onCustomBgUploaded={vi.fn()}
        {...props}
      />
    </ToastProvider>
  );

describe('background picker', () => {
  it('offers the styles as one radio group and reports the choice', () => {
    const onBackgroundStyleChange = vi.fn();
    renderPicker({ backgroundStyle: 'artwork', onBackgroundStyleChange });

    const group = screen.getByRole('radiogroup', { name: 'Stage background' });
    const names = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.textContent);
    expect(names).toEqual(['Cover art', 'Drifting art', 'Aurora', 'Spectrum', 'Plain']);
    expect(within(group).getByRole('radio', { name: 'Cover art' })).toHaveAttribute(
      'aria-checked',
      'true'
    );

    fireEvent.click(within(group).getByRole('radio', { name: 'Aurora' }));
    expect(onBackgroundStyleChange).toHaveBeenCalledWith('aurora');
  });

  it('adds the upload as a choice once there is one, without repeating its file name', () => {
    renderPicker({
      backgroundStyle: 'custom',
      onBackgroundStyleChange: vi.fn(),
      customBgId: 'ab12cd34_concert.mp4',
    });
    const upload = screen.getByRole('radio', { name: 'Upload' });
    expect(upload).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByText('concert.mp4')).toHaveLength(1);
  });

  it('explains songs without cover art and styles that move', () => {
    const { rerender } = renderPicker({
      backgroundStyle: 'drift',
      onBackgroundStyleChange: vi.fn(),
      hasArtwork: false,
    });
    expect(screen.getByText(/no cover art, so the stage colour shows/i)).toBeInTheDocument();
    expect(screen.getByText(/Moves with the song: press play/i)).toBeInTheDocument();

    rerender(
      <ToastProvider>
        <VisualThemePicker
          selectedTheme={afterglow}
          onSelectTheme={vi.fn()}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
          backgroundStyle="color"
          onBackgroundStyleChange={vi.fn()}
        />
      </ToastProvider>
    );
    expect(screen.queryByText(/Moves with the song/i)).toBeNull();
  });

  it('is left out where no handler is given', () => {
    renderPicker();
    expect(screen.queryByRole('radiogroup', { name: 'Stage background' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
  });
});

describe('stage lyrics outline', () => {
  it('outlines the lyrics like the exported video', () => {
    render(
      <LyricDisplay
        lines={[
          {
            id: 1,
            text: 'Neon',
            start_time: 1,
            end_time: 3,
            words: [{ word: 'Neon', start_time: 1, end_time: 3 }],
          },
        ]}
        currentTime={1.5}
      />
    );
    const base = screen.getAllByText('Neon')[0];
    expect(base.style.textShadow).toContain('#111111');
  });
});

describe('render requests and palette commands', () => {
  const project: ProjectState = {
    id: 'bg-proj',
    title: 'Backdrop Song',
    artist: 'The Styles',
    status: 'ready',
    progress: 100,
    duration: 60,
    lines: [{ id: 1, text: 'One line', start_time: 2, end_time: 5, words: [] }],
    semitones: 0,
    guide_volume: 0,
    thumbnail_url: '/static/downloads/bg.jpg',
    master_audio_url: '/static/output/bg_master.wav',
    instrumental_url: '/static/stems/bg/instrumental.wav',
  };
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    window.history.pushState({}, '', '/?project=bg-proj');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes('/api/auth/status')) {
        return new Response(JSON.stringify({ auth_required: false, authenticated: true }));
      }
      if (u.includes('/api/projects'))
        return new Response(JSON.stringify({ [project.id]: project }));
      if (u.includes('/api/project/bg-proj')) return new Response(JSON.stringify(project));
      return new Response('{}');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  const renderBody = async (settings: Record<string, unknown> | null) => {
    if (settings) localStorage.setItem(STAGE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    render(<App />);
    await waitFor(() => expect(screen.getByText('Backdrop Song')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('studio-export-btn'));
    fireEvent.click(await screen.findByRole('button', { name: 'Start video render' }));
    await waitFor(() =>
      expect(fetchSpy.mock.calls.some(([u]) => String(u).endsWith('/render'))).toBe(true)
    );
    const call = fetchSpy.mock.calls.find(([u]) => String(u).endsWith('/render'))!;
    return JSON.parse((call[1] as RequestInit).body as string);
  };

  it('sends nothing new for the cover-art default', async () => {
    const body = await renderBody(null);
    expect(body.custom_bg_id).toBeUndefined();
    expect(body.style_config).not.toHaveProperty('background_style');
    expect(body.style_config).not.toHaveProperty('background_palette');
    expect(body.style_config).not.toHaveProperty('background_tone');
  });

  it('sends a generated style with its colours, and the light tone on light presets', async () => {
    const body = await renderBody({
      v: 1,
      presetId: 'clean_paper',
      presetSource: 'user',
      backgroundStyle: 'aurora',
      customBgId: 'ab12cd34_loop.mp4',
    });
    expect(body.custom_bg_id).toBeUndefined(); // a stored upload must not outrank the style
    expect(body.style_config).toMatchObject({
      background_style: 'aurora',
      background_palette: ['#dc2626', '#d97706', '#1f2937'],
      background_tone: 'light',
      background_color: '#f4f4f0',
    });
  });

  it('sends the drift without colours and the upload only when it is chosen', async () => {
    const drift = await renderBody({
      v: 1,
      backgroundStyle: 'drift',
      customBgId: 'ab12cd34_a.png',
    });
    expect(drift.custom_bg_id).toBeUndefined();
    expect(drift.style_config.background_style).toBe('drift');
    expect(drift.style_config).not.toHaveProperty('background_palette');
  });

  it('sends the uploaded file for the upload style', async () => {
    const body = await renderBody({
      v: 1,
      backgroundStyle: 'custom',
      customBgId: 'ab12cd34_a.png',
    });
    expect(body.custom_bg_id).toBe('ab12cd34_a.png');
    expect(body.style_config).not.toHaveProperty('background_style');
  });

  it('switches the background from the command palette', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText('Backdrop Song')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /open command palette/i }));
    fireEvent.change(screen.getByRole('combobox', { name: /search commands/i }), {
      target: { value: 'stage background aurora' },
    });
    fireEvent.click(screen.getByRole('option', { name: /Stage background: Aurora/ }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(STAGE_SETTINGS_STORAGE_KEY)!).backgroundStyle).toBe(
        'aurora'
      )
    );
  });
});

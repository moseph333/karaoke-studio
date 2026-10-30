/**
 * Persisted stage settings: validation of stored data, restore/save in useVisualTheme, the
 * preset-source rules, duet colors, and the Look panel controls that feed them.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DEFAULT_STAGE_SETTINGS,
  STAGE_SETTINGS_STORAGE_KEY,
  loadStageSettings,
  sanitizeStageSettings,
} from '../../theme/stageSettingsStorage';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { AppThemeProvider, useAppTheme } from '../../context/AppThemeContext';
import { VisualThemePicker } from '../../components/VisualThemePicker';
import { ExportModal } from '../../components/ExportModal';
import { DEFAULT_SINGER2_COLOR, getStagePreset } from '../../theme/stagePresets';
import * as apiModule from '../../api';
import { ProjectState } from '../../types';

const stored = () => JSON.parse(localStorage.getItem(STAGE_SETTINGS_STORAGE_KEY) || 'null');
const seed = (value: unknown) =>
  localStorage.setItem(STAGE_SETTINGS_STORAGE_KEY, JSON.stringify(value));

const withAppTheme =
  (initialThemeId: 'afterglow' | 'punk_diy' = 'afterglow') =>
  ({ children }: { children: React.ReactNode }) => (
    <AppThemeProvider initialThemeId={initialThemeId}>{children}</AppThemeProvider>
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sanitizeStageSettings', () => {
  it('falls back to defaults for anything that is not an object', () => {
    expect(sanitizeStageSettings(null)).toEqual(DEFAULT_STAGE_SETTINGS);
    expect(sanitizeStageSettings('nope')).toEqual(DEFAULT_STAGE_SETTINGS);
    expect(sanitizeStageSettings([1, 2])).toEqual(DEFAULT_STAGE_SETTINGS);
  });

  it('keeps valid fields and drops invalid ones field by field', () => {
    const result = sanitizeStageSettings({
      presetId: 'neon_pink',
      presetSource: 'user',
      customSungColor: '#ABCDEF',
      customUnsungColor: 'red',
      singer2Color: '#123',
      bothColor: '#0f0f0f',
      fontSizeScale: 9,
      aspectRatio: '4:3',
      syncMode: 'line',
      customBgId: '../../etc/passwd',
      showVisualizer: 'yes',
      showChordBar: true,
      stageSize: 'huge',
    });
    expect(result).toEqual({
      ...DEFAULT_STAGE_SETTINGS,
      presetId: 'neon_pink',
      presetSource: 'user',
      customSungColor: '#abcdef',
      bothColor: '#0f0f0f',
      syncMode: 'line',
      showChordBar: true,
    });
  });

  it('only honours a user preset that still exists', () => {
    expect(sanitizeStageSettings({ presetId: 'gone', presetSource: 'user' })).toMatchObject({
      presetId: null,
      presetSource: 'app',
    });
  });

  it('accepts uploaded background ids and the large stage size', () => {
    expect(
      sanitizeStageSettings({ customBgId: 'ab12cd34_my-loop.mp4', stageSize: 'large' })
    ).toMatchObject({ customBgId: 'ab12cd34_my-loop.mp4', stageSize: 'large' });
  });

  it('returns null for corrupt JSON or blocked storage', () => {
    localStorage.setItem(STAGE_SETTINGS_STORAGE_KEY, '{not json');
    expect(loadStageSettings()).toBeNull();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(loadStageSettings()).toBeNull();
  });
});

describe('useVisualTheme persistence', () => {
  it('does not touch storage unless persistence is requested', () => {
    const { result } = renderHook(() => useVisualTheme());
    act(() => result.current.setCustomSungColor('#112233'));
    expect(localStorage.getItem(STAGE_SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it('saves every stage setting as it changes', () => {
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }), {
      wrapper: withAppTheme(),
    });
    act(() => {
      result.current.setCustomSungColor('#112233');
      result.current.setCustomSinger2Color('#445566');
      result.current.setFontSizeScale(1.2);
      result.current.setAspectRatio('9:16');
      result.current.setSyncMode('line');
      result.current.toggleVisualizer();
      result.current.toggleChordBar();
      result.current.setStageSize('large');
    });
    expect(stored()).toMatchObject({
      v: 1,
      presetId: 'afterglow',
      presetSource: 'app',
      customSungColor: '#112233',
      singer2Color: '#445566',
      fontSizeScale: 1.2,
      aspectRatio: '9:16',
      syncMode: 'line',
      showVisualizer: true,
      showChordBar: true,
      stageSize: 'large',
    });
  });

  it('restores saved settings on the next visit', () => {
    seed({
      v: 1,
      customSungColor: '#ff0000',
      fontSizeScale: 1.5,
      aspectRatio: '9:16',
      syncMode: 'line',
      showVisualizer: true,
      stageSize: 'compact',
    });
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }), {
      wrapper: withAppTheme(),
    });
    expect(result.current.activeSungColor).toBe('#ff0000');
    expect(result.current.fontSizeScale).toBe(1.5);
    expect(result.current.aspectRatio).toBe('9:16');
    expect(result.current.syncMode).toBe('line');
    expect(result.current.showVisualizer).toBe(true);
    expect(result.current.showChordBar).toBe(false);
    expect(result.current.stageSize).toBe('compact');
  });

  it('keeps a preset the user picked across reloads', () => {
    seed({ v: 1, presetId: 'neon_pink', presetSource: 'user' });
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }), {
      wrapper: withAppTheme('afterglow'),
    });
    expect(result.current.selectedTheme.id).toBe('neon_pink');
  });

  it('follows the app theme when the saved preset came from it', () => {
    seed({ v: 1, presetId: 'neon_pink', presetSource: 'app' });
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }), {
      wrapper: withAppTheme('punk_diy'),
    });
    expect(result.current.selectedTheme.id).toBe('punk_diy');
  });

  it('re-syncs the preset when the app theme changes, even after a user pick', () => {
    const { result } = renderHook(
      () => ({ visual: useVisualTheme(undefined, { persist: true }), app: useAppTheme() }),
      { wrapper: withAppTheme('afterglow') }
    );
    act(() => result.current.visual.setSelectedTheme(getStagePreset('neon_pink')!));
    expect(stored()).toMatchObject({ presetId: 'neon_pink', presetSource: 'user' });

    act(() => result.current.app.setThemeId('punk_diy'));
    expect(result.current.visual.selectedTheme.id).toBe('punk_diy');
    expect(stored()).toMatchObject({ presetId: 'punk_diy', presetSource: 'app' });
  });
});

describe('duet colors and stage backdrop', () => {
  it('uses the preset duet colors, then custom overrides, and resets them', () => {
    const { result } = renderHook(() => useVisualTheme(getStagePreset('afterglow')));
    expect(result.current.activeSinger2Color).toBe('#f472b6');
    expect(result.current.activeBothColor).toBe('#5eead4');
    expect(result.current.stageBackgroundColor).toBe('#0b0b12');

    act(() => result.current.setCustomSinger2Color('#00ff00'));
    expect(result.current.activeSinger2Color).toBe('#00ff00');

    act(() => result.current.resetThemeDefaults());
    expect(result.current.activeSinger2Color).toBe('#f472b6');
  });

  it('falls back to the default duet colors for presets without their own', () => {
    const { result } = renderHook(() => useVisualTheme(getStagePreset('modern_gold')));
    expect(result.current.activeSinger2Color).toBe(DEFAULT_SINGER2_COLOR);
  });
});

describe('Look panel controls', () => {
  const baseProps = {
    selectedTheme: getStagePreset('afterglow')!,
    onSelectTheme: vi.fn(),
    aspectRatio: '16:9',
    onChangeAspectRatio: vi.fn(),
    onCustomBgUploaded: vi.fn(),
  };

  it('shows duet color pickers only for duet songs', () => {
    const onSinger2 = vi.fn();
    const { rerender } = render(<VisualThemePicker {...baseProps} />);
    expect(screen.queryByTestId('singer2-color-picker')).toBeNull();

    rerender(
      <VisualThemePicker {...baseProps} showDuetColors onCustomSinger2ColorChange={onSinger2} />
    );
    const picker = screen.getByLabelText('Singer 2 sung color') as HTMLInputElement;
    expect(picker.value).toBe('#f472b6');
    fireEvent.change(picker, { target: { value: '#123456' } });
    expect(onSinger2).toHaveBeenCalledWith('#123456');
    expect(screen.getByLabelText('Both singers sung color')).toBeInTheDocument();
  });

  it('switches the studio preview size', async () => {
    const user = userEvent.setup();
    const onStageSizeChange = vi.fn();
    render(
      <VisualThemePicker
        {...baseProps}
        stageSize="standard"
        onStageSizeChange={onStageSizeChange}
      />
    );
    const group = screen.getByRole('group', { name: 'Studio preview size' });
    expect(screen.getByTestId('stage-size-standard')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('stage-size-large'));
    expect(onStageSizeChange).toHaveBeenCalledWith('large');
    // Desktop-only control
    expect(group.parentElement?.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(group.parentElement?.className).toContain('md:flex');
  });
});

describe('exports carry the stage look', () => {
  const project: ProjectState = {
    id: 'parity-project',
    status: 'ready',
    progress: 100,
    title: 'Duet',
    artist: 'Pair',
    lines: [{ id: 1, start_time: 0, end_time: 2, text: 'Hi', words: [], singer: 'singer2' }],
    semitones: 0,
    guide_volume: 0,
    render_status: 'idle',
    render_progress: 0,
  };

  it('sends duet colors and the backdrop with a render request', async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(apiModule, 'apiFetch')
      .mockResolvedValue(new Response(JSON.stringify({ status: 'queued' }), { status: 200 }));
    render(
      <ExportModal
        project={project}
        isOpen
        onClose={vi.fn()}
        selectedTheme={getStagePreset('afterglow')}
        singer2Color="#f472b6"
        bothColor="#5eead4"
        backgroundColor="#0b0b12"
      />
    );
    await user.click(screen.getByRole('button', { name: /start video render/i }));
    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    expect(body.style_config).toMatchObject({
      theme_id: 'afterglow',
      singer2_color: '#f472b6',
      both_color: '#5eead4',
      background_color: '#0b0b12',
    });
  });

  it('adds duet colors to the .ass subtitle export', async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(apiModule, 'apiFetch')
      .mockResolvedValue(new Response('[Script Info]', { status: 200 }));
    render(
      <ExportModal
        project={project}
        isOpen
        onClose={vi.fn()}
        selectedTheme={getStagePreset('afterglow')}
        singer2Color="#f472b6"
        bothColor="#5eead4"
      />
    );
    await user.click(screen.getByRole('button', { name: 'Download .ass subtitles' }));
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('singer2_color=%23f472b6');
    expect(url).toContain('both_color=%235eead4');
  });
});

describe('background style', () => {
  it('keeps a known style and falls back to cover art otherwise', () => {
    expect(sanitizeStageSettings({ backgroundStyle: 'aurora' }).backgroundStyle).toBe('aurora');
    expect(sanitizeStageSettings({ backgroundStyle: 'lava' }).backgroundStyle).toBe('artwork');
    expect(sanitizeStageSettings({ backgroundStyle: ['drift'] }).backgroundStyle).toBe('artwork');
    expect(DEFAULT_STAGE_SETTINGS.backgroundStyle).toBe('artwork');
  });

  it('keeps showing an upload saved before background styles existed', () => {
    expect(sanitizeStageSettings({ customBgId: 'ab12cd34_loop.mp4' })).toMatchObject({
      backgroundStyle: 'custom',
      customBgId: 'ab12cd34_loop.mp4',
    });
    // A chosen style still wins over a stored upload, and 'custom' needs a file
    expect(
      sanitizeStageSettings({ customBgId: 'ab12cd34_loop.mp4', backgroundStyle: 'spectrum' })
    ).toMatchObject({ backgroundStyle: 'spectrum', customBgId: 'ab12cd34_loop.mp4' });
    expect(sanitizeStageSettings({ backgroundStyle: 'custom' }).backgroundStyle).toBe('artwork');
    expect(
      sanitizeStageSettings({ backgroundStyle: 'custom', customBgId: '../etc/passwd' })
    ).toMatchObject({ backgroundStyle: 'artwork', customBgId: '' });
  });

  it('switches to an upload, keeps it while another style is shown, and saves the style', () => {
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }), {
      wrapper: withAppTheme(),
    });
    expect(result.current.backgroundStyle).toBe('artwork');

    act(() => result.current.setCustomBgId('ab12cd34_loop.mp4'));
    expect(result.current.backgroundStyle).toBe('custom');
    expect(result.current.stageBackground).toEqual({
      url: '/static/backgrounds/ab12cd34_loop.mp4',
      kind: 'video',
    });

    act(() => result.current.setBackgroundStyle('aurora'));
    expect(result.current.stageBackground).toBeNull();
    expect(result.current.customBgId).toBe('ab12cd34_loop.mp4');
    expect(stored()).toMatchObject({ backgroundStyle: 'aurora', customBgId: 'ab12cd34_loop.mp4' });

    // Removing the upload leaves another chosen style alone...
    act(() => result.current.setCustomBgId(''));
    expect(result.current.backgroundStyle).toBe('aurora');
    // ...and returns from the upload itself to cover art
    act(() => result.current.setCustomBgId('ab12cd34_poster.png'));
    act(() => result.current.setCustomBgId(''));
    expect(result.current.backgroundStyle).toBe('artwork');
  });

  it('restores the saved style and builds the palette from the preset', () => {
    seed({ v: 1, backgroundStyle: 'drift', presetId: 'tape_70s', presetSource: 'user' });
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }), {
      wrapper: withAppTheme(),
    });
    expect(result.current.backgroundStyle).toBe('drift');
    expect(result.current.backgroundPalette).toEqual(['#f59e0b', '#c44a12', '#fef3c7']);

    act(() => result.current.setCustomSinger2Color('#00ff00'));
    expect(result.current.backgroundPalette[1]).toBe('#00ff00');
  });
});

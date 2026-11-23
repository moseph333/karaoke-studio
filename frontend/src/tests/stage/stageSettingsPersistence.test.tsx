/**
 * Persisted stage settings: validation of stored data, restore/save in useVisualTheme, which
 * look a stage starts on, settings carried over from before the looks, duet colors, and the
 * Look panel controls that feed them.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DEFAULT_STAGE_SETTINGS,
  LEGACY_STAGE_SETTINGS_KEY,
  STAGE_SETTINGS_STORAGE_KEY,
  loadStageSettings,
  migrateLegacyStageSettings,
  sanitizeStageSettings,
} from '../../theme/stageSettingsStorage';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { VisualThemePicker } from '../../components/VisualThemePicker';
import { ExportModal } from '../../components/ExportModal';
import { LEGACY_LOOK_IDS, getStageLook } from '../../theme/stageLooks';
import * as apiModule from '../../api';
import { ProjectState } from '../../types';

const stored = () => JSON.parse(localStorage.getItem(STAGE_SETTINGS_STORAGE_KEY) || 'null');
const seed = (value: unknown) =>
  localStorage.setItem(STAGE_SETTINGS_STORAGE_KEY, JSON.stringify(value));
/** Settings as the studio saved them while the stage had nine presets. */
const seedLegacy = (value: unknown) =>
  localStorage.setItem(LEGACY_STAGE_SETTINGS_KEY, JSON.stringify(value));

const marquee = getStageLook('marquee');

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
      lookId: 'ktv',
      colors: {
        ktv: { sung: '#ABCDEF', unsung: 'red', singer2: '#123', both: '#0f0f0f' },
        // Nothing valid chosen, a look that does not exist, and a look that is not an object
        songbook: { sung: 'red' },
        neon_pink: { sung: '#ff00b3' },
        cinema: '#ffffff',
      },
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
      lookId: 'ktv',
      colors: { ktv: { sung: '#abcdef', unsung: null, singer2: null, both: '#0f0f0f' } },
      syncMode: 'line',
      showChordBar: true,
    });
  });

  it('only honours a look that exists', () => {
    expect(sanitizeStageSettings({ lookId: 'gone' }).lookId).toBeNull();
    // The id of a preset a look replaced is not a look's id
    expect(sanitizeStageSettings({ lookId: 'neon_pink' }).lookId).toBeNull();
    expect(sanitizeStageSettings({ lookId: 'cinema', colors: 'red' })).toEqual({
      ...DEFAULT_STAGE_SETTINGS,
      lookId: 'cinema',
    });
  });

  it('drops the fields that older versions stored', () => {
    expect(
      sanitizeStageSettings({
        lookId: 'ktv',
        presetId: 'neon_pink',
        presetSource: 'app',
        customSungColor: '#abcdef',
        singer2Color: '#123456',
      })
    ).toEqual({ ...DEFAULT_STAGE_SETTINGS, lookId: 'ktv' });
  });

  it('accepts uploaded background ids and the large stage size', () => {
    expect(
      sanitizeStageSettings({ customBgId: 'ab12cd34_my-loop.mp4', stageSize: 'large' })
    ).toMatchObject({ customBgId: 'ab12cd34_my-loop.mp4', stageSize: 'large' });
  });

  it('returns null for corrupt JSON or blocked storage', () => {
    localStorage.setItem(STAGE_SETTINGS_STORAGE_KEY, '{not json');
    expect(loadStageSettings()).toBeNull();
    localStorage.removeItem(STAGE_SETTINGS_STORAGE_KEY);
    localStorage.setItem(LEGACY_STAGE_SETTINGS_KEY, '{not json');
    expect(loadStageSettings()).toBeNull();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(loadStageSettings()).toBeNull();
  });
});

describe('useVisualTheme persistence', () => {
  it('does not touch storage unless persistence is requested', () => {
    seedLegacy({ v: 1, presetId: 'clean_paper', fontSizeScale: 1.5 });
    const { result } = renderHook(() => useVisualTheme());
    act(() => result.current.setCustomSungColor('#112233'));
    expect(localStorage.getItem(STAGE_SETTINGS_STORAGE_KEY)).toBeNull();
    // ...and stored settings are not read either
    expect(result.current.selectedTheme.id).toBe('marquee');
    expect(result.current.fontSizeScale).toBe(1);
  });

  it('saves every stage setting as it changes', () => {
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
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
      v: 2,
      lookId: 'marquee',
      colors: { marquee: { sung: '#112233', unsung: null, singer2: '#445566', both: null } },
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
      v: 2,
      lookId: 'cinema',
      colors: { cinema: { sung: '#ff0000' }, ktv: { unsung: '#00ff00' } },
      fontSizeScale: 1.5,
      aspectRatio: '9:16',
      syncMode: 'line',
      showVisualizer: true,
      stageSize: 'compact',
    });
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
    expect(result.current.selectedTheme.id).toBe('cinema');
    expect(result.current.activeSungColor).toBe('#ff0000');
    expect(result.current.customSungColor).toBe('#ff0000');
    expect(result.current.activeUnsungColor).toBe(getStageLook('cinema').palette.unsung);
    expect(result.current.fontSizeScale).toBe(1.5);
    expect(result.current.aspectRatio).toBe('9:16');
    expect(result.current.syncMode).toBe('line');
    expect(result.current.showVisualizer).toBe(true);
    expect(result.current.showChordBar).toBe(false);
    expect(result.current.stageSize).toBe('compact');

    // The colour saved for another look is there when that look is picked
    act(() => result.current.setSelectedTheme(getStageLook('ktv')));
    expect(result.current.activeUnsungColor).toBe('#00ff00');
    expect(result.current.activeSungColor).toBe(getStageLook('ktv').palette.sung);
  });

  it('starts a first visit on the default look', () => {
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
    expect(result.current.selectedTheme.id).toBe('marquee');
    expect(result.current.customSungColor).toBeNull();
    expect(result.current.activeSungColor).toBe(marquee.palette.sung);
    expect(document.documentElement.getAttribute('data-stage-look')).toBe('marquee');
  });

  it('keeps the look across reloads', () => {
    seed({ v: 2, lookId: 'songbook' });
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
    expect(result.current.selectedTheme.id).toBe('songbook');
  });

  it('shows the default look when the stored one is unknown, keeping the other settings', () => {
    seed({ v: 2, lookId: 'gone', fontSizeScale: 1.2, colors: { gone: { sung: '#ff0000' } } });
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
    expect(result.current.selectedTheme.id).toBe('marquee');
    expect(result.current.activeSungColor).toBe(marquee.palette.sung);
    expect(result.current.fontSizeScale).toBe(1.2);
  });

  it('saves a newly picked look', () => {
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
    act(() => result.current.setSelectedTheme(getStageLook('ktv')));
    expect(stored()).toMatchObject({ lookId: 'ktv' });
    expect(stored()).not.toHaveProperty('presetId');
    expect(stored()).not.toHaveProperty('presetSource');
  });

  it('saves the colours of every look, not only the one showing', () => {
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
    act(() => result.current.setCustomSungColor('#112233'));
    act(() => result.current.setSelectedTheme(getStageLook('songbook')));
    act(() => result.current.setCustomBothColor('#445566'));
    expect(stored()).toMatchObject({
      lookId: 'songbook',
      colors: { marquee: { sung: '#112233' }, songbook: { both: '#445566' } },
    });

    // Reset forgets the showing look's colours only
    act(() => result.current.resetThemeDefaults());
    expect(stored().colors).toEqual({
      marquee: { sung: '#112233', unsung: null, singer2: null, both: null },
    });
  });
});

describe('settings saved before the looks', () => {
  /** What a v1 entry held: one of the nine presets and the colours picked on it. */
  const legacy = (presetId: string, more: Record<string, unknown> = {}) => ({
    v: 1,
    presetId,
    presetSource: 'user',
    ...more,
  });

  it('knows all nine presets', () => {
    expect(Object.keys(LEGACY_LOOK_IDS).sort()).toEqual([
      'afterglow',
      'classic_ktv',
      'clean_paper',
      'crt_ktv',
      'cyber_cyan',
      'modern_gold',
      'neon_pink',
      'punk_diy',
      'tape_70s',
    ]);
  });

  it.each([
    ['afterglow', 'marquee'],
    ['punk_diy', 'marquee'],
    ['modern_gold', 'ktv'],
    ['classic_ktv', 'ktv'],
    ['cyber_cyan', 'ktv'],
    ['neon_pink', 'ktv'],
    ['tape_70s', 'cinema'],
    ['crt_ktv', 'prompter'],
    ['clean_paper', 'songbook'],
  ])('carries %s over to the %s look with its picked colours', (presetId, lookId) => {
    const settings = legacy(presetId, {
      customSungColor: '#AA0000',
      customUnsungColor: '#00aa00',
      singer2Color: '#0000aa',
      bothColor: '#aaaa00',
      fontSizeScale: 1.2,
      aspectRatio: '9:16',
      syncMode: 'line',
      backgroundStyle: 'aurora',
      showChordBar: true,
      stageSize: 'large',
    });
    const picked = { sung: '#aa0000', unsung: '#00aa00', singer2: '#0000aa', both: '#aaaa00' };
    expect(migrateLegacyStageSettings(settings)).toEqual({
      ...DEFAULT_STAGE_SETTINGS,
      lookId,
      colors: { [lookId]: picked },
      fontSizeScale: 1.2,
      aspectRatio: '9:16',
      syncMode: 'line',
      backgroundStyle: 'aurora',
      showChordBar: true,
      stageSize: 'large',
    });

    seedLegacy(settings);
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
    expect(result.current.selectedTheme.id).toBe(lookId);
    expect(result.current.activeSungColor).toBe('#aa0000');
    expect(result.current.activeUnsungColor).toBe('#00aa00');
    expect(result.current.activeSinger2Color).toBe('#0000aa');
    expect(result.current.activeBothColor).toBe('#aaaa00');
    expect(result.current.fontSizeScale).toBe(1.2);
    expect(result.current.aspectRatio).toBe('9:16');
    expect(result.current.syncMode).toBe('line');
    expect(result.current.backgroundStyle).toBe('aurora');
    expect(result.current.showChordBar).toBe(true);
    expect(result.current.stageSize).toBe('large');
    // Saved as settings for the looks, with the old entry left where it was
    expect(stored()).toMatchObject({ v: 2, lookId, colors: { [lookId]: picked } });
    expect(JSON.parse(localStorage.getItem(LEGACY_STAGE_SETTINGS_KEY)!)).toEqual(settings);
  });

  it.each([
    'afterglow',
    'punk_diy',
    'modern_gold',
    'classic_ktv',
    'tape_70s',
    'crt_ktv',
    'clean_paper',
  ])('with no colour picked, %s shows the colours of its look', (presetId) => {
    const look = getStageLook(presetId);
    expect(migrateLegacyStageSettings(legacy(presetId))).toEqual({
      ...DEFAULT_STAGE_SETTINGS,
      lookId: look.id,
    });

    seedLegacy(legacy(presetId));
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
    expect(result.current.selectedTheme.id).toBe(look.id);
    expect(result.current.customSungColor).toBeNull();
    expect(result.current.activeSungColor).toBe(look.palette.sung);
    expect(result.current.activeUnsungColor).toBe(look.palette.unsung);
    expect(result.current.activeSinger2Color).toBe(look.palette.singer2);
    expect(result.current.activeBothColor).toBe(look.palette.both);
  });

  it.each([
    ['cyber_cyan', '#00ffff'],
    ['neon_pink', '#ff00b3'],
  ])('%s, which was only a colour, carries its sung colour %s over', (presetId, sung) => {
    expect(migrateLegacyStageSettings(legacy(presetId))).toEqual({
      ...DEFAULT_STAGE_SETTINGS,
      lookId: 'ktv',
      colors: { ktv: { sung, unsung: null, singer2: null, both: null } },
    });

    seedLegacy(legacy(presetId));
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
    const ktv = getStageLook('ktv');
    expect(result.current.selectedTheme.id).toBe('ktv');
    expect(result.current.customSungColor).toBe(sung);
    expect(result.current.activeSungColor).toBe(sung);
    expect(result.current.activeUnsungColor).toBe(ktv.palette.unsung);
    expect(result.current.activeSinger2Color).toBe(ktv.palette.singer2);
  });

  it('lets a picked sung colour win over the one a colour-only preset carries', () => {
    expect(
      migrateLegacyStageSettings(legacy('cyber_cyan', { customSungColor: '#123456' })).colors
    ).toEqual({ ktv: { sung: '#123456', unsung: null, singer2: null, both: null } });
  });

  it('keeps the look of a preset that a retired app theme had chosen', () => {
    // Older versions stored presetSource 'app' when the stage followed the app theme, and
    // dropped that preset on the next visit. The stage and its videos keep their look.
    seedLegacy({ v: 1, presetId: 'punk_diy', presetSource: 'app' });
    localStorage.setItem('karaoke_app_theme', 'punk_diy');
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
    expect(result.current.selectedTheme.id).toBe('marquee');
  });

  it('shows the default look for a preset the app never had, keeping the other settings', () => {
    const settings = legacy('vaporwave', { customSungColor: '#aa0000', fontSizeScale: 1.5 });
    expect(migrateLegacyStageSettings(settings)).toEqual({
      ...DEFAULT_STAGE_SETTINGS,
      fontSizeScale: 1.5,
    });
    seedLegacy(settings);
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
    expect(result.current.selectedTheme.id).toBe('marquee');
    expect(result.current.activeSungColor).toBe(marquee.palette.sung);
    expect(result.current.fontSizeScale).toBe(1.5);
  });

  it('validates the old entry field by field too', () => {
    expect(
      migrateLegacyStageSettings(
        legacy('tape_70s', {
          customSungColor: 'red',
          singer2Color: '#123',
          bothColor: '#0F0F0F',
          fontSizeScale: 9,
          aspectRatio: '4:3',
          customBgId: '../../etc/passwd',
          stageSize: 'huge',
        })
      )
    ).toEqual({
      ...DEFAULT_STAGE_SETTINGS,
      lookId: 'cinema',
      colors: { cinema: { sung: null, unsung: null, singer2: null, both: '#0f0f0f' } },
    });
    expect(migrateLegacyStageSettings(null)).toEqual(DEFAULT_STAGE_SETTINGS);
  });

  it('reads the old entry only while nothing newer is saved', () => {
    seedLegacy(legacy('clean_paper', { fontSizeScale: 1.5 }));
    seed({ v: 2, lookId: 'ktv', fontSizeScale: 0.8 });
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
    expect(result.current.selectedTheme.id).toBe('ktv');
    expect(result.current.fontSizeScale).toBe(0.8);
  });
});

describe('duet colors and stage backdrop', () => {
  it('uses the look duet colors, then custom overrides, and resets them', () => {
    const { result } = renderHook(() => useVisualTheme(marquee));
    expect(result.current.activeSinger2Color).toBe(marquee.palette.singer2);
    expect(result.current.activeBothColor).toBe(marquee.palette.both);
    expect(result.current.stageBackgroundColor).toBe(marquee.palette.ground);

    act(() => result.current.setCustomSinger2Color('#00ff00'));
    expect(result.current.activeSinger2Color).toBe('#00ff00');

    act(() => result.current.resetThemeDefaults());
    expect(result.current.activeSinger2Color).toBe(marquee.palette.singer2);
  });
});

describe('Look panel controls', () => {
  const baseProps = {
    selectedTheme: marquee,
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
    expect(picker.value).toBe(marquee.palette.singer2);
    fireEvent.change(picker, { target: { value: '#123456' } });
    expect(onSinger2).toHaveBeenCalledWith('#123456');
    expect(screen.getByLabelText('Both singers sung color')).toBeInTheDocument();
  });

  it('says that colours are kept for the look, and where a part colour shows in Prompter', () => {
    const { rerender } = render(<VisualThemePicker {...baseProps} />);
    expect(screen.getByText('Sung words')).toBeInTheDocument();
    expect(screen.getByText('Words to sing')).toBeInTheDocument();
    expect(screen.getByTestId('look-colors-note')).toHaveTextContent(
      /^Colours are kept for this look\.$/
    );

    rerender(<VisualThemePicker {...baseProps} selectedTheme={getStageLook('prompter')} />);
    const note = screen.getByTestId('look-colors-note');
    expect(note).toHaveTextContent(/In Prompter a part's colour shows on the words still to sing/);
    expect(note).toHaveTextContent(/Colours are kept for this look/);
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

  it('sends the look and the picked duet colors with a render request, never its ground', async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(apiModule, 'apiFetch')
      .mockResolvedValue(new Response(JSON.stringify({ status: 'queued' }), { status: 200 }));
    render(
      <ExportModal
        project={project}
        isOpen
        onClose={vi.fn()}
        selectedTheme={getStageLook('songbook')}
        singer2Color="#f472b6"
        bothColor="#5eead4"
      />
    );
    await user.click(screen.getByRole('button', { name: /render 1080p video/i }));
    const body = JSON.parse(spy.mock.calls[0][1]?.body as string);
    // The look's own colours, ground and tone are the server's to fill in
    expect(body.style_config).toEqual({
      theme_id: 'songbook',
      singer2_color: '#f472b6',
      both_color: '#5eead4',
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
        selectedTheme={getStageLook('songbook')}
        singer2Color="#f472b6"
        bothColor="#5eead4"
      />
    );
    await user.click(screen.getByRole('button', { name: 'Download .ass subtitles' }));
    const url = spy.mock.calls[0][0] as string;
    expect(url).toContain('theme_id=songbook');
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
    // Settings from before the looks follow the same rule
    expect(
      migrateLegacyStageSettings({ presetId: 'afterglow', customBgId: 'ab12cd34_loop.mp4' })
    ).toMatchObject({ backgroundStyle: 'custom', customBgId: 'ab12cd34_loop.mp4' });
  });

  it('switches to an upload, keeps it while another style is shown, and saves the style', () => {
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
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

  it('restores the saved style and builds the palette from the look', () => {
    seed({ v: 2, backgroundStyle: 'drift', lookId: 'cinema' });
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
    const { palette } = getStageLook('cinema');
    expect(result.current.backgroundStyle).toBe('drift');
    expect(result.current.backgroundPalette).toEqual([palette.sung, palette.singer2, palette.both]);

    act(() => result.current.setCustomSinger2Color('#00ff00'));
    expect(result.current.backgroundPalette[1]).toBe('#00ff00');
  });
});

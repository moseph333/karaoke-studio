/**
 * The Server settings page's draft: the owner's unsaved changes over what the server has.
 */
import { describe, expect, it } from 'vitest';
import list from '@shared/server_settings.json';
import {
  SETTING_GROUPS,
  canTurnOff,
  changeCount,
  describeValue,
  isResetPending,
  offeredOptions,
  shownValue,
  withChange,
  withReset,
} from '../../utils/serverSettings';
import { opensServerSettings, urlWithoutAdminParam } from '../../utils/adminLink';
import { serverSettings } from '../helpers/serverSettingsFixtures';

const setting = (id: string) =>
  SETTING_GROUPS.flatMap((group) => group.settings).find((each) => each.id === id)!;

describe('the list of server settings', () => {
  it('is the one shared with the server, in four groups', () => {
    expect(SETTING_GROUPS.map((group) => group.title)).toEqual([
      'Song loops',
      'Stem quality',
      'Export and cloud',
      'Limits and search',
    ]);
    expect(SETTING_GROUPS.flatMap((group) => group.settings)).toHaveLength(13);
    expect(SETTING_GROUPS).toBe(list.groups);
  });

  it('matches what the test server answers with', () => {
    const ids = SETTING_GROUPS.flatMap((group) => group.settings.map((each) => each.id));
    expect(Object.keys(serverSettings().settings)).toEqual(ids);
  });
});

describe('a draft of changes', () => {
  it('starts empty and shows what the server has', () => {
    const state = serverSettings();
    expect(changeCount({})).toBe(0);
    expect(shownValue(state, {}, 'song_loop.models')).toEqual(['wan22', 'ltx']);
    expect(shownValue(state, {}, 'limits.song_minutes')).toBe(60);
  });

  it('holds a change, and drops it when the value goes back to the server’s', () => {
    const state = serverSettings();
    const changed = withChange(state, {}, 'render.prewarm', false);
    expect(changed).toEqual({ 'render.prewarm': false });
    expect(shownValue(state, changed, 'render.prewarm')).toBe(false);

    expect(withChange(state, changed, 'render.prewarm', true)).toEqual({});
  });

  it('does not count a set switched back on in another order as a change', () => {
    const state = serverSettings();
    const off = withChange(state, {}, 'search.sources', ['itunes', 'suggest']);
    expect(withChange(state, off, 'search.sources', ['suggest', 'itunes', 'deezer'])).toEqual({});
  });

  it('moves the default along when its option is switched off', () => {
    // The owner's example: the heavy video model off leaves the light one as the default
    const state = serverSettings();
    const draft = withChange(state, {}, 'song_loop.models', ['ltx']);

    expect(draft).toEqual({ 'song_loop.models': ['ltx'], 'song_loop.default_model': 'ltx' });
    expect(offeredOptions(state, draft, setting('song_loop.default_model'))).toEqual([
      expect.objectContaining({ id: 'ltx' }),
    ]);
  });

  it('leaves a default alone while its option stays on', () => {
    const state = serverSettings();
    expect(withChange(state, {}, 'separation.presets', ['fast', 'best'])).toEqual({
      'separation.presets': ['fast', 'best'],
    });
    expect(withChange(state, {}, 'separation.presets', ['fast', 'balanced'])).toEqual({
      'separation.presets': ['fast', 'balanced'],
      'separation.default': 'fast',
    });
  });

  it('hands a setting changed here back to the server’s own value', () => {
    const state = serverSettings();
    state.settings['limits.song_minutes'] = { value: 15, default: 60, overridden: true };

    const draft = withReset(state, {}, 'limits.song_minutes');

    expect(draft).toEqual({ 'limits.song_minutes': null });
    expect(isResetPending(draft, 'limits.song_minutes')).toBe(true);
    expect(shownValue(state, draft, 'limits.song_minutes')).toBe(60);
    // Changing it again replaces the reset
    expect(withChange(state, draft, 'limits.song_minutes', 30)).toEqual({
      'limits.song_minutes': 30,
    });
  });

  it('has nothing to reset on a setting that was never changed here', () => {
    const state = serverSettings();
    expect(withReset(state, { 'render.cloud': false }, 'render.cloud')).toEqual({});
  });

  it('moves the default along when a reset brings back a set without it', () => {
    const state = serverSettings();
    state.settings['song_loop.models'] = {
      ...state.settings['song_loop.models'],
      value: ['wan22', 'ltx'],
      default: ['ltx'],
      overridden: true,
    };

    expect(withReset(state, {}, 'song_loop.models')).toEqual({
      'song_loop.models': null,
      'song_loop.default_model': 'ltx',
    });
  });
});

describe('what may be switched off', () => {
  it('never a locked option, and never the last one of a set that must keep one', () => {
    const presets = setting('separation.presets');
    expect(canTurnOff(presets, ['fast', 'balanced'], 'fast')).toBe(false);
    expect(canTurnOff(presets, ['fast', 'balanced'], 'balanced')).toBe(true);

    const models = setting('song_loop.models');
    expect(canTurnOff(models, ['wan22', 'ltx'], 'wan22')).toBe(true);
    expect(canTurnOff(models, ['ltx'], 'ltx')).toBe(false);

    const sources = setting('search.sources');
    expect(canTurnOff(sources, ['deezer'], 'deezer')).toBe(true);
  });
});

describe('a value in words', () => {
  it('reads as the owner would say it', () => {
    const state = serverSettings();
    const models = state.settings['song_loop.models'].options;
    expect(describeValue(setting('render.cloud'), true)).toBe('on');
    expect(describeValue(setting('render.cloud'), false)).toBe('off');
    expect(describeValue(setting('limits.song_minutes'), 60)).toBe('60');
    expect(describeValue(setting('limits.song_minutes'), 0)).toBe('no limit');
    expect(describeValue(setting('song_loop.models'), ['wan22', 'ltx'], models)).toBe('Best, Fast');
    expect(describeValue(setting('search.sources'), [])).toBe('none');
    expect(describeValue(setting('song_loop.default_model'), 'ltx', models)).toBe('Fast');
  });
});

describe('the link that opens the page', () => {
  it('loses its parameter and keeps the rest of the address', () => {
    expect(opensServerSettings('?admin=1')).toBe(true);
    expect(opensServerSettings('?project=abc')).toBe(false);
    expect(urlWithoutAdminParam({ pathname: '/', search: '?admin=1', hash: '' })).toBe('/');
    expect(
      urlWithoutAdminParam({ pathname: '/', search: '?project=abc&admin=1', hash: '#top' })
    ).toBe('/?project=abc#top');
  });
});

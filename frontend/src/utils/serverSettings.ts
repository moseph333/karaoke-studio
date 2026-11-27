/**
 * Server settings: the options the owner turns on or off for everyone who uses the server.
 *
 * The list (ids, kinds, words) is data shared with the backend; what each setting is now
 * comes from GET /api/admin/settings. The owner's unsaved changes are a draft: a value per
 * changed setting, or null for "hand it back to the server's own setting".
 */

import list from '@shared/server_settings.json';
import type { ServerSettingOption, ServerSettingValue, ServerSettingsState } from '../types';

export type SettingKind = 'flag' | 'choice' | 'set' | 'minutes';

export interface SettingDefinition {
  id: string;
  kind: SettingKind;
  title: string;
  text: string;
  /** A choice: the set whose switched-on options it may be. */
  among?: string;
  /** A set: options that cannot be turned off. */
  locked?: string[];
  /** A set: how many options must stay on. */
  min?: number;
  /** Minutes: the largest number it takes. */
  max?: number;
  /** A flag that needs the cloud (the page says so when the cloud cannot be asked). */
  cloud?: boolean;
}

export interface SettingGroup {
  id: string;
  title: string;
  settings: SettingDefinition[];
}

export const SETTING_GROUPS = list.groups as SettingGroup[];

const DEFINITIONS = new Map(
  SETTING_GROUPS.flatMap((group) => group.settings).map((setting) => [setting.id, setting])
);

/** Unsaved changes by setting id; null hands the setting back to the server's own value. */
export type SettingDraft = Record<string, ServerSettingValue | null>;

function sameValue(a: ServerSettingValue, b: ServerSettingValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item) => b.includes(item));
  }
  return a === b;
}

/** What the page shows for a setting: the draft's value, else the server's. */
export function shownValue(
  state: ServerSettingsState,
  draft: SettingDraft,
  id: string
): ServerSettingValue {
  const entry = state.settings[id];
  if (!(id in draft)) return entry.value;
  const drafted = draft[id];
  return drafted === null ? entry.default : drafted;
}

/** Whether saving would hand this setting back to the server's own value. */
export function isResetPending(draft: SettingDraft, id: string): boolean {
  return id in draft && draft[id] === null;
}

/** A choice follows its set: when the option it holds is switched off, it moves to the first
 * one still on, so the page never shows (or sends) a default that is not offered. */
function withChoicesFollowing(state: ServerSettingsState, draft: SettingDraft): SettingDraft {
  let next = draft;
  for (const setting of DEFINITIONS.values()) {
    if (!setting.among || !state.settings[setting.id]) continue;
    const offered = shownValue(state, next, setting.among);
    const chosen = shownValue(state, next, setting.id);
    if (!Array.isArray(offered) || offered.length === 0 || typeof chosen !== 'string') continue;
    if (!offered.includes(chosen)) next = { ...next, [setting.id]: offered[0] };
  }
  return next;
}

/** The draft after the owner sets a value. Setting it back to what the server already has
 * drops the change. */
export function withChange(
  state: ServerSettingsState,
  draft: SettingDraft,
  id: string,
  value: ServerSettingValue
): SettingDraft {
  const next = { ...draft };
  if (sameValue(value, state.settings[id].value)) delete next[id];
  else next[id] = value;
  return withChoicesFollowing(state, next);
}

/** The draft after the owner asks for the server's own value back (only a setting that was
 * changed here has one to go back to). */
export function withReset(state: ServerSettingsState, draft: SettingDraft, id: string) {
  if (!state.settings[id].overridden) {
    const next = { ...draft };
    delete next[id];
    return withChoicesFollowing(state, next);
  }
  return withChoicesFollowing(state, { ...draft, [id]: null });
}

export function changeCount(draft: SettingDraft): number {
  return Object.keys(draft).length;
}

/** The options a choice may take right now: those its set has switched on. */
export function offeredOptions(
  state: ServerSettingsState,
  draft: SettingDraft,
  setting: SettingDefinition
): ServerSettingOption[] {
  const options = state.settings[setting.id].options ?? [];
  if (!setting.among) return options;
  const offered = shownValue(state, draft, setting.among);
  return Array.isArray(offered) ? options.filter((option) => offered.includes(option.id)) : options;
}

/** A setting's value in words: "on", "Best, Fast", "60", "no limit". */
export function describeValue(
  setting: SettingDefinition,
  value: ServerSettingValue,
  options: ServerSettingOption[] = []
): string {
  const label = (id: string) => options.find((option) => option.id === id)?.label ?? id;
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return value === 0 ? 'no limit' : String(value);
  if (Array.isArray(value)) return value.length ? value.map(label).join(', ') : 'none';
  return label(value);
}

/** Whether a set's option may be switched off: not a locked one, and not the last one on of
 * a set that must keep some. */
export function canTurnOff(
  setting: SettingDefinition,
  value: ServerSettingValue,
  optionId: string
): boolean {
  if (setting.locked?.includes(optionId)) return false;
  const on = Array.isArray(value) ? value : [];
  return on.length > (setting.min ?? 0) || !on.includes(optionId);
}

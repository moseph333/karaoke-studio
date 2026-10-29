/**
 * Stem separation and lyric sync quality: preset names, time estimates and labels shared by
 * the intake picker, the Mix panel, the re-separation dialog and the sync badge.
 */

import type {
  SeparationInfo,
  SeparationPreset,
  SeparationPresetInfo,
  StudioCapabilities,
} from '../types';

export const SEPARATION_PRESET_ORDER: readonly SeparationPreset[] = ['fast', 'balanced', 'best'];

export const PRESET_NAMES: Record<SeparationPreset, string> = {
  fast: 'Fast',
  balanced: 'Balanced',
  best: 'Best',
};

export const PRESET_BLURBS: Record<SeparationPreset, string> = {
  fast: 'Demucs: quickest, with a little instrument bleed in the vocals.',
  balanced: 'Mel-Band RoFormer: cleaner vocals and a tidier backing track.',
  best: 'Two RoFormer models averaged: the cleanest stems, and the slowest.',
};

/** Used until the server has said what it can run (matches the server's own figures). */
const FALLBACK_PRESETS: Record<SeparationPreset, SeparationPresetInfo> = {
  fast: {
    id: 'fast',
    label: 'Fast · Demucs',
    engine: 'demucs',
    models: ['htdemucs'],
    available: true,
    cpu_realtime_factor: 0.35,
    gpu_recommended: false,
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced · Mel-Band RoFormer',
    engine: 'roformer',
    models: [],
    available: true,
    cpu_realtime_factor: 1.6,
    gpu_recommended: false,
  },
  best: {
    id: 'best',
    label: 'Best · RoFormer ensemble',
    engine: 'roformer',
    models: [],
    available: true,
    cpu_realtime_factor: 6.4,
    gpu_recommended: true,
  },
};

export function presetInfo(
  preset: SeparationPreset,
  capabilities?: StudioCapabilities['separation'] | null
): SeparationPresetInfo {
  return capabilities?.presets.find((p) => p.id === preset) ?? FALLBACK_PRESETS[preset];
}

/** The preset new songs get when nobody picks one: what the server would actually run. */
export function defaultPreset(
  capabilities?: StudioCapabilities['separation'] | null
): SeparationPreset {
  return capabilities?.effective_default ?? capabilities?.default ?? 'balanced';
}

/** "under a minute", "about 6 min", "about 1.5 h". */
export function formatDurationEstimate(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return 'under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = seconds / 3600;
  return `about ${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
}

/** How long a preset takes on CPU, or on the cloud GPU: for this song when its length is
 * known. */
export function separationEstimate(
  factor: number,
  durationSeconds?: number | null,
  runsOn?: SeparationPresetInfo['runs_on']
): string {
  const where = runsOn === 'cloud-gpu' ? 'on a cloud GPU' : 'on CPU';
  if (durationSeconds && durationSeconds > 0) {
    return `${formatDurationEstimate(factor * durationSeconds)} ${where}`;
  }
  const times =
    factor < 1 ? `${Math.round(factor * 100) / 100}` : `${Math.round(factor * 10) / 10}`;
  return `about ${times}× the song's length ${where}`;
}

/** "Balanced · Mel-Band RoFormer" for the song's stems. Songs made before stem presets
 * existed were all separated with Demucs. */
export function stemsLabel(separation?: SeparationInfo | null): string {
  if (!separation) return FALLBACK_PRESETS.fast.label;
  if (separation.label) return separation.label;
  if (separation.preset === 'custom') return 'Custom stems';
  return FALLBACK_PRESETS[separation.preset]?.label ?? separation.preset;
}

/** "3 min left", "under a minute left", or null without an estimate. */
export function formatTimeLeft(seconds?: number | null): string | null {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  if (seconds < 60) return 'under a minute left';
  return `${formatDurationEstimate(seconds).replace(/^about /, '')} left`;
}

/** Validates a /api/capabilities response (test doubles and old servers send other shapes). */
export function isStudioCapabilities(value: unknown): value is StudioCapabilities {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<StudioCapabilities>;
  return (
    Boolean(data.separation) &&
    Array.isArray(data.separation?.presets) &&
    typeof data.alignment === 'object' &&
    data.alignment !== null
  );
}

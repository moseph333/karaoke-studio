/**
 * Duet singer roles shared by the live stage and the timeline.
 */

import { Mic, Mic2, Users, type LucideIcon } from 'lucide-react';
import singerAliases from '@shared/singer_aliases.json';

export type NormalizedSinger = 'singer1' | 'singer2' | 'both';

/** Every label a lyric line may carry, mapped to its role (shared with the backend). */
const SINGER_ALIASES = singerAliases as Partial<Record<string, NormalizedSinger>>;

/** Maps free-form singer labels from lyrics data onto the three stage roles, with the labels
 * the export understands ("s2", "together", "singer 2", …). */
export function normalizeSingerRole(singer?: string | null): NormalizedSinger {
  if (!singer) return 'singer1';
  return SINGER_ALIASES[singer.toLowerCase().trim()] ?? 'singer1';
}

export interface SingerVisualConfig {
  label: string;
  tag: string;
  short: string;
  Icon: LucideIcon;
}

export const SINGER_CONFIG: Record<NormalizedSinger, SingerVisualConfig> = {
  singer1: { label: 'Singer 1 / Lead', tag: '[Singer 1]', short: 'S1', Icon: Mic },
  singer2: { label: 'Singer 2 / Partner', tag: '[Singer 2]', short: 'S2', Icon: Mic2 },
  both: { label: 'Both / Duet', tag: '[Both / Duet]', short: 'Both', Icon: Users },
};

export interface SingerColors {
  singer1: string;
  singer2: string;
  both: string;
}

export function singerColor(role: NormalizedSinger, colors: SingerColors): string {
  return colors[role];
}

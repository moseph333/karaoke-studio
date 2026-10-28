/**
 * Duet singer roles shared by the live stage and the timeline.
 */

import { Mic, Mic2, Users, type LucideIcon } from 'lucide-react';

export type NormalizedSinger = 'singer1' | 'singer2' | 'both';

/** Maps free-form singer labels from lyrics data onto the three stage roles. */
export function normalizeSingerRole(singer?: string | null): NormalizedSinger {
  if (!singer) return 'singer1';
  const s = singer.toLowerCase().trim();
  if (s === 'singer2' || s === 'partner') return 'singer2';
  if (s === 'both' || s === 'unison' || s === 'duet' || s === 'all') return 'both';
  return 'singer1';
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

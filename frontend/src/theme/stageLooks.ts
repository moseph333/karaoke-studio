/**
 * The five stage looks, read from the spec the backend reads too
 * (backend/assets/shared/stage_looks.json): each look's layout, colours, typefaces and where
 * things sit in a 16:9 and a 9:16 frame. Lengths are in u, 1% of the frame's short side; sizes
 * are em sizes and vertical positions are baselines. Mirrors backend/services/stage_looks.py.
 */
import spec from '@shared/stage_looks.json';

export type LookId = 'marquee' | 'ktv' | 'songbook' | 'cinema' | 'prompter';
export type LayoutKind = 'stack' | 'rows' | 'column';
export type Aspect = '16:9' | '9:16';
export type Align = 'left' | 'center' | 'right';
export type StagePart = 'singer1' | 'singer2' | 'both';

/** When things show, in seconds (the `timing` block of the spec). */
export interface StageTiming {
  early_show: number;
  first_early_show: number;
  lead_out: number;
  min_show: number;
  gap_threshold: number;
  count_in: number;
  break_delay: number;
  break_min: number;
  title_min_intro: number;
  title_start: number;
  title_gap: number;
  title_max: number;
  end_delay: number;
  end_min: number;
  card_fade: number;
}

/** How lines are fitted to a measure (the `fit` block of the spec). */
export interface FitRules {
  fill: number;
  min_condense: number;
  size_step: number;
  shrink: number;
}

/** A place for text: one `size`, or a range the fit may choose from. */
export interface TextBoxSpec {
  face: string;
  x: number;
  align: Align;
  baseline: number;
  measure: number;
  size?: number;
  min?: number;
  prefer?: number;
  max?: number;
  rows?: number;
  leading?: number;
  color?: string;
}

export interface LabelSpec {
  face: string;
  place: 'above' | 'margin';
  size: number;
  gap?: number;
  x?: number;
  align?: Align;
  measure?: number;
}

export interface LookFrame {
  lyric: TextBoxSpec;
  next?: TextBoxSpec;
  rows?: Array<{ x: number; align: Align; baseline: number }>;
  column?: {
    before: number;
    after: number;
    after_alpha: number[];
    gap: number;
    min_baseline: number;
    max_baseline: number;
  };
  caret?: { x: number; width: number; height: number };
  picture?: { x: number; y: number; w: number; h: number };
  label: LabelSpec;
  cue: { face: string; x: number; align: Align; baseline: number; size: number };
  title: TextBoxSpec;
  artist: { face: string; place: 'above' | 'below'; size: number; gap: number; color: string };
  progress: { height: number };
}

export type ArtTreatment =
  | { kind: 'blur'; level?: number }
  | { kind: 'mono'; level: number }
  | { kind: 'dim'; level: number }
  | { kind: 'wash'; keep: number }
  | { kind: 'sharp' };

export interface StageLook {
  id: LookId;
  name: string;
  description: string;
  layout: LayoutKind;
  tone: 'dark' | 'light';
  /** Which side of the fill carries a part's colour: the words sung, or the words to sing. */
  emphasis: 'sung' | 'unsung';
  palette: {
    ground: string;
    unsung: string;
    sung: string;
    quiet: string;
    singer2: string;
    both: string;
    cue: string;
  };
  outline: { width: number; color: string } | null;
  shadow: { offset: number; blur: number; color: string; alpha: number } | null;
  caps: Partial<Record<string, boolean>>;
  tracking: Partial<Record<string, number>>;
  adlib: { scale: number; alpha: number; face: string | null };
  romaji: { scale: number; face: string | null };
  count_in: 'numerals' | 'dots';
  motion: { enter: number; exit: number; rise: number; scroll: number };
  card_scrim?: number;
  art: { cover: ArtTreatment; upload: ArtTreatment | null };
  frames: Record<Aspect, LookFrame>;
}

export interface LegacyLook {
  look: LookId;
  /** The sung colour carried over from a preset that was only a colour. */
  carry_sung?: string;
  /** The replaced preset's own colours, which an old tab sends as if they were chosen. */
  was: Partial<Record<'sung' | 'unsung' | 'singer2' | 'both', string>>;
}

const SPEC = spec as unknown as {
  default_look: LookId;
  default_part_names: Record<StagePart, string>;
  timing: StageTiming;
  fit: FitRules;
  looks: StageLook[];
  legacy_ids: Record<string, LegacyLook>;
};

export const STAGE_LOOKS: readonly StageLook[] = SPEC.looks;
export const DEFAULT_STAGE_LOOK_ID: LookId = SPEC.default_look;
export const STAGE_TIMING: StageTiming = SPEC.timing;
export const FIT_RULES: FitRules = SPEC.fit;
export const DEFAULT_PART_NAMES: Record<StagePart, string> = SPEC.default_part_names;
export const LEGACY_LOOK_IDS: Readonly<Record<string, LegacyLook>> = SPEC.legacy_ids;

const BY_ID = new Map<string, StageLook>(STAGE_LOOKS.map((look) => [look.id, look]));

/** True for a look's id (not for the id of a preset a look replaced). */
export function isLookId(id: unknown): id is LookId {
  return typeof id === 'string' && BY_ID.has(id);
}

/** The look an id names; the id of a replaced preset gives the look nearest it, and anything
 * unknown the default look. */
export function getStageLook(id: unknown): StageLook {
  if (typeof id === 'string') {
    const look = BY_ID.get(id) ?? BY_ID.get(LEGACY_LOOK_IDS[id]?.look ?? '');
    if (look) return look;
  }
  return BY_ID.get(DEFAULT_STAGE_LOOK_ID) as StageLook;
}

/** The legacy entry of a replaced preset's id, or null for any other id. */
export function legacyLook(id: unknown): LegacyLook | null {
  return typeof id === 'string' && !BY_ID.has(id) ? (LEGACY_LOOK_IDS[id] ?? null) : null;
}

/** A frame's size in u: the short side is always 100. */
export function frameSize(aspect: Aspect): { width: number; height: number } {
  const long = (100 * 16) / 9;
  return aspect === '9:16' ? { width: 100, height: long } : { width: long, height: 100 };
}

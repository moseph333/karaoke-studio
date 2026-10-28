/**
 * Common TypeScript Domain Interfaces & Types
 *
 * Defines core data models for lyrics, word timings, project states,
 * visual themes, and toast notifications across the studio.
 */

export interface WordTiming {
  word: string;
  start_time: number;
  end_time: number;
}

export type SingerRole = 'singer1' | 'singer2' | 'both';

export type SyncDisplayMode = 'word' | 'line';

export interface BulkAssignOptions {
  mode: 'range' | 'alternating' | 'auto';
  startLineIndex?: number;
  endLineIndex?: number;
  singer?: SingerRole;
  pattern?: '1x1' | '2x2';
  startSinger?: SingerRole;
  pauseThreshold?: number;
}

/** How a line's word timings were produced. */
export type AlignMethod = 'ctc' | 'dsp' | 'lrc' | 'fallback' | 'manual';

export interface LyricLine {
  id: number;
  text: string;
  start_time: number;
  end_time: number;
  words: WordTiming[];
  singer?: SingerRole;
  /** Alignment confidence from 0 to 1, when the server measured one. */
  confidence?: number;
  align_method?: AlignMethod;
}

export interface LyricLineDraft {
  id?: number;
  text: string;
  start_time: number;
  end_time: number;
  words?: WordTiming[];
  singer?: SingerRole;
}

export interface ProjectState {
  id: string;
  status:
    | 'queued'
    | 'downloading'
    | 'separating'
    | 'fetching_lyrics'
    | 'aligning'
    | 'mixing'
    | 'ready'
    | 'error'
    | 'cancelled';
  progress: number;
  status_detail?: string;
  eta_seconds?: number;
  elapsed_seconds?: number;
  heartbeat?: number;
  title?: string;
  artist?: string;
  duration?: number;
  audio_url?: string;
  vocals_url?: string;
  instrumental_url?: string;
  master_audio_url?: string;
  thumbnail_url?: string;
  lines: LyricLine[];
  lyric_source?: string;
  is_synced?: boolean;
  semitones: number;
  guide_volume: number;
  vocal_range?: VocalRangeData;
  chords?: ChordSegment[];
  created_by?: string;
  created_at?: number;
  error?: string;
  render_status?: 'idle' | 'queued' | 'rendering' | 'completed' | 'error';
  render_progress?: number;
  render_detail?: string;
  render_eta_seconds?: number;
  render_elapsed_seconds?: number;
  render_heartbeat?: number;
  render_error?: string;
  video_url?: string;
  youtube_package?: {
    title: string;
    description: string;
    tags: string[];
    key_note: string;
    lyrics: string;
    privacy_status: string;
  };
}

export interface LyricCandidate {
  id?: number | string;
  track_name: string;
  artist_name: string;
  album_name?: string;
  duration?: number;
  instrumental?: boolean;
  plain_lyrics?: string;
  synced_lyrics?: string;
}

export interface SearchResult {
  id: string;
  title: string;
  artist: string;
  duration: number;
  url: string;
  thumbnail?: string;
}

export interface VisualTheme {
  id: string;
  name: string;
  description: string;
  primary_color: string; // ASS sung color
  secondary_color: string; // ASS unsung color
  previewBg: string;
  previewSung: string;
  previewUnsung: string;
  sync_mode?: SyncDisplayMode;
  fontFamily?: string;
  /** Solid stage backdrop shared by the live preview and the video renderer fallback. */
  stageBg?: string;
  /** Preset-specific duet palette (falls back to the export defaults when omitted). */
  singer2Color?: string;
  bothColor?: string;
  tone?: 'dark' | 'light';
}

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number; // Duration in ms; 0 or undefined for default (4000ms)
  createdAt: number;
}

// ==========================================
// R1: Vocal Range & Smart Key Recommender Types
// ==========================================

export type VoicePreset = 'Bass' | 'Baritone' | 'Tenor' | 'Alto' | 'Mezzo-Soprano' | 'Soprano';

export interface VocalRangeData {
  lowest_note: string | null; // e.g., "C#3"
  highest_note: string | null; // e.g., "E4"
  lowest_hz: number | null; // e.g., 140.6
  highest_hz: number | null; // e.g., 332.7
  tessitura_low_note: string | null; // e.g., "B3"
  tessitura_high_note: string | null; // e.g., "D#4"
  tessitura_low_hz: number | null; // e.g., 246.9
  tessitura_high_hz: number | null; // e.g., 311.1
  median_note: string | null; // e.g., "C#4"
  median_hz: number | null; // e.g., 279.9
  estimated_key: string; // e.g., "C# Minor" or "Unknown"
  key_confidence: number; // 0.0 to 1.0
  is_voiced: boolean; // False if silent, noise, or unvoiced
  voiced_frames_count?: number;
  total_frames_count?: number;
}

export interface KeyRecommendation {
  recommended_semitones: number; // Integer in [-12, +12]
  projected_key: string; // e.g., "B Minor"
  projected_low_note: string; // e.g., "B2"
  projected_high_note: string; // e.g., "D4"
  cost: number; // Objective function score
  is_in_range?: boolean; // True if all song notes fit within target bounds
}

export interface KeyRecommendationRequest {
  target_voice_preset?: VoicePreset | null;
  custom_low_note?: string | null;
  custom_high_note?: string | null;
}

// ==========================================
// R1: Harmonic Chords & Live Chord Bar Types
// ==========================================

export interface ChordSegment {
  id?: string;
  start: number;
  end: number;
  chord: string;
  confidence?: number;
}

export interface ProjectChordsResponse {
  project_id: string;
  chords: ChordSegment[];
  estimated_key?: string | null;
  detected: boolean;
}

export interface ChordsUpdateRequest {
  chords: ChordSegment[];
}

// ==========================================
// Application Theme Engine Types
// ==========================================

export type AppThemeId =
  'afterglow' | 'punk_diy' | 'tape_studio_70s' | 'dive_bar_crt' | 'clean_paper';

export interface AppThemeColors {
  bg: string;
  surface: string;
  surfaceSubtle: string;
  surfaceRaised: string;
  border: string;
  borderSubtle: string;
  text: string;
  textMuted: string;
  textInverse: string;
  accent: string;
  accentHover: string;
  accentText: string;
  secondary: string;
  highlight: string;
  sung: string;
  unsung: string;
  // Semantic status & interaction tokens (optional so ad-hoc palettes stay valid)
  success?: string;
  warning?: string;
  danger?: string;
  info?: string;
  focus?: string;
  overlay?: string;
}

export interface AppThemeTypography {
  heading: string;
  body: string;
  mono: string;
  karaoke: string;
}

export interface AppThemeGeometry {
  radiusSm: string;
  radiusMd: string;
  radiusLg: string;
  radiusXl: string;
  radiusPill: string;
  borderWidth: string;
  borderWidthThick: string;
}

export interface AppThemeShadows {
  sm: string;
  md: string;
  lg: string;
  glow: string;
  card?: string;
}

export interface AppThemeSwatches {
  primary: string;
  accent: string;
  bg: string;
}

export interface AppThemeEffects {
  /** Brand gradient used for primary CTAs and the brand mark. */
  gradientAccent: string;
  /** Ambient stage backdrop gradient. */
  gradientStage: string;
  /** Alpha (0-1) applied to translucent "glass" surfaces such as the transport dock. */
  glassAlpha: string;
}

export interface AppThemeBorders {
  radius: string;
  width: string;
  style?: string;
}

export interface AppTheme {
  id: AppThemeId;
  name: string;
  tagline: string;
  stagePresetId: 'afterglow' | 'punk_diy' | 'tape_70s' | 'crt_ktv' | 'clean_paper';
  swatches: AppThemeSwatches;
  colors: AppThemeColors;
  typography: AppThemeTypography;
  fonts?: AppThemeTypography;
  geometry: AppThemeGeometry;
  borders?: AppThemeBorders;
  shadows: AppThemeShadows;
  effects?: AppThemeEffects;
  cssVariables: Record<string, string>;
}

// ==========================================
// Studio Workspace Navigation Types (Milestone M1)
// ==========================================

export type StudioWorkspaceTab = 'stage' | 'timeline' | 'mix';

export interface StudioWorkspaceTabConfig {
  id: StudioWorkspaceTab;
  label: string;
  ariaLabel: string;
  panelId: string;
}

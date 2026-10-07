export interface WordTiming {
  word: string;
  start_time: number;
  end_time: number;
}

export interface LyricLine {
  id: number;
  text: string;
  start_time: number;
  end_time: number;
  words: WordTiming[];
}

export interface ProjectState {
  id: string;
  status: 'queued' | 'downloading' | 'separating' | 'fetching_lyrics' | 'aligning' | 'mixing' | 'ready' | 'error' | 'cancelled';
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
  semitones: number;
  guide_volume: number;
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
  primary_color: string;    // ASS sung color
  secondary_color: string;  // ASS unsung color
  previewBg: string;
  previewSung: string;
  previewUnsung: string;
}

/**
 * YouTube, for a show's karaoke videos: reading a video id out of a pasted link, and loading
 * YouTube's IFrame Player API.
 *
 * The API script is the one thing this app loads from another site, and only in a stage
 * window that is about to play a YouTube video: the video itself comes from YouTube either
 * way, in its player.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const API_SRC = 'https://www.youtube.com/iframe_api';

/** The video id in a YouTube link (watch, youtu.be, shorts, embed, live), or null. */
export function youtubeVideoId(text: string): string | null {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, first, second] = url.pathname.split('/');
    if (first === 'watch') id = url.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v'].includes(first)) id = second ?? null;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** The words to search YouTube with: the song, as a karaoke video. */
export function karaokeQuery(words: string): string {
  const trimmed = words.replace(/\s+/g, ' ').trim();
  return /karaoke/i.test(trimmed) ? trimmed : `${trimmed} karaoke`;
}

// --- The IFrame Player API, as far as the stage uses it ----------------------------------

export const YT_STATE = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 };

export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

export interface YouTubePlayerOptions {
  videoId: string;
  width: string;
  height: string;
  host?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: { target: YouTubePlayer }) => void;
    onStateChange?: (event: { data: number; target: YouTubePlayer }) => void;
    onError?: (event: { data: number }) => void;
  };
}

export interface YouTubeApi {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
}

type YouTubeWindow = Window & { YT?: Partial<YouTubeApi>; onYouTubeIframeAPIReady?: () => void };

let loading: Promise<YouTubeApi> | null = null;

/** Loads the IFrame Player API once; rejects when the script cannot be fetched. */
export function loadYouTubeApi(): Promise<YouTubeApi> {
  const page = window as YouTubeWindow;
  if (page.YT?.Player) return Promise.resolve(page.YT as YouTubeApi);
  loading ??= new Promise<YouTubeApi>((resolve, reject) => {
    const earlier = page.onYouTubeIframeAPIReady;
    page.onYouTubeIframeAPIReady = () => {
      earlier?.();
      if (page.YT?.Player) resolve(page.YT as YouTubeApi);
      else reject(new Error('The YouTube player did not load'));
    };
    const script = document.createElement('script');
    script.src = API_SRC;
    script.async = true;
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('The YouTube player could not be loaded'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

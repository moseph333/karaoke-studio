/**
 * YouTube's IFrame Player API for tests: `window.YT.Player` as the stage window uses it. A
 * test drives the player the way YouTube would (`ready`, `setState`, `fail`) and reads what
 * the app asked of it (`calls`).
 */

import { YT_STATE, type YouTubePlayerOptions } from '../../utils/youtube';

export class FakeYouTubePlayer {
  static instances: FakeYouTubePlayer[] = [];

  state: number = YT_STATE.unstarted;
  time = 0;
  duration = 200;
  destroyed = false;
  calls: string[] = [];

  constructor(
    public element: HTMLElement,
    public options: YouTubePlayerOptions
  ) {
    FakeYouTubePlayer.instances.push(this);
  }

  /** The newest player that has not been destroyed. */
  static get current(): FakeYouTubePlayer | undefined {
    return [...FakeYouTubePlayer.instances].reverse().find((player) => !player.destroyed);
  }

  // --- What YouTube does ------------------------------------------------------------------
  ready(): void {
    this.options.events?.onReady?.({ target: this });
  }
  setState(state: number, time = this.time): void {
    this.state = state;
    this.time = time;
    this.options.events?.onStateChange?.({ data: state, target: this });
  }
  fail(code: number): void {
    this.options.events?.onError?.({ data: code });
  }

  // --- What the app asks ------------------------------------------------------------------
  playVideo(): void {
    this.calls.push('play');
  }
  pauseVideo(): void {
    this.calls.push('pause');
  }
  seekTo(seconds: number): void {
    this.time = seconds;
    this.calls.push(`seek ${seconds}`);
  }
  setVolume(volume: number): void {
    this.calls.push(`volume ${volume}`);
  }
  mute(): void {
    this.calls.push('mute');
  }
  unMute(): void {
    this.calls.push('unmute');
  }
  getCurrentTime(): number {
    return this.time;
  }
  getDuration(): number {
    return this.duration;
  }
  getPlayerState(): number {
    return this.state;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

type YouTubeWindow = Window & { YT?: unknown };

/** Puts the API on the page, as if its script had loaded. */
export function installFakeYouTube(): void {
  FakeYouTubePlayer.instances = [];
  (window as YouTubeWindow).YT = { Player: FakeYouTubePlayer };
}

export function removeFakeYouTube(): void {
  FakeYouTubePlayer.instances = [];
  delete (window as YouTubeWindow).YT;
}

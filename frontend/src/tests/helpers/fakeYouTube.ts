/**
 * YouTube's IFrame Player API for tests: `window.YT.Player` as a show uses it. A test drives
 * the player the way YouTube would (`ready`, `setState`, `fail`) and reads what the app asked
 * of it (`calls`). A show makes two kinds: the one the room hears, in the stage window
 * (`current`), and the host screen's silent one that follows it (`monitor`), told apart as
 * YouTube tells them, by the `mute` player variable.
 */

import { YT_STATE, type YouTubePlayerOptions } from '../../utils/youtube';

export class FakeYouTubePlayer {
  static instances: FakeYouTubePlayer[] = [];

  state: number = YT_STATE.unstarted;
  time = 0;
  duration = 200;
  destroyed = false;
  muted: boolean;
  calls: string[] = [];

  constructor(
    public element: HTMLElement,
    public options: YouTubePlayerOptions
  ) {
    this.muted = options.playerVars?.mute === 1;
    FakeYouTubePlayer.instances.push(this);
  }

  private static newest(silent: boolean): FakeYouTubePlayer | undefined {
    return [...FakeYouTubePlayer.instances]
      .reverse()
      .find((player) => !player.destroyed && (player.options.playerVars?.mute === 1) === silent);
  }

  /** The newest player with sound that has not been destroyed: the stage window's. */
  static get current(): FakeYouTubePlayer | undefined {
    return FakeYouTubePlayer.newest(false);
  }

  /** The newest silent player that has not been destroyed: the host screen's monitor. */
  static get monitor(): FakeYouTubePlayer | undefined {
    return FakeYouTubePlayer.newest(true);
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
    this.muted = true;
    this.calls.push('mute');
  }
  unMute(): void {
    this.muted = false;
    this.calls.push('unmute');
  }
  isMuted(): boolean {
    return this.muted;
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

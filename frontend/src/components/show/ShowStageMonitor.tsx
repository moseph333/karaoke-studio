/**
 * A show's stage monitor: the video that is on the stage window, shown on the host screen
 * without sound, so the host sees what the room sees.
 *
 * It is a second playing of the same video (YouTube's player, or the server's copy), not a
 * picture of the stage window: the stage window says where its video is, and this one follows
 * (`utils/stageMonitor`). It is always silent, since the room's sound is the stage window's,
 * and it takes no clicks or keys: the song is run from the buttons above it. If it cannot
 * play, it says so and the show goes on, because nothing on the stage depends on it.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  followStage,
  newFollowMemory,
  type FollowMemory,
  type MonitorPlayback,
  type MonitorTarget,
} from '../../utils/stageMonitor';
import type { StageScene } from '../../utils/stageLink';
import { YT_STATE, loadYouTubeApi, type YouTubePlayer } from '../../utils/youtube';

/** A video scene: the only ones the monitor shows. */
export type VideoScene = Extract<StageScene, { kind: 'youtube' | 'file' }>;

export interface ShowStageMonitorProps {
  scene: VideoScene;
  /** The stage window's video is playing. */
  playing: boolean;
  /** Its position, as the stage window last reported it. */
  time: number;
}

/** The monitor's own player, whichever kind it is. */
interface MonitorPlayer {
  /** Where it is, or null while it cannot be asked yet. */
  playback(): MonitorPlayback | null;
  play(): void;
  pause(): void;
  seek(time: number): void;
}

/** How often the monitor checks itself against the stage with nothing new heard. */
const CHECK_MS = 1000;

/** Keeps `playerRef`'s player with the stage's video; the returned function checks it now. */
function useStageFollower(
  playerRef: React.MutableRefObject<MonitorPlayer | null>,
  playing: boolean,
  time: number
): () => void {
  const target = useRef<MonitorTarget>({ playing, time, at: performance.now() });
  const memory = useRef<FollowMemory>(newFollowMemory());

  const follow = useCallback(() => {
    const player = playerRef.current;
    const own = player?.playback();
    if (!player || !own) return;
    const next = followStage(target.current, own, memory.current, performance.now());
    memory.current = next.memory;
    if (next.step.seek !== undefined) player.seek(next.step.seek);
    if (next.step.play) player.play();
    if (next.step.pause) player.pause();
  }, [playerRef]);

  useEffect(() => {
    target.current = { playing, time, at: performance.now() };
    follow();
  }, [playing, time, follow]);

  useEffect(() => {
    const timer = setInterval(follow, CHECK_MS);
    return () => clearInterval(timer);
  }, [follow]);

  return follow;
}

interface PlayerProps {
  playing: boolean;
  time: number;
  onFailed: () => void;
}

const YouTubeMonitor: React.FC<PlayerProps & { videoId: string }> = ({
  videoId,
  playing,
  time,
  onFailed,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<MonitorPlayer | null>(null);
  const follow = useStageFollower(playerRef, playing, time);
  const latest = useRef({ follow, onFailed });
  latest.current = { follow, onFailed };

  useEffect(() => {
    let cancelled = false;
    let youtube: YouTubePlayer | null = null;
    // The API replaces the element it is given, so it gets one React does not manage
    const slot = document.createElement('div');
    mountRef.current?.appendChild(slot);

    loadYouTubeApi().then(
      (api) => {
        if (cancelled) return;
        youtube = new api.Player(slot, {
          videoId,
          width: '100%',
          height: '100%',
          host: 'https://www.youtube.com',
          playerVars: {
            autoplay: 0,
            // Silent from its first frame: the room's sound is the stage window's
            mute: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            rel: 0,
            iv_load_policy: 3,
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: ({ target }) => {
              if (cancelled) return;
              // `mute: 1` has done this already; asked again only if it has not, since
              // YouTube may remember a mute asked for here for the next player it makes
              if (!target.isMuted()) target.mute();
              playerRef.current = {
                playback() {
                  const state = target.getPlayerState();
                  return {
                    playing: state === YT_STATE.playing || state === YT_STATE.buffering,
                    time: target.getCurrentTime() || 0,
                    ended: state === YT_STATE.ended,
                  };
                },
                play: () => target.playVideo(),
                pause: () => target.pauseVideo(),
                seek: (to) => target.seekTo(to, true),
              };
              latest.current.follow();
            },
            onError: () => {
              if (!cancelled) latest.current.onFailed();
            },
          },
        });
      },
      () => {
        if (!cancelled) latest.current.onFailed();
      }
    );

    return () => {
      cancelled = true;
      playerRef.current = null;
      try {
        youtube?.destroy();
      } catch {
        // The player's frame is already gone
      }
      slot.remove();
    };
  }, [videoId]);

  return (
    <div
      ref={mountRef}
      data-testid="show-monitor-youtube"
      data-video={videoId}
      className="absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full"
    />
  );
};

const FileMonitor: React.FC<PlayerProps & { url: string }> = ({ url, playing, time, onFailed }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<MonitorPlayer | null>(null);
  const follow = useStageFollower(playerRef, playing, time);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // React writes `muted` as a property after the element exists; this makes sure of it
    video.muted = true;
    return () => {
      playerRef.current = null;
      video.pause();
    };
  }, [url]);

  const onLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    playerRef.current = {
      playback: () => ({
        playing: !video.paused && !video.ended,
        time: video.currentTime || 0,
        ended: video.ended,
      }),
      play: () => void video.play()?.catch(() => {}),
      pause: () => video.pause(),
      seek: (to) => {
        video.currentTime = to;
      },
    };
    follow();
  };

  return (
    <video
      ref={videoRef}
      data-testid="show-monitor-file"
      src={url}
      muted
      playsInline
      preload="auto"
      onLoadedMetadata={onLoadedMetadata}
      onError={onFailed}
      className="absolute inset-0 h-full w-full object-contain"
    />
  );
};

export const ShowStageMonitor: React.FC<ShowStageMonitorProps> = ({ scene, playing, time }) => {
  const [failed, setFailed] = useState(false);
  const onFailed = useCallback(() => setFailed(true), []);
  const frameRef = useRef<HTMLDivElement>(null);

  // It is a picture to watch, not a control: no clicks, no focus, nothing read out
  useEffect(() => {
    frameRef.current?.setAttribute('inert', '');
  }, [failed]);

  if (failed) {
    return (
      <p data-testid="show-monitor" className="text-sm text-theme-text-muted">
        The video plays on the stage window. It could not be shown here as well.
      </p>
    );
  }
  return (
    <div data-testid="show-monitor" className="flex max-w-3xl flex-col gap-2">
      <div
        ref={frameRef}
        aria-hidden="true"
        className="pointer-events-none relative aspect-video overflow-hidden bg-black"
      >
        {scene.kind === 'youtube' ? (
          <YouTubeMonitor
            videoId={scene.videoId}
            playing={playing}
            time={time}
            onFailed={onFailed}
          />
        ) : (
          <FileMonitor url={scene.url} playing={playing} time={time} onFailed={onFailed} />
        )}
      </div>
      <p className="text-sm text-theme-text-muted">
        The video on the stage window, shown here without sound.
      </p>
    </div>
  );
};

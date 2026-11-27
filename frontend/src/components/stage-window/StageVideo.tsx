/**
 * A show's videos on the stage window: a YouTube karaoke video in YouTube's own player, or a
 * video file (the server's copy of a video whose uploader does not allow embedding).
 *
 * Both fill the window, take the host's commands through a ref (`StageVideoHandle`) and tell
 * the host how the video is doing (`PlayerReport`: its state, position and length, about four
 * times a second while it plays). A browser only starts sound in a window that has been
 * clicked or typed in; a video that does not start is reported as `blocked`, and the host
 * says to click the stage window once.
 */

import React, { useEffect, useImperativeHandle, useRef } from 'react';
import type { PlayerCommand, PlayerError, PlayerReport } from '../../utils/stageLink';
import { YT_STATE, loadYouTubeApi, type YouTubePlayer } from '../../utils/youtube';

export interface StageVideoHandle {
  command(command: PlayerCommand): void;
  /** Play or pause, whichever the video is not doing (the Space key in the stage window). */
  toggle(): void;
  /** Moves the position by this many seconds (the arrow keys). */
  nudge(seconds: number): void;
}

interface StageVideoProps {
  /** Which playing this is; goes back in every report. */
  play: number;
  onReport: (report: PlayerReport) => void;
}

const REPORT_MS = 250;
/** A video that has not started this long after it was ready was stopped by the browser. */
const BLOCKED_AFTER_MS = 4000;

/** YouTube's error codes: 101, 150 and 153 mean it will not play outside youtube.com. */
function youtubeError(code: number): PlayerError {
  if (code === 101 || code === 150 || code === 153) return 'embed';
  if (code === 100 || code === 2) return 'unavailable';
  return 'playback';
}

export const YouTubeVideo = React.forwardRef<
  StageVideoHandle,
  StageVideoProps & { videoId: string }
>(function YouTubeVideo({ videoId, play, onReport }, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const reportRef = useRef(onReport);
  reportRef.current = onReport;

  useEffect(() => {
    let cancelled = false;
    let failed = false;
    let ticker: ReturnType<typeof setInterval> | null = null;
    let blockedTimer: ReturnType<typeof setTimeout> | null = null;
    const send = (status: PlayerReport['status'], error?: PlayerError) => {
      if (cancelled) return;
      const player = playerRef.current;
      reportRef.current({
        play,
        status,
        time: player?.getCurrentTime?.() ?? 0,
        duration: player?.getDuration?.() ?? 0,
        ...(error ? { error } : {}),
      });
    };
    const statusOf = (state: number): PlayerReport['status'] => {
      if (state === YT_STATE.playing) return 'playing';
      if (state === YT_STATE.paused) return 'paused';
      if (state === YT_STATE.ended) return 'ended';
      return 'loading';
    };

    send('loading');
    // The API replaces the element it is given, so it gets one React does not manage
    const slot = document.createElement('div');
    mountRef.current?.appendChild(slot);

    loadYouTubeApi().then(
      (api) => {
        if (cancelled) return;
        playerRef.current = new api.Player(slot, {
          videoId,
          width: '100%',
          height: '100%',
          host: 'https://www.youtube.com',
          playerVars: {
            autoplay: 1,
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
              target.playVideo();
              blockedTimer = setTimeout(() => {
                const state = target.getPlayerState();
                if (!failed && (state === YT_STATE.unstarted || state === YT_STATE.cued)) {
                  send('blocked');
                }
              }, BLOCKED_AFTER_MS);
              ticker = setInterval(() => {
                const state = target.getPlayerState();
                if (!failed && (state === YT_STATE.playing || state === YT_STATE.paused)) {
                  send(statusOf(state));
                }
              }, REPORT_MS);
            },
            onStateChange: ({ data }) => {
              if (!failed) send(statusOf(data));
            },
            onError: ({ data }) => {
              failed = true;
              send('error', youtubeError(data));
            },
          },
        });
      },
      () => {
        failed = true;
        send('error', 'playback');
      }
    );

    return () => {
      cancelled = true;
      if (ticker) clearInterval(ticker);
      if (blockedTimer) clearTimeout(blockedTimer);
      try {
        playerRef.current?.destroy();
      } catch {
        // The player's frame is already gone
      }
      playerRef.current = null;
      slot.remove();
    };
  }, [videoId, play]);

  useImperativeHandle(
    ref,
    () => ({
      command(command) {
        const player = playerRef.current;
        if (!player) return;
        if (command.name === 'play') player.playVideo();
        else if (command.name === 'pause') player.pauseVideo();
        else if (command.name === 'seek') player.seekTo(Math.max(0, command.time), true);
        else {
          player.setVolume(Math.round(Math.min(1, Math.max(0, command.volume)) * 100));
          if (command.muted) player.mute();
          else player.unMute();
        }
      },
      toggle() {
        const player = playerRef.current;
        if (!player) return;
        if (player.getPlayerState() === YT_STATE.playing) player.pauseVideo();
        else player.playVideo();
      },
      nudge(seconds) {
        const player = playerRef.current;
        if (player) player.seekTo(Math.max(0, player.getCurrentTime() + seconds), true);
      },
    }),
    []
  );

  return (
    <div
      ref={mountRef}
      data-testid="stage-youtube"
      data-video={videoId}
      className="absolute inset-0 bg-black [&>iframe]:h-full [&>iframe]:w-full"
    />
  );
});

export const FileVideo = React.forwardRef<StageVideoHandle, StageVideoProps & { url: string }>(
  function FileVideo({ url, play, onReport }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const reportRef = useRef(onReport);
    reportRef.current = onReport;

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      let cancelled = false;
      const send = (status: PlayerReport['status'], error?: PlayerError) => {
        if (cancelled) return;
        reportRef.current({
          play,
          status,
          time: video.currentTime || 0,
          duration: Number.isFinite(video.duration) ? video.duration : 0,
          ...(error ? { error } : {}),
        });
      };
      const onPlaying = () => send('playing');
      const onPause = () => {
        if (!video.ended) send('paused');
      };
      const onEnded = () => send('ended');
      const onTime = () => send(video.paused ? 'paused' : 'playing');
      const onError = () => send('error', 'playback');
      video.addEventListener('playing', onPlaying);
      video.addEventListener('pause', onPause);
      video.addEventListener('ended', onEnded);
      video.addEventListener('timeupdate', onTime);
      video.addEventListener('error', onError);
      send('loading');
      const started = video.play();
      if (started && typeof started.catch === 'function') {
        started.catch((err: unknown) => {
          // NotAllowedError: the window has not been clicked yet
          if (err instanceof DOMException && err.name === 'NotAllowedError') send('blocked');
        });
      }
      return () => {
        cancelled = true;
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener('pause', onPause);
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('timeupdate', onTime);
        video.removeEventListener('error', onError);
        video.pause();
      };
    }, [url, play]);

    useImperativeHandle(
      ref,
      () => ({
        command(command) {
          const video = videoRef.current;
          if (!video) return;
          if (command.name === 'play') void video.play()?.catch(() => {});
          else if (command.name === 'pause') video.pause();
          else if (command.name === 'seek') video.currentTime = Math.max(0, command.time);
          else {
            video.volume = Math.min(1, Math.max(0, command.volume));
            video.muted = command.muted;
          }
        },
        toggle() {
          const video = videoRef.current;
          if (!video) return;
          if (video.paused) void video.play()?.catch(() => {});
          else video.pause();
        },
        nudge(seconds) {
          const video = videoRef.current;
          if (video) video.currentTime = Math.max(0, video.currentTime + seconds);
        },
      }),
      []
    );

    return (
      <video
        ref={videoRef}
        data-testid="stage-file-video"
        src={url}
        playsInline
        className="absolute inset-0 h-full w-full bg-black object-contain"
      />
    );
  }
);

/**
 * The studio's side of the stage link (`utils/stageLink`): keeps a stage window, when one is
 * open on another screen, showing this stage at this moment of the song.
 *
 * The live stage calls it with what it draws. That is sent when it changes and when a stage
 * window says hello; the song position is sent on every update the playback clock publishes
 * (the player's `timeupdate`, a seek) and when play, pause or the speed changes. Commands
 * from the stage window are carried out through the stage's own handlers. When the stage
 * goes (the song closed, the tab closed) the stage window is told, and shows its idle card.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlaybackClock } from './usePlaybackClock';
import {
  newStudioId,
  openStageLink,
  type StageLink,
  type StageState,
  type StageTransport,
} from '../utils/stageLink';
import { canOpenStageWindow, openStageWindow } from '../utils/stageWindowOpen';

export interface UseStageLeaderOptions {
  /** False in a stage window itself, which follows and never leads. */
  enabled: boolean;
  state: StageState;
  isPlaying: boolean;
  playbackRate: number;
  /** The song position when there is no playback clock to read (the `currentTime` prop). */
  fallbackTime?: number;
  onTogglePlay?: () => void;
  onSeek?: (time: number) => void;
}

export interface UseStageLeader {
  /** Whether this browser can show a stage window. */
  canOpen: boolean;
  /** A stage window is open and listening. */
  isOpen: boolean;
  /** Opens the stage window, or brings the open one forward. False when the popup was blocked. */
  open: () => boolean;
}

export function useStageLeader({
  enabled,
  state,
  isPlaying,
  playbackRate,
  fallbackTime = 0,
  onTogglePlay,
  onSeek,
}: UseStageLeaderOptions): UseStageLeader {
  const clock = usePlaybackClock();
  const [studioId] = useState(newStudioId);
  const [isOpen, setIsOpen] = useState(false);
  const linkRef = useRef<StageLink | null>(null);

  const latest = useRef({ state, isPlaying, playbackRate, fallbackTime, onTogglePlay, onSeek });
  latest.current = { state, isPlaying, playbackRate, fallbackTime, onTogglePlay, onSeek };

  const transportNow = useCallback(
    (seek: boolean): StageTransport => ({
      time: clock ? clock.now() : latest.current.fallbackTime,
      at: Date.now(),
      isPlaying: latest.current.isPlaying,
      rate: latest.current.playbackRate,
      seek,
    }),
    [clock]
  );

  // The channel, for as long as the stage is mounted
  useEffect(() => {
    if (!enabled) return;
    const link = openStageLink((message) => {
      if (message.type === 'hello') {
        setIsOpen(true);
        link?.post({ type: 'state', from: studioId, state: latest.current.state });
        link?.post({ type: 'transport', from: studioId, transport: transportNow(true) });
      } else if (message.type === 'closed') {
        setIsOpen(false);
      } else if (message.type === 'command' && message.to === studioId) {
        const { command } = message;
        // Explicit play and pause: a toggle would undo a press made in both windows at once
        if (command.name === 'play' && !latest.current.isPlaying) latest.current.onTogglePlay?.();
        else if (command.name === 'pause' && latest.current.isPlaying)
          latest.current.onTogglePlay?.();
        else if (command.name === 'seek' && Number.isFinite(command.time))
          latest.current.onSeek?.(command.time);
      }
    });
    if (!link) return;
    linkRef.current = link;
    link.post({ type: 'who' });
    const leave = () => link.post({ type: 'state', from: studioId, state: null });
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
      link.close();
      linkRef.current = null;
    };
  }, [enabled, studioId, transportNow]);

  // What the stage draws
  useEffect(() => {
    if (!enabled) return;
    linkRef.current?.post({ type: 'state', from: studioId, state });
  }, [enabled, studioId, state]);

  // Where the song is
  useEffect(() => {
    if (!enabled) return;
    const send = (seek: boolean) =>
      linkRef.current?.post({ type: 'transport', from: studioId, transport: transportNow(seek) });
    send(false);
    if (!clock) return;
    let lastSeekId = clock.getState().seekId;
    return clock.subscribe(() => {
      const { seekId } = clock.getState();
      const seek = seekId !== lastSeekId;
      lastSeekId = seekId;
      send(seek);
    });
  }, [enabled, studioId, clock, transportNow, isPlaying, playbackRate, fallbackTime]);

  const open = useCallback(() => openStageWindow(isOpen) !== null, [isOpen]);

  return { canOpen: enabled && canOpenStageWindow(), isOpen, open };
}

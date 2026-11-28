/**
 * A show's side of the stage link (`utils/stageLink`): what the stage window shows between
 * and instead of lyrics.
 *
 * The host screen sets the scene (a card, the lyrics stage, a karaoke video). It is sent
 * when it changes and again when a stage window says hello, so a stage window opened in the
 * middle of the night shows what is on. A video plays in the stage window, so its commands
 * go there and its reports (state, position, errors) come back here. When the host screen
 * closes, the stage window is told and goes back to its own idle card.
 *
 * A stage window that says hello while a video is on (it was closed and opened again, or
 * reloaded) has a new player to make: the scene it is sent says where the old one was (`at`,
 * from the last report of the video playing or paused), so the song goes on from there and
 * not from its first bar.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  newStudioId,
  openStageLink,
  resumeAt,
  type PlayerCommand,
  type PlayerReport,
  type StageLink,
  type StageScene,
} from '../utils/stageLink';
import { canOpenStageWindow, openStageWindow } from '../utils/stageWindowOpen';

export interface UseShowStage {
  /** This host screen's name on the stage link: its scenes and its lyrics stage carry it. */
  hostId: string;
  canOpen: boolean;
  /** A stage window is open and listening. */
  isOpen: boolean;
  /** Opens the stage window, or brings the open one forward. False when it was blocked. */
  open: () => boolean;
  /** Puts a scene on the stage window. */
  show: (scene: StageScene) => void;
  /** Sends a command to the video playing in the stage window. */
  command: (command: PlayerCommand) => void;
}

export function useShowStage(onReport: (report: PlayerReport) => void): UseShowStage {
  const [hostId] = useState(newStudioId);
  const [isOpen, setIsOpen] = useState(false);
  const linkRef = useRef<StageLink | null>(null);
  const sceneRef = useRef<StageScene | null>(null);
  const onReportRef = useRef(onReport);
  onReportRef.current = onReport;
  /** Where the video on stage was when last heard playing or paused, and which playing. */
  const heardRef = useRef<{ play: number; time: number; duration: number } | null>(null);

  useEffect(() => {
    // The scene for a stage window that has just opened: a video goes on from where it was
    const sceneForNewWindow = (): StageScene | null => {
      const scene = sceneRef.current;
      const heard = heardRef.current;
      if (!scene || (scene.kind !== 'youtube' && scene.kind !== 'file')) return scene;
      if (!heard || heard.play !== scene.play) return scene;
      const at = resumeAt(heard.time, heard.duration);
      return at === null ? scene : { ...scene, at };
    };
    const link = openStageLink((message) => {
      if (message.type === 'hello') {
        setIsOpen(true);
        const scene = sceneForNewWindow();
        if (scene) link?.post({ type: 'scene', from: hostId, scene });
      } else if (message.type === 'closed') {
        setIsOpen(false);
      } else if (message.type === 'report' && message.to === hostId) {
        const { report } = message;
        // A player being made reports "loading" at 0: only a video that is running, or held,
        // says where it is
        if (report.status === 'playing' || report.status === 'paused') {
          heardRef.current = { play: report.play, time: report.time, duration: report.duration };
        }
        onReportRef.current(report);
      }
    });
    if (!link) return;
    linkRef.current = link;
    link.post({ type: 'who' });
    if (sceneRef.current) link.post({ type: 'scene', from: hostId, scene: sceneRef.current });
    const leave = () => link.post({ type: 'scene', from: hostId, scene: null });
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
      link.close();
      linkRef.current = null;
    };
  }, [hostId]);

  const show = useCallback(
    (scene: StageScene) => {
      sceneRef.current = scene;
      linkRef.current?.post({ type: 'scene', from: hostId, scene });
    },
    [hostId]
  );
  const command = useCallback(
    (playerCommand: PlayerCommand) =>
      linkRef.current?.post({ type: 'player', from: hostId, command: playerCommand }),
    [hostId]
  );
  const open = useCallback(() => openStageWindow(isOpen) !== null, [isOpen]);

  return { hostId, canOpen: canOpenStageWindow(), isOpen, open, show, command };
}

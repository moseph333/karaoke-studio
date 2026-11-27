/**
 * Practice: the studio's view for rehearsing the open song. This hook holds whether practice
 * is on (kept in the address as `?practice=1`), its keys and palette commands, and the pieces
 * a singer practises with: repeating a part of the song, the original singer switched on
 * and off at once, and the singer's own pitch from the microphone against the song's melody.
 *
 * It is called once by the app, whether or not practice is on, so turning practice on and off
 * never remounts the studio: the timeline keeps its unsaved edits behind the practice panel.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AudioLines, Mic, Mic2, Repeat } from 'lucide-react';
import type { ProjectState } from '../types';
import type { UseStudioAudioReturn } from './useStudioAudio';
import { isInputElement, isModalActive } from './useKeyboardShortcuts';
import { useMelody, type UseMelodyReturn } from './useMelody';
import { useMicPitch, type UseMicPitchReturn } from './useMicPitch';
import { useOriginalVocal, type UseOriginalVocalReturn } from './useOriginalVocal';
import { usePracticeLoop, type UsePracticeLoopReturn } from './usePracticeLoop';
import { useStableHandlers } from './useStableHandlers';
import { PaletteCommand, useRegisterCommands } from '../components/commandPalette/context';
import { opensPractice, urlWithPractice } from '../utils/practiceLink';
import { characterShortcutsEnabled } from '../utils/shortcutPrefs';

export interface UsePracticeOptions {
  /** The open song once it is ready, else null: practice needs a finished song. */
  project: ProjectState | null;
  audio: UseStudioAudioReturn;
  /** The key the master plays in: the singer's track is asked for at the same one. */
  semitones: number;
  /** Practice was just turned on (the app shows the stage). */
  onEnter?: () => void;
  /** Keys are off while the app is locked behind the sign-in. */
  keysEnabled?: boolean;
}

export interface UsePracticeReturn {
  /** Practice is showing. */
  on: boolean;
  toggle: () => void;
  leave: () => void;
  loop: UsePracticeLoopReturn;
  /** The original singer, switched on and off without a new mix. */
  singer: UseOriginalVocalReturn;
  /** The microphone: the singer's pitch, shown against the melody. */
  mic: UseMicPitchReturn;
  /** The song's melody, asked for once the microphone is wanted. */
  melody: UseMelodyReturn;
}

const NO_LINES: ProjectState['lines'] = [];

export function usePractice({
  project,
  audio,
  semitones,
  onEnter,
  keysEnabled = true,
}: UsePracticeOptions): UsePracticeReturn {
  const songId = project?.id;
  const [wanted, setWanted] = useState(() => opensPractice(window.location.search));

  // A song opened from its link (or a reload, or Forward) comes back in practice when the
  // address says so; going straight to another song, or closing this one, leaves practice
  const [trackedSongId, setTrackedSongId] = useState(songId);
  if (trackedSongId !== songId) {
    setTrackedSongId(songId);
    setWanted(Boolean(songId) && !trackedSongId && opensPractice(window.location.search));
  }
  const on = wanted && Boolean(songId);

  useEffect(() => {
    if (!songId) return;
    const url = urlWithPractice(window.location, on);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (url !== current) window.history.replaceState(window.history.state, '', url);
  }, [songId, on]);

  const { enter } = useStableHandlers({ enter: () => onEnter?.() });
  const toggle = useCallback(() => {
    if (!songId) return;
    if (!on) enter();
    setWanted(!on);
  }, [songId, on, enter]);
  const leave = useCallback(() => setWanted(false), []);

  const loop = usePracticeLoop({
    enabled: on,
    songId,
    lines: project?.lines ?? NO_LINES,
    duration: audio.duration,
    clock: audio.clock,
    isPlaying: audio.isPlaying,
    playbackRate: audio.playbackRate,
    onSeek: audio.handleSeek,
  });

  const singer = useOriginalVocal({
    enabled: on,
    projectId: songId,
    hasVocals: Boolean(project?.vocals_url),
    semitones,
    audio,
  });

  const mic = useMicPitch({ enabled: on });
  const melody = useMelody({
    wanted: on && mic.wanted,
    projectId: songId,
    vocalsUrl: project?.vocals_url,
  });

  // P turns practice on and off; in practice L repeats the part being sung and O switches
  // the original singer. Single letters, so they follow the same rules as the stage's F
  const { toggleCurrentPart } = loop;
  const toggleSinger = singer.toggle;
  useEffect(() => {
    if (!songId || !keysEnabled) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'p' && !((key === 'l' || key === 'o') && on)) return;
      if (isInputElement(e.target) || isModalActive() || !characterShortcutsEnabled()) return;
      e.preventDefault();
      if (key === 'p') toggle();
      else if (key === 'l') toggleCurrentPart();
      else toggleSinger();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [songId, keysEnabled, on, toggle, toggleCurrentPart, toggleSinger]);

  const repeating = loop.mode !== 'off';
  const commands = useMemo<PaletteCommand[] | null>(() => {
    if (!songId) return null;
    const list: PaletteCommand[] = [
      {
        id: 'practice-toggle',
        title: on ? 'Leave practice' : 'Practice this song',
        group: 'Practice',
        icon: React.createElement(Mic),
        shortcut: ['P'],
        keywords: ['rehearse', 'practise', 'learn', 'sing', 'repeat'],
        run: toggle,
      },
    ];
    if (on) {
      list.push({
        id: 'practice-repeat',
        title: repeating ? 'Stop repeating' : 'Repeat this part',
        group: 'Practice',
        icon: React.createElement(Repeat),
        shortcut: ['L'],
        keywords: ['loop', 'again', 'section', 'verse', 'chorus'],
        run: toggleCurrentPart,
      });
      if (singer.available) {
        list.push({
          id: 'practice-singer',
          title: singer.on ? 'Switch the original singer off' : 'Switch the original singer on',
          group: 'Practice',
          icon: React.createElement(Mic2),
          shortcut: ['O'],
          keywords: ['vocal', 'guide', 'voice', 'hear', 'original'],
          run: toggleSinger,
        });
      }
      list.push({
        id: 'practice-pitch',
        title: mic.wanted ? 'Stop showing my pitch' : 'See my pitch',
        group: 'Practice',
        icon: React.createElement(AudioLines),
        keywords: ['microphone', 'mic', 'tune', 'melody', 'sing', 'note'],
        run: mic.wanted ? mic.stop : mic.start,
      });
    }
    return list;
  }, [
    songId,
    on,
    repeating,
    toggle,
    toggleCurrentPart,
    singer.available,
    singer.on,
    toggleSinger,
    mic.wanted,
    mic.start,
    mic.stop,
  ]);
  useRegisterCommands('practice', commands);

  return useMemo(
    () => ({ on, toggle, leave, loop, singer, mic, melody }),
    [on, toggle, leave, loop, singer, mic, melody]
  );
}

/**
 * The original singer in practice, switched on and off at once.
 *
 * The guide vocal of the Audio mix panel is mixed into the master by the server, so changing
 * it means a new master and a moment's wait. Practice plays the song's vocals by themselves
 * in a second player instead, kept in step with the master (`utils/vocalFollow`), and the
 * switch only changes that player's level.
 *
 * The player is an audio element that is never put in the page (the page has one `<audio>`,
 * the dock's). Its sound goes through the studio's audio graph, where a gain node makes the
 * switch a short fade; without the graph (a browser that refuses it) the element's own
 * volume does the same.
 *
 * The server says where the vocals are (`POST …/practice-vocal`): the vocal stem at the
 * original key, a copy shifted to the master's key otherwise.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, readApiError } from '../api';
import type { PracticeVocalResponse } from '../types';
import type { UseStudioAudioReturn } from './useStudioAudio';
import { followMaster, newVocalFollowMemory, type VocalFollowMemory } from '../utils/vocalFollow';

/** `idle`: not asked for yet. `ready`: loaded, following the master once switched on. */
export type OriginalVocalStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface UseOriginalVocalOptions {
  /** Practice is on. */
  enabled: boolean;
  projectId: string | undefined;
  /** The song has a separate vocal track. */
  hasVocals: boolean;
  /** The key the master plays in (the mix as applied, not as asked for). */
  semitones: number;
  audio: Pick<UseStudioAudioReturn, 'audioRef' | 'analyserNode'>;
}

export interface UseOriginalVocalReturn {
  /** The song has vocals to play. */
  available: boolean;
  status: OriginalVocalStatus;
  /** The singer is switched on. */
  on: boolean;
  /** The singer's level, 0 to 1. */
  level: number;
  toggle: () => void;
  setLevel: (level: number) => void;
  /** Asks for the vocals again after a failure. */
  retry: () => void;
}

export const VOCAL_LEVEL_STORAGE_KEY = 'karaoke_practice_vocal_level';
export const DEFAULT_VOCAL_LEVEL = 0.8;
/** How often the vocal is checked against the master while it plays. */
export const FOLLOW_INTERVAL_MS = 250;
/** The switch fades over about this long, so it does not click. */
const FADE_SEC = 0.015;

const MASTER_EVENTS = [
  'play',
  'playing',
  'pause',
  'seeking',
  'ratechange',
  'waiting',
  'emptied',
  'ended',
] as const;

const clampLevel = (level: number) =>
  Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;

function storedLevel(): number {
  try {
    const raw = window.localStorage.getItem(VOCAL_LEVEL_STORAGE_KEY);
    const level = raw === null ? NaN : Number(raw);
    return Number.isFinite(level) ? clampLevel(level) : DEFAULT_VOCAL_LEVEL;
  } catch {
    return DEFAULT_VOCAL_LEVEL;
  }
}

/** A listener asked to save data gets the vocals when the singer is first switched on. */
function savesData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(connection?.saveData);
}

interface VocalPlayer {
  el: HTMLAudioElement;
  /** Set once the element's sound runs through the studio's graph. */
  gain: GainNode | null;
}

export function useOriginalVocal({
  enabled,
  projectId,
  hasVocals,
  semitones,
  audio,
}: UseOriginalVocalOptions): UseOriginalVocalReturn {
  const { audioRef, analyserNode } = audio;
  const available = Boolean(projectId) && hasVocals;
  const [on, setOn] = useState(false);
  const [level, setLevelState] = useState(storedLevel);
  const [status, setStatus] = useState<OriginalVocalStatus>('idle');
  /** The singer has been switched on once: the vocals are wanted even on a metered line. */
  const [asked, setAsked] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Leaving practice or opening another song switches the singer off (during render, so no
  // frame shows the last song's switch)
  const [tracked, setTracked] = useState({ enabled, projectId });
  if (tracked.enabled !== enabled || tracked.projectId !== projectId) {
    setTracked({ enabled, projectId });
    setOn(false);
    setAsked(false);
    setStatus('idle');
  }

  const playerRef = useRef<VocalPlayer | null>(null);
  const memoryRef = useRef<VocalFollowMemory>(newVocalFollowMemory());
  const readyRef = useRef(false);
  /** The element was started from a click once; some browsers need that before it may play. */
  const primedRef = useRef(false);
  const latest = useRef({ on, level, analyserNode });
  latest.current = { on, level, analyserNode };

  /** The player, made on first use and wired into the studio's graph when there is one. */
  const player = useCallback((): VocalPlayer => {
    let current = playerRef.current;
    if (!current) {
      const el = new Audio();
      el.preload = 'auto';
      el.crossOrigin = 'use-credentials';
      (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
      current = { el, gain: null };
      playerRef.current = current;
    }
    const analyser = latest.current.analyserNode;
    if (!current.gain && analyser) {
      try {
        const context = analyser.context as AudioContext;
        const gain = context.createGain();
        gain.gain.value = 0;
        context.createMediaElementSource(current.el).connect(gain);
        gain.connect(analyser);
        current.gain = gain;
      } catch {
        // No graph for this element: its own volume carries the level instead
      }
    }
    return current;
  }, []);

  /** Sets how loud the vocal is: silent when switched off, and with the master's volume. */
  const applyLevel = useCallback(() => {
    const current = playerRef.current;
    if (!current) return;
    const master = audioRef.current;
    const target = latest.current.on ? latest.current.level : 0;
    const masterVolume = master ? master.volume : 1;
    const masterMuted = master ? master.muted : false;
    if (current.gain) {
      const context = current.gain.context;
      current.gain.gain.setTargetAtTime(target, context.currentTime, FADE_SEC);
      current.el.volume = masterVolume;
      current.el.muted = masterMuted;
    } else {
      current.el.volume = clampLevel(masterVolume * target);
      current.el.muted = masterMuted || target === 0;
    }
  }, [audioRef]);

  /** One step of following the master. */
  const follow = useCallback(() => {
    const current = playerRef.current;
    const master = audioRef.current;
    if (!current || !master || !readyRef.current || !primedRef.current) return;
    const { el } = current;
    const { step, memory } = followMaster(
      {
        time: master.currentTime,
        playing: !master.paused && !master.ended && !master.seeking,
        rate: master.playbackRate || 1,
      },
      { time: el.currentTime, playing: !el.paused, rate: el.playbackRate || 1 },
      memoryRef.current,
      performance.now()
    );
    memoryRef.current = memory;
    if (step.seek !== undefined) {
      const length = el.duration;
      el.currentTime =
        Number.isFinite(length) && length > 0 ? Math.min(step.seek, length) : step.seek;
    }
    if (step.rate !== undefined) el.playbackRate = step.rate;
    if (step.pause) el.pause();
    if (step.play) void Promise.resolve(el.play()).catch(() => {});
  }, [audioRef]);

  // Where the vocals are, and loading them: when practice opens, or on the first switch-on
  // for a listener saving data
  const wanted = enabled && available && (asked || !savesData());
  useEffect(() => {
    if (!wanted || !projectId) return;
    const abort = new AbortController();
    let cancelled = false;
    let el: HTMLAudioElement | null = null;
    const onCanPlay = () => {
      if (cancelled) return;
      readyRef.current = true;
      setStatus('ready');
      follow();
    };
    const onError = () => {
      if (cancelled) return;
      readyRef.current = false;
      setStatus('failed');
    };
    readyRef.current = false;
    memoryRef.current = newVocalFollowMemory();
    setStatus('loading');
    void (async () => {
      try {
        const res = await apiFetch(`/api/project/${projectId}/practice-vocal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ semitones }),
          signal: abort.signal,
        });
        if (!res.ok) throw new Error(await readApiError(res, 'Could not load the vocal track'));
        const data: Partial<PracticeVocalResponse> = await res.json();
        if (cancelled) return;
        if (typeof data.url !== 'string' || !data.url) throw new Error('No vocal track');
        el = player().el;
        el.addEventListener('canplay', onCanPlay);
        el.addEventListener('error', onError);
        el.src = data.url;
        el.load();
        applyLevel();
      } catch (err) {
        if (cancelled || (err as { name?: string } | null)?.name === 'AbortError') return;
        console.error('Practice vocal failed to load', err);
        setStatus('failed');
      }
    })();
    return () => {
      cancelled = true;
      abort.abort();
      readyRef.current = false;
      const current = playerRef.current;
      if (el) {
        el.removeEventListener('canplay', onCanPlay);
        el.removeEventListener('error', onError);
      }
      if (current) {
        current.el.pause();
        current.el.removeAttribute('src');
        current.el.load();
      }
    };
  }, [wanted, projectId, semitones, attempt, player, applyLevel, follow]);

  // Leaving practice or changing song: the next visit starts from a click again
  useEffect(() => {
    primedRef.current = false;
  }, [enabled, projectId]);

  // With the master: its play, pause, seeks and speed at once, its drift four times a second.
  // The dock's element may not be there yet when practice opens (its code loads on demand),
  // so each tick also looks for it and listens once it has come.
  useEffect(() => {
    if (!wanted) return;
    let listeningTo: HTMLAudioElement | null = null;
    // The master has landed somewhere else: go there now, even just after a jump of its own
    const afterSeek = () => {
      memoryRef.current = { ...memoryRef.current, soughtAt: null };
      follow();
    };
    const stopListening = () => {
      const master = listeningTo;
      if (!master) return;
      MASTER_EVENTS.forEach((name) => master.removeEventListener(name, follow));
      master.removeEventListener('seeked', afterSeek);
      master.removeEventListener('volumechange', applyLevel);
      listeningTo = null;
    };
    const listen = () => {
      const master = audioRef.current;
      if (master === listeningTo) return;
      stopListening();
      if (!master) return;
      MASTER_EVENTS.forEach((name) => master.addEventListener(name, follow));
      master.addEventListener('seeked', afterSeek);
      master.addEventListener('volumechange', applyLevel);
      listeningTo = master;
      applyLevel();
    };
    listen();
    const timer = window.setInterval(() => {
      listen();
      follow();
    }, FOLLOW_INTERVAL_MS);
    return () => {
      stopListening();
      window.clearInterval(timer);
    };
  }, [wanted, audioRef, follow, applyLevel]);

  // The switch and the level: a fade on the gain, nothing reloaded
  useEffect(() => {
    // The graph may have come since the player was made (it is built on first play)
    if (playerRef.current && analyserNode) player();
    applyLevel();
  }, [on, level, analyserNode, status, player, applyLevel]);

  const toggle = useCallback(() => {
    if (!enabled || !available) return;
    const next = !on;
    setOn(next);
    if (!next) return;
    setAsked(true);
    if (primedRef.current) return;
    primedRef.current = true;
    // Started inside this click, for browsers that let an element play only once a click
    // has started it; silent until it has found its place beside the master
    const current = playerRef.current;
    if (!current || !readyRef.current) return;
    const master = audioRef.current;
    if (!master || master.paused) {
      current.el.muted = true;
      void Promise.resolve(current.el.play())
        .catch(() => {})
        .then(() => {
          follow();
          applyLevel();
        });
    } else {
      follow();
    }
  }, [enabled, available, on, audioRef, follow, applyLevel]);

  const setLevel = useCallback((next: number) => {
    const clamped = clampLevel(next);
    setLevelState(clamped);
    try {
      window.localStorage.setItem(VOCAL_LEVEL_STORAGE_KEY, String(clamped));
    } catch {
      // Not remembered: the level still holds for this visit
    }
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // The player goes with the studio
  useEffect(
    () => () => {
      const current = playerRef.current;
      if (!current) return;
      current.el.pause();
      current.el.removeAttribute('src');
      try {
        current.gain?.disconnect();
      } catch {
        // Already gone with its context
      }
      playerRef.current = null;
    },
    []
  );

  return useMemo(
    () => ({ available, status: available ? status : 'idle', on, level, toggle, setLevel, retry }),
    [available, status, on, level, toggle, setLevel, retry]
  );
}

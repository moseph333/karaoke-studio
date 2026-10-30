/**
 * Mix Controller Hook
 *
 * Owns the requested vs. applied audio mix (key transposition + guide vocal blend).
 * Changes are applied automatically: key steps and slider releases schedule a debounced
 * POST /api/project/{id}/mix, newer requests abort older ones, and only the latest response
 * is committed. Consumers render the requested values immediately (e.g. transposed chords)
 * while `isRemixing` reports the server-side re-render.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, readApiError } from '../api';

export const MIX_SEMITONE_MIN = -12;
export const MIX_SEMITONE_MAX = 12;
export const MIX_GUIDE_MAX = 0.5;
export const MIX_DEBOUNCE_MS = 500;

export interface MixAppliedResult {
  semitones: number;
  guideVolume: number;
  masterAudioUrl?: string;
}

export interface UseMixControllerOptions {
  projectId?: string;
  /** Applied values from the project record. */
  initialSemitones?: number;
  initialGuideVolume?: number;
  onApplied?: (result: MixAppliedResult) => void;
  onError?: (error: unknown) => void;
  debounceMs?: number;
  enabled?: boolean;
}

export interface UseMixControllerReturn {
  semitones: number;
  guideVolume: number;
  appliedSemitones: number;
  appliedGuideVolume: number;
  isRemixing: boolean;
  isPending: boolean;
  setSemitones: (semitones: number) => void;
  stepSemitones: (delta: number) => void;
  resetSemitones: () => void;
  setGuideVolume: (volume: number) => void;
  commitGuideVolume: (volume?: number) => void;
  applyNow: (semitones?: number, guideVolume?: number) => Promise<boolean>;
}

const clampSemitones = (n: number) =>
  Math.max(MIX_SEMITONE_MIN, Math.min(MIX_SEMITONE_MAX, Math.round(Number.isFinite(n) ? n : 0)));

const clampGuide = (v: number) =>
  Math.max(0, Math.min(MIX_GUIDE_MAX, Number.isFinite(v) ? Math.round(v * 100) / 100 : 0));

export function useMixController({
  projectId,
  initialSemitones = 0,
  initialGuideVolume = 0,
  onApplied,
  onError,
  debounceMs = MIX_DEBOUNCE_MS,
  enabled = true,
}: UseMixControllerOptions): UseMixControllerReturn {
  const [semitones, setSemitonesState] = useState(() => clampSemitones(initialSemitones));
  const [guideVolume, setGuideVolumeState] = useState(() => clampGuide(initialGuideVolume));
  const [appliedSemitones, setAppliedSemitones] = useState(() => clampSemitones(initialSemitones));
  const [appliedGuideVolume, setAppliedGuideVolume] = useState(() =>
    clampGuide(initialGuideVolume)
  );
  const [isRemixing, setIsRemixing] = useState(false);

  // A newly opened song shows its own key and guide level from its first frame. Adjusting the
  // state while rendering (React's pattern for state that follows a prop) never commits a frame
  // with the previous song's values; the effect below still cancels that song's pending work.
  const [seededFor, setSeededFor] = useState(projectId);
  if (seededFor !== projectId) {
    const s = clampSemitones(initialSemitones);
    const g = clampGuide(initialGuideVolume);
    setSeededFor(projectId);
    setSemitonesState(s);
    setGuideVolumeState(g);
    setAppliedSemitones(s);
    setAppliedGuideVolume(g);
    setIsRemixing(false);
  }

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const latestRef = useRef({ semitones, guideVolume });
  latestRef.current = { semitones, guideVolume };
  const callbacksRef = useRef({ onApplied, onError });
  callbacksRef.current = { onApplied, onError };

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Values committed by this hook; echoes of them from the project record are ignored.
  const appliedRef = useRef({ semitones: appliedSemitones, guideVolume: appliedGuideVolume });
  const seededProjectRef = useRef<string | undefined>(projectId);

  // Re-seed when the project changes, or when its applied values change from the outside
  useEffect(() => {
    const s = clampSemitones(initialSemitones);
    const g = clampGuide(initialGuideVolume);
    const projectChanged = seededProjectRef.current !== projectId;
    const isEcho = appliedRef.current.semitones === s && appliedRef.current.guideVolume === g;
    if (!projectChanged && isEcho) return;
    seededProjectRef.current = projectId;
    clearTimer();
    abortRef.current?.abort();
    appliedRef.current = { semitones: s, guideVolume: g };
    latestRef.current = { semitones: s, guideVolume: g };
    setSemitonesState(s);
    setGuideVolumeState(g);
    setAppliedSemitones(s);
    setAppliedGuideVolume(g);
    setIsRemixing(false);
  }, [projectId, initialSemitones, initialGuideVolume]);

  useEffect(
    () => () => {
      clearTimer();
      abortRef.current?.abort();
    },
    []
  );

  const applyNow = useCallback(
    async (s?: number, g?: number): Promise<boolean> => {
      clearTimer();
      if (!projectId || !enabled) return false;
      const targetS = clampSemitones(s ?? latestRef.current.semitones);
      const targetG = clampGuide(g ?? latestRef.current.guideVolume);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++seqRef.current;
      setIsRemixing(true);
      try {
        const res = await apiFetch(`/api/project/${projectId}/mix`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ semitones: targetS, guide_volume: targetG }),
          signal: controller.signal,
        });
        if (seq !== seqRef.current) return false;
        if (!res.ok) {
          throw new Error(await readApiError(res, 'Failed to apply audio mix'));
        }
        const data = await res.json().catch(() => ({}));
        if (seq !== seqRef.current) return false;
        appliedRef.current = { semitones: targetS, guideVolume: targetG };
        setAppliedSemitones(targetS);
        setAppliedGuideVolume(targetG);
        callbacksRef.current.onApplied?.({
          semitones: targetS,
          guideVolume: targetG,
          masterAudioUrl: data?.master_audio_url,
        });
        return true;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return false;
        if (seq === seqRef.current) callbacksRef.current.onError?.(err);
        return false;
      } finally {
        if (seq === seqRef.current) {
          setIsRemixing(false);
          abortRef.current = null;
        }
      }
    },
    [projectId, enabled]
  );

  const schedule = useCallback(() => {
    clearTimer();
    if (!projectId || !enabled) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void applyNow();
    }, debounceMs);
  }, [applyNow, debounceMs, projectId, enabled]);

  const setSemitones = useCallback(
    (n: number) => {
      const next = clampSemitones(n);
      latestRef.current = { ...latestRef.current, semitones: next };
      setSemitonesState(next);
      schedule();
    },
    [schedule]
  );

  const stepSemitones = useCallback(
    (delta: number) => setSemitones(latestRef.current.semitones + delta),
    [setSemitones]
  );

  const resetSemitones = useCallback(() => setSemitones(0), [setSemitones]);

  const setGuideVolume = useCallback((v: number) => {
    const next = clampGuide(v);
    latestRef.current = { ...latestRef.current, guideVolume: next };
    setGuideVolumeState(next);
  }, []);

  const commitGuideVolume = useCallback(
    (v?: number) => {
      if (v !== undefined) setGuideVolume(v);
      schedule();
    },
    [schedule, setGuideVolume]
  );

  return {
    semitones,
    guideVolume,
    appliedSemitones,
    appliedGuideVolume,
    isRemixing,
    isPending: semitones !== appliedSemitones || guideVolume !== appliedGuideVolume,
    setSemitones,
    stepSemitones,
    resetSemitones,
    setGuideVolume,
    commitGuideVolume,
    applyNow,
  };
}

/**
 * Project chords: loads the detected progression when a song opens, saves edits, and keeps
 * a bounded undo/redo history for chord changes.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChordSegment, ProjectState } from '../types';
import { apiFetch, readApiError } from '../api';
import { useChordHistory } from './useChordHistory';
import { useToast } from './useToast';

export interface UseProjectChordsOptions {
  project: ProjectState | null;
  setProject: React.Dispatch<React.SetStateAction<ProjectState | null>>;
  isStudioReady: boolean;
}

export function useProjectChords({ project, setProject, isStudioReady }: UseProjectChordsOptions) {
  const { toast } = useToast();
  const [initialChords, setInitialChords] = useState<ChordSegment[]>([]);

  // Load chords once when a song opens without them. The intake detects them while the
  // studio opens, so the request may wait for that detection; a song with no chords at all
  // must not ask again on every update.
  const chordsRequestedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!project?.id) return;
    if (project.status !== 'ready') {
      if (chordsRequestedFor.current === project.id) chordsRequestedFor.current = null;
      return;
    }
    if (project.chords && project.chords.length > 0) return;
    if (chordsRequestedFor.current === project.id) return;
    chordsRequestedFor.current = project.id;

    apiFetch(`/api/project/${project.id}/chords`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.chords && Array.isArray(data.chords)) {
          // Only onto the song the reply is for; the effect below takes them as saved
          setProject((prev) =>
            prev && prev.id === data.project_id ? { ...prev, chords: data.chords } : prev
          );
        }
      })
      .catch((e) => console.error('Failed to load project chords', e));
  }, [project?.id, project?.status, project?.chords, setProject]);

  // The chords this hook last put on the project itself (an edit, an undo, a save's reply).
  // Any other chords array came from the server.
  const localChordsRef = useRef<ChordSegment[] | null>(null);
  const setLocalChords = useCallback(
    (chords: ChordSegment[]) => {
      localChordsRef.current = chords;
      setProject((prev) => (prev ? { ...prev, chords } : null));
    },
    [setProject]
  );

  // The saved baseline: the chords a song opens with, and any the server sends later (the
  // first detection, a re-detection after new stems). Without the latter a song whose
  // chords the server replaced stayed "unsaved" for good.
  const prevProjectIdRef = useRef<string | undefined>(project?.id);
  useEffect(() => {
    if (!project?.id) {
      setInitialChords([]);
      prevProjectIdRef.current = undefined;
    } else if (prevProjectIdRef.current !== project.id) {
      prevProjectIdRef.current = project.id;
      localChordsRef.current = null;
      setInitialChords(project.chords && project.chords.length > 0 ? project.chords : []);
    } else if (
      project.chords &&
      project.chords.length > 0 &&
      project.chords !== localChordsRef.current
    ) {
      setInitialChords(project.chords);
    }
  }, [project?.id, project?.chords]);

  const chordHistoryRef = useRef<ReturnType<typeof useChordHistory> | null>(null);

  // Save edited chord progression to backend
  const handleSaveChords = useCallback(
    async (updatedChords?: ChordSegment[]): Promise<boolean> => {
      if (!project?.id) return false;
      const chordsToSave = updatedChords ?? project.chords ?? [];
      try {
        const res = await apiFetch(`/api/project/${project.id}/chords`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chords: chordsToSave }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          const savedChords = (data?.chords as ChordSegment[]) || chordsToSave;
          setLocalChords(savedChords);
          chordHistoryRef.current?.updateBaseline(savedChords);
          toast.success('Chord progression saved');
          return true;
        } else {
          throw new Error(await readApiError(res, 'Failed to save chords'));
        }
      } catch (err: unknown) {
        console.error('Failed to save chords:', err);
        toast.error(err instanceof Error ? err.message : 'Error saving chords');
        throw err;
      }
    },
    [project?.id, project?.chords, setLocalChords, toast]
  );

  // 50-step bounded Undo / Redo history stack hook
  const chordHistory = useChordHistory({
    projectId: project?.id,
    initialChords,
    currentChords: project?.chords,
    enabled: isStudioReady,
    onApplySnapshot: (restoredChords) => {
      setLocalChords(restoredChords);
      handleSaveChords(restoredChords).catch((e) =>
        console.error('Failed to persist snapshot chords', e)
      );
    },
    onSaveSuccess: (savedChords) => {
      setLocalChords(savedChords);
    },
  });
  chordHistoryRef.current = chordHistory;

  // Inline chord cue modification handler (the history object is new each render; its
  // pushSnapshot is stable)
  const { pushSnapshot } = chordHistory;
  const handleEditChord = useCallback(
    async (index: number, newChord: string) => {
      if (!project?.chords || index < 0 || index >= project.chords.length) return;
      const current = project.chords;
      pushSnapshot(current);

      const updated = current.map((c, i) => (i === index ? { ...c, chord: newChord } : c));
      setLocalChords(updated);

      try {
        await handleSaveChords(updated);
      } catch (e) {
        console.error('Failed to persist edited chord', e);
      }
    },
    [project?.chords, pushSnapshot, handleSaveChords, setLocalChords]
  );

  return { chordHistory, handleSaveChords, handleEditChord };
}

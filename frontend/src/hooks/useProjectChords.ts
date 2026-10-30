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

  // Load chords for project when ready
  useEffect(() => {
    if (!project?.id || project.status !== 'ready') return;
    if (project.chords && project.chords.length > 0) return;

    apiFetch(`/api/project/${project.id}/chords`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.chords && Array.isArray(data.chords)) {
          setInitialChords(data.chords);
          setProject((prev) =>
            prev && prev.id === data.project_id ? { ...prev, chords: data.chords } : prev
          );
        }
      })
      .catch((e) => console.error('Failed to load project chords', e));
  }, [project?.id, project?.status, project?.chords, setProject]);

  // Sync initial baseline chords when project changes or chords arrive
  const prevProjectIdRef = useRef<string | undefined>(project?.id);
  useEffect(() => {
    if (!project?.id) {
      setInitialChords([]);
      prevProjectIdRef.current = undefined;
    } else if (prevProjectIdRef.current !== project.id) {
      prevProjectIdRef.current = project.id;
      setInitialChords(project.chords && project.chords.length > 0 ? project.chords : []);
    } else if (project.chords && project.chords.length > 0 && initialChords.length === 0) {
      setInitialChords(project.chords);
    }
  }, [project?.id, project?.chords, initialChords.length]);

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
          setProject((prev) => (prev ? { ...prev, chords: savedChords } : null));
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
    [project?.id, project?.chords, setProject, toast]
  );

  // 50-step bounded Undo / Redo history stack hook
  const chordHistory = useChordHistory({
    projectId: project?.id,
    initialChords,
    currentChords: project?.chords,
    enabled: isStudioReady,
    onApplySnapshot: (restoredChords) => {
      setProject((prev) => (prev ? { ...prev, chords: restoredChords } : null));
      handleSaveChords(restoredChords).catch((e) =>
        console.error('Failed to persist snapshot chords', e)
      );
    },
    onSaveSuccess: (savedChords) => {
      setProject((prev) => (prev ? { ...prev, chords: savedChords } : null));
    },
  });
  chordHistoryRef.current = chordHistory;

  // Inline chord cue modification handler
  const handleEditChord = useCallback(
    async (index: number, newChord: string) => {
      if (!project?.chords || index < 0 || index >= project.chords.length) return;
      const current = project.chords;
      chordHistory.pushSnapshot(current);

      const updated = current.map((c, i) => (i === index ? { ...c, chord: newChord } : c));
      setProject((prev) => (prev ? { ...prev, chords: updated } : null));

      try {
        await handleSaveChords(updated);
      } catch (e) {
        console.error('Failed to persist edited chord', e);
      }
    },
    [project?.chords, chordHistory, handleSaveChords, setProject]
  );

  return { chordHistory, handleSaveChords, handleEditChord };
}

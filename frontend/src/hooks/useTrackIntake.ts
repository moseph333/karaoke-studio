/**
 * Track intake: starts processing for a YouTube URL/search pick or an uploaded audio file
 * and hands the queued project to the app. Remembers the stem separation quality the user
 * picked (none means the server's default).
 */

import React, { useCallback, useState } from 'react';
import { ProjectState, SeparationPreset } from '../types';
import { apiFetch, readApiError } from '../api';
import { useToast } from './useToast';
import { SEPARATION_PRESET_ORDER } from '../utils/quality';

export const SEPARATION_QUALITY_STORAGE_KEY = 'karaoke_separation_quality';

function readStoredQuality(): SeparationPreset | null {
  try {
    const stored = localStorage.getItem(SEPARATION_QUALITY_STORAGE_KEY);
    return SEPARATION_PRESET_ORDER.find((preset) => preset === stored) ?? null;
  } catch {
    return null;
  }
}

export interface UseTrackIntakeOptions {
  currentUser: string;
  setProject: React.Dispatch<React.SetStateAction<ProjectState | null>>;
}

export function useTrackIntake({ currentUser, setProject }: UseTrackIntakeOptions) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [separationQuality, setSeparationQualityState] = useState<SeparationPreset | null>(
    readStoredQuality
  );

  const setSeparationQuality = useCallback((preset: SeparationPreset) => {
    setSeparationQualityState(preset);
    try {
      localStorage.setItem(SEPARATION_QUALITY_STORAGE_KEY, preset);
    } catch {
      // The choice still applies to this session
    }
  }, []);

  // Start processing a new track
  const handleSelectTrack = async (urlOrId: string, customLyrics?: string) => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url_or_id: urlOrId,
          custom_lyrics: customLyrics,
          created_by: currentUser || 'Friend',
          ...(separationQuality ? { separation_quality: separationQuality } : {}),
        }),
      });
      if (!res.ok) throw new Error('Failed to initiate processing');
      const data = await res.json();
      setProject({
        id: data.project_id,
        status: 'queued',
        progress: 5,
        lines: [],
        semitones: 0,
        guide_volume: 0,
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error processing track');
    } finally {
      setLoading(false);
    }
  };

  // Start processing an uploaded local audio track
  const handleUploadTrack = async (params: {
    file: File;
    title?: string;
    artist?: string;
    customLyrics?: string;
    createdBy?: string;
  }) => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', params.file);
      if (params.title) formData.append('title', params.title);
      if (params.artist) formData.append('artist', params.artist);
      if (params.customLyrics) formData.append('custom_lyrics', params.customLyrics);
      formData.append('created_by', params.createdBy || currentUser || 'Friend');
      if (separationQuality) formData.append('separation_quality', separationQuality);

      const res = await apiFetch('/api/upload-track', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, 'Failed to upload audio track'));
      }
      const data = await res.json();
      setProject({
        id: data.project_id,
        status: 'queued',
        progress: 5,
        lines: [],
        semitones: 0,
        guide_volume: 0,
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error uploading audio track');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    handleSelectTrack,
    handleUploadTrack,
    separationQuality,
    setSeparationQuality,
  };
}

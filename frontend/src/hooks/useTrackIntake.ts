/**
 * Track intake: starts processing for a YouTube URL/search pick or an uploaded audio file
 * and hands the queued project to the app.
 */

import React, { useState } from 'react';
import { ProjectState } from '../types';
import { apiFetch } from '../api';
import { useToast } from './useToast';

export interface UseTrackIntakeOptions {
  currentUser: string;
  setProject: React.Dispatch<React.SetStateAction<ProjectState | null>>;
}

export function useTrackIntake({ currentUser, setProject }: UseTrackIntakeOptions) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

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

      const res = await apiFetch('/api/upload-track', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to upload audio track');
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

  return { loading, handleSelectTrack, handleUploadTrack };
}

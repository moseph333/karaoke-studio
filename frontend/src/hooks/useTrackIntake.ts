/**
 * Track intake: starts processing for a song link (YouTube, SoundCloud, Bandcamp, Vimeo,
 * Internet Archive; Spotify, Apple Music, TIDAL and Deezer songs are found on YouTube), a YouTube
 * search pick or an uploaded audio file
 * and hands the queued project to the app. Remembers the stem separation quality the user
 * picked (none means the server's default).
 */

import React, { useCallback, useState } from 'react';
import { AlbumSongsStarted, ProjectState, SeparationPreset } from '../types';
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
  // `again`: the failed or cancelled song being started again, which keeps its owner and
  // its quality rather than taking this browser's
  const handleSelectTrack = async (
    urlOrId: string,
    customLyrics?: string,
    again?: Pick<ProjectState, 'created_by' | 'separation_quality'>
  ) => {
    const quality = again?.separation_quality || separationQuality;
    setLoading(true);
    try {
      const res = await apiFetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url_or_id: urlOrId,
          custom_lyrics: customLyrics,
          created_by: again?.created_by || currentUser || 'Friend',
          ...(quality ? { separation_quality: quality } : {}),
        }),
      });
      if (!res.ok) {
        // The server's detail says why, such as a disk that is almost full (507)
        throw new Error(await readApiError(res, 'Failed to initiate processing'));
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

  const queuedProject = (id: string): ProjectState => ({
    id,
    status: 'queued',
    progress: 5,
    lines: [],
    semitones: 0,
    guide_volume: 0,
  });

  // Make songs picked from a whole album; the first one opens, the others queue behind it
  // and show in the library. `again`: a failed album song started again keeps its quality
  const handleAlbumSongs = async (
    albumId: string,
    songs: Array<{ number: number; title?: string }>,
    artist?: string,
    again?: Pick<ProjectState, 'created_by' | 'separation_quality'>
  ): Promise<AlbumSongsStarted | null> => {
    const quality = again?.separation_quality || separationQuality;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/project/${encodeURIComponent(albumId)}/album/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songs,
          ...(artist ? { artist } : {}),
          created_by: again?.created_by || currentUser || 'Friend',
          ...(quality ? { separation_quality: quality } : {}),
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Could not start the songs'));
      const data: AlbumSongsStarted = await res.json();
      const first = data.projects[0];
      if (first) {
        setProject({
          ...queuedProject(first.project_id),
          status: first.status as ProjectState['status'],
        });
        if (data.projects.length > 1) {
          toast.info(
            `${data.projects.length} songs are on their way. The others are in your library.`
          );
        }
      }
      return data;
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not start the songs');
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Make a whole album recording one song after all
  const handleAlbumWhole = async (albumId: string): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/project/${encodeURIComponent(albumId)}/album/whole`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(separationQuality ? { separation_quality: separationQuality } : {}),
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Could not start the song'));
      const data = await res.json();
      setProject(queuedProject(data.project_id));
      return true;
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not start the song');
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    handleSelectTrack,
    handleAlbumSongs,
    handleAlbumWhole,
    handleUploadTrack,
    separationQuality,
    setSeparationQuality,
  };
}

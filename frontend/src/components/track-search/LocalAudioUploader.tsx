/* eslint-disable react-refresh/only-export-components */
/**
 * Local Audio Uploader Component
 *
 * Drag-and-drop dropzone, local file selection, audio format validation, optional
 * title/artist fields and project creation.
 */

import React, { useState } from 'react';
import { FileAudio, Upload, X } from 'lucide-react';
import { ProjectState } from '../../types';
import { apiFetch, readApiError } from '../../api';
import { cn } from '../../utils/cn';
import { focusRing } from '../ui/variants';

export interface UploadTrackParams {
  file: File;
  title?: string;
  artist?: string;
  customLyrics?: string;
  createdBy?: string;
}

export interface LocalAudioUploaderProps {
  isLoading: boolean;
  currentUser?: string;
  customLyrics: string;
  onUploadTrack?: (params: UploadTrackParams) => Promise<void> | void;
  onOpenProject?: (project: ProjectState) => void;
  onError: (error: string | null) => void;
}

export const MAX_AUDIO_SIZE = 100 * 1024 * 1024; // 100MB
export const ALLOWED_AUDIO_EXTENSIONS = ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'aac', 'opus'];

export const validateAudioFile = (file: File): string | null => {
  if (file.size === 0) {
    return 'Selected file is empty (0 bytes).';
  }
  if (file.size > MAX_AUDIO_SIZE) {
    return 'Audio file exceeds 100MB limit. Please choose a smaller file.';
  }
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!ext || !ALLOWED_AUDIO_EXTENSIONS.includes(ext)) {
    return 'Unsupported audio format. Supported formats: WAV, MP3, FLAC, M4A, OGG, OPUS, AAC.';
  }
  return null;
};

export const parseAudioFilename = (filename: string): { artist?: string; title: string } => {
  const baseName = filename.replace(/\.[^/.]+$/, '').trim();
  // Normalize underscores to spaces before checking artist - title delimiter
  const normalized = baseName.replace(/_+/g, ' ').trim();
  // Check if filename matches Artist - Title or Artist – Title or Artist — Title
  const delimiterMatch = normalized.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (delimiterMatch) {
    const rawArtist = delimiterMatch[1];
    const rawTitle = delimiterMatch[2];
    const cleanArtist = rawArtist.replace(/\s+/g, ' ').trim();
    const cleanTitle = rawTitle.replace(/\s+/g, ' ').trim();
    return {
      artist: cleanArtist || undefined,
      title: cleanTitle || baseName,
    };
  }
  // Single title: collapse multiple whitespace, preserve single hyphens
  const cleanTitle = normalized.replace(/\s+/g, ' ').trim();
  return {
    title: cleanTitle || baseName,
  };
};

export const LocalAudioUploader: React.FC<LocalAudioUploaderProps> = ({
  isLoading,
  currentUser = 'Friend',
  customLyrics,
  onUploadTrack,
  onOpenProject,
  onError,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [trackTitle, setTrackTitle] = useState('');
  const [trackArtist, setTrackArtist] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingTrack, setUploadingTrack] = useState(false);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const processFile = (file: File, resetInput?: () => void) => {
    const validationError = validateAudioFile(file);
    if (validationError) {
      setSelectedFile(null);
      onError(validationError);
      if (resetInput) {
        resetInput();
      }
      return;
    }

    setSelectedFile(file);
    onError(null);

    const parsed = parseAudioFilename(file.name);
    if (!trackTitle.trim() && parsed.title) {
      setTrackTitle(parsed.title);
    }
    if (!trackArtist.trim() && parsed.artist) {
      setTrackArtist(parsed.artist);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file, () => {
        e.target.value = '';
      });
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleLocalUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      onError('Please select an audio file to upload.');
      return;
    }

    setUploadingTrack(true);
    onError(null);

    try {
      if (onUploadTrack) {
        await onUploadTrack({
          file: selectedFile,
          title: trackTitle.trim() || undefined,
          artist: trackArtist.trim() || undefined,
          customLyrics: customLyrics.trim() || undefined,
          createdBy: currentUser || 'Friend',
        });
      } else {
        const formData = new FormData();
        formData.append('file', selectedFile);
        if (trackTitle.trim()) formData.append('title', trackTitle.trim());
        if (trackArtist.trim()) formData.append('artist', trackArtist.trim());
        if (customLyrics.trim()) formData.append('custom_lyrics', customLyrics.trim());
        formData.append('created_by', currentUser || 'Friend');

        const res = await apiFetch('/api/upload-track', {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) {
          throw new Error(await readApiError(res, 'Upload failed'));
        }
        const data = await res.json();
        if (onOpenProject && data.project_id) {
          onOpenProject({
            id: data.project_id,
            status: 'queued',
            progress: 5,
            lines: [],
            semitones: 0,
            guide_volume: 0,
          });
        }
      }
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Error uploading audio file');
    } finally {
      setUploadingTrack(false);
    }
  };

  const inputCls =
    'min-h-[44px] w-full rounded-theme-md border border-theme-border-subtle bg-theme-bg px-3.5 py-2.5 text-base text-theme-text placeholder:text-theme-text-muted focus:border-theme-accent focus:outline-none focus:ring-2 focus:ring-theme-focus/60 disabled:opacity-60 sm:text-sm';
  const labelCls = 'mb-1 block text-xs font-semibold text-theme-text-muted';

  return (
    <div id="panel-local">
      <form onSubmit={handleLocalUpload} className="space-y-4">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          data-dragging={isDragging ? 'true' : undefined}
          className={cn(
            'rounded-theme-lg border-2 border-dashed p-4 text-center transition-colors sm:p-6',
            // The file input is visually hidden, so its keyboard focus is shown here
            'has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-theme-focus has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-theme-bg',
            isDragging
              ? 'border-theme-accent bg-theme-accent/10 shadow-theme-glow'
              : selectedFile
                ? 'border-theme-border bg-theme-bg/60'
                : 'border-theme-border-subtle bg-theme-bg/40 hover:border-theme-border hover:bg-theme-bg/70'
          )}
        >
          <input
            type="file"
            id="local-audio-file-input"
            accept=".mp3,.wav,.flac,.m4a,.ogg,.opus,.aac,audio/*"
            onChange={handleFileChange}
            className="sr-only"
            // Names start with the visible text of the label that opens the picker
            aria-label={
              selectedFile
                ? 'Change File: choose local audio file'
                : 'Click to select audio: choose local audio file'
            }
            disabled={isLoading || uploadingTrack}
          />
          {selectedFile ? (
            <div className="flex flex-col items-center justify-between gap-3 text-left sm:flex-row">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-theme-md bg-theme-accent/15 text-theme-highlight">
                  <FileAudio className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-theme-heading text-sm font-semibold text-theme-text">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-theme-text-muted">
                    {formatFileSize(selectedFile.size)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="local-audio-file-input"
                  className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-theme-md border border-theme-border-subtle bg-theme-surface-raised px-3 py-2 font-theme-heading text-xs font-semibold text-theme-text transition-colors hover:border-theme-border md:min-h-[36px]"
                >
                  Change File
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    setTrackTitle('');
                    setTrackArtist('');
                    onError(null);
                  }}
                  aria-label="Remove selected audio file"
                  className={cn(
                    'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-theme-md p-2 text-theme-text-muted transition-colors hover:bg-theme-danger/10 hover:text-theme-danger md:min-h-[36px] md:min-w-[36px]',
                    focusRing
                  )}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <label htmlFor="local-audio-file-input" className="block cursor-pointer space-y-2 py-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-theme-pill bg-gradient-accent text-theme-accent-text shadow-theme-glow">
                <Upload className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <span className="font-theme-heading text-sm font-semibold text-theme-text transition-colors hover:text-theme-highlight">
                  Click to select audio
                </span>
                <span className="text-xs text-theme-text-muted"> or drag and drop here</span>
              </div>
              <p className="text-xs text-theme-text-muted">
                WAV, MP3, FLAC, M4A, OGG, OPUS or AAC · up to 100 MB
              </p>
            </label>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="local-track-title" className={labelCls}>
              Track Title (optional)
            </label>
            <input
              type="text"
              id="local-track-title"
              value={trackTitle}
              onChange={(e) => setTrackTitle(e.target.value)}
              placeholder="e.g. Bohemian Rhapsody"
              aria-label="Track Title"
              className={inputCls}
              disabled={isLoading || uploadingTrack}
            />
          </div>
          <div>
            <label htmlFor="local-track-artist" className={labelCls}>
              Artist Name (optional)
            </label>
            <input
              type="text"
              id="local-track-artist"
              value={trackArtist}
              onChange={(e) => setTrackArtist(e.target.value)}
              placeholder="e.g. Queen"
              aria-label="Artist Name"
              className={inputCls}
              disabled={isLoading || uploadingTrack}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading || uploadingTrack || !selectedFile}
          aria-label={
            uploadingTrack
              ? 'Uploading and Processing Track...'
              : 'Upload & Create Karaoke Project: upload and process local audio track'
          }
          className={cn(
            'flex min-h-[44px] w-full items-center justify-center gap-2 rounded-theme-md bg-gradient-accent px-4 py-3 font-theme-heading text-sm font-semibold text-theme-accent-text shadow-theme-glow transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50',
            focusRing
          )}
        >
          {uploadingTrack ? (
            <>
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-theme-accent-text border-t-transparent"
                role="status"
                aria-label="Uploading"
              ></span>
              <span>Uploading and Processing Track...</span>
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" aria-hidden="true" />
              <span>Upload &amp; Create Karaoke Project</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
};

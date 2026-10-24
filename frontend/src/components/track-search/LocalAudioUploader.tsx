/**
 * Local Audio Uploader Component
 *
 * Provides drag-and-drop dropzone, local file selection, audio format validation,
 * metadata fields (track title & artist), and project creation submission.
 * Fully adapted to application-wide semantic theme tokens across 4 visual dimensions.
 */

import React, { useState } from 'react';
import { Music, Upload, X } from 'lucide-react';
import { ProjectState } from '../../types';
import { apiFetch } from '../../api';

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      onError(null);
      if (!trackTitle.trim()) {
        const defaultTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
        setTrackTitle(defaultTitle);
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setSelectedFile(file);
      onError(null);
      if (!trackTitle.trim()) {
        const defaultTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
        setTrackTitle(defaultTitle);
      }
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
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || 'Upload failed');
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

  return (
    <div id="panel-local" role="tabpanel" aria-labelledby="tab-local" className="font-theme-body">
      <form onSubmit={handleLocalUpload} className="space-y-4">
        {/* File Dropzone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-theme-thick border-dashed rounded-theme-md p-5 sm:p-6 text-center transition-all ${
            isDragging
              ? 'border-theme-accent bg-theme-accent/15 shadow-theme-glow'
              : selectedFile
                ? 'border-theme-border bg-theme-surface shadow-theme-md'
                : 'border-theme-border-subtle hover:border-theme-border bg-theme-surface/70 hover:bg-theme-surface shadow-theme-sm'
          }`}
        >
          <input
            type="file"
            id="local-audio-file-input"
            accept=".mp3,.wav,.flac,.m4a,.ogg,.aac,audio/*"
            onChange={handleFileChange}
            className="sr-only"
            aria-label="Choose local audio file"
            disabled={isLoading || uploadingTrack}
          />
          {selectedFile ? (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-left">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-theme-sm bg-theme-accent/20 border-theme border-theme-accent/30 text-theme-accent flex items-center justify-center shrink-0 shadow-theme-sm">
                  <Music className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-theme-text truncate font-theme-heading">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-theme-text-muted font-theme-body">
                    {formatFileSize(selectedFile.size)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="local-audio-file-input"
                  className="min-h-[44px] px-3 py-2 rounded-theme-sm bg-theme-surface-subtle hover:bg-theme-surface-raised border-theme border-theme-border-subtle text-xs font-semibold text-theme-text cursor-pointer flex items-center justify-center transition-colors shadow-theme-sm font-theme-heading"
                >
                  Change File
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    setTrackTitle('');
                  }}
                  aria-label="Remove selected audio file"
                  className="min-h-[44px] min-w-[44px] p-2 rounded-theme-sm bg-theme-surface-subtle hover:bg-red-950/60 hover:text-red-300 border-theme border-theme-border-subtle hover:border-red-600 text-theme-text-muted flex items-center justify-center transition-colors shadow-theme-sm"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <label htmlFor="local-audio-file-input" className="cursor-pointer block space-y-2 py-4">
              <div className="w-12 h-12 rounded-theme-pill bg-theme-surface-subtle border-theme border-theme-border text-theme-accent flex items-center justify-center mx-auto shadow-theme-sm">
                <Upload className="w-6 h-6" aria-hidden="true" />
              </div>
              <div>
                <span className="text-sm font-semibold text-theme-text hover:text-theme-accent transition-colors font-theme-heading">
                  Click to select audio
                </span>
                <span className="text-xs text-theme-text-muted font-theme-body">
                  {' '}
                  or drag and drop here
                </span>
              </div>
              <p className="text-xs text-theme-text-muted font-theme-body">
                Supported formats: WAV, MP3, FLAC, M4A, OGG, AAC (up to 100MB)
              </p>
            </label>
          )}
        </div>

        {/* Optional Metadata Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="local-track-title"
              className="block text-xs font-medium text-theme-text-muted mb-1 font-theme-body"
            >
              Track Title (optional)
            </label>
            <input
              type="text"
              id="local-track-title"
              value={trackTitle}
              onChange={(e) => setTrackTitle(e.target.value)}
              placeholder="e.g. Bohemian Rhapsody"
              aria-label="Track Title"
              className="w-full px-3.5 py-2.5 rounded-theme-sm bg-theme-surface border-theme border-theme-border-subtle text-theme-text placeholder:text-theme-text-muted text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-theme-border min-h-[44px] shadow-theme-sm font-theme-body"
              disabled={isLoading || uploadingTrack}
            />
          </div>
          <div>
            <label
              htmlFor="local-track-artist"
              className="block text-xs font-medium text-theme-text-muted mb-1 font-theme-body"
            >
              Artist Name (optional)
            </label>
            <input
              type="text"
              id="local-track-artist"
              value={trackArtist}
              onChange={(e) => setTrackArtist(e.target.value)}
              placeholder="e.g. Queen"
              aria-label="Artist Name"
              className="w-full px-3.5 py-2.5 rounded-theme-sm bg-theme-surface border-theme border-theme-border-subtle text-theme-text placeholder:text-theme-text-muted text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-theme-border min-h-[44px] shadow-theme-sm font-theme-body"
              disabled={isLoading || uploadingTrack}
            />
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading || uploadingTrack || !selectedFile}
          aria-label={
            uploadingTrack
              ? 'Uploading and processing audio track...'
              : 'Upload and process local audio track'
          }
          className="w-full min-h-[44px] py-3 px-4 rounded-theme-md bg-theme-accent hover:bg-theme-accent-hover text-theme-accent-text border-theme border-theme-border font-semibold text-sm transition-all shadow-theme-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-theme-heading"
        >
          {uploadingTrack ? (
            <>
              <span
                className="inline-block w-4 h-4 border-2 border-theme-accent-text border-t-transparent rounded-full animate-spin"
                role="status"
                aria-label="Uploading"
              ></span>
              <span>Uploading and Processing Track...</span>
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" aria-hidden="true" />
              <span>Upload &amp; Create Karaoke Project</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
};

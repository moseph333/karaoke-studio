import React, { useState, useEffect } from 'react';
import {
  Search,
  Music,
  Sparkles,
  FileText,
  ChevronDown,
  ChevronUp,
  FolderHeart,
  Globe,
  CheckCircle2,
  Clock,
  Play,
  Pencil,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { SearchResult, ProjectState } from '../types';
import { apiFetch } from '../api';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { EditMetadataModal } from './EditMetadataModal';

export interface UploadTrackParams {
  file: File;
  title?: string;
  artist?: string;
  customLyrics?: string;
  createdBy?: string;
}

interface TrackSearchProps {
  onSelectTrack: (urlOrId: string, customLyrics?: string) => void;
  onUploadTrack?: (params: UploadTrackParams) => Promise<void> | void;
  onOpenProject?: (project: ProjectState) => void;
  isLoading: boolean;
  currentUser?: string;
  authToken?: string;
}

export const TrackSearch: React.FC<TrackSearchProps> = ({
  onSelectTrack,
  onUploadTrack,
  onOpenProject,
  isLoading,
  currentUser = 'Friend',
  authToken = '',
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showCustomLyrics, setShowCustomLyrics] = useState(false);
  const [customLyrics, setCustomLyrics] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Local audio upload state
  const [intakeMode, setIntakeMode] = useState<'youtube' | 'local'>('youtube');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [trackTitle, setTrackTitle] = useState('');
  const [trackArtist, setTrackArtist] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingTrack, setUploadingTrack] = useState(false);

  // Library / existing projects state
  const [libraryProjects, setLibraryProjects] = useState<ProjectState[]>([]);
  const [activeTab, setActiveTab] = useState<'my' | 'community'>('my');
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [deletingProject, setDeletingProject] = useState<ProjectState | null>(null);
  const [editingProject, setEditingProject] = useState<ProjectState | null>(null);

  const handleProjectDeleted = (deletedId: string) => {
    setLibraryProjects((prev) => prev.filter((p) => p.id !== deletedId));
    setDeletingProject(null);
  };

  const handleMetadataSaved = (updated: { id: string; title: string; artist: string }) => {
    setLibraryProjects((prev) =>
      prev.map((p) =>
        p.id === updated.id ? { ...p, title: updated.title, artist: updated.artist } : p
      )
    );
    setEditingProject(null);
  };

  // Fetch recent projects from the studio
  const fetchLibrary = async () => {
    setLoadingLibrary(true);
    try {
      const res = await apiFetch('/api/projects?scope=all');
      if (res.ok) {
        const data: Record<string, ProjectState> = await res.json();
        // Deduplicate projects by ID
        const uniqueMap = new Map<string, ProjectState>();
        Object.values(data).forEach((p) => {
          if (p && p.id && !uniqueMap.has(p.id)) {
            uniqueMap.set(p.id, p);
          }
        });
        setLibraryProjects(Array.from(uniqueMap.values()).reverse());
      }
    } catch (e) {
      console.error('Failed to load project library', e);
    } finally {
      setLoadingLibrary(false);
    }
  };

  useEffect(() => {
    fetchLibrary();
  }, [authToken]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    if (query.includes('youtube.com/') || query.includes('youtu.be/')) {
      onSelectTrack(query.trim(), customLyrics.trim() || undefined);
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const res = await apiFetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), limit: 5 }),
      });
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setResults(data.results || []);
      if (!data.results || data.results.length === 0) {
        setError('No matching tracks found. Try a different title or paste a direct YouTube URL.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error searching YouTube');
    } finally {
      setSearching(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
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
      setError(null);
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
      setError('Please select an audio file to upload.');
      return;
    }

    setUploadingTrack(true);
    setError(null);

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
      setError(err instanceof Error ? err.message : 'Error uploading audio file');
    } finally {
      setUploadingTrack(false);
    }
  };

  const myProjects = libraryProjects.filter(
    (p) => p.created_by && p.created_by.toLowerCase() === currentUser.toLowerCase()
  );
  const displayProjects = activeTab === 'my' ? myProjects : libraryProjects;

  return (
    <div className="max-w-3xl mx-auto py-2 sm:py-8 px-0 sm:px-4 space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/40 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-4">
          <Sparkles className="w-3.5 h-3.5" />
          AI-Powered Karaoke Studio
        </div>
        <h1 className="text-2xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight font-['Montserrat']">
          Turn Any YouTube Song Into Karaoke
        </h1>
        <p className="mt-3 text-sm text-slate-400 max-w-xl mx-auto">
          Word-by-word synchronized highlighting, isolated instrumentals, pitch control, and 1080p60
          YouTube exports.
        </p>
      </div>

      {/* Intake Mode Switcher */}
      <div
        className="flex rounded-xl bg-slate-900/80 p-1 border border-slate-800/80 max-w-sm sm:max-w-md mx-auto"
        role="group"
        aria-label="Track intake mode"
      >
        <button
          type="button"
          id="toggle-youtube-mode"
          aria-pressed={intakeMode === 'youtube'}
          aria-label="YouTube Search"
          onClick={() => {
            setIntakeMode('youtube');
            setError(null);
          }}
          className={`flex-1 min-h-[44px] py-2 px-3 sm:px-4 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
            intakeMode === 'youtube'
              ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Search className="w-4 h-4" aria-hidden="true" />
          <span>YouTube Search</span>
        </button>
        <button
          type="button"
          id="toggle-local-mode"
          aria-pressed={intakeMode === 'local'}
          aria-label="Local Audio File"
          onClick={() => {
            setIntakeMode('local');
            setError(null);
          }}
          className={`flex-1 min-h-[44px] py-2 px-3 sm:px-4 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
            intakeMode === 'local'
              ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Upload className="w-4 h-4" aria-hidden="true" />
          <span>Local Audio File</span>
        </button>
      </div>

      {intakeMode === 'youtube' ? (
        /* Search Input */
        <div id="panel-youtube" role="tabpanel" aria-labelledby="tab-youtube">
          <form onSubmit={handleSearch} className="relative" role="search">
            <div className="relative flex items-center">
              <Search
                className="absolute left-3.5 sm:left-4 w-4 h-4 sm:w-5 sm:h-5 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Paste YouTube or YouTube Music URL or search song title"
                placeholder="Paste YouTube / YouTube Music URL or search song title..."
                className="w-full pl-10 sm:pl-12 pr-24 sm:pr-32 py-3.5 sm:py-4 rounded-xl bg-slate-900/90 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-sm sm:text-base shadow-xl min-h-[48px]"
                disabled={isLoading || searching}
              />
              <button
                type="submit"
                disabled={isLoading || searching || !query.trim()}
                aria-label={searching ? 'Searching YouTube...' : 'Search YouTube or load track'}
                className="absolute right-1.5 sm:right-2.5 min-h-[36px] sm:min-h-[44px] px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-xs sm:text-sm transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 sm:gap-2"
              >
                {searching ? (
                  <span
                    className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
                    role="status"
                    aria-label="Loading"
                  ></span>
                ) : (
                  <>
                    <span className="sm:hidden">Go</span>
                    <span className="hidden sm:inline">Search / Go</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* Local Audio Intake Form */
        <div id="panel-local" role="tabpanel" aria-labelledby="tab-local">
          <form onSubmit={handleLocalUpload} className="space-y-4">
            {/* File Dropzone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-5 sm:p-6 text-center transition-all ${
                isDragging
                  ? 'border-cyan-400 bg-cyan-950/30'
                  : selectedFile
                    ? 'border-cyan-700/60 bg-slate-900/80'
                    : 'border-slate-700/80 hover:border-slate-600 bg-slate-900/60'
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
                    <div className="w-10 h-10 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
                      <Music className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white truncate">
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-slate-400">{formatFileSize(selectedFile.size)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="local-audio-file-input"
                      className="min-h-[44px] px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 cursor-pointer flex items-center justify-center transition-colors"
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
                      className="min-h-[44px] min-w-[44px] p-2 rounded-lg bg-slate-800 hover:bg-red-950/60 hover:text-red-300 text-slate-400 flex items-center justify-center transition-colors"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : (
                <label
                  htmlFor="local-audio-file-input"
                  className="cursor-pointer block space-y-2 py-4"
                >
                  <div className="w-12 h-12 rounded-full bg-cyan-950/60 border border-cyan-800/40 text-cyan-400 flex items-center justify-center mx-auto">
                    <Upload className="w-6 h-6" aria-hidden="true" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-white hover:text-cyan-300 transition-colors">
                      Click to select audio
                    </span>
                    <span className="text-xs text-slate-400"> or drag and drop here</span>
                  </div>
                  <p className="text-xs text-slate-500">
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
                  className="block text-xs font-medium text-slate-400 mb-1"
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
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900/90 border border-slate-700/80 text-white placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 min-h-[44px]"
                  disabled={isLoading || uploadingTrack}
                />
              </div>
              <div>
                <label
                  htmlFor="local-track-artist"
                  className="block text-xs font-medium text-slate-400 mb-1"
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
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900/90 border border-slate-700/80 text-white placeholder-slate-500 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 min-h-[44px]"
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
              className="w-full min-h-[44px] py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-sm transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {uploadingTrack ? (
                <>
                  <span
                    className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
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
      )}

      {/* Optional Custom Lyrics Toggle */}
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowCustomLyrics(!showCustomLyrics)}
          aria-expanded={showCustomLyrics}
          aria-controls="custom-lyrics-panel"
          className="w-full flex items-center justify-between px-4 py-3 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          <span className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-cyan-400" aria-hidden="true" />
            (Optional) Provide custom lyrics text
          </span>
          {showCustomLyrics ? (
            <ChevronUp className="w-4 h-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          )}
        </button>
        {showCustomLyrics && (
          <div id="custom-lyrics-panel" className="p-4 pt-1 border-t border-slate-800/50">
            <textarea
              id="custom-lyrics-textarea"
              aria-label="Custom plain lyrics text"
              value={customLyrics}
              onChange={(e) => setCustomLyrics(e.target.value)}
              placeholder="Paste line-by-line lyrics here. If left blank, synchronized lyrics are queried automatically from LRCLIB."
              rows={4}
              className="w-full p-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/50 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Search Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-1">
            Search Results
          </h3>
          {results.map((track) => (
            <div
              key={track.id}
              onClick={() => onSelectTrack(track.url, customLyrics.trim() || undefined)}
              className="group flex items-center justify-between p-2.5 sm:p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-cyan-500/50 hover:bg-slate-800/60 transition-all cursor-pointer shadow-md gap-2"
            >
              <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 flex-1">
                {track.thumbnail ? (
                  <img
                    src={track.thumbnail}
                    alt={track.title}
                    className="w-12 h-10 sm:w-16 sm:h-12 object-cover rounded-lg shrink-0 shadow"
                  />
                ) : (
                  <div className="w-12 h-10 sm:w-16 sm:h-12 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                    <Music className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" />
                  </div>
                )}
                <div className="truncate flex-1 min-w-0">
                  <h4 className="text-xs sm:text-sm font-semibold text-white group-hover:text-cyan-300 truncate transition-colors">
                    {track.title}
                  </h4>
                  <p className="text-[11px] sm:text-xs text-slate-400 truncate mt-0.5">
                    {track.artist} {track.duration ? `• ${formatDuration(track.duration)}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Create Karaoke"
                className="shrink-0 ml-2 sm:ml-4 px-2.5 sm:px-3.5 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-500 group-hover:text-slate-950 font-medium text-[11px] sm:text-xs transition-all border border-cyan-500/30 min-h-[36px] flex items-center justify-center"
              >
                <span className="sm:hidden">Create</span>
                <span className="hidden sm:inline">Create Karaoke</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Studio Library / Recent Songs */}
      <div className="pt-4 border-t border-slate-800/80 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            className="flex items-center gap-1.5 sm:gap-2 flex-wrap"
            role="tablist"
            aria-label="Song library filters"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'my'}
              aria-label={`My Songs (${myProjects.length})`}
              onClick={() => setActiveTab('my')}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors min-h-[36px] ${
                activeTab === 'my'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <FolderHeart className="w-3.5 h-3.5" aria-hidden="true" />
              My Songs ({myProjects.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'community'}
              aria-label={`Community Library (${libraryProjects.length})`}
              onClick={() => setActiveTab('community')}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors min-h-[36px] ${
                activeTab === 'community'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Globe className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden xs:inline sm:inline">Community </span>Library (
              {libraryProjects.length})
            </button>
          </div>
          <button
            type="button"
            onClick={fetchLibrary}
            className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors py-1 px-2 min-h-[36px] flex items-center"
          >
            Refresh
          </button>
        </div>

        {loadingLibrary ? (
          <div className="py-8 text-center text-xs text-slate-500">Loading library tracks...</div>
        ) : displayProjects.length === 0 ? (
          <div className="py-8 text-center rounded-xl bg-slate-900/30 border border-slate-800/50 p-6 space-y-1">
            <p className="text-xs text-slate-400">
              {activeTab === 'my'
                ? `No songs created yet by "${currentUser}". Search a song above to generate your first track!`
                : 'No tracks in the studio library yet.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {displayProjects.map((p) => {
              const isReady = p.status === 'ready';
              return (
                <div
                  key={p.id}
                  onClick={() => onOpenProject && onOpenProject(p)}
                  className="group flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-cyan-500/50 hover:bg-slate-800/50 transition-all cursor-pointer shadow min-h-[64px]"
                >
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                    {p.thumbnail_url ? (
                      <img
                        src={p.thumbnail_url}
                        alt={p.title || 'Track'}
                        className="w-12 h-12 sm:w-14 sm:h-14 object-cover rounded-lg shrink-0 shadow"
                      />
                    ) : (
                      <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                        <Music className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" />
                      </div>
                    )}

                    <div className="truncate flex-1 min-w-0">
                      <h4 className="text-xs font-semibold text-white group-hover:text-cyan-300 truncate transition-colors">
                        {p.title || `Track ${p.id}`}
                      </h4>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        {p.artist || 'Karaoke'}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            isReady
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                          }`}
                        >
                          {isReady ? (
                            <CheckCircle2 className="w-2.5 h-2.5" />
                          ) : (
                            <Clock className="w-2.5 h-2.5" />
                          )}
                          {isReady ? 'Ready' : p.status}
                        </span>
                        {p.created_by && (
                          <span className="text-[10px] text-slate-500 truncate">
                            by {p.created_by}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-1.5 shrink-0 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingProject(p);
                      }}
                      aria-label={`Edit metadata for ${p.title || p.id}`}
                      title="Edit song title and artist"
                      className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl bg-slate-800/70 hover:bg-slate-700 text-slate-400 hover:text-cyan-300 transition-colors flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                      <Pencil className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingProject(p);
                      }}
                      aria-label={`Delete project ${p.title || p.id}`}
                      title="Delete project"
                      className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl bg-slate-800/70 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 transition-colors flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-rose-500"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <div
                      aria-hidden="true"
                      className="shrink-0 p-2.5 rounded-xl bg-slate-800/60 text-slate-400 group-hover:bg-cyan-500 group-hover:text-slate-950 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                    >
                      <Play className="w-4 h-4 fill-current" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <DeleteConfirmModal
        isOpen={Boolean(deletingProject)}
        projectId={deletingProject?.id || ''}
        projectTitle={deletingProject?.title || ''}
        projectArtist={deletingProject?.artist}
        onClose={() => setDeletingProject(null)}
        onDeleted={handleProjectDeleted}
      />

      <EditMetadataModal
        isOpen={Boolean(editingProject)}
        project={
          editingProject
            ? {
                id: editingProject.id,
                title: editingProject.title || '',
                artist: editingProject.artist || '',
              }
            : null
        }
        onClose={() => setEditingProject(null)}
        onSaved={handleMetadataSaved}
      />
    </div>
  );
};

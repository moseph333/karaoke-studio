/**
 * Track Search Component
 *
 * Primary intake screen offering YouTube URL/title search, local audio intake,
 * optional custom lyrics input, search results browsing, and project library management.
 * Fully adapted to application-wide semantic theme tokens across 4 visual dimensions.
 */

import React, { useState } from 'react';
import { Search, Music, Sparkles, FileText, ChevronDown, ChevronUp, Upload, X } from 'lucide-react';
import { SearchResult, ProjectState } from '../types';
import { apiFetch } from '../api';
import { LocalAudioUploader, type UploadTrackParams } from './track-search/LocalAudioUploader';
import { ProjectLibrary } from './track-search/ProjectLibrary';

export type { UploadTrackParams };

export interface TrackSearchProps {
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
  const [intakeMode, setIntakeMode] = useState<'youtube' | 'local'>('youtube');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    if (trimmed.includes('youtube.com/') || trimmed.includes('youtu.be/')) {
      onSelectTrack(trimmed, customLyrics.trim() || undefined);
      return;
    }

    const isNonYoutubeUrl =
      /^https?:\/\//i.test(trimmed) ||
      /^www\./i.test(trimmed) ||
      /(?:soundcloud\.com|spotify\.com|vimeo\.com|bandcamp\.com|apple\.com|deezer\.com|audiomack\.com|tidal\.com|music\.apple\.com)/i.test(
        trimmed
      );

    if (isNonYoutubeUrl) {
      setError(
        'Direct URL import currently supports YouTube and YouTube Music links. For other platforms, please download the audio file and use the Local Audio File tab.'
      );
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

  return (
    <div className="max-w-3xl mx-auto py-2 sm:py-8 px-0 sm:px-4 space-y-6 sm:space-y-8 font-theme-body text-theme-text">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-theme-pill bg-theme-surface-subtle border-theme border-theme-border-subtle text-theme-accent text-xs font-semibold uppercase tracking-wider mb-4 shadow-theme-sm font-theme-heading">
          <Sparkles className="w-3.5 h-3.5 text-theme-accent" />
          AI-Powered Karaoke Studio
        </div>
        <h1 className="text-2xl sm:text-4xl md:text-5xl font-extrabold text-theme-text tracking-tight font-theme-heading">
          Turn Any YouTube Song Into Karaoke
        </h1>
        <p className="mt-3 text-sm text-theme-text-muted max-w-xl mx-auto font-theme-body">
          Word-by-word synchronized highlighting, isolated instrumentals, pitch control, and 1080p60
          YouTube exports.
        </p>
      </div>

      {/* Intake Mode Switcher */}
      <div
        className="flex rounded-theme-lg bg-theme-surface p-1 border-theme border-theme-border-subtle max-w-sm sm:max-w-md mx-auto shadow-theme-sm"
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
          className={`flex-1 min-h-[44px] py-2 px-3 sm:px-4 rounded-theme-md text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 font-theme-heading ${
            intakeMode === 'youtube'
              ? 'bg-theme-accent text-theme-accent-text shadow-theme-sm border-theme border-theme-border'
              : 'text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-subtle/60 border-theme border-transparent'
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
          className={`flex-1 min-h-[44px] py-2 px-3 sm:px-4 rounded-theme-md text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 font-theme-heading ${
            intakeMode === 'local'
              ? 'bg-theme-accent text-theme-accent-text shadow-theme-sm border-theme border-theme-border'
              : 'text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-subtle/60 border-theme border-transparent'
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
                className="absolute left-3.5 sm:left-4 w-4 h-4 sm:w-5 sm:h-5 text-theme-text-muted pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Paste YouTube or YouTube Music URL or search song title"
                placeholder="Paste YouTube / YouTube Music URL or search song title..."
                className="w-full pl-10 sm:pl-12 pr-24 sm:pr-32 py-3.5 sm:py-4 rounded-theme-md bg-theme-surface border-theme border-theme-border-subtle text-theme-text placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-accent focus:border-theme-border text-sm sm:text-base shadow-theme-md min-h-[48px] font-theme-body"
                disabled={isLoading || searching}
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setError(null);
                  }}
                  aria-label="Clear search query"
                  className="absolute right-14 sm:right-28 min-h-[32px] min-w-[32px] p-1.5 rounded-full text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-subtle transition-colors flex items-center justify-center focus:outline-none focus:ring-1 focus:ring-theme-accent"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="submit"
                disabled={isLoading || searching || !query.trim()}
                aria-label={searching ? 'Searching YouTube...' : 'Search YouTube or load track'}
                className="absolute right-1.5 sm:right-2.5 min-h-[36px] sm:min-h-[44px] px-3 sm:px-5 py-2 sm:py-2.5 rounded-theme-sm bg-theme-accent hover:bg-theme-accent-hover text-theme-accent-text font-semibold text-xs sm:text-sm transition-all shadow-theme-sm border-theme border-theme-border disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 sm:gap-2 font-theme-heading"
              >
                {searching ? (
                  <span
                    className="inline-block w-4 h-4 border-2 border-theme-accent-text border-t-transparent rounded-full animate-spin"
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
        <LocalAudioUploader
          isLoading={isLoading}
          currentUser={currentUser}
          customLyrics={customLyrics}
          onUploadTrack={onUploadTrack}
          onOpenProject={onOpenProject}
          onError={setError}
        />
      )}

      {/* Optional Custom Lyrics Toggle */}
      <div className="bg-theme-surface-subtle/50 border-theme border-theme-border-subtle rounded-theme-md overflow-hidden shadow-theme-sm">
        <button
          type="button"
          onClick={() => setShowCustomLyrics(!showCustomLyrics)}
          aria-expanded={showCustomLyrics}
          aria-controls="custom-lyrics-panel"
          className="w-full flex items-center justify-between px-4 py-3 text-xs text-theme-text-muted hover:text-theme-text transition-colors min-h-[44px] font-theme-body"
        >
          <span className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-theme-accent" aria-hidden="true" />
            (Optional) Provide custom lyrics text
          </span>
          {showCustomLyrics ? (
            <ChevronUp className="w-4 h-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          )}
        </button>
        {showCustomLyrics && (
          <div id="custom-lyrics-panel" className="p-4 pt-1 border-t border-theme-border-subtle">
            <textarea
              id="custom-lyrics-textarea"
              aria-label="Custom plain lyrics text"
              value={customLyrics}
              onChange={(e) => setCustomLyrics(e.target.value)}
              placeholder="Paste line-by-line lyrics here. If left blank, synchronized lyrics are queried automatically from LRCLIB."
              rows={4}
              className="w-full p-3 rounded-theme-sm bg-theme-bg border-theme border-theme-border-subtle text-theme-text placeholder:text-theme-text-muted text-xs focus:outline-none focus:ring-1 focus:ring-theme-accent font-mono shadow-inner"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-theme-md bg-red-950/40 border-theme border-red-800/60 text-red-300 text-sm shadow-theme-sm font-theme-body">
          {error}
        </div>
      )}

      {/* Search Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted font-theme-heading">
              Search Results
            </h3>
            <button
              type="button"
              onClick={() => {
                setResults([]);
                setError(null);
              }}
              aria-label="Clear search results"
              className="text-xs text-theme-text-muted hover:text-theme-text hover:underline transition-colors font-theme-body flex items-center gap-1 cursor-pointer min-h-[32px] px-2 py-1 rounded-theme-sm hover:bg-theme-surface-subtle"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Clear Results</span>
            </button>
          </div>
          {results.map((track) => (
            <div
              key={track.id}
              onClick={() => onSelectTrack(track.url, customLyrics.trim() || undefined)}
              className="group flex items-center justify-between p-2.5 sm:p-3.5 rounded-theme-md bg-theme-surface border-theme border-theme-border-subtle hover:border-theme-border hover:bg-theme-surface-subtle transition-all cursor-pointer shadow-theme-md gap-2"
            >
              <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0 flex-1">
                {track.thumbnail ? (
                  <img
                    src={track.thumbnail}
                    alt={track.title}
                    className="w-12 h-10 sm:w-16 sm:h-12 object-cover rounded-theme-sm shrink-0 shadow-theme-sm border-theme border-theme-border-subtle"
                  />
                ) : (
                  <div className="w-12 h-10 sm:w-16 sm:h-12 rounded-theme-sm bg-theme-surface-subtle border-theme border-theme-border-subtle flex items-center justify-center shrink-0">
                    <Music className="w-4 h-4 sm:w-5 sm:h-5 text-theme-text-muted" />
                  </div>
                )}
                <div className="truncate flex-1 min-w-0">
                  <h4 className="text-xs sm:text-sm font-semibold text-theme-text group-hover:text-theme-accent truncate transition-colors font-theme-heading">
                    {track.title}
                  </h4>
                  <p className="text-[11px] sm:text-xs text-theme-text-muted truncate mt-0.5 font-theme-body">
                    {track.artist} {track.duration ? `• ${formatDuration(track.duration)}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Create Karaoke"
                className="shrink-0 ml-2 sm:ml-4 px-2.5 sm:px-3.5 py-1.5 rounded-theme-sm bg-theme-accent/15 text-theme-accent group-hover:bg-theme-accent group-hover:text-theme-accent-text font-semibold text-[11px] sm:text-xs transition-all border-theme border-theme-accent/40 group-hover:border-theme-border min-h-[36px] flex items-center justify-center shadow-theme-sm font-theme-heading"
              >
                <span className="sm:hidden">Create</span>
                <span className="hidden sm:inline">Create Karaoke</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Studio Library / Recent Songs */}
      <ProjectLibrary
        currentUser={currentUser}
        authToken={authToken}
        onOpenProject={onOpenProject}
      />
    </div>
  );
};

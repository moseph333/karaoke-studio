/**
 * Track Search Component
 *
 * Primary intake screen offering YouTube URL/title search, local audio intake,
 * optional custom lyrics input, search results browsing, and project library management.
 */

import React, { useState } from 'react';
import { Search, Music, Sparkles, FileText, ChevronDown, ChevronUp, Upload } from 'lucide-react';
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
      <ProjectLibrary
        currentUser={currentUser}
        authToken={authToken}
        onOpenProject={onOpenProject}
      />
    </div>
  );
};

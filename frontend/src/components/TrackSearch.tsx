/**
 * Track Search Component
 *
 * The home screen: a hero intake card (YouTube link/search or local upload, with
 * advanced options such as custom lyrics), search results, and the song library.
 */

import React, { useId, useState } from 'react';
import {
  ChevronDown,
  FileText,
  Music,
  Search,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { SearchResult, ProjectState } from '../types';
import { apiFetch } from '../api';
import { LocalAudioUploader, type UploadTrackParams } from './track-search/LocalAudioUploader';
import { ProjectLibrary } from './track-search/ProjectLibrary';
import { SegmentedControl } from './ui/SegmentedControl';
import { focusRing } from './ui/variants';
import { cn } from '../utils/cn';
import { formatTime } from '../utils/format';

export type { UploadTrackParams };

export interface TrackSearchProps {
  onSelectTrack: (urlOrId: string, customLyrics?: string) => void;
  onUploadTrack?: (params: UploadTrackParams) => Promise<void> | void;
  onOpenProject?: (project: ProjectState) => void;
  isLoading: boolean;
  currentUser?: string;
  authToken?: string;
}

type IntakeMode = 'youtube' | 'local';

const NON_YOUTUBE_HOSTS =
  /(?:soundcloud\.com|spotify\.com|vimeo\.com|bandcamp\.com|apple\.com|deezer\.com|audiomack\.com|tidal\.com|music\.apple\.com)/i;

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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customLyrics, setCustomLyrics] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [intakeMode, setIntakeMode] = useState<IntakeMode>('youtube');
  const advancedHintId = useId();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    if (trimmed.includes('youtube.com/') || trimmed.includes('youtu.be/')) {
      onSelectTrack(trimmed, customLyrics.trim() || undefined);
      return;
    }

    const isNonYoutubeUrl =
      /^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed) || NON_YOUTUBE_HOSTS.test(trimmed);

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

  const customLyricsCount = customLyrics.trim()
    ? customLyrics.trim().split(/\n+/).filter(Boolean).length
    : 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 font-theme-body text-theme-text sm:space-y-10">
      <div className="mx-auto w-full max-w-3xl px-0 py-2 sm:px-4 sm:py-6">
        <div className="relative overflow-hidden rounded-theme-xl border border-theme-border-subtle bg-theme-surface p-4 shadow-theme-lg sm:p-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-stage opacity-70"
          />
          <div className="relative space-y-5 sm:space-y-6">
            <div className="space-y-2 text-center sm:space-y-3">
              <span className="inline-flex items-center gap-1.5 rounded-theme-pill border border-theme-accent/40 bg-theme-accent/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-theme-highlight">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                AI karaoke studio
              </span>
              <h1 className="font-theme-heading text-2xl font-extrabold tracking-tight text-theme-text sm:text-4xl md:text-5xl">
                Turn Any YouTube Song Into Karaoke
              </h1>
              <p className="mx-auto max-w-xl text-sm text-theme-text-muted">
                Paste a link or upload your own audio. You get word-synced lyrics, a clean
                instrumental, key control and 1080p video exports.
              </p>
            </div>

            <SegmentedControl<IntakeMode>
              ariaLabel="Track intake mode"
              value={intakeMode}
              onChange={(mode) => {
                setIntakeMode(mode);
                setError(null);
              }}
              fullWidth
              className="mx-auto max-w-md"
              options={[
                {
                  value: 'youtube',
                  id: 'toggle-youtube-mode',
                  ariaLabel: 'YouTube Search',
                  icon: <Search className="h-4 w-4" aria-hidden="true" />,
                  label: <span>YouTube Search</span>,
                },
                {
                  value: 'local',
                  id: 'toggle-local-mode',
                  ariaLabel: 'Local Audio File',
                  icon: <Upload className="h-4 w-4" aria-hidden="true" />,
                  label: <span>Local Audio File</span>,
                },
              ]}
            />

            {intakeMode === 'youtube' ? (
              <div id="panel-youtube">
                <form onSubmit={handleSearch} className="relative" role="search">
                  <div className="relative flex items-center">
                    <Search
                      className="pointer-events-none absolute left-3.5 h-4 w-4 text-theme-text-muted sm:left-4 sm:h-5 sm:w-5"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      aria-label="Paste YouTube or YouTube Music URL or search song title"
                      placeholder="Paste YouTube / YouTube Music URL or search song title..."
                      className="min-h-[48px] w-full rounded-theme-lg border border-theme-border bg-theme-bg py-3.5 pl-10 pr-24 text-base text-theme-text shadow-theme-sm placeholder:text-theme-text-muted focus:border-theme-accent focus:outline-none focus:ring-2 focus:ring-theme-focus/60 sm:py-4 sm:pl-12 sm:pr-32"
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
                        className={cn(
                          'absolute right-14 flex min-h-[32px] min-w-[32px] items-center justify-center rounded-full p-1.5 text-theme-text-muted transition-colors hover:bg-theme-surface-subtle hover:text-theme-text sm:right-32',
                          focusRing
                        )}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      type="submit"
                      disabled={isLoading || searching || !query.trim()}
                      aria-label={
                        searching ? 'Searching YouTube...' : 'Search YouTube or load track'
                      }
                      className={cn(
                        'absolute right-1.5 flex min-h-[36px] items-center justify-center gap-1.5 rounded-theme-md bg-gradient-accent px-3 py-2 font-theme-heading text-xs font-semibold text-theme-accent-text shadow-theme-glow transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:right-2 sm:min-h-[44px] sm:gap-2 sm:px-5 sm:text-sm',
                        focusRing
                      )}
                    >
                      {searching ? (
                        <span
                          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-theme-accent-text border-t-transparent"
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
              <LocalAudioUploader
                isLoading={isLoading}
                currentUser={currentUser}
                customLyrics={customLyrics}
                onUploadTrack={onUploadTrack}
                onOpenProject={onOpenProject}
                onError={setError}
              />
            )}

            <div className="rounded-theme-lg border border-theme-border-subtle bg-theme-surface-subtle/60">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                aria-expanded={showAdvanced}
                aria-controls="custom-lyrics-panel"
                aria-label="Advanced options"
                aria-describedby={advancedHintId}
                className={cn(
                  'flex min-h-[44px] w-full items-center justify-between gap-3 rounded-theme-lg px-4 py-2.5 text-left text-sm font-semibold text-theme-text transition-colors hover:bg-theme-surface-subtle',
                  focusRing
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <SlidersHorizontal
                    className="h-4 w-4 shrink-0 text-theme-highlight"
                    aria-hidden="true"
                  />
                  Advanced options
                </span>
                <span className="flex items-center gap-2 text-xs font-medium text-theme-text-muted">
                  <span id={advancedHintId} className="truncate">
                    {customLyricsCount > 0
                      ? `Custom lyrics · ${customLyricsCount} ${customLyricsCount === 1 ? 'line' : 'lines'}`
                      : 'Custom lyrics'}
                  </span>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 transition-transform',
                      showAdvanced && 'rotate-180'
                    )}
                    aria-hidden="true"
                  />
                </span>
              </button>
              {showAdvanced && (
                <div
                  id="custom-lyrics-panel"
                  className="space-y-2 border-t border-theme-border-subtle px-4 pb-4 pt-3"
                >
                  <label
                    htmlFor="custom-lyrics-textarea"
                    className="flex items-center gap-1.5 text-xs font-semibold text-theme-text"
                  >
                    <FileText className="h-3.5 w-3.5 text-theme-text-muted" aria-hidden="true" />
                    Custom lyrics (optional)
                  </label>
                  <textarea
                    id="custom-lyrics-textarea"
                    aria-label="Custom plain lyrics text"
                    value={customLyrics}
                    onChange={(e) => setCustomLyrics(e.target.value)}
                    placeholder="Paste line-by-line lyrics here. If left blank, synchronized lyrics are queried automatically from LRCLIB."
                    rows={4}
                    className="w-full rounded-theme-md border border-theme-border-subtle bg-theme-bg p-3 font-mono text-base text-theme-text placeholder:text-theme-text-muted focus:border-theme-accent focus:outline-none focus:ring-2 focus:ring-theme-focus/60 sm:text-xs"
                  />
                  <p className="text-[11px] text-theme-text-muted">
                    One lyric line per row. Words are timed automatically against the vocals.
                  </p>
                </div>
              )}
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-theme-md border border-theme-danger/40 bg-theme-danger/10 p-3.5 text-sm text-theme-danger"
              >
                {error}
              </div>
            )}
          </div>
        </div>
      </div>

      {results.length > 0 && (
        <div className="mx-auto w-full max-w-3xl space-y-2.5 sm:px-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="font-theme-heading text-xs font-semibold uppercase tracking-wider text-theme-text-muted">
              Search Results
            </h3>
            <button
              type="button"
              onClick={() => {
                setResults([]);
                setError(null);
              }}
              aria-label="Clear search results"
              className={cn(
                'flex min-h-[32px] cursor-pointer items-center gap-1 rounded-theme-sm px-2 py-1 text-xs text-theme-text-muted transition-colors hover:bg-theme-surface-subtle hover:text-theme-text',
                focusRing
              )}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Clear Results</span>
            </button>
          </div>
          {results.map((track) => (
            <div
              key={track.id}
              onClick={() => onSelectTrack(track.url, customLyrics.trim() || undefined)}
              className="group flex cursor-pointer items-center justify-between gap-2 rounded-theme-lg border border-theme-border-subtle bg-theme-surface p-2.5 shadow-theme-sm transition-colors hover:border-theme-border hover:bg-theme-surface-subtle sm:p-3"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {track.thumbnail ? (
                  <img
                    src={track.thumbnail}
                    alt={track.title}
                    className="h-11 w-16 shrink-0 rounded-theme-sm object-cover sm:h-12 sm:w-20"
                  />
                ) : (
                  <div className="flex h-11 w-16 shrink-0 items-center justify-center rounded-theme-sm bg-theme-surface-raised sm:h-12 sm:w-20">
                    <Music className="h-5 w-5 text-theme-text-muted" aria-hidden="true" />
                  </div>
                )}
                <div className="min-w-0 flex-1 truncate">
                  <h4 className="truncate font-theme-heading text-sm font-semibold text-theme-text transition-colors group-hover:text-theme-highlight">
                    {track.title}
                  </h4>
                  <p className="mt-0.5 truncate text-xs text-theme-text-muted">
                    {track.artist} {track.duration ? `• ${formatTime(track.duration)}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Create Karaoke"
                className={cn(
                  'ml-2 flex min-h-[36px] shrink-0 items-center justify-center rounded-theme-md border border-theme-accent/40 bg-theme-accent/15 px-3 font-theme-heading text-xs font-semibold text-theme-highlight transition-colors group-hover:border-transparent group-hover:bg-gradient-accent group-hover:text-theme-accent-text sm:ml-4 sm:px-3.5',
                  focusRing
                )}
              >
                <span className="sm:hidden">Create</span>
                <span className="hidden sm:inline">Create Karaoke</span>
              </button>
            </div>
          ))}
        </div>
      )}

      <ProjectLibrary
        currentUser={currentUser}
        authToken={authToken}
        onOpenProject={onOpenProject}
      />
    </div>
  );
};

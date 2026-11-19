/**
 * Track Search Component
 *
 * The home screen: a hero with the intake card beside a self-playing lyric preview, three
 * "how it works" steps for visitors who have not made a song yet, and the song library.
 *
 * The intake card takes a song three ways. Typed words are searched as the typing pauses
 * (`useSongSearch`): songs from the music catalogs, listed under the box with a preview of
 * each (`track-search/SongSearchResults`), and YouTube uploads on request. A song link
 * (YouTube, SoundCloud, Bandcamp, Vimeo, the Internet Archive; Spotify, Apple Music, TIDAL
 * or Deezer, found on YouTube) starts at once. Or an audio file is uploaded. Advanced
 * options hold the stem separation quality and custom lyrics.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AudioLines,
  Captions,
  ChevronDown,
  Clapperboard,
  FileText,
  Link2,
  MicOff,
  MicVocal,
  Music2,
  Search,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { SearchResult, ProjectState, SeparationPreset } from '../types';
import { LocalAudioUploader, type UploadTrackParams } from './track-search/LocalAudioUploader';
import { ProjectLibrary, type LibraryCounts } from './track-search/ProjectLibrary';
import { HeroStageDemo } from './track-search/HeroStageDemo';
import { SongSearchResults } from './track-search/SongSearchResults';
import { SeparationQualityPicker } from './quality/SeparationQualityPicker';
import { SegmentedControl } from './ui/SegmentedControl';
import { focusRing } from './ui/variants';
import { cn } from '../utils/cn';
import { SUPPORTED_SITES_SENTENCE, linkSite, looksLikeLink } from '../utils/mediaLinks';
import { PRESET_NAMES, defaultPreset } from '../utils/quality';
import { useCapabilities } from '../hooks/useCapabilities';
import { useSongSearch } from '../hooks/useSongSearch';
import { useSongPreview } from '../hooks/useSongPreview';

export type { UploadTrackParams };

export interface TrackSearchProps {
  onSelectTrack: (urlOrId: string, customLyrics?: string) => void;
  onUploadTrack?: (params: UploadTrackParams) => Promise<void> | void;
  onOpenProject?: (project: ProjectState) => void;
  isLoading: boolean;
  currentUser?: string;
  authToken?: string;
  /** Stem separation quality for new songs; null uses the server's default. */
  separationQuality?: SeparationPreset | null;
  /** Shows the quality picker in Advanced options. */
  onSeparationQualityChange?: (preset: SeparationPreset) => void;
  /** Pre-filled search text, e.g. a YouTube link shared into the installed app. It is never
   * submitted automatically. */
  initialQuery?: string;
  /** The intake tab to open on, e.g. the upload tab for the "Upload audio" app shortcut. */
  initialMode?: IntakeMode;
  /** Puts keyboard focus in the song search, for the "New song" app shortcut. */
  focusSearch?: boolean;
  /** The library song being fetched in full after its card was chosen. */
  openingProjectId?: string | null;
}

export type IntakeMode = 'youtube' | 'local';

/** What a finished song gives you, under the intake card. */
const HIGHLIGHTS: Array<{ Icon: LucideIcon; label: string }> = [
  { Icon: Captions, label: 'Word-by-word lyrics' },
  { Icon: MicOff, label: 'Vocals removed' },
  { Icon: Music2, label: 'Any key' },
  { Icon: Clapperboard, label: '1080p video export' },
];

const STEPS: Array<{ Icon: LucideIcon; title: string; text: string }> = [
  {
    Icon: Link2,
    title: 'Pick a song',
    text: 'Search for it by name, paste a link, or upload an audio file of your own.',
  },
  {
    Icon: AudioLines,
    title: 'The studio does the work',
    text: 'The vocals are lifted off the music and every word is timed to the singing. Most songs take a few minutes; the best stem quality and a server’s first song take longer.',
  },
  {
    Icon: MicVocal,
    title: 'Sing it or share it',
    text: 'Sing along on the live stage, change the key, adjust any timing, and export a karaoke video.',
  },
];

/** Remembers that this browser has songs of its own, so the first-visit extras stay away. */
const HAS_SONGS_KEY = 'karaoke_has_songs';

function readHasSongs(): boolean {
  try {
    return localStorage.getItem(HAS_SONGS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Shown for a link to a site the intake cannot download from (Spotify, Apple Music, …). */
export const UNSUPPORTED_LINK_MESSAGE = `Links from ${SUPPORTED_SITES_SENTENCE} work here. For another site, download the audio file and add it under Local Audio File.`;

export const TrackSearch: React.FC<TrackSearchProps> = ({
  onSelectTrack,
  onUploadTrack,
  onOpenProject,
  isLoading,
  currentUser = 'Friend',
  authToken = '',
  separationQuality = null,
  onSeparationQualityChange,
  initialQuery = '',
  initialMode = 'youtube',
  focusSearch = false,
  openingProjectId = null,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customLyrics, setCustomLyrics] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [intakeMode, setIntakeMode] = useState<IntakeMode>(initialMode);
  const advancedHintId = useId();
  const linkHintId = useId();
  const submitRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const resultsId = useId();
  // Typed words are searched as the typing pauses; a link is not searched at all
  const search = useSongSearch(query, intakeMode === 'youtube');
  const preview = useSongPreview();
  const showResults =
    intakeMode === 'youtube' && (search.phase !== 'idle' || search.videosPhase !== 'idle');
  const isLink = Boolean(linkSite(query.trim()));
  // First visit (no songs of their own yet): show how it works, and keep the lyric preview
  // on phones too. Decided once, from what this browser remembered, and not changed when
  // the library answers: taking those sections away then would make the page jump. The
  // answer is stored for the next time the home screen opens.
  const [hasOwnSongs] = useState(readHasSongs);
  const handleLibraryCounts = useCallback(({ mine }: LibraryCounts) => {
    try {
      if (mine > 0) localStorage.setItem(HAS_SONGS_KEY, '1');
      else localStorage.removeItem(HAS_SONGS_KEY);
    } catch {
      // Storage is unavailable: every visit looks like a first one
    }
  }, []);

  // A shared link arrives pre-filled: put focus on Go so one tap (or Enter) starts it
  useEffect(() => {
    if (initialQuery) submitRef.current?.focus({ preventScroll: true });
    else if (focusSearch) searchInputRef.current?.focus({ preventScroll: true });
  }, [initialQuery, focusSearch]);
  // Asked only once the picker is on screen
  const capabilities = useCapabilities(showAdvanced && Boolean(onSeparationQualityChange));

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || isLoading) return;

    // A song link from a supported site starts at once; the server checks it is one song
    if (linkSite(trimmed)) {
      setError(null);
      onSelectTrack(trimmed, customLyrics.trim() || undefined);
      return;
    }

    if (looksLikeLink(trimmed)) {
      setError(UNSUPPORTED_LINK_MESSAGE);
      return;
    }

    setError(null);
    search.submit();
  };

  const createFromResult = (result: SearchResult) => {
    onSelectTrack(result.url, customLyrics.trim() || undefined);
  };

  // A result that is already in the library opens that song; the app fetches it in full
  const openFromResult = (projectId: string, status: string) => {
    if (!onOpenProject) return;
    onOpenProject({
      id: projectId,
      status: status as ProjectState['status'],
      progress: 0,
      lines: [],
      semitones: 0,
      guide_volume: 0,
      summary: true,
    });
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && showResults) {
      const first = resultsRef.current?.querySelector<HTMLButtonElement>('[data-result-primary]');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === 'Escape' && showResults) {
      e.preventDefault();
      preview.stop();
      search.clear();
    }
  };

  const customLyricsCount = customLyrics.trim()
    ? customLyrics.trim().split(/\n+/).filter(Boolean).length
    : 0;
  const advancedHint = [
    separationQuality ? `${PRESET_NAMES[separationQuality]} stems` : null,
    customLyricsCount > 0
      ? `Custom lyrics · ${customLyricsCount} ${customLyricsCount === 1 ? 'line' : 'lines'}`
      : 'Custom lyrics',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="relative isolate mx-auto w-full max-w-6xl space-y-8 font-theme-body text-theme-text sm:space-y-12">
      {/* Soft light behind the hero (hidden by the flat themes, see index.css) */}
      <div
        aria-hidden="true"
        className="ks-aurora pointer-events-none absolute -top-28 left-1/2 -z-10 h-[38rem] w-[min(100vw,84rem)] -translate-x-1/2 opacity-70"
      />

      <section className="grid items-center gap-8 pt-1 sm:px-4 sm:pt-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-12 lg:pt-4">
        {/* Not faded in: this is the page's main content, and it should count as painted the
            moment it appears */}
        <div className="min-w-0 space-y-5 sm:space-y-6">
          <div className="space-y-3 text-center sm:space-y-4 lg:text-left">
            <span className="inline-flex items-center gap-1.5 rounded-theme-pill border border-theme-accent/40 bg-theme-accent/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-theme-highlight">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              AI karaoke studio
            </span>
            <h1
              tabIndex={-1}
              data-view-heading
              className="text-balance font-theme-heading text-3xl font-extrabold leading-[1.08] tracking-tight text-theme-text focus:outline-none sm:text-5xl lg:text-[3.4rem]"
            >
              Turn Any Song Into <span className="ks-text-gradient">Karaoke</span>
            </h1>
            {/* The pitch is for first visits; on a phone, someone with songs gets to them sooner */}
            <p
              className={cn(
                'mx-auto max-w-xl text-pretty text-sm text-theme-text-muted sm:text-base lg:mx-0',
                hasOwnSongs && 'hidden sm:block'
              )}
            >
              Search for a song, paste a link or upload your own audio. You get word-synced lyrics,
              a clean instrumental, key control and 1080p video exports.
            </p>
          </div>

          <div className="space-y-4 rounded-theme-xl border border-theme-border-subtle bg-theme-surface/85 p-3.5 shadow-theme-lg backdrop-blur-md sm:p-5">
            <SegmentedControl<IntakeMode>
              ariaLabel="Track intake mode"
              value={intakeMode}
              onChange={(mode) => {
                setIntakeMode(mode);
                setError(null);
              }}
              fullWidth
              options={[
                {
                  value: 'youtube',
                  id: 'toggle-youtube-mode',
                  ariaLabel: 'Search or Link',
                  icon: <Search className="h-4 w-4" aria-hidden="true" />,
                  label: <span>Search or Link</span>,
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
                      ref={searchInputRef}
                      type="text"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setError(null);
                      }}
                      onKeyDown={handleSearchKeyDown}
                      aria-label="Search for a song or artist, or paste a song link"
                      aria-describedby={linkHintId}
                      aria-controls={showResults ? resultsId : undefined}
                      placeholder="Song, artist or link"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      enterKeyHint={isLink ? 'go' : 'search'}
                      className="min-h-[48px] w-full rounded-theme-lg border border-theme-border bg-theme-bg py-3.5 pl-10 pr-28 text-base text-theme-text shadow-theme-sm placeholder:text-theme-text-muted focus:border-theme-accent focus:outline-none focus:ring-2 focus:ring-theme-focus/60 sm:py-4 sm:pl-12 sm:pr-32"
                      // Read-only rather than disabled while a song starts, so keyboard
                      // focus stays put
                      readOnly={isLoading}
                      aria-busy={search.phase === 'searching' || undefined}
                    />
                    {query ? (
                      <button
                        type="button"
                        onClick={() => {
                          setQuery('');
                          setError(null);
                          preview.stop();
                          searchInputRef.current?.focus({ preventScroll: true });
                        }}
                        aria-label="Clear search query"
                        className={cn(
                          'absolute right-[4.75rem] flex min-h-[32px] min-w-[32px] items-center justify-center rounded-theme-pill p-1.5 text-theme-text-muted transition-colors hover:bg-theme-surface-subtle hover:text-theme-text sm:right-32',
                          focusRing
                        )}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      ref={submitRef}
                      type="submit"
                      disabled={isLoading || !query.trim()}
                      aria-label="Search / Go: search for a song or load a link"
                      className={cn(
                        'absolute right-1.5 flex min-h-[36px] items-center justify-center gap-1.5 rounded-theme-md bg-gradient-accent px-3 py-2 font-theme-heading text-xs font-semibold text-theme-accent-text shadow-theme-glow transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 sm:right-2 sm:min-h-[44px] sm:gap-2 sm:px-5 sm:text-sm',
                        focusRing
                      )}
                    >
                      {isLink ? 'Go' : 'Search'}
                    </button>
                  </div>
                </form>
                {/* The sites are named where there is room; a phone gets to the library sooner */}
                <p id={linkHintId} className="mt-2 text-pretty text-xs text-theme-text-muted">
                  Type a title, an artist or both; small typos are fine. Or paste a song link
                  <span className="hidden sm:inline"> from {SUPPORTED_SITES_SENTENCE}</span>.
                </p>
                {showResults && (
                  <SongSearchResults
                    ref={resultsRef}
                    id={resultsId}
                    className="mt-3"
                    search={search}
                    preview={preview}
                    isLoading={isLoading}
                    onCreate={createFromResult}
                    onOpen={openFromResult}
                    onReturnFocus={() => searchInputRef.current?.focus({ preventScroll: true })}
                  />
                )}
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
                    {advancedHint}
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
                  {onSeparationQualityChange && (
                    <SeparationQualityPicker
                      name="intake-separation-quality"
                      legend="Stem separation quality"
                      value={separationQuality ?? defaultPreset(capabilities?.separation)}
                      onChange={onSeparationQualityChange}
                      capabilities={capabilities?.separation}
                      className="pb-2"
                    />
                  )}
                  <label
                    htmlFor="custom-lyrics-textarea"
                    className="flex items-center gap-1.5 text-xs font-semibold text-theme-text"
                  >
                    <FileText className="h-3.5 w-3.5 text-theme-text-muted" aria-hidden="true" />
                    Custom lyrics (optional)
                  </label>
                  <textarea
                    id="custom-lyrics-textarea"
                    aria-label="Custom lyrics (optional): custom plain lyrics text"
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

          <ul
            aria-label="What you get"
            className={cn(
              'flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-medium text-theme-text-muted lg:justify-start',
              hasOwnSongs ? 'hidden sm:flex' : 'flex'
            )}
          >
            {HIGHLIGHTS.map(({ Icon, label }) => (
              <li key={label} className="inline-flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 text-theme-highlight" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>

        {/* Beside the form on wide screens; below it on small ones, for first visits only */}
        <HeroStageDemo
          className={cn(
            'mx-auto w-full max-w-xl motion-safe:animate-rise-in lg:max-w-none',
            hasOwnSongs && 'hidden lg:block'
          )}
        />
      </section>

      {!hasOwnSongs && (
        <section aria-labelledby="how-it-works-heading" className="space-y-3 sm:px-4">
          <h2
            id="how-it-works-heading"
            className="font-theme-heading text-lg font-bold text-theme-text"
          >
            How it works
          </h2>
          <ol className="grid gap-3 sm:grid-cols-3">
            {STEPS.map(({ Icon, title, text }, i) => (
              <li
                key={title}
                className="relative flex gap-3 rounded-theme-lg border border-theme-border-subtle bg-theme-surface/70 p-4 shadow-theme-sm sm:flex-col sm:gap-4"
              >
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-theme-md bg-theme-accent/15 text-theme-highlight"
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 space-y-1">
                  <h3 className="font-theme-heading text-sm font-semibold text-theme-text">
                    <span className="mr-1.5 font-mono text-xs text-theme-text-muted">{i + 1}.</span>
                    {title}
                  </h3>
                  <p className="text-pretty text-sm text-theme-text-muted">{text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p
            data-testid="how-it-works-expectations"
            className="text-pretty text-sm text-theme-text-muted"
          >
            It is all automatic, so now and then a lyric is wrong or a line is out of time. The
            studio marks what to check and has a fix for each.
          </p>
        </section>
      )}

      <ProjectLibrary
        currentUser={currentUser}
        authToken={authToken}
        onOpenProject={onOpenProject}
        onCounts={handleLibraryCounts}
        openingProjectId={openingProjectId}
      />
    </div>
  );
};

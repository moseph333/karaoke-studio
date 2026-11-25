/**
 * Track Search Component
 *
 * The home screen: the headline (sung once on arrival), the intake band, three "how it
 * works" steps for visitors who have not made a song yet, and the song library.
 *
 * The intake takes a song three ways. Typed words are searched as the typing pauses
 * (`useSongSearch`): songs from the music catalogs, listed under the box with a preview of
 * each (`track-search/SongSearchResults`), and YouTube uploads on request. A song link
 * (YouTube, SoundCloud, Bandcamp, Vimeo, the Internet Archive; Spotify, Apple Music, TIDAL
 * or Deezer, found on YouTube) starts at once. Or an audio file is uploaded. Advanced
 * options hold the stem separation quality and custom lyrics.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { SearchResult, ProjectState, SeparationPreset } from '../types';
import { LocalAudioUploader, type UploadTrackParams } from './track-search/LocalAudioUploader';
import { ProjectLibrary, type LibraryCounts } from './track-search/ProjectLibrary';
import { SungHeadline } from './track-search/SungHeadline';
import { SongSearchResults } from './track-search/SongSearchResults';
import { SeparationQualityPicker } from './quality/SeparationQualityPicker';
import { Button } from './ui/Button';
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
  /** Starts the tour of this screen; offered to first-time visitors under "How it works". */
  onShowAround?: () => void;
}

export type IntakeMode = 'youtube' | 'local';

const STEPS: Array<{ title: string; text: string }> = [
  {
    title: 'Pick a song',
    text: 'Search for it by name, paste a link, or upload an audio file of your own.',
  },
  {
    title: 'The studio does the work',
    text: 'The vocals are lifted off the music and every word is timed to the singing. Most songs take a few minutes; the best stem quality and a server’s first song take longer.',
  },
  {
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
  onShowAround,
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
  // First visit (no songs of their own yet): the full-size headline and how it works. A
  // returning visitor gets a compact headline, so the search and the songs come first. Decided once, from what this browser remembered, and not changed when
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
    <div className="mx-auto w-full font-theme-body text-theme-text">
      <section className="pb-5 sm:pb-8">
        <SungHeadline compact={hasOwnSongs} />
      </section>

      <section className="grid gap-x-14 gap-y-5 border-t-2 border-theme-border pt-5 sm:pt-7 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* The pitch is for first visits; on a phone, someone with songs gets to them sooner */}
        <p
          className={cn(
            'max-w-[44ch] text-pretty text-base text-theme-text sm:text-[19px] sm:leading-snug',
            hasOwnSongs && 'hidden lg:block'
          )}
        >
          Search for a song, paste a link or upload your own audio. You get word-synced lyrics, a
          clean instrumental, key control and 1080p video exports.
        </p>

        <div className="min-w-0 space-y-3">
          <SegmentedControl<IntakeMode>
            ariaLabel="Track intake mode"
            guide="intake-mode"
            value={intakeMode}
            onChange={(mode) => {
              setIntakeMode(mode);
              setError(null);
            }}
            options={[
              {
                value: 'youtube',
                id: 'toggle-youtube-mode',
                ariaLabel: 'Search or Link',
                label: <span>Search or Link</span>,
              },
              {
                value: 'local',
                id: 'toggle-local-mode',
                ariaLabel: 'Local Audio File',
                label: <span>Local Audio File</span>,
              },
            ]}
          />

          {intakeMode === 'youtube' ? (
            <div id="panel-youtube">
              {/* One outlined field with the yellow block joined to it: the outline lights up
                  while the field has focus */}
              <form
                onSubmit={handleSearch}
                role="search"
                data-guide="home-search"
                className="flex items-stretch border-2 border-theme-border focus-within:border-theme-accent"
              >
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
                  className="h-[60px] min-h-[48px] min-w-0 flex-1 bg-transparent px-4 font-display text-[26px] font-extrabold text-theme-text placeholder:uppercase placeholder:text-theme-text-muted focus:outline-none sm:h-[68px] sm:px-5 sm:text-[32px]"
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
                      'flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-theme-text-muted transition-colors hover:text-theme-text',
                      focusRing
                    )}
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  ref={submitRef}
                  type="submit"
                  disabled={isLoading || !query.trim()}
                  aria-label="Search / Go: search for a song or load a link"
                  className={cn(
                    'ks-display flex min-h-[48px] shrink-0 items-center justify-center bg-theme-accent px-5 text-[26px] font-black text-theme-accent-text transition-colors hover:bg-theme-accent-hover disabled:cursor-not-allowed sm:px-9 sm:text-[32px]',
                    focusRing
                  )}
                >
                  {isLink ? 'Go' : 'Search'}
                </button>
              </form>
              {/* The sites are named where there is room; a phone gets to the library sooner */}
              <p id={linkHintId} className="mt-2 text-pretty text-sm text-theme-text-muted">
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

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              aria-expanded={showAdvanced}
              aria-controls="custom-lyrics-panel"
              aria-label="Advanced options"
              data-guide="advanced"
              aria-describedby={advancedHintId}
              className={cn(
                'flex min-h-[44px] w-full items-center justify-between gap-3 border-b border-theme-border-subtle text-left transition-colors hover:border-theme-border',
                focusRing
              )}
            >
              <span className="ks-display text-[20px] text-theme-text">Advanced options</span>
              <span className="flex min-w-0 items-center gap-2 text-sm text-theme-text-muted">
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
              <div id="custom-lyrics-panel" className="space-y-2 pt-4">
                {onSeparationQualityChange && (
                  <SeparationQualityPicker
                    name="intake-separation-quality"
                    legend="Stem separation quality"
                    value={separationQuality ?? defaultPreset(capabilities?.separation)}
                    onChange={onSeparationQualityChange}
                    capabilities={capabilities?.separation}
                    className="pb-3"
                  />
                )}
                <label
                  htmlFor="custom-lyrics-textarea"
                  className="block text-sm font-semibold text-theme-text"
                >
                  Custom lyrics (optional)
                </label>
                <textarea
                  id="custom-lyrics-textarea"
                  aria-label="Custom lyrics (optional): custom plain lyrics text"
                  value={customLyrics}
                  onChange={(e) => setCustomLyrics(e.target.value)}
                  placeholder="Paste line-by-line lyrics here. If left blank, synchronized lyrics are queried automatically from LRCLIB."
                  rows={4}
                  className="w-full border-2 border-theme-border bg-transparent p-3 font-mono text-base text-theme-text placeholder:text-theme-text-muted focus:border-theme-accent focus:outline-none sm:text-sm"
                />
                <p className="text-sm text-theme-text-muted">
                  One lyric line per row. Words are timed automatically against the vocals.
                </p>
              </div>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="border-2 border-theme-danger p-3.5 text-sm text-theme-danger"
            >
              {error}
            </div>
          )}
        </div>
      </section>

      {!hasOwnSongs && (
        <section
          aria-labelledby="how-it-works-heading"
          className="mt-10 border-t-2 border-theme-border pt-5 sm:mt-14 sm:pt-6"
        >
          <h2
            id="how-it-works-heading"
            className="ks-display text-[28px] font-black text-theme-text sm:text-[36px]"
          >
            How it works
          </h2>
          <ol className="mt-4 grid gap-x-10 gap-y-5 sm:grid-cols-3">
            {STEPS.map(({ title, text }, i) => (
              <li key={title} className="border-t border-theme-border-subtle pt-3">
                <h3 className="ks-display text-[22px] text-theme-text sm:text-[26px]">
                  <span className="mr-2 text-theme-text-muted">{i + 1}.</span>
                  {title}
                </h3>
                <p className="mt-1.5 max-w-[46ch] text-pretty text-sm text-theme-text-muted sm:text-base">
                  {text}
                </p>
              </li>
            ))}
          </ol>
          <p
            data-testid="how-it-works-expectations"
            className="mt-5 max-w-[80ch] text-pretty text-sm text-theme-text-muted"
          >
            It is all automatic, so now and then a lyric is wrong or a line is out of time. The
            studio marks what to check and has a fix for each.
          </p>
          {onShowAround && (
            <Button size="sm" className="mt-4" onClick={onShowAround}>
              Show me around
            </Button>
          )}
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

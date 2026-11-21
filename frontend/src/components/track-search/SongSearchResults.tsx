/**
 * The song search's results, shown in the intake card under the search box: songs from the
 * music catalogs (artwork with a 30-second preview, title, artist, album, year, length and
 * what kind of recording it is), then YouTube uploads on request, for a recording the
 * catalogs do not list. A result that is already in the library opens it instead of making
 * it again. Arrow keys move between results; Escape returns to the search box.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Music, Pause, Play, RotateCcw, Search, VolumeX, X } from 'lucide-react';
import type { SearchResult, SongSearchResult } from '../../types';
import type { UseSongSearch } from '../../hooks/useSongSearch';
import type { SongPreview } from '../../hooks/useSongPreview';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { Spinner } from '../ui/Spinner';
import { focusRing, type BadgeTone } from '../ui/variants';
import { cn } from '../../utils/cn';
import { formatTime } from '../../utils/format';

/** Songs listed before "Show more". */
export const INITIAL_SONGS = 5;

const VERSION_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
  live: { label: 'Live', tone: 'neutral' },
  remix: { label: 'Remix', tone: 'neutral' },
  acoustic: { label: 'Acoustic', tone: 'neutral' },
  cover: { label: 'Cover', tone: 'neutral' },
  demo: { label: 'Demo', tone: 'neutral' },
  altered: { label: 'Altered', tone: 'neutral' },
  extended: { label: 'Extended', tone: 'neutral' },
  // Nothing sung to time the lyrics to
  karaoke: { label: 'Karaoke track', tone: 'warning' },
  instrumental: { label: 'Instrumental', tone: 'warning' },
  edit: { label: 'Edit', tone: 'neutral' },
  rerecorded: { label: 'Re-recorded', tone: 'neutral' },
  remaster: { label: 'Remaster', tone: 'neutral' },
};

const BUSY_STATUSES = new Set([
  'queued',
  'processing',
  'downloading',
  'separating',
  'fetching_lyrics',
  'aligning',
  'mixing',
]);

type AnyResult = SearchResult & Partial<SongSearchResult>;

/** "Wonderwall – Oasis, from Stop the Clocks": what a result's buttons are named after. */
function resultName(result: AnyResult): string {
  const song = `${result.title}${result.artist ? ` – ${result.artist}` : ''}`;
  return result.album ? `${song}, from ${result.album}` : song;
}

interface ResultRowProps {
  result: AnyResult;
  kind: 'song' | 'video';
  disabled: boolean;
  preview: SongPreview;
  onPick: (result: AnyResult) => void;
}

const ResultRow: React.FC<ResultRowProps> = ({ result, kind, disabled, preview, onPick }) => {
  const name = resultName(result);
  const inLibrary = Boolean(result.project_id);
  const beingMade = inLibrary && BUSY_STATUSES.has(result.project_status ?? '');
  const previewing = preview.activeId === result.id;
  const previewFailed = preview.failedIds.has(result.id);
  const details = [result.artist, result.album, result.year].filter(Boolean).join(' · ');
  const artClass = kind === 'song' ? 'h-12 w-12' : 'h-11 w-16 sm:h-12 sm:w-20';
  const art = result.thumbnail ? (
    <img
      src={result.thumbnail}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={cn(artClass, 'object-cover')}
    />
  ) : (
    <span className={cn(artClass, 'flex items-center justify-center bg-theme-surface-raised')}>
      <Music className="h-5 w-5 text-theme-text-muted" aria-hidden="true" />
    </span>
  );

  return (
    <li
      // One song at a time: while a start is on its way, a second click (or a double
      // click) would create the song twice
      onClick={() => {
        if (!disabled) onPick(result);
      }}
      className={cn(
        'group flex items-center gap-3 border-b border-theme-border-subtle py-2 transition-colors',
        disabled ? 'cursor-progress opacity-60' : 'cursor-pointer hover:bg-theme-surface-subtle'
      )}
    >
      {result.preview ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (result.preview) preview.toggle(result.id, result.preview);
          }}
          aria-pressed={previewing}
          aria-label={
            previewFailed
              ? `The preview would not play. Try again: ${name}`
              : previewing
                ? `Stop the preview of ${name}`
                : `Play a preview of ${name}`
          }
          title={
            previewFailed ? 'This preview would not play. Try again' : 'Play a 30-second preview'
          }
          className={cn('relative shrink-0 overflow-hidden', focusRing)}
        >
          {art}
          {/* Always shown, so the artwork reads as playable without a pointer to hover: a
              small chip in the corner, moved to the middle while its preview is on */}
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-0 flex transition-colors',
              previewing || previewFailed
                ? 'items-center justify-center bg-theme-overlay/60'
                : 'items-end justify-end p-0.5 group-hover:bg-theme-overlay/30'
            )}
          >
            <span
              className={cn(
                'flex items-center justify-center bg-theme-accent text-theme-accent-text',
                previewing || previewFailed ? 'h-7 w-7' : 'h-5 w-5'
              )}
            >
              {previewFailed ? (
                <VolumeX className="h-3.5 w-3.5" />
              ) : previewing && !preview.playing ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : previewing ? (
                <Pause className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Play className="h-2.5 w-2.5 translate-x-px fill-current" />
              )}
            </span>
          </span>
        </button>
      ) : (
        <span className="shrink-0">{art}</span>
      )}

      <div className="min-w-0 flex-1 truncate">
        <h3 className="ks-display truncate text-[24px] text-theme-text sm:text-[28px]">
          {result.title}
        </h3>
        {/* The length stays whole when the names are cut short: it tells versions apart */}
        <p className="mt-0.5 flex min-w-0 text-sm text-theme-text-muted">
          <span className="truncate">{details}</span>
          {result.duration ? (
            <span className="shrink-0 whitespace-pre">
              {details ? ' · ' : ''}
              {formatTime(result.duration)}
            </span>
          ) : null}
        </p>
        {(inLibrary || result.explicit || (result.versions?.length ?? 0) > 0) && (
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {inLibrary && (
              <Badge tone={beingMade ? 'accent' : 'success'}>
                {beingMade ? 'Being made' : 'In your library'}
              </Badge>
            )}
            {result.versions?.map((version) => {
              const known = VERSION_LABELS[version];
              return known ? (
                <Badge key={version} tone={known.tone}>
                  {known.label}
                </Badge>
              ) : null;
            })}
            {result.explicit && <Badge tone="neutral">Explicit</Badge>}
          </div>
        )}
      </div>

      <button
        type="button"
        data-result-primary
        disabled={disabled}
        aria-label={`${inLibrary ? 'Open' : 'Create Karaoke'}: ${name}`}
        className={cn(
          'ks-display flex min-h-[44px] shrink-0 items-center justify-center border border-theme-border px-3 text-[20px] text-theme-text transition-colors sm:px-3.5',
          // The action of the row under the pointer lights up; opening a song inverts instead
          inLibrary
            ? 'group-hover:bg-theme-text group-hover:text-theme-text-inverse'
            : 'group-hover:border-theme-accent group-hover:bg-theme-accent group-hover:text-theme-accent-text',
          focusRing
        )}
      >
        {inLibrary ? (
          'Open'
        ) : (
          <>
            <span className="sm:hidden">Create</span>
            <span className="hidden sm:inline">Create Karaoke</span>
          </>
        )}
      </button>
    </li>
  );
};

const SkeletonRows: React.FC<{ count: number }> = ({ count }) => (
  <ul aria-hidden="true" className="border-t border-theme-border-subtle">
    {Array.from({ length: count }, (_, i) => (
      <li key={i} className="flex items-center gap-3 border-b border-theme-border-subtle py-2">
        <Skeleton className="h-12 w-12 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-2/5" />
        </div>
        <Skeleton className="h-9 w-16 shrink-0" />
      </li>
    ))}
  </ul>
);

export interface SongSearchResultsProps {
  search: UseSongSearch;
  preview: SongPreview;
  /** A song is being started: results stay listed but cannot be picked. */
  isLoading: boolean;
  /** Start a result that is not in the library yet. */
  onCreate: (result: SearchResult) => void;
  /** Open a result that is already in the library. */
  onOpen: (projectId: string, status: string) => void;
  /** Put keyboard focus back in the search box. */
  onReturnFocus: () => void;
  /** The element's id, which the search box names as what it controls. */
  id?: string;
  className?: string;
}

export const SongSearchResults = React.forwardRef<HTMLElement, SongSearchResultsProps>(
  ({ search, preview, isLoading, onCreate, onOpen, onReturnFocus, id, className }, ref) => {
    const { query, phase, songs, corrected, catalog, videosPhase, videos, videosQuery } = search;
    const [showAll, setShowAll] = useState(false);
    const listRef = useRef<HTMLElement | null>(null);
    const headingId = useId();

    // A new search starts from the short list again
    useEffect(() => setShowAll(false), [query]);

    // A preview stops when its song leaves the list
    const { activeId, stop: stopPreview } = preview;
    useEffect(() => {
      if (activeId && !songs.some((song) => song.id === activeId)) stopPreview();
    }, [activeId, songs, stopPreview]);

    const shownSongs = showAll ? songs : songs.slice(0, INITIAL_SONGS);
    const hiddenSongs = songs.length - shownSongs.length;
    const firstSearch = phase === 'searching' && songs.length === 0 && videosPhase === 'idle';
    const noSongs = phase === 'done' && songs.length === 0;

    const pick = (result: AnyResult) => {
      preview.stop();
      if (result.project_id) onOpen(result.project_id, result.project_status ?? 'ready');
      else onCreate(result);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onReturnFocus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const buttons = Array.from(
        listRef.current?.querySelectorAll<HTMLButtonElement>('[data-result-primary]') ?? []
      );
      const at = buttons.findIndex((button) => button.closest('li')?.contains(e.target as Node));
      if (at < 0) return;
      e.preventDefault();
      const next = at + (e.key === 'ArrowDown' ? 1 : -1);
      if (next < 0) onReturnFocus();
      else buttons[Math.min(next, buttons.length - 1)]?.focus();
    };

    let status: string;
    if (phase === 'error') status = 'The search did not get through.';
    else if (firstSearch) status = `Searching for “${query || '…'}”`;
    else if (!catalog && videosPhase === 'idle' && noSongs)
      status = 'Press Search to look on YouTube.';
    else if (noSongs) status = `No songs found for “${query}”.`;
    else {
      const count = `${songs.length} ${songs.length === 1 ? 'song' : 'songs'}`;
      status = corrected
        ? `${count} for “${corrected}” (you typed “${query}”)`
        : `${count} for “${query}”`;
    }
    // Without a catalog the uploads are the results: their own status says the rest
    const quietStatus = noSongs && videosPhase !== 'idle';

    return (
      <section
        ref={(node) => {
          listRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        id={id}
        aria-labelledby={headingId}
        aria-busy={phase === 'searching' || videosPhase === 'searching' || undefined}
        onKeyDown={onKeyDown}
        className={cn('space-y-2.5', className)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 id={headingId} className="sr-only">
              Search results
            </h2>
            <p
              role="status"
              className={cn(
                'flex items-center gap-2 text-sm text-theme-text-muted',
                quietStatus && 'sr-only'
              )}
            >
              {phase === 'searching' && <Spinner className="h-3.5 w-3.5" />}
              <span className="min-w-0 text-pretty">{quietStatus ? '' : status}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              preview.stop();
              search.clear();
              onReturnFocus();
            }}
            aria-label="Clear search results"
            className={cn(
              'flex min-h-[32px] shrink-0 cursor-pointer items-center gap-1 px-2 py-1 text-sm text-theme-text-muted transition-colors hover:text-theme-text',
              focusRing
            )}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Clear</span>
          </button>
        </div>

        {phase === 'error' && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-2 border-theme-danger p-3 text-sm text-theme-danger">
            <span>Search failed. Check the connection and try again.</span>
            <button
              type="button"
              onClick={search.submit}
              className={cn(
                'ks-display flex min-h-[36px] items-center gap-1.5 border border-theme-danger px-3 text-[20px]',
                focusRing
              )}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Search again
            </button>
          </div>
        )}

        {firstSearch && <SkeletonRows count={3} />}

        {shownSongs.length > 0 && (
          <ul aria-label="Songs" className="border-t border-theme-border-subtle">
            {shownSongs.map((song) => (
              <ResultRow
                key={song.id}
                result={song}
                kind="song"
                disabled={isLoading}
                preview={preview}
                onPick={pick}
              />
            ))}
          </ul>
        )}

        {hiddenSongs > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className={cn(
              'ks-display flex min-h-[44px] w-full items-center justify-center text-[20px] text-theme-text-muted transition-colors hover:text-theme-text',
              focusRing
            )}
          >
            Show {hiddenSongs} more {hiddenSongs === 1 ? 'song' : 'songs'}
          </button>
        )}

        {/* YouTube uploads: on request under the songs, or the only results without a catalog */}
        {videosPhase === 'idle' && phase === 'done' && (catalog || songs.length > 0) && (
          <div className="flex flex-col gap-2 py-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <p className="min-w-0 text-pretty text-sm text-theme-text-muted sm:flex-1">
              {noSongs
                ? 'It may still be on YouTube.'
                : 'Looking for another recording, or a song that is not listed?'}
            </p>
            <button
              type="button"
              onClick={search.searchVideos}
              aria-label={`Search YouTube uploads for “${corrected ?? query}”`}
              className={cn(
                'ks-display flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 border border-theme-border px-3 text-[20px] text-theme-text transition-colors hover:bg-theme-text hover:text-theme-text-inverse',
                focusRing
              )}
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              Search YouTube uploads
            </button>
          </div>
        )}

        {videosPhase !== 'idle' && (
          <div className="space-y-2">
            <p
              role="status"
              className="ks-display flex items-center gap-2 text-[22px] text-theme-text"
            >
              {videosPhase === 'searching' && <Spinner className="h-3.5 w-3.5" />}
              {videosPhase === 'searching'
                ? 'Searching YouTube…'
                : videosPhase === 'error'
                  ? 'The YouTube search failed'
                  : videos.length > 0
                    ? `YouTube uploads for “${videosQuery}”`
                    : `Nothing on YouTube for “${videosQuery}”`}
            </p>
            {videosPhase === 'searching' && <SkeletonRows count={3} />}
            {videosPhase === 'done' && videos.length === 0 && (
              <p className="text-sm text-theme-text-muted">
                No matching tracks found. Try a different title, add the artist, or paste a song
                link.
              </p>
            )}
            {videosPhase === 'error' && (
              <button
                type="button"
                onClick={search.searchVideos}
                className={cn(
                  'ks-display flex min-h-[44px] items-center gap-1.5 border border-theme-border px-3 text-[20px] text-theme-text',
                  focusRing
                )}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Search YouTube again
              </button>
            )}
            {videos.length > 0 && (
              <ul aria-label="YouTube uploads" className="border-t border-theme-border-subtle">
                {videos.map((video) => (
                  <ResultRow
                    key={video.id}
                    result={video}
                    kind="video"
                    disabled={isLoading}
                    preview={preview}
                    onPick={pick}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    );
  }
);
SongSearchResults.displayName = 'SongSearchResults';

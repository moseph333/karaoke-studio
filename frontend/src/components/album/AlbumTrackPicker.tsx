/**
 * The album picker: shown for a pasted link or an uploaded file that holds a whole album
 * (project status `album`). Lists the album's songs (`useAlbumListing`) with where the list
 * came from, lets the listener pick songs, correct their names and the album's artist (both
 * find the lyrics), and makes each picked song a song of its own. Songs made already open from
 * their rows. A long song that was taken for an album can still be made as one song.
 */

import React, { useEffect, useId, useState } from 'react';
import { ArrowLeft, Disc3, Info, ListMusic, Music, RefreshCw } from 'lucide-react';
import type { AlbumSongsStarted, AlbumTrack, ProjectState } from '../../types';
import { useAlbumListing } from '../../hooks/useAlbumListing';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { Skeleton } from '../ui/Skeleton';
import { AlbumTrackRow } from './AlbumTrackRow';
import { cn } from '../../utils/cn';
import { formatTime } from '../../utils/format';
import {
  albumSourceSentence,
  isTrackMade,
  makeSongsLabel,
  songPicks,
  unnamedPicks,
} from '../../utils/albumTracks';

export interface AlbumTrackPickerProps {
  /** The album's project (status `album`). */
  project: ProjectState;
  /** Starts the picked songs; resolves to their projects, or null when it failed. */
  onMakeSongs: (
    albumId: string,
    songs: Array<{ number: number; title?: string }>,
    artist?: string
  ) => Promise<AlbumSongsStarted | null>;
  /** Makes the whole recording one song; resolves to whether it started. */
  onMakeWhole: (albumId: string) => Promise<boolean>;
  onOpenSong: (projectId: string, status: string) => void;
  onBack: () => void;
  isStarting?: boolean;
}

const cardCls =
  'rounded-theme-xl border border-theme-border-subtle bg-theme-surface/85 p-4 shadow-theme-lg backdrop-blur-md sm:p-6';

export const AlbumTrackPicker: React.FC<AlbumTrackPickerProps> = ({
  project,
  onMakeSongs,
  onMakeWhole,
  onOpenSong,
  onBack,
  isStarting = false,
}) => {
  const { listing, error, loading, reload } = useAlbumListing(project.id);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [titles, setTitles] = useState<Record<number, string>>({});
  const [artist, setArtist] = useState('');
  const artistId = useId();
  const listId = useId();

  useEffect(() => {
    if (listing) setArtist((current) => current || listing.artist || '');
  }, [listing]);

  const tracks: AlbumTrack[] = listing?.tracks ?? project.album?.tracks ?? [];
  const pickable = tracks.filter((t) => !isTrackMade(t));
  const unnamed = unnamedPicks(tracks, selected, titles);
  const allPicked = pickable.length > 0 && pickable.every((t) => selected.has(t.number));
  const title = listing?.title || project.album?.title || project.title || 'Album';
  const duration = listing?.duration ?? project.album?.duration ?? project.duration ?? 0;
  const source = listing?.source ?? project.album?.source ?? 'none';
  const kind = listing?.kind ?? project.album?.kind ?? 'link';

  const toggle = (number: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(number);
      else next.delete(number);
      return next;
    });

  const makeSongs = async () => {
    const typedArtist = artist.trim();
    const result = await onMakeSongs(
      project.id,
      songPicks(selected, titles),
      typedArtist && typedArtist !== listing?.artist ? typedArtist : undefined
    );
    if (result) {
      setSelected(new Set());
      reload();
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 py-2 font-theme-body motion-safe:animate-rise-in sm:py-8">
      <div className={cn(cardCls, 'space-y-5')}>
        <div className="flex items-start gap-4">
          {project.thumbnail_url || listing?.thumbnail_url ? (
            <img
              src={listing?.thumbnail_url || project.thumbnail_url}
              alt=""
              className="h-20 w-20 shrink-0 rounded-theme-md object-cover shadow-theme-md sm:h-24 sm:w-24"
            />
          ) : (
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-theme-md bg-gradient-stage text-theme-text-muted sm:h-24 sm:w-24">
              <Disc3 className="h-8 w-8" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0 space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-theme-highlight">
              Whole album
            </p>
            <h1
              tabIndex={-1}
              data-view-heading
              className="text-balance font-theme-heading text-xl font-bold text-theme-text focus:outline-none sm:text-2xl"
            >
              {title}
            </h1>
            <p className="text-sm text-theme-text-muted">
              {[listing?.artist || project.artist, tracks.length ? `${tracks.length} songs` : null]
                .filter(Boolean)
                .join(' · ')}
              {duration ? ` · ${formatTime(duration)}` : ''}
            </p>
          </div>
        </div>

        <p className="text-pretty text-sm text-theme-text">
          This {kind === 'upload' ? 'file' : 'link'} holds a whole album. Pick the songs you want:
          each one becomes a karaoke song of its own, with its own lyrics.
        </p>
        <p className="flex gap-2 text-pretty text-xs text-theme-text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {albumSourceSentence(source, kind, listing?.catalog?.site)}
        </p>

        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-theme-md border border-theme-danger/40 bg-theme-danger/10 p-3 text-sm text-theme-danger"
          >
            {error}
            <Button
              size="sm"
              variant="secondary"
              onClick={reload}
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              Try again
            </Button>
          </div>
        )}

        {tracks.length > 0 && (
          <Field
            label="Album artist"
            htmlFor={artistId}
            hint="Used with each song's name to find its lyrics."
          >
            <Input
              id={artistId}
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              maxLength={300}
              autoComplete="off"
            />
          </Field>
        )}

        {loading && !listing && tracks.length === 0 ? (
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : tracks.length > 0 ? (
          <section aria-labelledby={listId} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2
                id={listId}
                className="flex items-center gap-2 font-theme-heading text-sm font-semibold text-theme-text"
              >
                <ListMusic className="h-4 w-4 text-theme-highlight" aria-hidden="true" />
                Songs
              </h2>
              {pickable.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setSelected(allPicked ? new Set() : new Set(pickable.map((t) => t.number)))
                  }
                  className="min-h-[44px]"
                >
                  {allPicked ? 'Pick none' : 'Pick all'}
                </Button>
              )}
            </div>
            <ol className="space-y-1.5" aria-label={`Songs of ${title}`}>
              {tracks.map((track) => (
                <AlbumTrackRow
                  key={track.number}
                  track={track}
                  selected={selected.has(track.number)}
                  onToggle={toggle}
                  title={titles[track.number]}
                  onTitleChange={(number, text) =>
                    setTitles((prev) => ({ ...prev, [number]: text }))
                  }
                  onOpen={onOpenSong}
                  disabled={isStarting}
                />
              ))}
            </ol>
          </section>
        ) : (
          !loading && (
            <p className="flex gap-2 rounded-theme-md border border-theme-border-subtle bg-theme-surface-subtle/60 p-3 text-sm text-theme-text-muted">
              <Music className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              No songs could be told apart. Make the whole recording one song, or find a video of
              the song you want on its own.
            </p>
          )
        )}

        {unnamed.length > 0 && (
          <p className="text-pretty text-xs text-theme-warning" data-testid="album-unnamed-hint">
            {unnamed.length === 1
              ? `Song ${unnamed[0].number} has no name yet, so its lyrics cannot be looked up.`
              : `Songs ${unnamed.map((t) => t.number).join(', ')} have no names yet, so their lyrics cannot be looked up.`}{' '}
            Type the names above, or paste the lyrics in the studio later.
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-theme-border-subtle pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="ghost"
            onClick={onBack}
            leftIcon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
            className="min-h-[44px]"
          >
            Back to library
          </Button>
          {/* On a phone the button that makes the picked songs comes first */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {listing?.whole_allowed && (
              <Button
                variant="secondary"
                onClick={() => void onMakeWhole(project.id)}
                disabled={isStarting}
                className="min-h-[44px]"
              >
                Make it all one song
              </Button>
            )}
            {tracks.length > 0 && (
              <Button
                variant="gradient"
                onClick={() => void makeSongs()}
                disabled={selected.size === 0}
                loading={isStarting}
                loadingLabel="Starting…"
                className="min-h-[44px]"
              >
                {selected.size ? makeSongsLabel(selected.size) : 'Pick songs to make'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

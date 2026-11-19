/**
 * One song of an album in the album picker: a checkbox to pick it, its number, name and place
 * in the recording, or, for a song made from it already, its state and an Open button. A song
 * with a stand-in name ("Track 3") asks for its name once it is picked; any picked song can be
 * renamed, since its name is what finds the lyrics.
 */

import React, { useId, useState } from 'react';
import { CheckCircle2, Clock, Pencil } from 'lucide-react';
import type { AlbumTrack } from '../../types';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Field';
import { cn } from '../../utils/cn';
import { isTrackMade, madeTrackLabel, trackRangeLabel } from '../../utils/albumTracks';

export interface AlbumTrackRowProps {
  track: AlbumTrack;
  selected: boolean;
  onToggle: (number: number, selected: boolean) => void;
  /** The name typed for the song, if any. */
  title: string | undefined;
  onTitleChange: (number: number, title: string) => void;
  onOpen: (projectId: string, status: string) => void;
  disabled?: boolean;
}

export const AlbumTrackRow: React.FC<AlbumTrackRowProps> = ({
  track,
  selected,
  onToggle,
  title,
  onTitleChange,
  onOpen,
  disabled = false,
}) => {
  const checkboxId = useId();
  const nameId = useId();
  const [renaming, setRenaming] = useState(false);
  const made = isTrackMade(track);
  const failed = track.project_status === 'error' || track.project_status === 'cancelled';
  const shownTitle = title?.trim() || track.title;
  const asksName = selected && (!track.named || renaming);

  return (
    <li
      data-testid={`album-track-${track.number}`}
      className={cn(
        'rounded-theme-md border px-3 py-2 transition-colors',
        selected
          ? 'border-theme-accent/60 bg-theme-accent/10'
          : 'border-theme-border-subtle bg-theme-surface/60'
      )}
    >
      <div className="flex min-h-[44px] items-center gap-3">
        {made ? (
          <span
            aria-hidden="true"
            className="flex h-5 w-5 shrink-0 items-center justify-center text-theme-success"
          >
            {track.project_status === 'ready' ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <Clock className="h-5 w-5 text-theme-warning" />
            )}
          </span>
        ) : (
          <input
            id={checkboxId}
            type="checkbox"
            checked={selected}
            disabled={disabled}
            onChange={(e) => onToggle(track.number, e.target.checked)}
            className="h-5 w-5 min-h-[20px] shrink-0 cursor-pointer rounded border-theme-border accent-[rgb(var(--theme-accent-rgb))]"
          />
        )}
        <label
          htmlFor={made ? undefined : checkboxId}
          className={cn('min-w-0 flex-1', !made && 'cursor-pointer')}
        >
          <span className="flex items-baseline gap-2">
            <span className="w-6 shrink-0 text-right font-mono text-xs text-theme-text-muted">
              {track.number}
            </span>
            <span
              className={cn(
                'truncate text-sm font-medium',
                track.named || title?.trim() ? 'text-theme-text' : 'italic text-theme-text-muted'
              )}
            >
              {shownTitle}
            </span>
          </span>
          <span className="ml-8 block truncate text-xs text-theme-text-muted">
            {track.artist ? `${track.artist} · ` : ''}
            {trackRangeLabel(track)}
            {failed ? ' · Failed last time: pick it to try again' : ''}
          </span>
        </label>
        {made && track.project_id ? (
          <>
            <span className="hidden text-xs font-semibold text-theme-text-muted sm:inline">
              {madeTrackLabel(track.project_status)}
            </span>
            <Button
              size="sm"
              variant={track.project_status === 'ready' ? 'primary' : 'secondary'}
              onClick={() => onOpen(track.project_id!, track.project_status || 'queued')}
              aria-label={`Open song ${track.number}, ${shownTitle} (${madeTrackLabel(
                track.project_status
              ).toLowerCase()})`}
              className="min-h-[44px]"
            >
              Open
            </Button>
          </>
        ) : (
          selected &&
          track.named &&
          !renaming && (
            <IconButton
              variant="ghost"
              size="sm"
              label={`Rename song ${track.number}`}
              tooltip="Correct the song's name (it finds the lyrics)"
              icon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() => setRenaming(true)}
              className="h-11 w-11"
            />
          )
        )}
      </div>
      {asksName && (
        <div className="ml-8 pb-1 pt-1">
          <label htmlFor={nameId} className="sr-only">
            {`Name of song ${track.number}`}
          </label>
          <Input
            id={nameId}
            value={title ?? (track.named ? track.title : '')}
            onChange={(e) => onTitleChange(track.number, e.target.value)}
            placeholder="Song title (finds the lyrics)"
            maxLength={300}
            autoComplete="off"
            autoFocus={renaming}
          />
        </div>
      )}
    </li>
  );
};

/**
 * One song of an album in the album picker: a checkbox to pick it, its number, name and place
 * in the recording, or, for a song made from it already, its state and an Open button. A song
 * with a stand-in name ("Track 3") asks for its name once it is picked; any picked song can be
 * renamed, since its name is what finds the lyrics.
 */

import React, { useId, useState } from 'react';
import { Check, Clock, Pencil } from 'lucide-react';
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
      className="border-b border-theme-border-subtle py-1"
    >
      <div className="flex min-h-[44px] items-center gap-3">
        {made ? (
          <span
            aria-hidden="true"
            className="flex h-5 w-5 shrink-0 items-center justify-center text-theme-text-muted"
          >
            {track.project_status === 'ready' ? (
              <Check className="h-5 w-5 text-theme-text" />
            ) : (
              <Clock className="h-5 w-5" />
            )}
          </span>
        ) : (
          <input
            id={checkboxId}
            type="checkbox"
            checked={selected}
            disabled={disabled}
            onChange={(e) => onToggle(track.number, e.target.checked)}
            className="ks-check min-h-[20px]"
          />
        )}
        <label
          htmlFor={made ? undefined : checkboxId}
          className={cn('min-w-0 flex-1', !made && 'cursor-pointer')}
        >
          <span className="ks-display flex items-baseline gap-3 text-[24px]">
            <span className="w-7 shrink-0 tabular-nums text-theme-text-muted">
              {String(track.number).padStart(2, '0')}
            </span>
            <span
              className={cn(
                'truncate',
                track.named || title?.trim() ? 'text-theme-text' : 'text-theme-text-muted'
              )}
            >
              {shownTitle}
            </span>
          </span>
          <span className="ml-10 block truncate text-sm tabular-nums text-theme-text-muted">
            {track.artist ? `${track.artist} · ` : ''}
            {trackRangeLabel(track)}
            {failed ? ' · Failed last time: pick it to try again' : ''}
          </span>
        </label>
        {made && track.project_id ? (
          <>
            <span className="hidden text-sm text-theme-text-muted sm:inline">
              {madeTrackLabel(track.project_status)}
            </span>
            <Button
              size="sm"
              variant="secondary"
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
        <div className="ml-8 max-w-xl pb-2 pt-1 sm:ml-[4.5rem]">
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

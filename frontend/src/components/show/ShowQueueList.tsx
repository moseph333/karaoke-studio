/**
 * A show's queue: the singers still to go, in order, with the controls to call one, move one
 * and take one off; under it, the singers who have been on, who can go again.
 */

import React from 'react';
import { ArrowDown, ArrowUp, Play, RotateCcw, X } from 'lucide-react';
import { videoNote, type ShowVideoInfo } from '../../hooks/useShowVideos';
import type { ShowEntry } from '../../utils/showQueue';
import { Button, IconButton } from '../ui';

export interface ShowQueueListProps {
  waiting: ShowEntry[];
  finished: ShowEntry[];
  videos: Record<string, ShowVideoInfo>;
  /** Somebody is on stage: starting another takes them off. */
  busy: boolean;
  onStart: (entry: ShowEntry) => void;
  onMove: (id: string, by: -1 | 1) => void;
  onRemove: (id: string) => void;
  onAgain: (id: string) => void;
  onClearFinished: () => void;
}

const row =
  'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-theme-border-subtle py-2 sm:flex-nowrap';
const heading = 'ks-display text-[28px] font-black text-theme-text';

const SongLine: React.FC<{ entry: ShowEntry; note?: string | null }> = ({ entry, note }) => (
  <div className="min-w-0 flex-1">
    <p className="truncate text-base font-semibold text-theme-text">{entry.singer}</p>
    <p className="truncate text-sm text-theme-text-muted">
      {entry.source.title}
      {entry.source.kind === 'library' && entry.source.artist ? ` · ${entry.source.artist}` : ''}
      {entry.source.kind === 'youtube' ? ' · Video' : ''}
    </p>
    {note && <p className="text-sm text-theme-warning">{note}</p>}
  </div>
);

export const ShowQueueList: React.FC<ShowQueueListProps> = ({
  waiting,
  finished,
  videos,
  busy,
  onStart,
  onMove,
  onRemove,
  onAgain,
  onClearFinished,
}) => (
  <div className="flex flex-col gap-8">
    <section aria-labelledby="show-queue-heading">
      <h2 id="show-queue-heading" className={heading}>
        Queue
        <span className="ml-2 font-theme-body text-base font-semibold normal-case tabular-nums text-theme-text-muted">
          {waiting.length}
        </span>
      </h2>
      {waiting.length === 0 ? (
        <p className="border-b border-theme-border-subtle py-3 text-sm text-theme-text-muted">
          Nobody is waiting. Add a singer and their song.
        </p>
      ) : (
        <ol data-testid="show-queue">
          {waiting.map((entry, index) => (
            <li key={entry.id} className={row} data-testid="show-queue-row">
              <span className="w-6 shrink-0 text-right text-sm tabular-nums text-theme-text-muted">
                {index + 1}
              </span>
              <SongLine
                entry={entry}
                note={
                  entry.source.kind === 'youtube' ? videoNote(videos[entry.source.videoId]) : null
                }
              />
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="secondary"
                  className="min-h-[44px]"
                  leftIcon={<Play className="h-4 w-4" aria-hidden="true" />}
                  aria-label={`Start ${entry.singer}${busy ? ' now' : ''}`}
                  onClick={() => onStart(entry)}
                >
                  Start
                </Button>
                <IconButton
                  icon={<ArrowUp className="h-4 w-4" aria-hidden="true" />}
                  label={`Move ${entry.singer} up`}
                  className="min-h-[44px] min-w-[44px]"
                  disabled={index === 0}
                  onClick={() => onMove(entry.id, -1)}
                />
                <IconButton
                  icon={<ArrowDown className="h-4 w-4" aria-hidden="true" />}
                  label={`Move ${entry.singer} down`}
                  className="min-h-[44px] min-w-[44px]"
                  disabled={index === waiting.length - 1}
                  onClick={() => onMove(entry.id, 1)}
                />
                <IconButton
                  icon={<X className="h-4 w-4" aria-hidden="true" />}
                  label={`Take ${entry.singer} off the queue`}
                  className="min-h-[44px] min-w-[44px]"
                  onClick={() => onRemove(entry.id)}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>

    {finished.length > 0 && (
      <section aria-labelledby="show-sung-heading">
        <div className="flex items-end justify-between gap-3">
          <h2 id="show-sung-heading" className={heading}>
            Sung tonight
          </h2>
          <Button variant="ghost" className="min-h-[44px]" onClick={onClearFinished}>
            Clear the list
          </Button>
        </div>
        <ul data-testid="show-sung">
          {finished.map((entry) => (
            <li key={entry.id} className={row}>
              <SongLine entry={entry} note={entry.status === 'skipped' ? 'Skipped' : null} />
              <Button
                variant="ghost"
                className="min-h-[44px] shrink-0"
                leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
                aria-label={`Put ${entry.singer} back in the queue`}
                onClick={() => onAgain(entry.id)}
              >
                Again
              </Button>
            </li>
          ))}
        </ul>
      </section>
    )}
  </div>
);

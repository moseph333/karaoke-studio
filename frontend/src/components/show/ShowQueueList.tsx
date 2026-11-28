/**
 * A show's queue: the singers still to go, in order, with the controls to call one, move one
 * and take one off; under it, the singers who have been on, who can go again.
 *
 * A waiting singer is moved by dragging their row (by its grip with a finger, anywhere on it
 * with a mouse) or, one place at a time, with the row's arrow buttons. The switch beside the
 * heading says whether singers take turns: where a song that joins the line is put
 * (`showQueue.turnPlace`). It moves nobody who is already waiting.
 *
 * A row starts its singer only while nobody is on: with a song on stage the host ends or
 * skips it first, from "Now singing", so one press on a row cannot cut a singer off.
 *
 * "Clear the list" and "Start a new night" (everybody, waiting and sung) ask first, in
 * place: neither has an undo.
 *
 * Moved from the keyboard, a singer's arrow keeps the focus as the row moves, so it can be
 * pressed again. An arrow that can go no further (the first singer's up, the last one's
 * down) is marked `aria-disabled`, not disabled: a disabled button drops the focus the
 * moment the singer arrives there. Where the singer now stands is said in a live region.
 */

import React, { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Play, RotateCcw, X } from 'lucide-react';
import { useReorderDrag } from '../../hooks/useReorderDrag';
import { videoNote, type ShowVideoInfo } from '../../hooks/useShowVideos';
import { cn } from '../../utils/cn';
import { ordinal } from '../../utils/format';
import type { ShowEntry } from '../../utils/showQueue';
import { Button, IconButton, InlineConfirm, Switch } from '../ui';

export interface ShowQueueListProps {
  waiting: ShowEntry[];
  finished: ShowEntry[];
  videos: Record<string, ShowVideoInfo>;
  /** Somebody is on stage: the rows offer no Start until their song is ended or skipped. */
  busy: boolean;
  onStart: (entry: ShowEntry) => void;
  onMove: (id: string, by: -1 | 1) => void;
  /** A singer's row was dropped at a place in the queue; 0 is the head of the line. */
  onPlace: (id: string, at: number) => void;
  onRemove: (id: string) => void;
  onAgain: (id: string) => void;
  onClearFinished: () => void;
  /** Empties the queue and the list of who has sung; without it the list does not offer to. */
  onNewNight?: () => void;
  /** Whether a song that joins the line is put by turns; without `onTurnsChange` the list
   *  has no switch for it. */
  turns?: boolean;
  onTurnsChange?: (turns: boolean) => void;
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
  onPlace,
  onRemove,
  onAgain,
  onClearFinished,
  onNewNight,
  turns = false,
  onTurnsChange,
}) => {
  // The move just asked for: once the list has it, the new place is said and the arrow
  // that was pressed gets the focus back if the move took it
  const moved = useRef<{ id: string; by: -1 | 0 | 1 } | null>(null);
  const [said, setSaid] = useState('');
  const { listRef, draggingId, rowProps, placeOf } = useReorderDrag<HTMLOListElement>({
    ids: waiting.map((entry) => entry.id),
    onReorder: (id, at) => {
      moved.current = { id, by: 0 };
      onPlace(id, at);
    },
  });
  const move = (id: string, index: number, by: -1 | 1) => {
    // The first singer cannot go up, nor the last one down
    if (by < 0 ? index === 0 : index === waiting.length - 1) return;
    moved.current = { id, by };
    onMove(id, by);
  };
  const order = waiting.map((entry) => entry.id).join(' ');
  useLayoutEffect(() => {
    const last = moved.current;
    if (!last) return;
    moved.current = null;
    const at = waiting.findIndex((entry) => entry.id === last.id);
    if (at < 0) return;
    setSaid(`${waiting[at].singer} is now ${ordinal(at + 1)} of ${waiting.length}`);
    if (last.by === 0) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body) return;
    const arrows = listRef.current?.querySelectorAll<HTMLElement>('[data-move]') ?? [];
    for (const arrow of Array.from(arrows)) {
      if (arrow.dataset.move === `${last.id}:${last.by}`) arrow.focus();
    }
    // Run when the order changes; `waiting` is read as it is then
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="show-queue-heading">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-1">
          <h2 id="show-queue-heading" className={heading}>
            Queue
            <span className="ml-2 font-theme-body text-base font-semibold normal-case tabular-nums text-theme-text-muted">
              {waiting.length}
            </span>
          </h2>
          {onTurnsChange && (
            <Switch
              checked={turns}
              onChange={onTurnsChange}
              label="Take turns"
              description="Everyone waiting sings before anyone sings again"
              testId="show-turns"
              className="w-full sm:w-auto"
            />
          )}
        </div>
        <p role="status" aria-live="polite" data-testid="show-queue-said" className="sr-only">
          {said}
        </p>
        {waiting.length === 0 ? (
          <p className="border-b border-theme-border-subtle py-3 text-sm text-theme-text-muted">
            Nobody is waiting. Add a singer and their song.
          </p>
        ) : (
          <ol ref={listRef} data-testid="show-queue">
            {waiting.map((entry, index) => (
              <li
                key={entry.id}
                {...rowProps(entry.id, index)}
                className={cn(
                  row,
                  'cursor-grab select-none',
                  draggingId === entry.id
                    ? 'relative z-10 cursor-grabbing border-theme-border bg-theme-surface-raised outline outline-2 outline-theme-border'
                    : draggingId &&
                        'transition-transform duration-150 motion-reduce:transition-none'
                )}
                data-testid="show-queue-row"
                data-dragging={draggingId === entry.id || undefined}
              >
                <span
                  data-drag-handle
                  className="flex min-h-[44px] min-w-[44px] shrink-0 touch-none items-center gap-0.5 text-sm tabular-nums text-theme-text-muted"
                >
                  <GripVertical className="h-4 w-4" aria-hidden="true" />
                  <span className="w-6 text-right">{placeOf(index) + 1}</span>
                </span>
                <SongLine
                  entry={entry}
                  note={
                    entry.source.kind === 'youtube' ? videoNote(videos[entry.source.videoId]) : null
                  }
                />
                <div className="flex shrink-0 items-center gap-1">
                  {!busy && (
                    <Button
                      variant="secondary"
                      className="min-h-[44px]"
                      leftIcon={<Play className="h-4 w-4" aria-hidden="true" />}
                      aria-label={`Start ${entry.singer}`}
                      onClick={() => onStart(entry)}
                    >
                      Start
                    </Button>
                  )}
                  <IconButton
                    icon={<ArrowUp className="h-4 w-4" aria-hidden="true" />}
                    label={`Move ${entry.singer} up`}
                    className="min-h-[44px] min-w-[44px]"
                    aria-disabled={index === 0 || undefined}
                    data-move={`${entry.id}:-1`}
                    onClick={() => move(entry.id, index, -1)}
                  />
                  <IconButton
                    icon={<ArrowDown className="h-4 w-4" aria-hidden="true" />}
                    label={`Move ${entry.singer} down`}
                    className="min-h-[44px] min-w-[44px]"
                    aria-disabled={index === waiting.length - 1 || undefined}
                    data-move={`${entry.id}:1`}
                    onClick={() => move(entry.id, index, 1)}
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
            <InlineConfirm
              message="Clear the list of who has sung? They cannot be put back from it after."
              confirmLabel="Clear it"
              keepLabel="Keep the list"
              onConfirm={onClearFinished}
              renderTrigger={({ ref, onClick }) => (
                <Button ref={ref} variant="ghost" className="min-h-[44px]" onClick={onClick}>
                  Clear the list
                </Button>
              )}
            />
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

      {onNewNight && !busy && waiting.length + finished.length > 0 && (
        <div>
          <InlineConfirm
            message="Start a new night? Everybody waiting and everybody who has sung is cleared."
            confirmLabel="Clear the queue"
            keepLabel="Keep the queue"
            onConfirm={onNewNight}
            renderTrigger={({ ref, onClick }) => (
              <Button ref={ref} variant="ghost" className="min-h-[44px]" onClick={onClick}>
                Start a new night
              </Button>
            )}
          />
        </div>
      )}
    </div>
  );
};

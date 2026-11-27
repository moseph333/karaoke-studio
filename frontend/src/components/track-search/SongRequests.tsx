/**
 * The home screen's requests: the songs a show's host could not find (`utils/songRequests`),
 * for the owner to make. "Find it" puts a request's words in the song search, where the
 * owner picks the recording; the request leaves the list when a song is started from that
 * search, or when it is removed here. Nothing is shown while no song is asked for.
 */

import React, { useState } from 'react';
import { Search, X } from 'lucide-react';
import { songRequestNote, type SongRequest } from '../../utils/songRequests';
import { Button, IconButton } from '../ui';

export interface SongRequestsProps {
  requests: SongRequest[];
  /** Puts the request's song in the song search. */
  onFind: (request: SongRequest) => void;
  /** Takes the request off the list; resolves to what went wrong, or null. */
  onRemove: (request: SongRequest) => Promise<string | null>;
}

const requestDate = (seconds: number): string =>
  seconds > 0
    ? new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : '';

export const SongRequests: React.FC<SongRequestsProps> = ({ requests, onFind, onRemove }) => {
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (requests.length === 0) return null;

  const remove = async (request: SongRequest) => {
    setRemoving(request.id);
    setError(null);
    const problem = await onRemove(request);
    setRemoving(null);
    setError(problem);
  };

  return (
    <section
      aria-labelledby="song-requests-heading"
      data-testid="song-requests"
      className="mt-10 border-t-2 border-theme-border pt-5 font-theme-body sm:mt-14 sm:pt-6"
    >
      <h2
        id="song-requests-heading"
        className="ks-display text-[28px] font-black text-theme-text sm:text-[36px]"
      >
        Requests
        <span className="ml-2 font-theme-body text-base font-semibold normal-case tabular-nums text-theme-text-muted">
          {requests.length}
        </span>
      </h2>
      <p className="mt-1 max-w-[70ch] text-pretty text-sm text-theme-text-muted">
        Songs asked for at a show that had no karaoke video and were not in the library. Find one to
        make it; it leaves this list when you start it.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-theme-danger">
          {error}
        </p>
      )}
      <ul className="mt-3 border-t border-theme-border-subtle">
        {requests.map((request) => {
          const note = [songRequestNote(request), requestDate(request.requested_at)]
            .filter(Boolean)
            .join(' · ');
          return (
            <li
              key={request.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-theme-border-subtle py-2 sm:flex-nowrap"
            >
              <div className="min-w-0 flex-1 basis-full sm:basis-0">
                <p className="break-words text-base font-semibold text-theme-text">
                  {request.song}
                </p>
                {note && (
                  <p className="break-words text-sm tabular-nums text-theme-text-muted">{note}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="secondary"
                  className="min-h-[44px]"
                  leftIcon={<Search className="h-4 w-4" aria-hidden="true" />}
                  aria-label={`Find the requested song ${request.song}`}
                  onClick={() => onFind(request)}
                >
                  Find it
                </Button>
                <IconButton
                  icon={<X className="h-4 w-4" aria-hidden="true" />}
                  label={`Remove the request for ${request.song}`}
                  className="min-h-[44px] min-w-[44px]"
                  disabled={removing === request.id}
                  onClick={() => void remove(request)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

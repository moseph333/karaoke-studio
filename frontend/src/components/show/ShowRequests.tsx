/**
 * A show's requested songs: what singers asked for that the host could not find, as the
 * server holds them. The host reads the list here; the owner makes the songs, or removes
 * the requests, on the studio's home screen. Nothing is listed until a song is asked for.
 */

import React from 'react';
import { songRequestNote, type SongRequest } from '../../utils/songRequests';

export interface ShowRequestsProps {
  requests: SongRequest[];
}

export const ShowRequests: React.FC<ShowRequestsProps> = ({ requests }) => {
  if (requests.length === 0) return null;
  return (
    <section aria-labelledby="show-requests-heading">
      <h2 id="show-requests-heading" className="ks-display text-[28px] font-black text-theme-text">
        Requested songs
        <span className="ml-2 font-theme-body text-base font-semibold normal-case tabular-nums text-theme-text-muted">
          {requests.length}
        </span>
      </h2>
      <p className="text-sm text-theme-text-muted">
        Songs that could not be found. They wait here until they are made in the studio.
      </p>
      <ul data-testid="show-requests" className="mt-2">
        {requests.map((request) => {
          const note = songRequestNote(request);
          return (
            <li key={request.id} className="border-b border-theme-border-subtle py-2">
              <p className="break-words text-sm font-semibold text-theme-text">{request.song}</p>
              {note && <p className="break-words text-sm text-theme-text-muted">{note}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

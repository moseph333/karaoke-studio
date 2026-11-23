/**
 * Song Loop Control (Stage look panel)
 *
 * The song's loop: a looping background video drawn from its lyrics on the server's cloud
 * GPU. The box holds the scene in words. Left empty, the scene is written from the lyrics;
 * once a loop exists it holds the scene that loop shows, which can be edited and made
 * again. Making one runs in the background (with Cancel) and replaces the loop the song
 * had; Remove deletes it.
 */

import React, { useState } from 'react';
import { Film, X } from 'lucide-react';
import type { SongLoop, SongLoopCapability, SongLoopJob } from '../../types';
import { isJobActive } from '../../utils/jobs';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Field';
import { ProgressBar } from '../ui/Progress';

export interface SongLoopControlProps {
  /** The song's loop; unset when it has none. */
  loop?: SongLoop | null;
  job?: SongLoopJob | null;
  /** What the server says about making loops; unknown while it loads. */
  capability?: SongLoopCapability | null;
  /** Makes the loop from this scene, or from the lyrics when the scene is empty. */
  onMake?: (prompt: string) => void;
  onCancel?: () => void;
  onRemove?: () => void;
}

const DEFAULT_MAX_CHARS = 600;

export const SongLoopControl: React.FC<SongLoopControlProps> = ({
  loop,
  job,
  capability,
  onMake,
  onCancel,
  onRemove,
}) => {
  const shown = loop?.prompt ?? '';
  const [text, setText] = useState(shown);
  // A new loop brings its own scene: the box follows it
  const [followed, setFollowed] = useState(shown);
  if (followed !== shown) {
    setFollowed(shown);
    setText(shown);
  }

  const active = isJobActive(job);
  const failed = job?.status === 'error';
  const unavailable =
    capability && !capability.available ? capability.reason || 'unavailable' : null;
  const cannot = unavailable ? `This server cannot make song loops: ${unavailable}` : null;
  const maxChars = capability?.max_prompt_chars ?? DEFAULT_MAX_CHARS;

  return (
    <section aria-labelledby="song-loop-heading" className="space-y-2" data-testid="song-loop">
      <div className="min-w-0">
        <h3 id="song-loop-heading" className="text-sm font-semibold text-theme-text">
          Song loop
        </h3>
        <p className="mt-0.5 text-xs text-theme-text-muted" data-testid="song-loop-label">
          {loop
            ? 'A moving picture made for this song'
            : 'A moving picture made for this song from its lyrics, which takes a few minutes'}
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="song-loop-scene" className="text-xs font-medium text-theme-text">
          What the loop shows
        </label>
        <Textarea
          id="song-loop-scene"
          rows={3}
          maxLength={maxChars}
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={active}
          placeholder="Leave empty to have it written from the lyrics"
          aria-describedby="song-loop-hint"
          className="min-h-[72px]"
        />
        <p id="song-loop-hint" className="text-xs leading-snug text-theme-text-muted">
          {loop
            ? 'Change the words and make it again, or clear them for a new scene from the lyrics.'
            : 'Scenery works best: the loop has no faces and no lettering.'}
        </p>
      </div>

      {!active && (
        <div className="flex flex-wrap items-center gap-2">
          {onMake && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Film className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={() => onMake(text.trim())}
              disabled={Boolean(cannot)}
              title={cannot ?? 'Draw a looping video of this scene behind the lyrics'}
            >
              {loop ? 'Make again' : 'Make a loop'}
            </Button>
          )}
          {loop && onRemove && (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
              onClick={onRemove}
              aria-label="Remove song loop"
            >
              Remove
            </Button>
          )}
        </div>
      )}

      {!active && cannot && (
        <p className="text-xs text-theme-text-muted" data-testid="song-loop-unavailable">
          {cannot}
        </p>
      )}

      {active && job && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate font-medium text-theme-text">
              Making the song loop
            </span>
            <span className="shrink-0 tabular-nums text-theme-text-muted">
              {Math.round(job.progress)}%
            </span>
          </div>
          <ProgressBar value={job.progress} label="Song loop progress" size="sm" />
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs text-theme-text-muted" title={job.detail}>
              {job.detail}
            </p>
            {onCancel && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={onCancel}
                aria-label="Cancel song loop"
                className="shrink-0"
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {failed && job && (
        <p className="text-xs text-theme-danger" data-testid="song-loop-error">
          {job.detail}
          {job.error ? ` (${job.error})` : ''}
        </p>
      )}
    </section>
  );
};

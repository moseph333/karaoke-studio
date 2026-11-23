/**
 * Song loops (the looping background video made from a song's lyrics): when the Stage look
 * panel has anything to show about them.
 */

import type { SongLoop, SongLoopCapability, SongLoopJob } from '../types';
import { isJobActive } from './jobs';

/** Whether the song loop control belongs on screen: the server can make loops (or is set up
 *  to and cannot right now), or the song already has one or is getting one. A server with no
 *  way to make them shows nothing. */
export function showsSongLoop({
  loop,
  job,
  capability,
}: {
  loop?: SongLoop | null;
  job?: SongLoopJob | null;
  capability?: SongLoopCapability | null;
}): boolean {
  return Boolean(loop || isJobActive(job) || capability?.available || capability?.runs_on);
}

/**
 * Background jobs on a finished song (`separation_job`, `sync_job`, `vocal_split_job`):
 * whether one is queued or running, and what a job that is keeps the others waiting for.
 */

import type { ProjectState } from '../types';

export const ACTIVE_JOB_STATUSES: readonly string[] = ['queued', 'running'];

/** Whether a job status means the job is queued or running. */
export const isActiveJobStatus = (status?: string | null): boolean =>
  Boolean(status && ACTIVE_JOB_STATUSES.includes(status));

/** Whether a job is queued or running. */
export const isJobActive = (job?: { status?: string } | null): boolean =>
  isActiveJobStatus(job?.status);

/** Why a vocal split of this song has to wait, in the server's own words, or null. */
export function vocalSplitBusyReason(
  project: Pick<ProjectState, 'separation_job' | 'sync_job' | 'render_status'>
): string | null {
  if (isJobActive(project.separation_job)) return 'Wait for the stems to finish re-making first';
  if (isJobActive(project.sync_job)) return 'Wait for the lyric re-alignment to finish first';
  if (project.render_status === 'queued' || project.render_status === 'rendering') {
    return 'Wait for the video render to finish first';
  }
  return null;
}

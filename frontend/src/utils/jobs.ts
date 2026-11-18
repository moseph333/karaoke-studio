/**
 * Background jobs on a finished song (`separation_job`, `sync_job`): whether one is queued
 * or running.
 */

export const ACTIVE_JOB_STATUSES: readonly string[] = ['queued', 'running'];

/** Whether a job status means the job is queued or running. */
export const isActiveJobStatus = (status?: string | null): boolean =>
  Boolean(status && ACTIVE_JOB_STATUSES.includes(status));

/** Whether a job is queued or running. */
export const isJobActive = (job?: { status?: string } | null): boolean =>
  isActiveJobStatus(job?.status);

import { ProjectState } from '../types';

const APP_NAME = 'Karaoke Studio';

const STAGE_LABELS: Partial<Record<ProjectState['status'], string>> = {
  queued: 'Queued',
  processing: 'Preparing',
  downloading: 'Downloading',
  separating: 'Separating',
  fetching_lyrics: 'Fetching lyrics',
  aligning: 'Aligning',
  mixing: 'Mixing',
};

/**
 * The browser tab title for what is on screen: the open song, and its progress while it is
 * being processed, so several tabs (or a background tab) can be told apart.
 */
export function pageTitle(
  project: Pick<ProjectState, 'title' | 'status' | 'progress'> | null
): string {
  if (!project) return APP_NAME;
  const song = project.title?.trim() || 'Untitled track';
  switch (project.status) {
    case 'ready':
      return `${song} — ${APP_NAME}`;
    case 'error':
      return `Processing failed — ${song} · ${APP_NAME}`;
    case 'cancelled':
      return `Cancelled — ${song} · ${APP_NAME}`;
    default: {
      const percent = Math.round(Math.max(0, Math.min(100, project.progress ?? 0)));
      const stage = STAGE_LABELS[project.status] ?? 'Processing';
      return `${percent}% · ${stage} — ${song} · ${APP_NAME}`;
    }
  }
}

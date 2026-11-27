/**
 * What a song puts behind its lyrics on the stage, for the chosen look and background style:
 * the studio's stage and a show's stage (the host screen) draw a library song from the same
 * inputs.
 */

import { useMemo } from 'react';
import type { ProjectState } from '../types';
import type { StageBackgroundStyle } from '../theme/stageBackgrounds';
import type { StageBackgroundMedia, UseVisualThemeReturn } from './useVisualTheme';

export interface ProjectStageInputs {
  /** The song's loop or the uploaded background, when that is the style. */
  backgroundMedia: StageBackgroundMedia | null;
  /** The style drawn: cover art for a song that has no loop to show. */
  backgroundStyle: StageBackgroundStyle;
  /** The cover art exactly as exports draw it (the larger, panned still for the drift). */
  artworkUrl: string | undefined;
}

type StageTheme = Pick<
  UseVisualThemeReturn,
  'backgroundStyle' | 'stageBackground' | 'aspectRatio' | 'selectedTheme'
>;

export function useProjectStageInputs(
  project: Pick<ProjectState, 'id' | 'thumbnail_url' | 'song_loop'>,
  theme: StageTheme
): ProjectStageInputs {
  // The song's loop is drawn like an uploaded video; a song without one shows its cover art
  const loopUrl = project.song_loop?.url;
  const showsLoop = theme.backgroundStyle === 'loop';
  const backgroundMedia = useMemo(
    () => (showsLoop && loopUrl ? { url: loopUrl, kind: 'video' as const } : theme.stageBackground),
    [showsLoop, loopUrl, theme.stageBackground]
  );
  const backgroundStyle = showsLoop && !loopUrl ? 'artwork' : theme.backgroundStyle;
  const artworkUrl = project.thumbnail_url
    ? `/api/project/${encodeURIComponent(project.id)}/backdrop?aspect=${
        theme.aspectRatio === '9:16' ? '9:16' : '16:9'
      }${theme.backgroundStyle === 'drift' ? '&drift=1' : ''}&look=${theme.selectedTheme.id}`
    : undefined;
  return { backgroundMedia, backgroundStyle, artworkUrl };
}

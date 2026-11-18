/**
 * Guide actions: carries out a `GuideAction` chosen in the song check-up, the first-song
 * card or Help. Lyric tools are opened through the commands the timeline editor registers
 * for the palette (their dialogs live inside the editor); the rest are the app's own
 * handlers.
 */

import { useCallback, useRef } from 'react';
import type { ProjectState, StudioWorkspaceTab } from '../types';
import { useCommandPalette } from '../components/commandPalette/context';
import { focusWorkspacePanel } from '../components/studio/workspacePanels';
import type { GuideAction } from '../utils/guideActions';
import { firstUncoveredVocalStart } from '../utils/songCheckup';
import { useToast } from './useToast';

export interface GuideActionTargets {
  project: ProjectState | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onSelectTab: (tab: StudioWorkspaceTab) => void;
  onOpenMix: () => void;
  onOpenExport: () => void;
  onOpenCheckup: () => void;
  /** Opens Help on its "Fix a problem" tab. */
  onOpenHelpFix: () => void;
  /** Closes the guidance dialog the action was chosen in, before the tool opens. */
  onCloseGuidance: () => void;
}

/**
 * The palette command behind each action that is one of the studio's own tools. `busy` says
 * why the command is not on offer right now. `timeline` marks tools whose dialog lives in
 * the timeline panel: on a phone that panel is hidden unless its tab is selected.
 */
const TOOL_COMMANDS: Partial<
  Record<
    GuideAction,
    { id: string; timeline?: boolean; busy: (project: ProjectState | null) => string }
  >
> = {
  'find-lyrics': {
    id: 'lyrics-replace',
    timeline: true,
    busy: () => 'Open a song first to change its lyrics',
  },
  offset: {
    id: 'lyrics-offset',
    timeline: true,
    busy: () => 'Open a song first to shift its timing',
  },
  duet: { id: 'lyrics-duet', timeline: true, busy: () => 'Open a song first to assign its parts' },
  'realign-all': {
    id: 'lyrics-realign-all',
    timeline: true,
    busy: (project) =>
      project && project.lines.length === 0
        ? 'This song has no lyrics to re-time yet. Add its lyrics first.'
        : 'The lyrics are already being re-timed',
  },
  'improve-stems': {
    id: 'stems-improve',
    busy: () => 'Wait for the job that is running on this song to finish first',
  },
};

/** A function with a fixed identity that performs a guide action on the open song. */
export function useGuideActions(targets: GuideActionTargets): (action: GuideAction) => void {
  const palette = useCommandPalette();
  const { toast } = useToast();
  const latest = useRef({ targets, palette });
  latest.current = { targets, palette };

  return useCallback(
    (action: GuideAction) => {
      const { targets: t, palette: commands } = latest.current;
      t.onCloseGuidance();

      const tool = TOOL_COMMANDS[action];
      if (tool) {
        if (tool.timeline) t.onSelectTab('timeline');
        if (!commands?.runCommand(tool.id)) toast.info(tool.busy(t.project));
        return;
      }
      switch (action) {
        case 'play':
          if (!t.isPlaying) t.onTogglePlay();
          break;
        case 'timeline':
          t.onSelectTab('timeline');
          focusWorkspacePanel('timeline');
          break;
        case 'review-lines':
          t.onSelectTab('timeline');
          // Not offered when the filter is already on: the lines are showing then
          commands?.runCommand('lyrics-review-show');
          focusWorkspacePanel('timeline');
          break;
        case 'uncovered-vocals': {
          const start = t.project ? firstUncoveredVocalStart(t.project) : null;
          t.onSelectTab('timeline');
          if (start !== null) t.onSeek(start);
          focusWorkspacePanel('timeline');
          break;
        }
        case 'mix':
          t.onOpenMix();
          break;
        case 'export':
          t.onOpenExport();
          break;
        case 'checkup':
          t.onOpenCheckup();
          break;
        case 'help-fix':
          t.onOpenHelpFix();
          break;
      }
    },
    [toast]
  );
}

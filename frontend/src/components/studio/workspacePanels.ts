/**
 * The studio's areas are tabs on phones (Stage / Timeline / Mix) and side by side from
 * `md` up, where the tab list is hidden and every area shows: only phones give them tab panel
 * semantics.
 */

import { useMediaQuery } from '../../hooks/useMediaQuery';
import type { StudioWorkspaceTab } from '../../types';

/** True while the workspace areas are tabs (below Tailwind's `md`, as the tab list). */
export function useWorkspaceTabs(): boolean {
  return !useMediaQuery('(min-width: 768px)');
}

/** Tab panel attributes for a workspace area while the areas are tabs. Side by side they are
 *  plain regions, still focusable from script (the key chip moves focus to the mix panel). */
export function workspacePanelProps(tab: StudioWorkspaceTab, asTabs: boolean) {
  return asTabs
    ? { role: 'tabpanel', 'aria-labelledby': `workspace-tab-${tab}`, tabIndex: 0 }
    : { tabIndex: -1 };
}

/** The element that takes focus when script moves to a workspace area. */
export const WORKSPACE_PANEL_IDS: Record<StudioWorkspaceTab, string> = {
  stage: 'workspace-panel-stage',
  timeline: 'workspace-panel-timeline',
  mix: 'workspace-panel-mix-audio',
};

/** Moves focus to a workspace area once the tab switch that shows it has rendered. */
export function focusWorkspacePanel(tab: StudioWorkspaceTab): void {
  window.requestAnimationFrame(() =>
    document.getElementById(WORKSPACE_PANEL_IDS[tab])?.focus({ preventScroll: false })
  );
}

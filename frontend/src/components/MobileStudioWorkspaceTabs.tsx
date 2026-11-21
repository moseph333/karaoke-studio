/**
 * Mobile Studio Workspace Tabs Component
 *
 * Segmented 3-tab workspace switcher for mobile viewports (< 768px):
 * 1. Stage: Live Karaoke Stage Preview
 * 2. Timeline: Word-by-Word Timeline Editor (with unsaved changes indicator)
 * 3. Mix & Look: the audio mix and the stage look
 *
 * Conforms to WAI-ARIA Tabs pattern with roving tabindex and keyboard navigation.
 * Uses theme semantic tokens and satisfies >= 44x44px touch target standards.
 * Hidden on desktop viewports (md:hidden).
 */

import React, { useRef } from 'react';
import { StudioWorkspaceTab } from '../types';
import { cn } from '../utils/cn';
import { focusRing } from './ui/variants';

export interface MobileStudioWorkspaceTabsProps {
  activeTab: StudioWorkspaceTab;
  onSelectTab?: (tab: StudioWorkspaceTab) => void;
  onTabChange?: (tab: StudioWorkspaceTab) => void;
  hasUnsavedChanges?: boolean;
  className?: string;
  'data-testid'?: string;
}

interface WorkspaceTabItem {
  id: StudioWorkspaceTab;
  label: string;
  ariaLabel: string;
  panelId: string;
}

const WORKSPACE_TABS: readonly WorkspaceTabItem[] = [
  {
    id: 'stage',
    label: 'Stage',
    ariaLabel: 'Stage preview workspace',
    panelId: 'workspace-panel-stage',
  },
  {
    id: 'timeline',
    label: 'Timeline',
    ariaLabel: 'Timeline editor workspace',
    panelId: 'workspace-panel-timeline',
  },
  {
    id: 'mix',
    label: 'Mix & Look',
    ariaLabel: 'Audio mix and stage look workspace',
    panelId: 'workspace-panel-mix',
  },
] as const;

export const MobileStudioWorkspaceTabs: React.FC<MobileStudioWorkspaceTabsProps> = ({
  activeTab,
  onSelectTab,
  onTabChange,
  hasUnsavedChanges = false,
  className,
  'data-testid': testId = 'mobile-studio-workspace-tabs',
}) => {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleSelect = (tab: StudioWorkspaceTab) => {
    onSelectTab?.(tab);
    onTabChange?.(tab);
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (index + 1) % WORKSPACE_TABS.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (index - 1 + WORKSPACE_TABS.length) % WORKSPACE_TABS.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = WORKSPACE_TABS.length - 1;
    }

    if (nextIndex >= 0) {
      const targetTab = WORKSPACE_TABS[nextIndex].id;
      handleSelect(targetTab);
      tabRefs.current[nextIndex]?.focus();
    }
  };

  return (
    <nav
      data-testid={testId}
      aria-label="Studio workspace navigation"
      className={cn('sticky top-[3.5rem] z-30 w-full bg-theme-bg md:hidden', className)}
    >
      <div
        role="tablist"
        aria-label="Studio workspace navigation sections"
        className="flex gap-x-6 border-b border-theme-border-subtle"
      >
        {WORKSPACE_TABS.map((tab, index) => {
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`workspace-tab-${tab.id}`}
              aria-controls={
                tab.id === 'mix'
                  ? 'workspace-panel-mix-audio workspace-panel-mix-theme'
                  : tab.panelId
              }
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => handleSelect(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                // Text tabs: the open one is underlined in yellow
                'ks-display relative -mb-px flex min-h-[44px] select-none items-center gap-1.5 border-b-[3px] text-[24px] transition-colors duration-150',
                focusRing,
                isActive
                  ? 'border-theme-accent text-theme-text'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text'
              )}
            >
              <span className="truncate">{tab.label}</span>
              {tab.id === 'timeline' && hasUnsavedChanges && (
                <span
                  data-testid="tab-unsaved-badge"
                  aria-label="Unsaved changes"
                  title="Unsaved changes in timeline"
                  className="ml-0.5 h-2 w-2 shrink-0 bg-theme-warning"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

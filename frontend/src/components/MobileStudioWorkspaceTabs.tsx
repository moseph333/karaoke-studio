/**
 * Mobile Studio Workspace Tabs Component (Milestone M1)
 *
 * Segmented 3-tab workspace switcher for mobile viewports (< 768px):
 * 1. Stage: Live Karaoke Stage Preview
 * 2. Timeline: Word-by-Word Timeline Editor (with unsaved changes indicator)
 * 3. Mix & Theme: Audio Stems Mixer & Visual Theme Settings
 *
 * Conforms to WAI-ARIA Tabs pattern with roving tabindex and keyboard navigation.
 * Uses theme semantic tokens and satisfies >= 44x44px touch target standards.
 * Hidden on desktop viewports (md:hidden).
 */

import React, { useRef } from 'react';
import { Tv, Edit3, Sliders } from 'lucide-react';
import { StudioWorkspaceTab } from '../types';

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
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  ariaLabel: string;
  panelId: string;
}

const WORKSPACE_TABS: readonly WorkspaceTabItem[] = [
  {
    id: 'stage',
    label: 'Stage',
    icon: Tv,
    ariaLabel: 'Stage preview workspace',
    panelId: 'workspace-panel-stage',
  },
  {
    id: 'timeline',
    label: 'Timeline',
    icon: Edit3,
    ariaLabel: 'Timeline editor workspace',
    panelId: 'workspace-panel-timeline',
  },
  {
    id: 'mix',
    label: 'Mix & Theme',
    icon: Sliders,
    ariaLabel: 'Audio mix and visual theme settings workspace',
    panelId: 'workspace-panel-mix',
  },
] as const;

export const MobileStudioWorkspaceTabs: React.FC<MobileStudioWorkspaceTabsProps> = ({
  activeTab,
  onSelectTab,
  onTabChange,
  hasUnsavedChanges = false,
  className = '',
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
      className={`w-full md:hidden mb-4 ${className}`.trim()}
    >
      <div
        role="tablist"
        aria-label="Studio workspace navigation sections"
        className="grid grid-cols-3 gap-1.5 p-1.5 rounded-theme-lg bg-theme-surface border border-theme-border shadow-theme-sm"
      >
        {WORKSPACE_TABS.map((tab, index) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;

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
              className={`relative flex items-center justify-center gap-1.5 px-2 py-2.5 min-h-[44px] rounded-theme-md text-xs sm:text-sm font-theme-heading font-bold transition-all focus:outline-none focus:ring-2 focus:ring-theme-accent focus:ring-offset-1 focus:ring-offset-theme-surface select-none ${
                isActive
                  ? 'bg-theme-accent text-theme-accent-text border border-theme-accent shadow-theme-sm'
                  : 'bg-theme-surface-subtle/60 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-subtle border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{tab.label}</span>
              {tab.id === 'timeline' && hasUnsavedChanges && (
                <span
                  data-testid="tab-unsaved-badge"
                  aria-label="Unsaved changes"
                  title="Unsaved changes in timeline"
                  className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0 ml-0.5"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

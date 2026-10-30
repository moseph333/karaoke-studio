/**
 * Mobile Studio Workspace Tabs Component
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
      className={cn(
        'sticky top-[3.5rem] z-30 w-full bg-theme-bg/85 py-2 backdrop-blur-xl md:hidden',
        className
      )}
    >
      <div
        role="tablist"
        aria-label="Studio workspace navigation sections"
        className="grid grid-cols-3 gap-1 rounded-theme-lg border border-theme-border-subtle bg-theme-surface-subtle p-1"
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
              className={cn(
                'relative flex min-h-[44px] select-none items-center justify-center gap-1.5 rounded-theme-md border px-2 py-2 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150 sm:text-sm',
                focusRing,
                isActive
                  ? 'border-theme-border-subtle bg-theme-surface-raised text-theme-text shadow-theme-sm'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text'
              )}
            >
              <Icon
                className={cn('h-4 w-4 shrink-0', isActive && 'text-theme-highlight')}
                aria-hidden="true"
              />
              <span className="truncate">{tab.label}</span>
              {tab.id === 'timeline' && hasUnsavedChanges && (
                <span
                  data-testid="tab-unsaved-badge"
                  aria-label="Unsaved changes"
                  title="Unsaved changes in timeline"
                  className="ml-0.5 h-2 w-2 shrink-0 rounded-full bg-theme-warning motion-safe:animate-pulse"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

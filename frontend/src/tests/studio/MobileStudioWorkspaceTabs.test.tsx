import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileStudioWorkspaceTabs } from '../../components/MobileStudioWorkspaceTabs';

describe('MobileStudioWorkspaceTabs Component', () => {
  it('renders tablist with role="tablist" and 3 tabs with role="tab"', () => {
    render(<MobileStudioWorkspaceTabs activeTab="stage" onTabChange={vi.fn()} />);

    const tablist = screen.getByRole('tablist', { name: /studio workspace navigation sections/i });
    expect(tablist).toBeInTheDocument();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveTextContent(/Stage/i);
    expect(tabs[1]).toHaveTextContent(/Timeline/i);
    expect(tabs[2]).toHaveTextContent(/Mix & Theme/i);
  });

  it('sets aria-selected="true" and tabIndex={0} on active tab, and false/-1 on inactive tabs', () => {
    render(<MobileStudioWorkspaceTabs activeTab="timeline" onTabChange={vi.fn()} />);

    const stageTab = screen.getByRole('tab', { name: /Stage/i });
    const timelineTab = screen.getByRole('tab', { name: /Timeline/i });
    const mixTab = screen.getByRole('tab', { name: /Mix & Theme/i });

    expect(timelineTab).toHaveAttribute('aria-selected', 'true');
    expect(timelineTab).toHaveAttribute('tabindex', '0');

    expect(stageTab).toHaveAttribute('aria-selected', 'false');
    expect(stageTab).toHaveAttribute('tabindex', '-1');

    expect(mixTab).toHaveAttribute('aria-selected', 'false');
    expect(mixTab).toHaveAttribute('tabindex', '-1');
  });

  it('calls onTabChange and onSelectTab when clicking a tab button', () => {
    const handleTabChange = vi.fn();
    const handleSelectTab = vi.fn();
    render(
      <MobileStudioWorkspaceTabs
        activeTab="stage"
        onTabChange={handleTabChange}
        onSelectTab={handleSelectTab}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: /Mix & Theme/i }));
    expect(handleTabChange).toHaveBeenCalledTimes(1);
    expect(handleTabChange).toHaveBeenCalledWith('mix');
    expect(handleSelectTab).toHaveBeenCalledTimes(1);
    expect(handleSelectTab).toHaveBeenCalledWith('mix');
  });

  it('supports roving arrow keyboard navigation (ArrowRight, ArrowLeft, Home, End)', () => {
    const handleTabChange = vi.fn();
    render(<MobileStudioWorkspaceTabs activeTab="stage" onTabChange={handleTabChange} />);

    const stageTab = screen.getByRole('tab', { name: /Stage/i });
    stageTab.focus();

    // ArrowRight -> timeline
    fireEvent.keyDown(stageTab, { key: 'ArrowRight' });
    expect(handleTabChange).toHaveBeenCalledWith('timeline');

    // ArrowLeft from stage wraps to mix
    fireEvent.keyDown(stageTab, { key: 'ArrowLeft' });
    expect(handleTabChange).toHaveBeenCalledWith('mix');

    // End -> mix
    fireEvent.keyDown(stageTab, { key: 'End' });
    expect(handleTabChange).toHaveBeenCalledWith('mix');

    // Home -> stage
    fireEvent.keyDown(stageTab, { key: 'Home' });
    expect(handleTabChange).toHaveBeenCalledWith('stage');
  });

  it('renders pulsing badge when hasUnsavedChanges is true', () => {
    const { rerender } = render(
      <MobileStudioWorkspaceTabs
        activeTab="stage"
        onTabChange={vi.fn()}
        hasUnsavedChanges={false}
      />
    );

    expect(screen.queryByTestId('tab-unsaved-badge')).not.toBeInTheDocument();

    rerender(
      <MobileStudioWorkspaceTabs activeTab="stage" onTabChange={vi.fn()} hasUnsavedChanges={true} />
    );

    expect(screen.getByTestId('tab-unsaved-badge')).toBeInTheDocument();
  });

  it('enforces min-h-[44px] touch target on all tab buttons', () => {
    render(<MobileStudioWorkspaceTabs activeTab="stage" onTabChange={vi.fn()} />);

    const tabs = screen.getAllByRole('tab');
    tabs.forEach((tab) => {
      expect(tab.className).toMatch(/min-h-\[44px\]/);
    });
  });

  it('applies md:hidden container class for responsive isolation', () => {
    render(<MobileStudioWorkspaceTabs activeTab="stage" onTabChange={vi.fn()} />);

    const nav = screen.getByTestId('mobile-studio-workspace-tabs');
    expect(nav.className).toMatch(/md:hidden/);
  });
});

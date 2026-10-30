/**
 * Accessible names and page structure: one h1 per view without skipped heading levels,
 * names that contain the visible label (WCAG 2.5.3), and tab panel semantics only where the
 * workspace areas are tabs.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import { TrackSearch } from '../../components/TrackSearch';
import { ProcessingView } from '../../components/ProcessingView';
import { LyricTimelineEditor } from '../../components/LyricTimelineEditor';
import { TimelineToolbar } from '../../components/timeline/TimelineToolbar';
import { StudioMetaHeader } from '../../components/StudioMetaHeader';
import { getLyricSyncFidelity, getStemsBadge } from '../../utils/syncStatus';
import { LyricLine, ProjectState } from '../../types';

const headingLevels = (root: HTMLElement) =>
  [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName[1]));

/** Exactly one h1, first, and no level skipped on the way down. */
const expectOrderedHeadings = (root: HTMLElement) => {
  const levels = headingLevels(root);
  expect(levels.filter((level) => level === 1)).toHaveLength(1);
  expect(levels[0]).toBe(1);
  levels.reduce((previous, level) => {
    expect(level).toBeLessThanOrEqual(previous + 1);
    return level;
  }, 0);
};

const song = (id: string, title: string): ProjectState => ({
  id,
  title,
  artist: 'Artist',
  status: 'ready',
  progress: 100,
  lines: [],
  semitones: 0,
  guide_volume: 0,
  created_by: 'Friend',
});

describe('heading structure', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify({ a: song('a', 'First Song'), b: song('b', 'Second Song') }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('library: one h1, then the song library, its tab and the song cards in order', async () => {
    const { container } = render(
      <TrackSearch onSelectTrack={vi.fn()} isLoading={false} currentUser="Friend" />
    );
    await screen.findByRole('heading', { level: 4, name: 'First Song' });
    expect(screen.getByRole('heading', { level: 3, name: 'My Songs' })).toBeInTheDocument();
    expectOrderedHeadings(container);
  });

  it('processing: the status heading is the view h1', () => {
    const { container } = render(
      <ProcessingView
        project={{ ...song('p', 'Processing Song'), status: 'separating', progress: 40 }}
        onCancelProcess={vi.fn()}
        onResetProject={vi.fn()}
      />
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('data-view-heading');
    expectOrderedHeadings(container);
  });

  it('timeline toolbar heading sits one level below the song title', () => {
    render(
      <TimelineToolbar
        lineCount={2}
        hasUnsavedChanges={false}
        isSaving={false}
        canUndo={false}
        canRedo={false}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onOpenOffset={vi.fn()}
        onOpenDuet={vi.fn()}
        onOpenReplace={vi.fn()}
        isTapToSyncActive={false}
        onToggleTapToSync={vi.fn()}
        onDiscard={vi.fn()}
        onSave={vi.fn()}
        filter="all"
        onFilterChange={vi.fn()}
        reviewCount={0}
      />
    );
    expect(screen.getAllByRole('heading').map((h) => h.tagName)).toEqual(['H2']);
  });
});

describe('names contain the visible label', () => {
  const toolbar = (overrides: Partial<React.ComponentProps<typeof TimelineToolbar>> = {}) =>
    render(
      <TimelineToolbar
        lineCount={2}
        hasUnsavedChanges
        isSaving={false}
        canUndo={false}
        canRedo={false}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onOpenOffset={vi.fn()}
        onOpenDuet={vi.fn()}
        onOpenReplace={vi.fn()}
        isTapToSyncActive={false}
        onToggleTapToSync={vi.fn()}
        onDiscard={vi.fn()}
        onSave={vi.fn()}
        filter="all"
        onFilterChange={vi.fn()}
        reviewCount={0}
        {...overrides}
      />
    );

  it.each([
    ['duet-assign-btn', 'Duet parts'],
    ['tap-to-sync-btn', 'Tap sync'],
    ['replace-lyrics-btn', 'Re-import'],
    ['batch-offset-btn', 'Offset'],
    ['save-lyrics-btn', 'Save'],
  ])('%s says "%s"', (testId, visible) => {
    toolbar();
    const button = screen.getByTestId(testId);
    expect(button).toHaveTextContent(visible);
    expect(button.getAttribute('aria-label')?.toLowerCase()).toContain(visible.toLowerCase());
  });

  it('the save button is named for what it shows while saving', () => {
    toolbar({ isSaving: true });
    const save = screen.getByTestId('save-lyrics-btn');
    expect(save).toHaveTextContent('Saving...');
    expect(save).toHaveAccessibleName('Saving timing changes');
  });

  it('the search button and the custom lyrics field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    render(<TrackSearch onSelectTrack={vi.fn()} isLoading={false} />);
    const go = screen.getByRole('button', { name: /search youtube or load track/i });
    expect(go.getAttribute('aria-label')).toMatch(/^Search \/ Go/);
    within(go)
      .getAllByText(/Go/)
      .forEach((label) => expect(go.getAttribute('aria-label')).toContain(label.textContent));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    vi.restoreAllMocks();
  });
});

describe('workspace panels', () => {
  const lines: LyricLine[] = [{ id: 1, text: 'One', start_time: 1, end_time: 2, words: [] }];
  const original = window.matchMedia;
  const setDesktop = (desktop: boolean) => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: desktop && query === '(min-width: 768px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  };
  afterEach(() => {
    window.matchMedia = original;
  });

  const renderEditor = () =>
    render(
      <LyricTimelineEditor
        lines={lines}
        currentTime={0}
        duration={10}
        onSeek={vi.fn()}
        onSaveLines={vi.fn()}
        activeWorkspaceTab="stage"
      />
    );

  it('are tab panels on phones', () => {
    setDesktop(false);
    renderEditor();
    const stage = screen.getByTestId('studio-panel-stage');
    expect(stage).toHaveAttribute('role', 'tabpanel');
    expect(stage).toHaveAttribute('aria-labelledby', 'workspace-tab-stage');
    expect(stage).toHaveAttribute('tabindex', '0');
  });

  it('are plain regions side by side on desktop, still focusable from script', () => {
    setDesktop(true);
    renderEditor();
    expect(screen.queryAllByRole('tabpanel')).toHaveLength(0);
    const timeline = screen.getByTestId('studio-panel-timeline');
    expect(timeline).not.toHaveAttribute('aria-labelledby');
    expect(timeline).toHaveAttribute('tabindex', '-1');
  });
});

describe('badge tooltips', () => {
  it('reach keyboard and screen reader users too: the badges take no focus', () => {
    const project: ProjectState = {
      ...song('meta', 'Meta Song'),
      lines: [{ id: 1, text: 'One', start_time: 1, end_time: 2, words: [] }],
      separation: { preset: 'balanced', label: 'Balanced · Mel-Band RoFormer' },
    };
    render(
      <StudioMetaHeader project={project} onOpenEditModal={vi.fn()} onOpenDeleteModal={vi.fn()} />
    );

    const sync = screen.getByTestId('sync-status-badge');
    expect(sync).not.toHaveAttribute('tabindex');
    expect(within(sync).getByTestId('sync-status-details')).toHaveClass('sr-only');
    expect(sync).toHaveTextContent(getLyricSyncFidelity(project).tooltipText);
    expect(screen.getByTestId('stems-badge')).toHaveTextContent(getStemsBadge(project).tooltip);
  });
});

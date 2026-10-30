import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { MobileStudioWorkspaceTabs } from '../components/MobileStudioWorkspaceTabs';
import { TransportDock } from '../components/transport/TransportDock';
import { ProjectState } from '../types';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  assertTouchTargets,
} from './helpers/responsiveTestUtils';

describe('Milestone M1: Mobile Studio Navigation & Transport Dock', () => {
  const readyProject: ProjectState = {
    id: 'm1-test-proj',
    title: 'Mobile Navigation Track',
    artist: 'Continuous Performer',
    status: 'ready',
    progress: 100,
    created_by: 'Explorer',
    lines: [
      {
        id: 1,
        text: 'First line of mobile lyric test',
        start_time: 1.0,
        end_time: 4.0,
        words: [
          { word: 'First', start_time: 1.0, end_time: 1.8 },
          { word: 'line', start_time: 1.8, end_time: 2.5 },
          { word: 'of', start_time: 2.5, end_time: 3.0 },
          { word: 'mobile', start_time: 3.0, end_time: 4.0 },
        ],
      },
      {
        id: 2,
        text: 'Second line of mobile lyric test',
        start_time: 5.0,
        end_time: 8.0,
        words: [
          { word: 'Second', start_time: 5.0, end_time: 6.0 },
          { word: 'line', start_time: 6.0, end_time: 8.0 },
        ],
      },
    ],
    semitones: 0,
    guide_volume: 0,
    master_audio_url: '/static/test-master.wav',
    instrumental_url: '/static/test-instrumental.wav',
    vocals_url: '/static/test-vocals.wav',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/?project=m1-test-proj');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/status')) {
        return new Response(JSON.stringify({ auth_required: false, authenticated: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/api/project/m1-test-proj')) {
        return new Response(JSON.stringify(readyProject), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/api/projects')) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    });
  });

  afterEach(() => {
    resetTestViewport();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Suite 1: Mobile Studio Workspace Navigation Tabs (< 768px)
  // =========================================================================
  describe('Suite 1: Mobile Studio Workspace Navigation Tabs', () => {
    it('T1.1: renders workspace tabs with role="tablist" on mobile viewports (< 768px)', async () => {
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Mobile Navigation Track')).toBeInTheDocument();
      });

      const tablist = screen.getByRole('tablist', { name: /studio workspace navigation/i });
      expect(tablist).toBeInTheDocument();
      expect(tablist.closest('nav')?.className).toContain('md:hidden');
    });

    it('T1.2: renders all 3 tabs (Stage, Timeline, Mix & Theme) with role="tab"', () => {
      render(<MobileStudioWorkspaceTabs activeTab="stage" onSelectTab={vi.fn()} />);

      const stageTab = screen.getByRole('tab', { name: /stage/i });
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      const mixTab = screen.getByRole('tab', { name: /mix/i });

      expect(stageTab).toBeInTheDocument();
      expect(timelineTab).toBeInTheDocument();
      expect(mixTab).toBeInTheDocument();
    });

    it('T1.3: sets aria-selected="true" on the active tab and aria-selected="false" on inactive tabs', () => {
      const { rerender } = render(
        <MobileStudioWorkspaceTabs activeTab="stage" onSelectTab={vi.fn()} />
      );

      expect(screen.getByRole('tab', { name: /stage/i })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: /timeline/i })).toHaveAttribute(
        'aria-selected',
        'false'
      );
      expect(screen.getByRole('tab', { name: /mix/i })).toHaveAttribute('aria-selected', 'false');

      rerender(<MobileStudioWorkspaceTabs activeTab="timeline" onSelectTab={vi.fn()} />);
      expect(screen.getByRole('tab', { name: /stage/i })).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByRole('tab', { name: /timeline/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.getByRole('tab', { name: /mix/i })).toHaveAttribute('aria-selected', 'false');
    });

    it('T1.4: calls onSelectTab with selected tab identifier when tab button is clicked', async () => {
      const user = userEvent.setup();
      const onSelectTab = vi.fn();
      render(<MobileStudioWorkspaceTabs activeTab="stage" onSelectTab={onSelectTab} />);

      await user.click(screen.getByRole('tab', { name: /timeline/i }));
      expect(onSelectTab).toHaveBeenCalledWith('timeline');

      await user.click(screen.getByRole('tab', { name: /mix/i }));
      expect(onSelectTab).toHaveBeenCalledWith('mix');
    });

    it('T1.5: supports keyboard navigation with ArrowRight, ArrowLeft, Home, and End keys', () => {
      const onSelectTab = vi.fn();
      render(<MobileStudioWorkspaceTabs activeTab="stage" onSelectTab={onSelectTab} />);

      const stageTab = screen.getByRole('tab', { name: /stage/i });
      stageTab.focus();

      fireEvent.keyDown(stageTab, { key: 'ArrowRight' });
      expect(onSelectTab).toHaveBeenCalledWith('timeline');

      fireEvent.keyDown(stageTab, { key: 'End' });
      expect(onSelectTab).toHaveBeenCalledWith('mix');

      fireEvent.keyDown(stageTab, { key: 'Home' });
      expect(onSelectTab).toHaveBeenCalledWith('stage');
    });

    it('T1.6: ensures all workspace tab buttons meet >= 44px touch target guidelines', () => {
      const { container } = render(
        <MobileStudioWorkspaceTabs activeTab="stage" onSelectTab={vi.fn()} />
      );
      const inspection = assertTouchTargets(container, 44);
      expect(inspection.failed).toHaveLength(0);
    });

    it('T1.7: cleanly resets activeWorkspaceTab to stage when project changes or resets', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Mobile Navigation Track')).toBeInTheDocument();
      });

      // Switch to mix tab
      const mixTab = screen.getByRole('tab', { name: /mix/i });
      await user.click(mixTab);
      expect(mixTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('studio-panel-audio').className).toContain('block');

      // Click "New Song" in header to reset project
      const newSongBtn = screen.getByRole('button', { name: /new song/i });
      await user.click(newSongBtn);

      // Verify workspace tablist unmounts on TrackSearch
      expect(
        screen.queryByRole('tablist', { name: /studio workspace navigation/i })
      ).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // Suite 2: Audio Element Persistence & State Preservation Across Mobile Tab Switches
  // =========================================================================
  describe('Suite 2: Audio Element Persistence & State Preservation', () => {
    it('T2.1: keeps native <audio> element mounted and referentially identical across tab transitions', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('audio-element')).toBeInTheDocument();
      });

      const audioElInitial = screen.getByTestId('audio-element');
      expect(audioElInitial).toBeInstanceOf(HTMLAudioElement);

      // Switch to Timeline tab
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      await user.click(timelineTab);

      // Verify audio element is still in DOM and referentially identical
      const audioElTimeline = screen.getByTestId('audio-element');
      expect(audioElTimeline).toBeInTheDocument();
      expect(audioElTimeline).toBe(audioElInitial); // Strict object equality proves zero unmount

      // Switch to Mix & Theme tab
      const mixTab = screen.getByRole('tab', { name: /mix/i });
      await user.click(mixTab);

      const audioElMix = screen.getByTestId('audio-element');
      expect(audioElMix).toBeInTheDocument();
      expect(audioElMix).toBe(audioElInitial);

      // Switch back to Stage tab
      const stageTab = screen.getByRole('tab', { name: /stage/i });
      await user.click(stageTab);

      const audioElStage = screen.getByTestId('audio-element');
      expect(audioElStage).toBeInTheDocument();
      expect(audioElStage).toBe(audioElInitial);
    });

    it('T2.2: maintains audio controls panel mounted in DOM via hidden md:block when inactive', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('studio-panel-audio')).toBeInTheDocument();
      });

      const audioPanel = screen.getByTestId('studio-panel-audio');
      // When stage tab is active, audio panel must have hidden md:block
      expect(audioPanel.className).toContain('hidden');
      expect(audioPanel.className).toContain('md:block');

      // Switch to Mix tab
      await user.click(screen.getByRole('tab', { name: /mix/i }));
      // When mix tab is active, audio panel must have block
      expect(audioPanel.className).toContain('block');
      expect(audioPanel.className).not.toMatch(/\bhidden\b/);
    });

    it('T2.3: maintains lyric timeline editor mounted in DOM when switching to stage or mix', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('studio-panel-timeline')).toBeInTheDocument();
      });

      const timelinePanel = screen.getByTestId('studio-panel-timeline');
      // On initial stage tab, timeline editor has hidden md:block
      expect(timelinePanel.className).toContain('hidden');
      expect(timelinePanel.className).toContain('md:block');

      // Switch to Timeline tab
      await user.click(screen.getByRole('tab', { name: /timeline/i }));
      expect(timelinePanel.className).toContain('block');
      expect(timelinePanel.className).not.toMatch(/\bhidden\b/);
    });

    it('T2.4: preserves unsaved lyric editor state when switching between mobile workspace tabs', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('studio-panel-timeline')).toBeInTheDocument();
      });

      // Switch to Timeline tab
      await user.click(screen.getByRole('tab', { name: /timeline/i }));

      // Perform a timing edit on the first line (+0.2s)
      const nudgePlusBtn = screen.getAllByRole('button', { name: /0\.2s later/i })[0];
      if (nudgePlusBtn) {
        await user.click(nudgePlusBtn);
        // Verify dirty indicator appears
        expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();

        // Switch to Stage tab
        await user.click(screen.getByRole('tab', { name: /stage/i }));

        // Switch back to Timeline tab
        await user.click(screen.getByRole('tab', { name: /timeline/i }));

        // Verify unsaved changes indicator is still present (state was not discarded)
        expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
      }
    });
  });

  // =========================================================================
  // Suite 3: Desktop Viewport Layout Continuity (>= 768px)
  // =========================================================================
  describe('Suite 3: Desktop Viewport Layout Continuity', () => {
    it('T3.1: simultaneously displays all studio panels at Tablet viewport (768px)', async () => {
      setTestViewport(768, 1024);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Mobile Navigation Track')).toBeInTheDocument();
      });

      // Workspace tabs must have md:hidden on tablet
      const tabsNav = screen
        .getByRole('tablist', { name: /studio workspace navigation/i })
        .closest('nav');
      expect(tabsNav?.className).toContain('md:hidden');

      // The transport dock stays available on tablet, docked in the layout flow
      const transport = screen.getByTestId('transport-dock');
      expect(transport.className).toContain('md:static');

      // All 4 panels must have md:block
      expect(screen.getByTestId('studio-panel-stage').className).toMatch(/block/);
      expect(screen.getByTestId('studio-panel-timeline').className).toMatch(/md:block/);
      expect(screen.getByTestId('studio-panel-audio').className).toMatch(/md:block/);
      expect(screen.getByTestId('studio-panel-theme').className).toMatch(/md:block/);
    });

    it('T3.2: simultaneously displays all studio panels at Desktop viewport (1280px)', async () => {
      setTestViewport(1280, 800);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Mobile Navigation Track')).toBeInTheDocument();
      });

      // Verify all panels are in document and have md:block
      const stagePanel = screen.getByTestId('studio-panel-stage');
      const timelinePanel = screen.getByTestId('studio-panel-timeline');
      const audioPanel = screen.getByTestId('studio-panel-audio');
      const themePanel = screen.getByTestId('studio-panel-theme');

      expect(stagePanel).toBeInTheDocument();
      expect(timelinePanel).toBeInTheDocument();
      expect(audioPanel).toBeInTheDocument();
      expect(themePanel).toBeInTheDocument();

      expect(timelinePanel.className).toContain('md:block');
      expect(audioPanel.className).toContain('md:block');
      expect(themePanel.className).toContain('md:block');
    });

    it('T3.3: reserves dock clearance below main on mobile and drops it on desktop', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Mobile Navigation Track')).toBeInTheDocument();
      });

      const mainEl = screen.getByRole('main');
      expect(mainEl.className).toContain('pb-[calc(var(--dock-height,8.5rem)+1rem)]');
      expect(mainEl.className).toContain('md:pb-0');
    });
  });

  // =========================================================================
  // Suite 4: Transport Dock (mobile mini-player)
  // =========================================================================
  describe('Suite 4: Transport Dock (mobile mini-player)', () => {
    const dockProps = {
      masterAudioUrl: '/static/test-master.wav',
      isPlaying: false,
      currentTime: 15,
      duration: 120,
      onTogglePlay: vi.fn(),
      onSeek: vi.fn(),
    };

    it('T4.1: docks to the bottom on phones with safe-area padding', () => {
      render(<TransportDock {...dockProps} />);

      const transport = screen.getByTestId('transport-dock');
      expect(transport.className).toContain('fixed');
      expect(transport.className).toContain('bottom-0');
      expect(transport.className).toContain('z-40');
      expect(transport.className).toContain('md:static');
      expect(transport.style.paddingBottom).toContain('safe-area-inset-bottom');
    });

    it('T4.2: toggles playback state when Play/Pause button is clicked', async () => {
      const user = userEvent.setup();
      const onTogglePlay = vi.fn();

      const { rerender } = render(
        <TransportDock {...dockProps} currentTime={0} duration={180} onTogglePlay={onTogglePlay} />
      );

      await user.click(screen.getByRole('button', { name: /start playback/i }));
      expect(onTogglePlay).toHaveBeenCalledTimes(1);

      rerender(
        <TransportDock
          {...dockProps}
          isPlaying
          currentTime={0}
          duration={180}
          onTogglePlay={onTogglePlay}
        />
      );

      await user.click(screen.getByRole('button', { name: /pause playback/i }));
      expect(onTogglePlay).toHaveBeenCalledTimes(2);
    });

    it('T4.3: calls onSeek when scrubbing the timeline', () => {
      const onSeek = vi.fn();
      render(<TransportDock {...dockProps} currentTime={20} duration={100} onSeek={onSeek} />);

      const scrubber = screen.getByRole('slider', { name: 'Audio timeline position' });
      fireEvent.change(scrubber, { target: { value: '45' } });
      expect(onSeek).toHaveBeenCalledWith(45);
    });

    it('T4.4: formats current playback time and total duration correctly', () => {
      render(<TransportDock {...dockProps} currentTime={75} duration={210} />);

      expect(screen.getByTestId('transport-time')).toHaveTextContent('1:15');
      expect(screen.getByTestId('transport-duration')).toHaveTextContent('3:30');
    });

    it('T4.5: shows the active key and tempo and opens mix settings on click', async () => {
      const user = userEvent.setup();
      const onOpenMixSettings = vi.fn();

      render(
        <TransportDock
          {...dockProps}
          currentTime={10}
          semitones={2}
          playbackRate={1.25}
          onOpenMixSettings={onOpenMixSettings}
        />
      );

      const chip = screen.getByRole('button', { name: /open mix settings/i });
      expect(chip).toHaveTextContent('+2 st');
      expect(chip).toHaveTextContent('1.25x');

      await user.click(chip);
      expect(onOpenMixSettings).toHaveBeenCalledTimes(1);
    });

    it('T4.6: ensures every dock control meets the >= 44px touch target requirement', () => {
      const { container } = render(<TransportDock {...dockProps} currentTime={0} />);
      const inspection = assertTouchTargets(container, 44);
      expect(inspection.failed).toHaveLength(0);
    });
  });

  // =========================================================================
  // Suite 5: Viewport Geometry & Zero Horizontal Overflow at 320px/375px
  // =========================================================================
  describe('Suite 5: Viewport Geometry & Overflow Validation', () => {
    it('T5.1: guarantees zero horizontal overflow at 375px Mobile Standard viewport', () => {
      const { container } = render(
        <TransportDock
          masterAudioUrl="/static/test-master.wav"
          isPlaying={false}
          currentTime={0}
          duration={100}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );
      assertZeroHorizontalOverflow(container, 375);
    });

    it('T5.2: guarantees zero horizontal overflow at 320px Mobile Small viewport', () => {
      const { container } = render(
        <MobileStudioWorkspaceTabs activeTab="stage" onSelectTab={vi.fn()} />
      );
      assertZeroHorizontalOverflow(container, 320);
    });
  });
});

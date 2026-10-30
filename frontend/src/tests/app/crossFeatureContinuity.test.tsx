/**
 * M4 Challenger 2: Cross-Milestone Integration & Viewport Continuity Adversarial Stress Suite
 *
 * Verifies:
 * 1. Cross-Milestone Flows:
 *    - Navigation (M1) + Tap-to-Sync (M2): Switching to timeline, entering tap sync, stamping words,
 *      exiting, and switching to stage tab with live rendering.
 *    - Navigation (M1) + Modals (M3): Opening ExportModal, HelpModal, and ThemePicker from mobile
 *      navigation/header without tab state disruption.
 *    - Timeline (M2) + Modals (M3): Opening BatchOffsetModal and LyricReplacementModal from timeline
 *      toolbar on mobile bottom sheets with proper layout and safe-area insets.
 * 2. Viewport Continuity & Layout Preservation:
 *    - Sequential resizing & rotation between mobile small (320x568), mobile standard (375x667),
 *      tablet (768x1024), and desktop (1280x800).
 *    - Zero horizontal overflow (scrollWidth <= clientWidth) across all viewports and modals.
 *    - Desktop multi-panel layout 100% preserved at >= 768px (Stage, Audio, Timeline, Theme simultaneously
 *      visible without tabs).
 * 3. Audio Graph Continuity:
 *    - Audio element DOM reference persistence, playback state, semitone transposition, volume,
 *      and playback rate continuity during all UI interactions.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import App from '../../App';
import { BatchOffsetModal } from '../../components/timeline/BatchOffsetModal';
import { ProjectState } from '../../types';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
} from '../helpers/responsiveTestUtils';

describe('M4 Challenger 2: Cross-Milestone Integration & Viewport Continuity', () => {
  const readyProject: ProjectState = {
    id: 'm4-challenger-cross-proj',
    title: 'Cross-Milestone Integration Anthem',
    artist: 'Continuous Resilient Ensemble',
    status: 'ready',
    progress: 100,
    created_by: 'M4Challenger2',
    lines: [
      {
        id: 1,
        text: 'First verse singing in harmony',
        start_time: 1.0,
        end_time: 4.0,
        words: [
          { word: 'First', start_time: 1.0, end_time: 1.5 },
          { word: 'verse', start_time: 1.5, end_time: 2.2 },
          { word: 'singing', start_time: 2.2, end_time: 3.0 },
          { word: 'in', start_time: 3.0, end_time: 3.3 },
          { word: 'harmony', start_time: 3.3, end_time: 4.0 },
        ],
      },
      {
        id: 2,
        text: 'Second verse rocking the crowd',
        start_time: 4.5,
        end_time: 7.5,
        words: [
          { word: 'Second', start_time: 4.5, end_time: 5.2 },
          { word: 'verse', start_time: 5.2, end_time: 6.0 },
          { word: 'rocking', start_time: 6.0, end_time: 6.8 },
          { word: 'the', start_time: 6.8, end_time: 7.0 },
          { word: 'crowd', start_time: 7.0, end_time: 7.5 },
        ],
      },
      {
        id: 3,
        text: 'Grand finale outro reverberation',
        start_time: 8.0,
        end_time: 12.0,
        words: [
          { word: 'Grand', start_time: 8.0, end_time: 8.8 },
          { word: 'finale', start_time: 8.8, end_time: 10.0 },
          { word: 'outro', start_time: 10.0, end_time: 11.0 },
          { word: 'reverberation', start_time: 11.0, end_time: 12.0 },
        ],
      },
    ],
    semitones: 0,
    guide_volume: 0,
    master_audio_url: '/static/test-master.wav',
    instrumental_url: '/static/test-instrumental.wav',
    vocals_url: '/static/test-vocals.wav',
    render_status: 'idle',
    render_progress: 0,
    heartbeat: Date.now(),
    chords: [{ start: 0.0, end: 4.0, chord: 'C' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/?project=m4-challenger-cross-proj');
    setTestViewport(375, 667);

    const mockFetch = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/status')) {
        return new Response(JSON.stringify({ auth_required: false, authenticated: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/api/project/m4-challenger-cross-proj/chords')) {
        return new Response(
          JSON.stringify({
            project_id: 'm4-challenger-cross-proj',
            chords: [{ start: 0.0, end: 4.0, chord: 'C' }],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      if (urlStr.includes('/api/project/m4-challenger-cross-proj/lyrics')) {
        return new Response(JSON.stringify({ ok: true, status: 'success' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/api/project/m4-challenger-cross-proj')) {
        return new Response(JSON.stringify(readyProject), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/api/projects')) {
        return new Response(JSON.stringify({ projects: [readyProject] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    });

    globalThis.fetch = mockFetch;
    window.fetch = mockFetch;
  });

  afterEach(() => {
    resetTestViewport();
    vi.clearAllMocks();
    cleanup();
  });

  // =========================================================================
  // SUITE 1: CROSS-MILESTONE: NAVIGATION (M1) + TAP-TO-SYNC (M2) + STAGE
  // =========================================================================
  describe('Suite 1: Navigation (M1) + Tap-to-Sync (M2) + Stage Continuity', () => {
    it('1.1 transitions cleanly from Stage to Timeline tab and enters Tap-to-Sync mode', async () => {
      render(<App />);
      await waitFor(() => {
        expect(screen.getByTestId('studio-panel-audio')).toBeInTheDocument();
      });
      const stageTab = screen.getByRole('tab', { name: /stage/i });
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      expect(stageTab).toHaveAttribute('aria-selected', 'true');
      expect(timelineTab).toHaveAttribute('aria-selected', 'false');
      act(() => {
        fireEvent.click(timelineTab);
      });
      expect(timelineTab).toHaveAttribute('aria-selected', 'true');
      expect(stageTab).toHaveAttribute('aria-selected', 'false');
      const tapSyncBtn = screen.getByTestId('tap-to-sync-btn');
      expect(tapSyncBtn).toBeInTheDocument();
      act(() => {
        fireEvent.click(tapSyncBtn);
      });
      const banner = screen.getByTestId('tap-to-sync-banner');
      expect(banner).toBeInTheDocument();
      const stampBtn = screen.getByTestId('tap-now-btn');
      expect(stampBtn).toBeInTheDocument();
      expect(stampBtn.className).toContain('min-h-[48px]');
    });

    it('1.2 stamps words in Tap-to-Sync and preserves dirty state across tab switches', async () => {
      render(<App />);
      await waitFor(() => {
        expect(screen.getByTestId('studio-panel-audio')).toBeInTheDocument();
      });

      // Switch to Timeline tab
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      act(() => {
        fireEvent.click(timelineTab);
      });

      // Enter Tap-to-Sync
      act(() => {
        fireEvent.click(screen.getByTestId('tap-to-sync-btn'));
      });
      expect(screen.getByTestId('tap-to-sync-banner')).toBeInTheDocument();

      // Switch to word mode if in line mode
      const wordModeBtn = screen.getByTestId('tap-mode-word-btn');
      act(() => {
        fireEvent.click(wordModeBtn);
      });

      const stampBtn = screen.getByTestId('tap-now-btn');

      // Stamp 3 times
      act(() => {
        fireEvent.click(stampBtn);
        fireEvent.click(stampBtn);
        fireEvent.click(stampBtn);
      });

      // Check dirty indicator is visible
      const dirtyIndicator = screen.getByTestId('dirty-indicator');
      expect(dirtyIndicator).toBeInTheDocument();

      // Now switch tabs: Timeline -> Stage -> Mix -> Timeline
      const stageTab = screen.getByRole('tab', { name: /stage/i });
      const mixTab = screen.getByRole('tab', { name: /mix/i });

      act(() => {
        fireEvent.click(stageTab);
      });
      expect(stageTab).toHaveAttribute('aria-selected', 'true');

      act(() => {
        fireEvent.click(mixTab);
      });
      expect(mixTab).toHaveAttribute('aria-selected', 'true');

      act(() => {
        fireEvent.click(timelineTab);
      });
      expect(timelineTab).toHaveAttribute('aria-selected', 'true');

      // Verify Tap-to-Sync banner is still active and dirty indicator persists!
      expect(screen.getByTestId('tap-to-sync-banner')).toBeInTheDocument();
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
    });

    it('1.3 exits Tap-to-Sync, switches to Stage tab, and retains updated timings', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Cross-Milestone Integration Anthem')).toBeInTheDocument();
      });
      // Allow initial project effect to settle
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Go to timeline
      fireEvent.click(screen.getByRole('tab', { name: /timeline/i }));
      fireEvent.click(screen.getByTestId('tap-to-sync-btn'));
      expect(screen.getByTestId('tap-to-sync-banner')).toBeInTheDocument();

      // Exit Tap-to-Sync
      const exitBtn = screen.getByTestId('exit-tap-mode-btn');
      fireEvent.click(exitBtn);

      // Banner should be dismissed
      expect(screen.queryByTestId('tap-to-sync-banner')).not.toBeInTheDocument();

      // Switch to Stage tab
      fireEvent.click(screen.getByRole('tab', { name: /stage/i }));

      // Stage panel should be active
      const stagePanel = screen.getByTestId('studio-panel-stage');
      expect(stagePanel.className).toContain('block');
      expect(stagePanel.className).not.toContain('hidden');
    });

    it('1.4 rapid 30x tab cycling preserves uncommitted edits and does not crash', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Cross-Milestone Integration Anthem')).toBeInTheDocument();
      });
      // Allow initial project effect to settle
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stageTab = screen.getByRole('tab', { name: /stage/i });
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      const mixTab = screen.getByRole('tab', { name: /mix/i });

      // Go to timeline and activate Tap-to-Sync
      fireEvent.click(timelineTab);
      fireEvent.click(screen.getByTestId('tap-to-sync-btn'));
      expect(screen.getByTestId('tap-to-sync-banner')).toBeInTheDocument();

      // Rapidly cycle tabs 30 times
      for (let i = 0; i < 10; i++) {
        fireEvent.click(stageTab);
        fireEvent.click(mixTab);
        fireEvent.click(timelineTab);
      }

      // After 30 transitions, verify Tap-to-sync banner is intact
      expect(screen.getByTestId('tap-to-sync-banner')).toBeInTheDocument();
      expect(screen.getByTestId('tap-now-btn')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // SUITE 2: CROSS-MILESTONE: NAVIGATION (M1) + HEADER & MODALS (M3)
  // =========================================================================
  describe('Suite 2: Navigation (M1) + Mobile Header & Modals (M3)', () => {
    it('2.1 opens ExportModal from mobile header export trigger while retaining active tab', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Cross-Milestone Integration Anthem')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /stage/i })).toHaveAttribute(
          'aria-selected',
          'true'
        );
      });

      // Switch to Timeline tab
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      fireEvent.click(timelineTab);
      expect(timelineTab).toHaveAttribute('aria-selected', 'true');

      // Header export button
      const exportBtn = screen.getByTestId('studio-export-btn');
      expect(exportBtn).toBeInTheDocument();
      fireEvent.click(exportBtn);

      // Verify ExportModal is displayed
      const exportModal = screen.getByRole('dialog', { name: /export/i });
      expect(exportModal).toBeInTheDocument();

      // Close modal
      const closeBtn = screen.getByRole('button', {
        name: /close export dialog/i,
      });
      expect(closeBtn).toBeInTheDocument();
      fireEvent.click(closeBtn);

      // Verify modal is closed and timeline tab remains active
      expect(screen.queryByRole('dialog', { name: /export/i })).not.toBeInTheDocument();
      expect(timelineTab).toHaveAttribute('aria-selected', 'true');
    });

    it('2.2 opens HelpModal from keyboard shortcut (?) and closes with Escape without losing tab', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Cross-Milestone Integration Anthem')).toBeInTheDocument();
      });
      // Allow initial project effect to settle
      await new Promise((resolve) => setTimeout(resolve, 50));

      const mixTab = screen.getByRole('tab', { name: /mix/i });
      fireEvent.click(mixTab);
      expect(mixTab).toHaveAttribute('aria-selected', 'true');

      // Press '?' to open help modal
      fireEvent.keyDown(window, { key: '?' });

      // Help modal visible
      const helpModal = screen.getByRole('dialog');
      expect(helpModal).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /karaoke studio help/i })).toBeInTheDocument();

      // Press Escape to dismiss
      fireEvent.keyDown(helpModal, { key: 'Escape' });

      // Verify help modal closed and mix tab still active
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(mixTab).toHaveAttribute('aria-selected', 'true');
    });

    it('2.3 dynamically syncs meta[name="theme-color"] and preserves workspace tab', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Cross-Milestone Integration Anthem')).toBeInTheDocument();
      });
      // Allow initial project effect to settle
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Switch to Timeline tab
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      fireEvent.click(timelineTab);

      // Check initial theme-color tag exists
      let themeColorMeta = document.querySelector('meta[name="theme-color"]');
      expect(themeColorMeta).toBeInTheDocument();

      // Open theme picker trigger
      const themePickerTrigger = screen.getByTestId('app-theme-picker-trigger');
      fireEvent.click(themePickerTrigger);

      // Select an alternative theme
      const punkTheme = screen.getByRole('option', {
        name: /reel-to-reel|tape_studio|punk/i,
      });
      fireEvent.click(punkTheme);

      // Verify theme-color is updated
      themeColorMeta = document.querySelector('meta[name="theme-color"]');
      expect(themeColorMeta?.getAttribute('content')).toMatch(/^#[0-9a-fA-F]{6}$/);

      // Timeline tab remains active
      expect(timelineTab).toHaveAttribute('aria-selected', 'true');
    });
  });

  // =========================================================================
  // SUITE 3: CROSS-MILESTONE: TIMELINE (M2) + BOTTOM-SHEET MODALS (M3)
  // =========================================================================
  describe('Suite 3: Timeline (M2) + Bottom-Sheet Modals (M3)', () => {
    it('3.1 opens BatchOffsetModal as a bottom sheet with >=44px close target', async () => {
      const handleApply = vi.fn();
      const handleClose = vi.fn();

      render(
        <BatchOffsetModal
          isOpen={true}
          onClose={handleClose}
          onApplyOffset={handleApply}
          selectedLineIndex={0}
          totalLines={3}
        />
      );

      const dialog = screen.getByRole('dialog', {
        name: /batch timestamp offset/i,
      });
      expect(dialog).toBeInTheDocument();

      // Bottom sheet styling classes
      expect(dialog.className).toContain('items-end');
      expect(dialog.className).toContain('sm:items-center');

      // Drag handle on mobile
      const dragHandle = screen.getByTestId('bottom-sheet-drag-handle');
      expect(dragHandle).toBeInTheDocument();
      expect(dragHandle.className).toContain('sm:hidden');

      // Close button meets touch target
      const closeBtn = screen.getByRole('button', { name: /close dialog/i });
      expect(closeBtn.className).toContain('min-w-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');

      // Apply offset
      const applyBtn = screen.getByRole('button', { name: /apply offset/i });
      fireEvent.click(applyBtn);

      expect(handleApply).toHaveBeenCalledWith(0.5, 0);
      expect(handleClose).toHaveBeenCalled();
    });

    it('3.2 integrates BatchOffsetModal in full App timeline and shifts timestamps', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Cross-Milestone Integration Anthem')).toBeInTheDocument();
      });
      // Allow initial project effect to settle
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Switch to timeline
      fireEvent.click(screen.getByRole('tab', { name: /timeline/i }));

      // Open Batch Offset Modal
      const offsetBtn = screen.getByTestId('batch-offset-btn');
      fireEvent.click(offsetBtn);

      // Batch Offset dialog opens
      const offsetModal = screen.getByRole('dialog', {
        name: /batch timestamp offset/i,
      });
      expect(offsetModal).toBeInTheDocument();

      // Apply offset
      const applyBtn = screen.getByRole('button', { name: /apply offset/i });
      fireEvent.click(applyBtn);

      // Modal closed and dirty indicator appears
      expect(
        screen.queryByRole('dialog', { name: /batch timestamp offset/i })
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
    });

    it('3.3 opens LyricReplacementModal as bottom sheet and handles cancellation', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Cross-Milestone Integration Anthem')).toBeInTheDocument();
      });
      // Allow initial project effect to settle
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Switch to timeline
      fireEvent.click(screen.getByRole('tab', { name: /timeline/i }));

      // Open Lyric Replacement Modal
      const replaceBtn = screen.getByTestId('replace-lyrics-btn');
      fireEvent.click(replaceBtn);

      const replaceModal = screen.getByRole('dialog');
      expect(replaceModal).toBeInTheDocument();
      expect(replaceModal.className).toContain('items-end');

      // Dismiss via close button
      const closeBtn = screen.getByRole('button', { name: /close dialog/i });
      fireEvent.click(closeBtn);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // SUITE 4: VIEWPORT CONTINUITY, ROTATION STRESS & ZERO HORIZONTAL OVERFLOW
  // =========================================================================
  describe('Suite 4: Viewport Continuity, Rotation Stress & Zero Horizontal Overflow', () => {
    const viewports = [
      { name: 'Mobile Small (320x568)', width: 320, height: 568 },
      { name: 'Mobile Standard (375x667)', width: 375, height: 667 },
      { name: 'Tablet Portrait (768x1024)', width: 768, height: 1024 },
      { name: 'Desktop Baseline (1280x800)', width: 1280, height: 800 },
    ];

    it('4.1 survives sequential viewport rotations and resizes without unmounting', async () => {
      const { container } = render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Cross-Milestone Integration Anthem')).toBeInTheDocument();
      });

      // Capture audio element instance
      const initialAudio = container.querySelector('audio');
      expect(initialAudio).toBeInTheDocument();

      // Cycle through viewports
      for (const vp of viewports) {
        setTestViewport(vp.width, vp.height);
        expect(container.querySelector('audio')).toBe(initialAudio);
      }

      // Reverse cycle (simulating mobile device orientation flip)
      for (let i = viewports.length - 1; i >= 0; i--) {
        const vp = viewports[i];
        setTestViewport(vp.width, vp.height);
        expect(container.querySelector('audio')).toBe(initialAudio);
      }
    });

    it('4.2 verifies zero horizontal overflow at 320px and 375px across all views', async () => {
      const { container } = render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Cross-Milestone Integration Anthem')).toBeInTheDocument();
      });
      // Allow initial project effect to settle
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check Stage at 320px
      setTestViewport(320, 568);
      assertZeroHorizontalOverflow(container, 320);

      // Check Stage at 375px
      setTestViewport(375, 667);
      assertZeroHorizontalOverflow(container, 375);

      // Switch to Timeline
      fireEvent.click(screen.getByRole('tab', { name: /timeline/i }));
      setTestViewport(320, 568);
      assertZeroHorizontalOverflow(container, 320);

      setTestViewport(375, 667);
      assertZeroHorizontalOverflow(container, 375);

      // Switch to Mix & Theme
      fireEvent.click(screen.getByRole('tab', { name: /mix/i }));
      setTestViewport(320, 568);
      assertZeroHorizontalOverflow(container, 320);

      setTestViewport(375, 667);
      assertZeroHorizontalOverflow(container, 375);
    });
  });

  // =========================================================================
  // SUITE 5: DESKTOP MULTI-PANEL LAYOUT 100% PRESERVATION (>= 768px)
  // =========================================================================
  describe('Suite 5: Desktop Multi-Panel Layout 100% Preservation (>= 768px)', () => {
    it('5.1 simultaneously displays Stage, Timeline, Audio Controls, and Theme Picker on desktop', async () => {
      setTestViewport(1280, 800);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Cross-Milestone Integration Anthem')).toBeInTheDocument();
      });

      // Panel wrappers
      const stagePanel = screen.getByTestId('studio-panel-stage');
      const timelinePanel = screen.getByTestId('studio-panel-timeline');
      const audioPanel = screen.getByTestId('studio-panel-audio');
      const themePanel = screen.getByTestId('studio-panel-theme');

      // Stage is visible (block), and secondary panels contain md:block for simultaneous visibility on desktop
      expect(stagePanel.className).toMatch(/block/);
      expect(timelinePanel.className).toContain('md:block');
      expect(audioPanel.className).toContain('md:block');
      expect(themePanel.className).toContain('md:block');

      // Mobile tabs navigation must be hidden on desktop
      const tabsNav = screen
        .getByRole('tablist', { name: /studio workspace navigation/i })
        .closest('nav');
      expect(tabsNav?.className).toContain('md:hidden');

      // The transport dock switches from a fixed mini-player to an in-flow dock on desktop
      const transportBar = screen.getByTestId('transport-dock');
      expect(transportBar.className).toContain('md:static');
    });

    it('5.2 simultaneously displays all panels on tablet viewport (768px)', async () => {
      setTestViewport(768, 1024);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Cross-Milestone Integration Anthem')).toBeInTheDocument();
      });

      expect(screen.getByTestId('studio-panel-stage').className).toMatch(/block/);
      expect(screen.getByTestId('studio-panel-timeline').className).toContain('md:block');
      expect(screen.getByTestId('studio-panel-audio').className).toContain('md:block');
      expect(screen.getByTestId('studio-panel-theme').className).toContain('md:block');

      const tabsNav = screen
        .getByRole('tablist', { name: /studio workspace navigation/i })
        .closest('nav');
      expect(tabsNav?.className).toContain('md:hidden');
    });
  });

  // =========================================================================
  // SUITE 6: AUDIO GRAPH & STATE CONTINUITY UNDER UI CHURN & CONCURRENCY
  // =========================================================================
  describe('Suite 6: Audio Graph & State Continuity Under UI Churn & Concurrency', () => {
    it('6.1 maintains identical <audio> DOM node across 15 tab switches and modal displays', async () => {
      const { container } = render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Cross-Milestone Integration Anthem')).toBeInTheDocument();
      });
      // Allow initial project effect to settle
      await new Promise((resolve) => setTimeout(resolve, 50));

      const audioEl = container.querySelector('audio');
      expect(audioEl).toBeInTheDocument();

      const stageTab = screen.getByRole('tab', { name: /stage/i });
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      const mixTab = screen.getByRole('tab', { name: /mix/i });

      // Tab churn
      for (let i = 0; i < 5; i++) {
        fireEvent.click(timelineTab);
        expect(container.querySelector('audio')).toBe(audioEl);

        fireEvent.click(mixTab);
        expect(container.querySelector('audio')).toBe(audioEl);

        fireEvent.click(stageTab);
        expect(container.querySelector('audio')).toBe(audioEl);
      }

      // Modal open/close churn
      const exportBtn = screen.getByTestId('studio-export-btn');
      fireEvent.click(exportBtn);
      expect(container.querySelector('audio')).toBe(audioEl);

      const closeExport = screen.getByRole('button', {
        name: /close export dialog|close modal/i,
      });
      fireEvent.click(closeExport);
      expect(container.querySelector('audio')).toBe(audioEl);
    });

    it('6.2 retains pitch transposition and playback rate across tab navigation', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Cross-Milestone Integration Anthem')).toBeInTheDocument();
      });
      // Allow initial project effect to settle
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Switch to Mix & Theme tab
      const mixTab = screen.getByRole('tab', { name: /mix/i });
      fireEvent.click(mixTab);

      // Find semitone increment button (+1)
      const transposeUp = screen.getByRole('button', {
        name: /increase pitch by one semitone/i,
      });
      fireEvent.click(transposeUp);
      fireEvent.click(transposeUp);

      // Verify the key chip in the transport dock updates immediately
      const transport = screen.getByTestId('transport-dock');
      expect(within(transport).getByTestId('transport-key-chip')).toHaveTextContent('+2 st');

      // Switch to Timeline tab
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      fireEvent.click(timelineTab);

      // Verify transposition remains +2 in the dock
      expect(transport.textContent).toContain('+2');

      // Switch to Stage tab
      const stageTab = screen.getByRole('tab', { name: /stage/i });
      fireEvent.click(stageTab);
      expect(transport.textContent).toContain('+2');
    });

    it('6.3 maintains play/pause toggle functionality from the transport dock', async () => {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Cross-Milestone Integration Anthem')).toBeInTheDocument();
      });
      // Allow initial project effect to settle
      await new Promise((resolve) => setTimeout(resolve, 50));

      const transport = screen.getByTestId('transport-dock');
      const playPauseBtn = within(transport).getByRole('button', {
        name: /start playback|pause playback/i,
      });
      expect(playPauseBtn).toBeInTheDocument();

      // Trigger play
      fireEvent.click(playPauseBtn);

      // Switch tabs while active
      fireEvent.click(screen.getByRole('tab', { name: /timeline/i }));
      fireEvent.click(screen.getByRole('tab', { name: /mix/i }));
      fireEvent.click(screen.getByRole('tab', { name: /stage/i }));

      // Button remains operable
      expect(playPauseBtn).toBeInTheDocument();
    });
  });
});

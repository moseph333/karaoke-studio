/**
 * Empirical Adversarial Challenge Test Suite for Milestone M1
 * (Mobile Studio Navigation & Sticky Transport)
 *
 * Verifies:
 * 1. Rapid tab switching during audio playback:
 *    - Native <audio> element is never unmounted across rapid switches
 *    - Audio playback state (playing vs paused) is uninterrupted
 *    - currentTime advances without backward drift or unexpected reset
 *    - Scrubbing/seeking from sticky transport works across all workspace tabs
 * 2. Editor state preservation & undo/redo stacks:
 *    - Uncommitted lyric timing edits survive tab transitions to Stage/Mix and back
 *    - Full multi-step undo/redo history stacks remain operable after switching tabs
 *    - Tab unsaved changes badge accurately reflects dirty state throughout
 * 3. Viewport geometry & zero horizontal overflow:
 *    - Zero horizontal overflow (scrollWidth <= clientWidth) at 320px, 375px, 768px, 1280px
 *    - Sizing and touch targets for mobile workspace tabs and sticky transport
 * 4. Boundary cases & resilient error handling:
 *    - NaN / zero duration resilience in mobile transport
 *    - Roving tabindex key navigation cycling stress
 *    - Audio completion ('ended') while background tab is active
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { MobileStudioWorkspaceTabs } from '../components/MobileStudioWorkspaceTabs';
import { TransportDock } from '../components/transport/TransportDock';
import { ProjectState } from '../types';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  detectHorizontalOverflow,
  assertTouchTargets,
} from './responsiveTestUtils';

describe('Milestone M1 Empirical Adversarial Challenge', () => {
  const challengeProject: ProjectState = {
    id: 'm1-challenge-proj',
    title: 'Adversarial Studio Mobile Test',
    artist: 'Empirical Challenger',
    status: 'ready',
    progress: 100,
    created_by: 'Challenger',
    lines: [
      {
        id: 101,
        text: 'The rhythm never stops when tabs change',
        start_time: 2.0,
        end_time: 6.0,
        words: [
          { word: 'The', start_time: 2.0, end_time: 2.5 },
          { word: 'rhythm', start_time: 2.5, end_time: 3.5 },
          { word: 'never', start_time: 3.5, end_time: 4.2 },
          { word: 'stops', start_time: 4.2, end_time: 5.0 },
          { word: 'when', start_time: 5.0, end_time: 5.4 },
          { word: 'tabs', start_time: 5.4, end_time: 5.7 },
          { word: 'change', start_time: 5.7, end_time: 6.0 },
        ],
      },
      {
        id: 102,
        text: 'State remains preserved across all panels',
        start_time: 7.0,
        end_time: 11.0,
        words: [
          { word: 'State', start_time: 7.0, end_time: 7.8 },
          { word: 'remains', start_time: 7.8, end_time: 8.6 },
          { word: 'preserved', start_time: 8.6, end_time: 9.6 },
          { word: 'across', start_time: 9.6, end_time: 10.2 },
          { word: 'all', start_time: 10.2, end_time: 10.5 },
          { word: 'panels', start_time: 10.5, end_time: 11.0 },
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
    window.history.pushState({}, '', '/?project=m1-challenge-proj');

    // Ensure HTMLMediaElement play() and pause() return proper browser Promises in JSDOM
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(function (this: HTMLMediaElement) {
        Object.defineProperty(this, 'paused', { value: false, configurable: true, writable: true });
        return Promise.resolve();
      }),
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(function (this: HTMLMediaElement) {
        Object.defineProperty(this, 'paused', { value: true, configurable: true, writable: true });
      }),
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/status')) {
        return new Response(JSON.stringify({ auth_required: false, authenticated: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/api/project/m1-challenge-proj')) {
        return new Response(JSON.stringify(challengeProject), {
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
  // Challenge 1: Rapid Tab Switching During Audio Playback
  // =========================================================================
  describe('Challenge 1: Rapid Tab Switching During Audio Playback', () => {
    it('C1.1: Audio element identity & continuous playback survive 50 rapid tab switches', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('audio-element')).toBeInTheDocument();
      });

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
      expect(audioEl).toBeInstanceOf(HTMLAudioElement);

      // Start audio playback via the transport dock play button
      const playBtn = screen.getByRole('button', { name: /start playback/i });
      await user.click(playBtn);

      // Verify playing state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /pause playback/i })).toBeInTheDocument();
      });

      const stageTab = screen.getByRole('tab', { name: /stage/i });
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      const mixTab = screen.getByRole('tab', { name: /mix/i });

      const tabs = [stageTab, timelineTab, mixTab];

      // Stress test: 50 rapid sequential tab switches
      for (let i = 0; i < 50; i++) {
        const targetTab = tabs[i % 3];
        fireEvent.click(targetTab);

        // Audio element must remain in DOM and referentially identical
        const currentAudio = screen.getByTestId('audio-element');
        expect(currentAudio).toBe(audioEl);

        // Dock play/pause button must remain in "Pause playback" (still playing) state
        expect(screen.getByTestId('transport-play-pause-btn')).toHaveAttribute(
          'aria-label',
          'Pause playback'
        );
      }
    });

    it('C1.2: currentTime advances monotonically during tab transitions without drift or reset', async () => {
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('audio-element')).toBeInTheDocument();
      });

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;

      // Start playback
      fireEvent.click(screen.getByRole('button', { name: /start playback/i }));

      const stageTab = screen.getByRole('tab', { name: /stage/i });
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      const mixTab = screen.getByRole('tab', { name: /mix/i });

      // Step 1: on Stage, advance to 2.5s
      act(() => {
        audioEl.currentTime = 2.5;
        fireEvent.timeUpdate(audioEl);
      });
      expect(screen.getByTestId('transport-time')).toHaveTextContent('0:02');

      // Switch to Timeline tab and advance to 4.5s
      fireEvent.click(timelineTab);
      act(() => {
        audioEl.currentTime = 4.5;
        fireEvent.timeUpdate(audioEl);
      });
      expect(screen.getByTestId('transport-time')).toHaveTextContent('0:04');

      // Switch to Mix tab and advance to 8.0s
      fireEvent.click(mixTab);
      act(() => {
        audioEl.currentTime = 8.0;
        fireEvent.timeUpdate(audioEl);
      });
      expect(screen.getByTestId('transport-time')).toHaveTextContent('0:08');

      // Switch back to Stage tab
      fireEvent.click(stageTab);
      // Verify time remained at 8.0s (no reset to 0:00)
      expect(screen.getByTestId('transport-time')).toHaveTextContent('0:08');
    });

    it('C1.3: Scrubbing from mobile transport while on Mix tab updates playhead and preserves state in Timeline', async () => {
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('audio-element')).toBeInTheDocument();
      });

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;

      // The browser reports the track duration once metadata has loaded
      act(() => {
        fireEvent.loadedMetadata(audioEl);
      });

      // Switch to Mix tab
      const mixTab = screen.getByRole('tab', { name: /mix/i });
      fireEvent.click(mixTab);

      // Scrub the dock timeline to 9.0s (inside Line 102)
      const scrubber = screen.getByRole('slider', { name: 'Audio timeline position' });
      fireEvent.change(scrubber, { target: { value: '9.0' } });

      expect(audioEl.currentTime).toBe(9.0);

      // Switch to Timeline tab
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      fireEvent.click(timelineTab);

      // Verify the dock time reflects the scrubbed position
      expect(screen.getByTestId('transport-time')).toHaveTextContent('0:09');

      // Verify Line 102 (starts at 7.0s, ends at 11.0s) is rendered and active
      expect(screen.getByText('State remains preserved across all panels')).toBeInTheDocument();
    });

    it('C1.4: Cross-tab play/pause toggle operations maintain consistent synchronized state', async () => {
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('audio-element')).toBeInTheDocument();
      });

      const stageTab = screen.getByRole('tab', { name: /stage/i });
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      const mixTab = screen.getByRole('tab', { name: /mix/i });

      // Start playing on Stage
      fireEvent.click(screen.getByRole('button', { name: /start playback/i }));
      await waitFor(() => {
        expect(screen.getByTestId('transport-play-pause-btn')).toHaveAttribute(
          'aria-label',
          'Pause playback'
        );
      });

      // Switch to Timeline: still playing
      fireEvent.click(timelineTab);
      expect(screen.getByTestId('transport-play-pause-btn')).toHaveAttribute(
        'aria-label',
        'Pause playback'
      );

      // Pause playback on Timeline
      fireEvent.click(screen.getByRole('button', { name: /pause playback/i }));
      await waitFor(() => {
        expect(screen.getByTestId('transport-play-pause-btn')).toHaveAttribute(
          'aria-label',
          'Start playback'
        );
      });

      // Switch to Mix: still paused
      fireEvent.click(mixTab);
      expect(screen.getByTestId('transport-play-pause-btn')).toHaveAttribute(
        'aria-label',
        'Start playback'
      );

      // Resume playback on Mix
      fireEvent.click(screen.getByRole('button', { name: /start playback/i }));
      await waitFor(() => {
        expect(screen.getByTestId('transport-play-pause-btn')).toHaveAttribute(
          'aria-label',
          'Pause playback'
        );
      });

      // Switch back to Stage: still playing
      fireEvent.click(stageTab);
      expect(screen.getByTestId('transport-play-pause-btn')).toHaveAttribute(
        'aria-label',
        'Pause playback'
      );
    });
  });

  // =========================================================================
  // Challenge 2: Editor State Preservation & Undo/Redo Stacks
  // =========================================================================
  describe('Challenge 2: Editor State Preservation & Undo/Redo Stacks', () => {
    it('C2.1: Multi-step undo/redo stack survives switching to Stage, Mix, and back to Timeline', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('studio-panel-timeline')).toBeInTheDocument();
      });

      const stageTab = screen.getByRole('tab', { name: /stage/i });
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      const mixTab = screen.getByRole('tab', { name: /mix/i });

      // Switch to Timeline tab
      await user.click(timelineTab);

      // Identify nudge buttons for line 1 and line 2
      const nudgePlusBtns = screen.getAllByRole('button', { name: /0\.2s later/i });
      expect(nudgePlusBtns.length).toBeGreaterThanOrEqual(2);

      // Action 1: Nudge line 1 (+0.2s: 2.0 -> 2.2s)
      await user.click(nudgePlusBtns[0]);
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('undo-lyrics-btn')).not.toBeDisabled();

      // Action 2: Nudge line 2 (+0.2s: 7.0 -> 7.2s)
      await user.click(nudgePlusBtns[1]);

      // Verify tab unsaved changes badge is present
      expect(screen.getByTestId('tab-unsaved-badge')).toBeInTheDocument();

      // Switch to Stage tab
      await user.click(stageTab);
      // Timeline tab button should show unsaved changes indicator while inactive
      expect(screen.getByTestId('tab-unsaved-badge')).toBeInTheDocument();

      // Switch to Mix tab
      await user.click(mixTab);
      expect(screen.getByTestId('tab-unsaved-badge')).toBeInTheDocument();

      // Switch back to Timeline tab
      await user.click(timelineTab);
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('undo-lyrics-btn')).not.toBeDisabled();

      // Stress test: Perform Undo step 1 (should undo line 2 nudge)
      await user.click(screen.getByTestId('undo-lyrics-btn'));

      // Switch to Stage and back to Timeline
      await user.click(stageTab);
      await user.click(timelineTab);

      // Perform Undo step 2 (should undo line 1 nudge)
      await user.click(screen.getByTestId('undo-lyrics-btn'));

      // Undo button should now be disabled (all edits undone)
      expect(screen.getByTestId('undo-lyrics-btn')).toBeDisabled();
      // Redo button should now be enabled
      expect(screen.getByTestId('redo-lyrics-btn')).not.toBeDisabled();

      // Switch to Mix and back to Timeline
      await user.click(mixTab);
      await user.click(timelineTab);

      // Stress test: Redo step 1
      await user.click(screen.getByTestId('redo-lyrics-btn'));
      expect(screen.getByTestId('undo-lyrics-btn')).not.toBeDisabled();

      // Redo step 2
      await user.click(screen.getByTestId('redo-lyrics-btn'));
      expect(screen.getByTestId('redo-lyrics-btn')).toBeDisabled();
      expect(screen.getByTestId('undo-lyrics-btn')).not.toBeDisabled();
    });

    it('C2.2: Selected line expansion survives switching away and returning', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('studio-panel-timeline')).toBeInTheDocument();
      });

      const stageTab = screen.getByRole('tab', { name: /stage/i });
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });

      await user.click(timelineTab);

      // Expand line 1 by clicking its expand/chevron trigger
      const expandBtns = screen.getAllByRole('button', { name: /expand word timings/i });
      if (expandBtns.length > 0) {
        await user.click(expandBtns[0]);
        // Expanded word editor or expanded card should be visible
        expect(screen.getByRole('button', { name: /collapse word timings/i })).toBeInTheDocument();

        // Switch to Stage tab
        await user.click(stageTab);

        // Switch back to Timeline tab
        await user.click(timelineTab);

        // Expand state should remain preserved
        expect(screen.getByRole('button', { name: /collapse word timings/i })).toBeInTheDocument();
      }
    });
  });

  // =========================================================================
  // Challenge 3: Viewport Geometry & Zero Horizontal Overflow
  // =========================================================================
  describe('Challenge 3: Viewport Geometry & Zero Horizontal Overflow', () => {
    const viewports = [
      { name: 'Mobile Small', width: 320, height: 568 },
      { name: 'Mobile Standard', width: 375, height: 667 },
      { name: 'Tablet Portrait', width: 768, height: 1024 },
      { name: 'Desktop Standard', width: 1280, height: 800 },
    ];

    for (const vp of viewports) {
      it(`C3.1: Zero horizontal overflow on entire App at ${vp.name} (${vp.width}px)`, async () => {
        setTestViewport(vp.width, vp.height);
        const { container } = render(<App />);

        await waitFor(() => {
          expect(screen.getByTestId('audio-element')).toBeInTheDocument();
        });

        // Test across each tab on mobile or full layout on desktop
        if (vp.width < 768) {
          const stageTab = screen.getByRole('tab', { name: /stage/i });
          const timelineTab = screen.getByRole('tab', { name: /timeline/i });
          const mixTab = screen.getByRole('tab', { name: /mix/i });

          // Test on Stage tab
          fireEvent.click(stageTab);
          const stageViolations = detectHorizontalOverflow(container, vp.width);
          expect(stageViolations, `Overflow on Stage tab at ${vp.width}px`).toHaveLength(0);

          // Test on Timeline tab
          fireEvent.click(timelineTab);
          const timelineViolations = detectHorizontalOverflow(container, vp.width);
          expect(timelineViolations, `Overflow on Timeline tab at ${vp.width}px`).toHaveLength(0);

          // Test on Mix tab
          fireEvent.click(mixTab);
          const mixViolations = detectHorizontalOverflow(container, vp.width);
          expect(mixViolations, `Overflow on Mix tab at ${vp.width}px`).toHaveLength(0);
        } else {
          // On tablet / desktop: all panels visible simultaneously
          const violations = detectHorizontalOverflow(container, vp.width);
          expect(violations, `Overflow on Desktop/Tablet at ${vp.width}px`).toHaveLength(0);
        }

        assertZeroHorizontalOverflow(container, vp.width);
      });
    }

    it('C3.2: TransportDock strictly fits within 320px viewport without overflow', () => {
      const { container } = render(
        <TransportDock
          masterAudioUrl="/static/m1-master.wav"
          currentTime={85}
          duration={240}
          isPlaying={true}
          semitones={-2}
          playbackRate={0.8}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
          onOpenMixSettings={vi.fn()}
        />
      );

      const violations = detectHorizontalOverflow(container, 320);
      expect(violations).toHaveLength(0);

      const inspection = assertTouchTargets(container, 44);
      expect(inspection.failed).toHaveLength(0);
    });

    it('C3.3: MobileStudioWorkspaceTabs component strictly fits within 320px viewport without overflow', () => {
      const { container } = render(
        <MobileStudioWorkspaceTabs
          activeTab="timeline"
          hasUnsavedChanges={true}
          onSelectTab={vi.fn()}
        />
      );

      const violations = detectHorizontalOverflow(container, 320);
      expect(violations).toHaveLength(0);

      const inspection = assertTouchTargets(container, 44);
      expect(inspection.failed).toHaveLength(0);
    });
  });

  // =========================================================================
  // Challenge 4: Edge Cases & Boundary Resilience
  // =========================================================================
  describe('Challenge 4: Edge Cases & Boundary Resilience', () => {
    it('C4.1: TransportDock handles duration=0, duration=NaN, currentTime=NaN gracefully', () => {
      const { rerender } = render(
        <TransportDock
          currentTime={NaN}
          duration={0}
          isPlaying={false}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      // Should display 0:00 / 0:00 and not "NaN:NaN"
      expect(screen.getByTestId('transport-time')).toHaveTextContent('0:00');
      expect(screen.getByTestId('transport-duration')).toHaveTextContent('0:00');

      rerender(
        <TransportDock
          currentTime={-5}
          duration={NaN}
          isPlaying={false}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );
      expect(screen.getByTestId('transport-time')).toHaveTextContent('0:00');
      expect(screen.getByTestId('transport-duration')).toHaveTextContent('0:00');
    });

    it('C4.2: Keyboard navigation on workspace tabs cycles correctly under stress', () => {
      const onSelectTab = vi.fn();
      render(<MobileStudioWorkspaceTabs activeTab="stage" onSelectTab={onSelectTab} />);

      const stageTab = screen.getByRole('tab', { name: /stage/i });
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      const mixTab = screen.getByRole('tab', { name: /mix/i });

      // Press ArrowRight from stage (index 0 -> index 1 timeline)
      fireEvent.keyDown(stageTab, { key: 'ArrowRight' });
      expect(onSelectTab).toHaveBeenLastCalledWith('timeline');

      // Press ArrowRight from timeline (index 1 -> index 2 mix)
      fireEvent.keyDown(timelineTab, { key: 'ArrowRight' });
      expect(onSelectTab).toHaveBeenLastCalledWith('mix');

      // Press ArrowRight from mix (index 2 -> index 0 stage)
      fireEvent.keyDown(mixTab, { key: 'ArrowRight' });
      expect(onSelectTab).toHaveBeenLastCalledWith('stage');

      // End key jumps to last tab (mix)
      fireEvent.keyDown(stageTab, { key: 'End' });
      expect(onSelectTab).toHaveBeenLastCalledWith('mix');

      // Home key jumps to first tab (stage)
      fireEvent.keyDown(mixTab, { key: 'Home' });
      expect(onSelectTab).toHaveBeenLastCalledWith('stage');
    });

    it('C4.3: Audio ended event fires while on background tab, updating transport state', async () => {
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('audio-element')).toBeInTheDocument();
      });

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;

      // Start audio
      fireEvent.click(screen.getByRole('button', { name: /start playback/i }));
      await waitFor(() => {
        expect(screen.getByTestId('transport-play-pause-btn')).toHaveAttribute(
          'aria-label',
          'Pause playback'
        );
      });

      // Switch to Mix tab
      fireEvent.click(screen.getByRole('tab', { name: /mix/i }));

      // Dispatch ended event on audio element
      act(() => {
        fireEvent.ended(audioEl);
      });

      // The dock must now offer Start playback
      await waitFor(() => {
        expect(screen.getByTestId('transport-play-pause-btn')).toHaveAttribute(
          'aria-label',
          'Start playback'
        );
      });
    });

    it('C4.4: Resizing viewport dynamically from mobile (375px) to desktop (1280px) and back maintains active tab', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('audio-element')).toBeInTheDocument();
      });

      // Switch to Mix tab on mobile
      await user.click(screen.getByRole('tab', { name: /mix/i }));
      expect(screen.getByRole('tab', { name: /mix/i })).toHaveAttribute('aria-selected', 'true');

      // Dynamically resize to desktop
      act(() => {
        setTestViewport(1280, 800);
      });

      // Desktop layout renders all panels simultaneously (using 'block' or 'md:block')
      expect(screen.getByTestId('studio-panel-stage').className).toMatch(/block/);
      expect(screen.getByTestId('studio-panel-timeline').className).toMatch(/block/);
      expect(screen.getByTestId('studio-panel-audio').className).toMatch(/block/);
      expect(screen.getByTestId('studio-panel-theme').className).toMatch(/block/);

      // Resize back to mobile
      act(() => {
        setTestViewport(375, 667);
      });

      // Mix tab should still be selected
      expect(screen.getByRole('tab', { name: /mix/i })).toHaveAttribute('aria-selected', 'true');
    });
  });
});

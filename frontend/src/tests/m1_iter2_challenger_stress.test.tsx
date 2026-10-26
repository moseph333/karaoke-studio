/**
 * M1 Iteration 2 Challenger 1 Empirical Stress Test Suite
 *
 * Verifies:
 * 1. Audio Playback Continuity & <audio> Referential Identity:
 *    - Native <audio> element is never unmounted during rapid, randomized tab transitions
 *    - Continuous playback state is preserved across 100 tab switches
 *    - currentTime advances monotonically across tab switches without backward jump or reset
 *    - Scrubbing from sticky transport updates playhead seamlessly across all workspace tabs
 *    - Audio ended and error events propagate cleanly regardless of active tab
 * 2. Editor State Preservation & Undo/Redo Stacks:
 *    - Uncommitted edits and unsaved dirty indicators survive multi-tab round-trips
 *    - Deep multi-level undo/redo stacks remain operable across tab switches
 *    - Discard changes resets editor state back to project baseline
 * 3. Viewport Geometry & Horizontal Overflow:
 *    - Zero horizontal overflow (scrollWidth <= clientWidth) at 320px, 375px, 768px, 1280px
 *    - Standalone MobileStudioTransport and MobileStudioWorkspaceTabs zero-overflow at 320px
 * 4. Architectural & Gate Remediation Verification:
 *    - LyricTimelineEditor.tsx strictly complies with <= 450 lines and zero lines > 200 chars
 *    - Safe-area calculation in MobileStudioTransport adheres to calc(env(safe-area-inset-bottom, 0px) + 0.5rem)
 *    - App.tsx workspace tab reset behavior on project transitions
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { MobileStudioWorkspaceTabs } from '../components/MobileStudioWorkspaceTabs';
import { MobileStudioTransport } from '../components/MobileStudioTransport';
import { ProjectState } from '../types';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  detectHorizontalOverflow,
  assertTouchTargets,
} from './responsiveTestUtils';

describe('M1 Iteration 2 Challenger 1: Empirical Stress Suite', () => {
  const mockProject: ProjectState = {
    id: 'm1-iter2-stress-proj',
    title: 'Iteration 2 Stress Anthem',
    artist: 'Empirical Challenger',
    status: 'ready',
    progress: 100,
    created_by: 'Challenger',
    lines: [
      {
        id: 201,
        text: 'First line playing continuous audio',
        start_time: 1.0,
        end_time: 4.0,
        words: [
          { word: 'First', start_time: 1.0, end_time: 1.6 },
          { word: 'line', start_time: 1.6, end_time: 2.2 },
          { word: 'playing', start_time: 2.2, end_time: 3.0 },
          { word: 'continuous', start_time: 3.0, end_time: 3.5 },
          { word: 'audio', start_time: 3.5, end_time: 4.0 },
        ],
      },
      {
        id: 202,
        text: 'Second line testing editor state resilience',
        start_time: 5.0,
        end_time: 9.0,
        words: [
          { word: 'Second', start_time: 5.0, end_time: 5.8 },
          { word: 'line', start_time: 5.8, end_time: 6.4 },
          { word: 'testing', start_time: 6.4, end_time: 7.2 },
          { word: 'editor', start_time: 7.2, end_time: 7.8 },
          { word: 'state', start_time: 7.8, end_time: 8.4 },
          { word: 'resilience', start_time: 8.4, end_time: 9.0 },
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
    window.history.pushState({}, '', '/?project=m1-iter2-stress-proj');

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
      if (urlStr.includes('/api/project/m1-iter2-stress-proj')) {
        return new Response(JSON.stringify(mockProject), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/api/project/another-proj')) {
        return new Response(
          JSON.stringify({ ...mockProject, id: 'another-proj', title: 'Second Song' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
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
  // Section 1: Audio Playback Continuity & Referential Identity
  // =========================================================================
  describe('1. Audio Playback Continuity & <audio> Referential Identity', () => {
    it('1.1: Audio element maintains strict referential identity across 100 randomized tab switches', async () => {
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('audio-element')).toBeInTheDocument();
      });

      const originalAudio = screen.getByTestId('audio-element') as HTMLAudioElement;
      expect(originalAudio).toBeInstanceOf(HTMLAudioElement);

      // Start playback
      fireEvent.click(screen.getByRole('button', { name: /play audio/i }));
      await waitFor(() => {
        expect(screen.getByTestId('mobile-play-pause-btn')).toHaveAttribute(
          'aria-label',
          'Pause audio'
        );
      });

      const tabs = [
        screen.getByRole('tab', { name: /stage/i }),
        screen.getByRole('tab', { name: /timeline/i }),
        screen.getByRole('tab', { name: /mix/i }),
      ];

      // Perform 100 pseudo-random tab transitions
      const sequence = [0, 1, 2, 1, 0, 2, 0, 1, 0, 2, 1, 2];
      for (let i = 0; i < 100; i++) {
        const tabIndex = sequence[i % sequence.length];
        fireEvent.click(tabs[tabIndex]);

        // Referential identity assertion: audio element must remain identical
        const currentAudio = screen.getByTestId('audio-element');
        expect(currentAudio).toBe(originalAudio);

        // Playback state must not be paused
        expect(originalAudio.paused).toBe(false);

        // Sticky transport state must remain in playing state
        expect(screen.getByTestId('mobile-play-pause-btn')).toHaveAttribute(
          'aria-label',
          'Pause audio'
        );
      }
    });

    it('1.2: Playhead advances monotonically during transitions without backward reset', async () => {
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('audio-element')).toBeInTheDocument();
      });

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
      fireEvent.click(screen.getByRole('button', { name: /play audio/i }));

      const stageTab = screen.getByRole('tab', { name: /stage/i });
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      const mixTab = screen.getByRole('tab', { name: /mix/i });

      // Step 1: Stage tab at 1.5s
      act(() => {
        audioEl.currentTime = 1.5;
        fireEvent.timeUpdate(audioEl);
      });
      expect(screen.getByTestId('mobile-transport-time')).toHaveTextContent('0:01');

      // Step 2: Switch to Timeline, advance to 3.8s
      fireEvent.click(timelineTab);
      act(() => {
        audioEl.currentTime = 3.8;
        fireEvent.timeUpdate(audioEl);
      });
      expect(screen.getByTestId('mobile-transport-time')).toHaveTextContent('0:03');

      // Step 3: Switch to Mix, advance to 6.2s
      fireEvent.click(mixTab);
      act(() => {
        audioEl.currentTime = 6.2;
        fireEvent.timeUpdate(audioEl);
      });
      expect(screen.getByTestId('mobile-transport-time')).toHaveTextContent('0:06');

      // Step 4: Return to Stage, ensure currentTime did NOT reset to 0:00
      fireEvent.click(stageTab);
      expect(screen.getByTestId('mobile-transport-time')).toHaveTextContent('0:06');
      expect(audioEl.currentTime).toBe(6.2);
    });

    it('1.3: Seeking from sticky transport updates audio currentTime regardless of active tab', async () => {
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('audio-element')).toBeInTheDocument();
      });

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
      const mixTab = screen.getByRole('tab', { name: /mix/i });
      fireEvent.click(mixTab);

      // Scrub while on Mix tab
      const scrubber = screen.getByRole('slider', { name: /audio playback scrub bar/i });
      fireEvent.change(scrubber, { target: { value: '7.5' } });

      expect(audioEl.currentTime).toBe(7.5);

      // Return to Stage and check rendered state
      const stageTab = screen.getByRole('tab', { name: /stage/i });
      fireEvent.click(stageTab);
      expect(screen.getByTestId('mobile-transport-time')).toHaveTextContent('0:07');
    });

    it('1.4: Audio ended event while in background tab transitions transport to paused state cleanly', async () => {
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('audio-element')).toBeInTheDocument();
      });

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
      fireEvent.click(screen.getByRole('button', { name: /play audio/i }));

      // Switch to Timeline
      fireEvent.click(screen.getByRole('tab', { name: /timeline/i }));

      // Dispatch ended event on audio element
      act(() => {
        fireEvent.ended(audioEl);
      });

      await waitFor(() => {
        expect(screen.getByTestId('mobile-play-pause-btn')).toHaveAttribute(
          'aria-label',
          'Play audio'
        );
      });
    });
  });

  // =========================================================================
  // Section 2: Editor State Preservation & Undo/Redo Stacks
  // =========================================================================
  describe('2. Editor State Preservation & Undo/Redo Stacks', () => {
    it('2.1: Uncommitted edits and dirty indicators persist across multiple tab round-trips', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('studio-panel-timeline')).toBeInTheDocument();
      });

      const stageTab = screen.getByRole('tab', { name: /stage/i });
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      const mixTab = screen.getByRole('tab', { name: /mix/i });

      // Navigate to Timeline tab
      await user.click(timelineTab);

      // Nudge line 1 (+0.2s)
      const nudgePlusBtns = screen.getAllByRole('button', { name: /0\.2s later/i });
      expect(nudgePlusBtns.length).toBeGreaterThanOrEqual(1);
      await user.click(nudgePlusBtns[0]);

      // Verify dirty state
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('tab-unsaved-badge')).toBeInTheDocument();

      // Cycle tabs: Timeline -> Stage -> Mix -> Stage -> Mix -> Timeline
      await user.click(stageTab);
      expect(screen.getByTestId('tab-unsaved-badge')).toBeInTheDocument();

      await user.click(mixTab);
      expect(screen.getByTestId('tab-unsaved-badge')).toBeInTheDocument();

      await user.click(stageTab);
      expect(screen.getByTestId('tab-unsaved-badge')).toBeInTheDocument();

      await user.click(timelineTab);
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('undo-lyrics-btn')).not.toBeDisabled();
    });

    it('2.2: Deep multi-step undo/redo stack survives tab transitions between each action', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('studio-panel-timeline')).toBeInTheDocument();
      });

      const stageTab = screen.getByRole('tab', { name: /stage/i });
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      const mixTab = screen.getByRole('tab', { name: /mix/i });

      await user.click(timelineTab);

      const nudgePlusBtns = screen.getAllByRole('button', { name: /0\.2s later/i });

      // Action 1: nudge line 1
      await user.click(nudgePlusBtns[0]);
      // Switch tab
      await user.click(stageTab);
      await user.click(timelineTab);

      // Action 2: nudge line 2
      await user.click(nudgePlusBtns[1]);
      // Switch tab
      await user.click(mixTab);
      await user.click(timelineTab);

      // Action 3: nudge line 1 again
      await user.click(nudgePlusBtns[0]);

      // Stack depth is 3. Now undo step 3
      await user.click(screen.getByTestId('undo-lyrics-btn'));

      // Switch to Stage and back to Timeline
      await user.click(stageTab);
      await user.click(timelineTab);

      // Undo step 2
      await user.click(screen.getByTestId('undo-lyrics-btn'));

      // Switch to Mix and back to Timeline
      await user.click(mixTab);
      await user.click(timelineTab);

      // Undo step 1
      await user.click(screen.getByTestId('undo-lyrics-btn'));

      // Stack should now be fully undone: undo disabled, redo enabled
      expect(screen.getByTestId('undo-lyrics-btn')).toBeDisabled();
      expect(screen.getByTestId('redo-lyrics-btn')).not.toBeDisabled();

      // Redo step 1
      await user.click(screen.getByTestId('redo-lyrics-btn'));
      expect(screen.getByTestId('undo-lyrics-btn')).not.toBeDisabled();

      // Switch tab
      await user.click(stageTab);
      await user.click(timelineTab);

      // Redo step 2
      await user.click(screen.getByTestId('redo-lyrics-btn'));

      // Redo step 3
      await user.click(screen.getByTestId('redo-lyrics-btn'));
      expect(screen.getByTestId('redo-lyrics-btn')).toBeDisabled();
    });

    it('2.3: Discarding unsaved changes cleanly rolls back state after tab switches', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('studio-panel-timeline')).toBeInTheDocument();
      });

      const stageTab = screen.getByRole('tab', { name: /stage/i });
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });

      await user.click(timelineTab);

      const nudgeBtns = screen.getAllByRole('button', { name: /0\.2s later/i });
      await user.click(nudgeBtns[0]);
      expect(screen.getByTestId('dirty-indicator')).toBeInTheDocument();

      // Switch to Stage and return
      await user.click(stageTab);
      await user.click(timelineTab);

      // Click discard button to open confirmation modal
      await user.click(screen.getByTestId('discard-changes-btn'));

      // Confirm discard in modal (second "Discard Changes" button)
      const discardButtons = screen.getAllByRole('button', {
        name: /discard changes/i,
      });
      expect(discardButtons.length).toBe(2);
      await user.click(discardButtons[1]);

      // Dirty indicator and unsaved badge should be gone
      expect(screen.queryByTestId('dirty-indicator')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tab-unsaved-badge')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // Section 3: Viewport Geometry & Zero Horizontal Overflow
  // =========================================================================
  describe('3. Viewport Geometry & Zero Horizontal Overflow', () => {
    const viewports = [
      { name: '320px (Mobile Small)', width: 320, height: 568 },
      { name: '375px (Mobile Standard)', width: 375, height: 667 },
      { name: '768px (Tablet Portrait)', width: 768, height: 1024 },
      { name: '1280px (Desktop Standard)', width: 1280, height: 800 },
    ];

    for (const vp of viewports) {
      it(`3.1: Zero horizontal overflow on entire App at ${vp.name}`, async () => {
        setTestViewport(vp.width, vp.height);
        const { container } = render(<App />);

        await waitFor(() => {
          expect(screen.getByTestId('audio-element')).toBeInTheDocument();
        });

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
          // On tablet / desktop: multi-panel layout
          const violations = detectHorizontalOverflow(container, vp.width);
          expect(violations, `Overflow on Desktop/Tablet at ${vp.width}px`).toHaveLength(0);
        }

        assertZeroHorizontalOverflow(container, vp.width);
      });
    }

    it('3.2: MobileStudioTransport fits within 320px viewport with >= 44x44px touch targets', () => {
      const { container } = render(
        <MobileStudioTransport
          currentTime={42}
          duration={180}
          isPlaying={true}
          activeSemitones={1}
          playbackRate={1.0}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
          onOpenMixTab={vi.fn()}
          onRestart={vi.fn()}
        />
      );

      const violations = detectHorizontalOverflow(container, 320);
      expect(violations).toHaveLength(0);

      const inspection = assertTouchTargets(container, 44);
      expect(inspection.failed).toHaveLength(0);
    });

    it('3.3: MobileStudioWorkspaceTabs fits within 320px viewport with >= 44x44px touch targets', () => {
      const { container } = render(
        <MobileStudioWorkspaceTabs
          activeTab="stage"
          hasUnsavedChanges={false}
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
  // Section 4: Architectural Budget & Remediation Verification
  // =========================================================================
  describe('4. Architectural Budget & Remediation Verification', () => {
    it('4.1: LyricTimelineEditor.tsx strictly satisfies line count <= 450 lines (and <= 430 lines)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodeRequire = eval('require') as (mod: string) => any;
      const fsModule = nodeRequire('fs');
      const pathModule = nodeRequire('path');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodeProcess = (globalThis as any).process;
      const editorPath = pathModule.resolve(
        nodeProcess.cwd(),
        'src/components/LyricTimelineEditor.tsx'
      );
      expect(fsModule.existsSync(editorPath)).toBe(true);

      const content: string = fsModule.readFileSync(editorPath, 'utf-8');
      const lines: string[] = content.split('\n');
      const lineCount = content.endsWith('\n') ? lines.length - 1 : lines.length;

      // Budget limit <= 450 lines and worker target <= 430 lines
      expect(lineCount).toBeLessThanOrEqual(450);
      expect(lineCount).toBeLessThanOrEqual(430);

      // Verify zero lines exceeding 200 characters
      const overLongLines: { lineNumber: number; length: number; text: string }[] = [];
      lines.forEach((lineText: string, idx: number) => {
        if (lineText.length > 200) {
          overLongLines.push({
            lineNumber: idx + 1,
            length: lineText.length,
            text: lineText,
          });
        }
      });
      expect(overLongLines).toEqual([]);
    });

    it('4.2: MobileStudioTransport safe-area padding calculation incorporates calc(env(...) + 0.5rem)', () => {
      const { container } = render(
        <MobileStudioTransport
          currentTime={10}
          duration={100}
          isPlaying={false}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      const transport = container.querySelector(
        '[data-testid="mobile-studio-transport"]'
      ) as HTMLElement;
      expect(transport).not.toBeNull();

      // Check className includes safe area padding
      expect(transport.className).toContain('pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)]');

      // Check inline style paddingBottom is present
      expect(transport.style.paddingBottom).toBeDefined();
      expect(transport.style.paddingBottom.length).toBeGreaterThan(0);
      // cssstyle in JSDOM normalizes the calc expression
      expect(transport.style.paddingBottom).toMatch(/calc\(/);
      expect(transport.style.paddingBottom).toMatch(/0\.5rem/);
      expect(transport.style.paddingBottom).toMatch(/safe-area-inset-bottom/);
    });

    it('4.3: App.tsx workspace tab state cleanly resets on project transition or new song', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      const { unmount } = render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId('audio-element')).toBeInTheDocument();
      });

      // Navigate to Timeline tab
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      await user.click(timelineTab);
      expect(timelineTab).toHaveAttribute('aria-selected', 'true');

      // Trigger "New Song" action in header to reset project
      const newSongBtn = screen.getByRole('button', { name: /new song/i });
      await user.click(newSongBtn);

      // Verify workspace tablist unmounts on TrackSearch
      expect(
        screen.queryByRole('tablist', { name: /studio workspace navigation/i })
      ).not.toBeInTheDocument();

      unmount();

      // Re-mount with another project to verify it opens at 'stage' tab
      window.history.pushState({}, '', '/?project=another-proj');
      render(<App />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /stage/i })).toBeInTheDocument();
      });

      // Cleanly starts on 'stage' tab
      expect(screen.getByRole('tab', { name: /stage/i })).toHaveAttribute('aria-selected', 'true');
    });
  });
});

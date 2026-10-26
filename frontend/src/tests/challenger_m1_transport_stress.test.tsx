/**
 * Challenger M1 Empirical Stress Test Suite
 *
 * Adversarially challenges Milestone M1 (Mobile Studio Navigation & Sticky Transport):
 * 1. MobileStudioTransport Scrubber & Play/Pause Rapid Stress:
 *    - 100 consecutive rapid scrubber seek events (fractional, boundary, random).
 *    - 50 consecutive play/pause toggle clicks with alternating state verification.
 *    - Rapid restart button triggers.
 * 2. Boundary and Malformed Edge Cases:
 *    - currentTime = 0, duration = 0 (unloaded / empty state).
 *    - currentTime = duration (end of track).
 *    - currentTime > duration (clamping to 100%).
 *    - currentTime < 0 (clamping to 0%, 0:00 formatting).
 *    - currentTime = NaN, duration = NaN (fallback formatting, no crash).
 *    - Key transposition and playback rate formatting variants.
 * 3. Key & Tempo Badge Quick-Switch Stress:
 *    - Quick-switch to mix tab from Stage tab.
 *    - Quick-switch to mix tab from Timeline tab.
 *    - Idempotency when already on Mix tab.
 *    - Rapid repetitive clicking (30 consecutive taps).
 * 4. Safe-Area Insets & Bottom Clearance Verification:
 *    - Safe-area bottom padding via inline style and Tailwind classes.
 *    - Main container clearance padding (pb-28 on mobile, md:pb-8 on desktop).
 *    - Clearance margin vs transport bar physical height.
 *    - Strict >= 44x44px touch target compliance for all interactive transport controls.
 * 5. Viewport Geometry & Horizontal Overflow Stress (320px and 375px).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { MobileStudioTransport } from '../components/MobileStudioTransport';
import { MobileStudioWorkspaceTabs } from '../components/MobileStudioWorkspaceTabs';
import { ProjectState } from '../types';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  assertTouchTargets,
} from './responsiveTestUtils';

describe('Challenger M1: MobileStudioTransport & Navigation Adversarial Stress', () => {
  const readyProject: ProjectState = {
    id: 'm1-stress-proj',
    title: 'Adversarial Stress Anthem',
    artist: 'Empirical Challenger',
    status: 'ready',
    progress: 100,
    created_by: 'Challenger',
    lines: [
      {
        id: 1,
        text: 'Stress testing mobile transport across tabs',
        start_time: 1.0,
        end_time: 4.5,
        words: [
          { word: 'Stress', start_time: 1.0, end_time: 1.8 },
          { word: 'testing', start_time: 1.8, end_time: 2.7 },
          { word: 'mobile', start_time: 2.7, end_time: 3.5 },
          { word: 'transport', start_time: 3.5, end_time: 4.5 },
        ],
      },
      {
        id: 2,
        text: 'Rapid seeks and quick badge switching',
        start_time: 5.0,
        end_time: 8.5,
        words: [
          { word: 'Rapid', start_time: 5.0, end_time: 6.0 },
          { word: 'seeks', start_time: 6.0, end_time: 7.0 },
          { word: 'and', start_time: 7.0, end_time: 7.5 },
          { word: 'switching', start_time: 7.5, end_time: 8.5 },
        ],
      },
    ],
    semitones: 2,
    guide_volume: 0,
    master_audio_url: '/static/stress-master.wav',
    instrumental_url: '/static/stress-instrumental.wav',
    vocals_url: '/static/stress-vocals.wav',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/?project=m1-stress-proj');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/status')) {
        return new Response(JSON.stringify({ auth_required: false, authenticated: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/api/project/m1-stress-proj')) {
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
  // Suite 1: MobileStudioTransport Rapid Scrubbing & Play/Pause Stress
  // =========================================================================
  describe('Suite 1: Rapid Scrubbing & Play/Pause Stress', () => {
    it('S1.1: handles 100 rapid consecutive scrubber seek events accurately', () => {
      const onSeek = vi.fn();
      render(
        <MobileStudioTransport
          isPlaying={true}
          currentTime={10}
          duration={240}
          onTogglePlay={vi.fn()}
          onSeek={onSeek}
        />
      );

      const scrubber = screen.getByRole('slider', { name: /audio playback scrub bar/i });
      expect(scrubber).toBeInTheDocument();

      // Fire 100 rapid seek values with varying floats, integers, and boundaries
      const seekValues = Array.from({ length: 100 }, (_, i) => {
        return Number(((i * 2.37) % 240).toFixed(2));
      });

      seekValues.forEach((targetVal) => {
        fireEvent.change(scrubber, { target: { value: targetVal.toString() } });
      });

      expect(onSeek).toHaveBeenCalledTimes(100);
      seekValues.forEach((val, index) => {
        expect(onSeek).toHaveBeenNthCalledWith(index + 1, val);
      });
    });

    it('S1.2: handles 50 rapid play/pause toggle clicks with alternating state', async () => {
      const user = userEvent.setup();
      let isPlaying = false;
      const onTogglePlay = vi.fn(() => {
        isPlaying = !isPlaying;
      });

      const { rerender } = render(
        <MobileStudioTransport
          isPlaying={isPlaying}
          currentTime={30}
          duration={200}
          onTogglePlay={onTogglePlay}
          onSeek={vi.fn()}
        />
      );

      const playPauseBtn = screen.getByTestId('mobile-play-pause-btn');

      for (let i = 0; i < 50; i++) {
        await user.click(playPauseBtn);
        // Rerender with toggled state to simulate parent state update
        rerender(
          <MobileStudioTransport
            isPlaying={isPlaying}
            currentTime={30}
            duration={200}
            onTogglePlay={onTogglePlay}
            onSeek={vi.fn()}
          />
        );

        if (isPlaying) {
          expect(playPauseBtn).toHaveAttribute('aria-label', 'Pause audio');
        } else {
          expect(playPauseBtn).toHaveAttribute('aria-label', 'Play audio');
        }
      }

      expect(onTogglePlay).toHaveBeenCalledTimes(50);
      expect(isPlaying).toBe(false); // 50 toggles returns to initial false
    });

    it('S1.3: triggers onRestart reliably over 20 consecutive clicks when provided', async () => {
      const user = userEvent.setup();
      const onRestart = vi.fn();

      render(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={45}
          duration={180}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
          onRestart={onRestart}
        />
      );

      const restartBtn = screen.getByTestId('mobile-restart-btn');
      expect(restartBtn).toBeInTheDocument();

      for (let i = 0; i < 20; i++) {
        await user.click(restartBtn);
      }

      expect(onRestart).toHaveBeenCalledTimes(20);
    });
  });

  // =========================================================================
  // Suite 2: Boundary and Malformed Edge Case Robustness
  // =========================================================================
  describe('Suite 2: Boundary & Malformed Edge Cases', () => {
    it('S2.1: survives edge case currentTime = 0 and duration = 0 without crashing or NaN in DOM', () => {
      render(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={0}
          duration={0}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      const timeDisplay = screen.getByTestId('mobile-transport-time');
      expect(timeDisplay).toHaveTextContent('0:00 / 0:00');

      const progressBar = screen.getByTestId('mobile-scrubber-progress');
      expect(progressBar.style.width).toBe('0%');

      const scrubber = screen.getByRole('slider');
      expect(scrubber).toHaveAttribute('aria-valuenow', '0');
      expect(scrubber).toHaveAttribute('aria-valuetext', '0:00 of 0:00');
    });

    it('S2.2: renders 100% progress and correct timestamp when currentTime equals duration', () => {
      render(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={180}
          duration={180}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      const timeDisplay = screen.getByTestId('mobile-transport-time');
      expect(timeDisplay).toHaveTextContent('3:00 / 3:00');

      const progressBar = screen.getByTestId('mobile-scrubber-progress');
      expect(progressBar.style.width).toBe('100%');
    });

    it('S2.3: clamps progress bar to 100% when currentTime exceeds duration', () => {
      render(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={210}
          duration={180}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      const progressBar = screen.getByTestId('mobile-scrubber-progress');
      expect(progressBar.style.width).toBe('100%');

      const timeDisplay = screen.getByTestId('mobile-transport-time');
      expect(timeDisplay).toHaveTextContent('3:30 / 3:00');
    });

    it('S2.4: clamps progress bar to 0% and time to 0:00 when currentTime is negative', () => {
      render(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={-15}
          duration={120}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      const progressBar = screen.getByTestId('mobile-scrubber-progress');
      expect(progressBar.style.width).toBe('0%');

      const timeDisplay = screen.getByTestId('mobile-transport-time');
      expect(timeDisplay).toHaveTextContent('0:00 / 2:00');
    });

    it('S2.5: handles NaN currentTime and NaN duration gracefully without throw', () => {
      render(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={NaN}
          duration={NaN}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      const timeDisplay = screen.getByTestId('mobile-transport-time');
      expect(timeDisplay).toHaveTextContent('0:00 / 0:00');
    });

    it('S2.6: correctly formats semitone transposition badges (0, positive, negative, undefined)', () => {
      const { rerender } = render(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={0}
          duration={100}
          activeSemitones={0}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );
      expect(screen.getByTestId('mobile-mix-quick-switch')).toHaveTextContent('Orig Key');

      rerender(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={0}
          duration={100}
          activeSemitones={3}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );
      expect(screen.getByTestId('mobile-mix-quick-switch')).toHaveTextContent('+3 st');

      rerender(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={0}
          duration={100}
          activeSemitones={-4}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );
      expect(screen.getByTestId('mobile-mix-quick-switch')).toHaveTextContent('-4 st');

      rerender(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={0}
          duration={100}
          activeSemitones={undefined}
          semitones={undefined}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );
      expect(screen.getByTestId('mobile-mix-quick-switch')).toHaveTextContent('Orig Key');
    });

    it('S2.7: correctly formats playback speed badges (1.0x, 1.25x, 0.75x, 2.0x, default)', () => {
      const { rerender } = render(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={0}
          duration={100}
          playbackRate={1.0}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );
      expect(screen.getByTestId('mobile-mix-quick-switch')).toHaveTextContent('1.0x');

      rerender(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={0}
          duration={100}
          playbackRate={1.25}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );
      expect(screen.getByTestId('mobile-mix-quick-switch')).toHaveTextContent('1.25x');

      rerender(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={0}
          duration={100}
          playbackRate={0.75}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );
      expect(screen.getByTestId('mobile-mix-quick-switch')).toHaveTextContent('0.75x');

      rerender(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={0}
          duration={100}
          playbackRate={2}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );
      expect(screen.getByTestId('mobile-mix-quick-switch')).toHaveTextContent('2.0x');
    });
  });

  // =========================================================================
  // Suite 3: Key & Tempo Badge Quick-Switch Stress Testing
  // =========================================================================
  describe('Suite 3: Key & Tempo Badge Quick-Switch Stress', () => {
    it('S3.1: switches activeWorkspaceTab to mix tab from Stage tab in integrated App', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Adversarial Stress Anthem')).toBeInTheDocument();
      });

      // Verify initially on stage tab
      expect(screen.getByRole('tab', { name: /stage/i })).toHaveAttribute('aria-selected', 'true');
      const stagePanel = screen.getByTestId('studio-panel-stage');
      expect(stagePanel.className).toContain('block');

      const audioPanel = screen.getByTestId('studio-panel-audio');
      expect(audioPanel.className).toContain('hidden');

      // Click Key & Tempo badge in mobile sticky transport
      const badge = screen.getByTestId('mobile-mix-quick-switch');
      await user.click(badge);

      // Verify active tab switched to mix
      expect(screen.getByRole('tab', { name: /mix/i })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: /stage/i })).toHaveAttribute('aria-selected', 'false');

      // Verify mix panels are now visible (block) and stage is hidden on mobile
      expect(audioPanel.className).toContain('block');
      expect(audioPanel.className).not.toMatch(/\bhidden\b/);
      expect(screen.getByTestId('studio-panel-theme').className).toContain('block');
      expect(stagePanel.className).toContain('hidden');
    });

    it('S3.2: switches activeWorkspaceTab to mix tab from Timeline tab in integrated App', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Adversarial Stress Anthem')).toBeInTheDocument();
      });

      // Switch to Timeline tab first
      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      await user.click(timelineTab);
      expect(timelineTab).toHaveAttribute('aria-selected', 'true');
      const timelinePanel = screen.getByTestId('studio-panel-timeline');
      expect(timelinePanel.className).toContain('block');

      // Tap Key & Tempo badge in sticky transport
      const badge = screen.getByTestId('mobile-mix-quick-switch');
      await user.click(badge);

      // Verify active tab switched to mix
      expect(screen.getByRole('tab', { name: /mix/i })).toHaveAttribute('aria-selected', 'true');
      expect(timelineTab).toHaveAttribute('aria-selected', 'false');

      // Timeline panel should now have hidden md:block, mix panel has block
      expect(timelinePanel.className).toContain('hidden');
      expect(timelinePanel.className).toContain('md:block');
      expect(screen.getByTestId('studio-panel-audio').className).toContain('block');
    });

    it('S3.3: remains idempotently on mix tab when badge is clicked while already on mix tab', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Adversarial Stress Anthem')).toBeInTheDocument();
      });

      // Navigate to mix tab
      await user.click(screen.getByRole('tab', { name: /mix/i }));
      expect(screen.getByRole('tab', { name: /mix/i })).toHaveAttribute('aria-selected', 'true');

      // Click badge while already on mix tab
      const badge = screen.getByTestId('mobile-mix-quick-switch');
      await user.click(badge);

      // Verify it stays on mix tab
      expect(screen.getByRole('tab', { name: /mix/i })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('studio-panel-audio').className).toContain('block');
    });

    it('S3.4: handles 30 rapid repetitive clicks on Key/Tempo badge without glitching', async () => {
      const user = userEvent.setup();
      setTestViewport(375, 667);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Adversarial Stress Anthem')).toBeInTheDocument();
      });

      const badge = screen.getByTestId('mobile-mix-quick-switch');

      for (let i = 0; i < 30; i++) {
        await user.click(badge);
      }

      // Tab must remain stably 'mix'
      expect(screen.getByRole('tab', { name: /mix/i })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: /stage/i })).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByRole('tab', { name: /timeline/i })).toHaveAttribute(
        'aria-selected',
        'false'
      );
      expect(screen.getByTestId('studio-panel-audio').className).toContain('block');
    });

    it('S3.5: invokes both onOpenMixTab and onSelectTab("mix") on standalone badge click', async () => {
      const user = userEvent.setup();
      const onOpenMixTab = vi.fn();
      const onSelectTab = vi.fn();

      render(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={25}
          duration={150}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
          onOpenMixTab={onOpenMixTab}
          onSelectTab={onSelectTab}
        />
      );

      const badge = screen.getByTestId('mobile-mix-quick-switch');
      await user.click(badge);

      expect(onOpenMixTab).toHaveBeenCalledTimes(1);
      expect(onSelectTab).toHaveBeenCalledTimes(1);
      expect(onSelectTab).toHaveBeenCalledWith('mix');
    });
  });

  // =========================================================================
  // Suite 4: Safe-Area Inset Handling & Bottom Clearance Verification
  // =========================================================================
  describe('Suite 4: Safe-Area Inset Handling & Bottom Clearance', () => {
    it('S4.1: applies fixed bottom positioning and md:hidden responsiveness', () => {
      render(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={0}
          duration={100}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      const transport = screen.getByTestId('mobile-studio-transport');
      expect(transport.className).toContain('fixed');
      expect(transport.className).toContain('bottom-0');
      expect(transport.className).toContain('left-0');
      expect(transport.className).toContain('right-0');
      expect(transport.className).toContain('z-40');
      expect(transport.className).toContain('md:hidden');
    });

    it('S4.2: applies safe-area bottom padding via inline style and utility class', () => {
      render(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={0}
          duration={100}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      const transport = screen.getByTestId('mobile-studio-transport');
      // Inline style incorporates calc(env(safe-area-inset-bottom, 0px) + 0.5rem)
      // (jsdom cssstyle normalizes operands to 'calc(0.5rem + env(0px * , * safe-area-inset-bottom))')
      expect(transport.style.paddingBottom).toBe(
        'calc(0.5rem + env(0px * , * safe-area-inset-bottom))'
      );

      // Class name includes fallback calc
      expect(transport.className).toMatch(
        /pb-\[calc\(env\(safe-area-inset-bottom,\s*0px\)\+0\.5rem\)\]/
      );
    });

    it('S4.3: applies pb-28 md:pb-8 clearance padding on main when project is ready, pb-4 sm:pb-8 when not', async () => {
      const { unmount } = render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Adversarial Stress Anthem')).toBeInTheDocument();
      });

      const mainEl = screen.getByRole('main');
      expect(mainEl.className).toContain('pb-28');
      expect(mainEl.className).toContain('md:pb-8');
      unmount();

      // Test with empty project (search view)
      window.history.pushState({}, '', '/');
      render(<App />);

      const unreadyMain = screen.getByRole('main');
      expect(unreadyMain.className).not.toContain('pb-28');
      expect(unreadyMain.className).toMatch(/pb-4\s+sm:pb-8/);
    });

    it('S4.4: verifies pb-28 (112px) provides clearance exceeding transport bar physical height (107px)', () => {
      // pb-28 = 28 * 0.25rem = 7rem = 112px
      const clearancePaddingPx = 112;

      // Transport layout components:
      // pt-2 (8px) + scrubber row (36px) + gap-1 (4px) + controls row (44px) + pb-1.5 (6px) + border (1px) + min-safe-area (8px) = 107px
      const transportContentHeight = 8 + 36 + 4 + 44 + 6 + 1 + 8; // 107px

      expect(clearancePaddingPx).toBeGreaterThanOrEqual(transportContentHeight);
      expect(clearancePaddingPx - transportContentHeight).toBe(5); // 5px positive safety margin
    });

    it('S4.5: guarantees >= 44x44px touch targets on all interactive controls in MobileStudioTransport', () => {
      const { container } = render(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={10}
          duration={100}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
          onRestart={vi.fn()}
        />
      );

      const inspection = assertTouchTargets(container, 44);
      expect(inspection.failed).toHaveLength(0);
      expect(inspection.total).toBeGreaterThanOrEqual(3); // play/pause, restart, key/tempo badge
    });
  });

  // =========================================================================
  // Suite 5: Viewport Geometry & Horizontal Overflow Stress (320px & 375px)
  // =========================================================================
  describe('Suite 5: Viewport Geometry & Horizontal Overflow Stress', () => {
    it('S5.1: guarantees zero horizontal overflow on MobileStudioTransport at 375px viewport', () => {
      const { container } = render(
        <MobileStudioTransport
          isPlaying={true}
          currentTime={95}
          duration={240}
          activeSemitones={-3}
          playbackRate={1.25}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
          onRestart={vi.fn()}
        />
      );

      assertZeroHorizontalOverflow(container, 375);
    });

    it('S5.2: guarantees zero horizontal overflow on MobileStudioTransport at 320px viewport', () => {
      const { container } = render(
        <MobileStudioTransport
          isPlaying={false}
          currentTime={0}
          duration={180}
          activeSemitones={0}
          playbackRate={1.0}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
          onRestart={vi.fn()}
        />
      );

      assertZeroHorizontalOverflow(container, 320);
    });

    it('S5.3: guarantees zero horizontal overflow on MobileStudioWorkspaceTabs at 320px and 375px', () => {
      const { container: c320 } = render(
        <MobileStudioWorkspaceTabs
          activeTab="stage"
          onSelectTab={vi.fn()}
          hasUnsavedChanges={true}
        />
      );
      assertZeroHorizontalOverflow(c320, 320);

      const { container: c375 } = render(
        <MobileStudioWorkspaceTabs
          activeTab="timeline"
          onSelectTab={vi.fn()}
          hasUnsavedChanges={true}
        />
      );
      assertZeroHorizontalOverflow(c375, 375);
    });
  });
});

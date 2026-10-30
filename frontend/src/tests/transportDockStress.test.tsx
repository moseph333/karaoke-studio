/**
 * Transport Dock Stress Suite
 *
 * Successor of the Milestone M1 sticky-transport challenger suite, retargeted to the
 * unified TransportDock (one playback surface for every viewport):
 * 1. Rapid scrubbing, play/pause and restart bursts.
 * 2. Boundary and malformed time values (0/0, end of track, overshoot, negative, NaN).
 * 3. Key/speed chip formatting and the mix-settings quick switch inside the App.
 * 4. Mobile docking: fixed bottom placement, safe-area padding, main clearance, touch targets.
 * 5. Horizontal overflow at 320px and 375px (collapsed and expanded drawer).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { TransportDock } from '../components/transport/TransportDock';
import { MobileStudioWorkspaceTabs } from '../components/MobileStudioWorkspaceTabs';
import { ProjectState } from '../types';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  assertTouchTargets,
} from './helpers/responsiveTestUtils';

const readyProject: ProjectState = {
  id: 'dock-stress-proj',
  title: 'Adversarial Stress Anthem',
  artist: 'Empirical Challenger',
  status: 'ready',
  progress: 100,
  created_by: 'Challenger',
  lines: [
    {
      id: 1,
      text: 'Stress testing the transport dock',
      start_time: 1.0,
      end_time: 4.5,
      words: [
        { word: 'Stress', start_time: 1.0, end_time: 1.8 },
        { word: 'testing', start_time: 1.8, end_time: 2.7 },
        { word: 'the', start_time: 2.7, end_time: 3.0 },
        { word: 'transport', start_time: 3.0, end_time: 3.7 },
        { word: 'dock', start_time: 3.7, end_time: 4.5 },
      ],
    },
    {
      id: 2,
      text: 'Rapid seeks and quick chip switching',
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

const baseDock = {
  masterAudioUrl: '/static/stress-master.wav',
  isPlaying: false,
  currentTime: 0,
  duration: 100,
  onTogglePlay: vi.fn(),
  onSeek: vi.fn(),
};

describe('TransportDock stress', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/?project=dock-stress-proj');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/status')) {
        return new Response(JSON.stringify({ auth_required: false, authenticated: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/api/project/dock-stress-proj')) {
        return new Response(JSON.stringify(readyProject), {
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
    window.history.pushState({}, '', '/');
  });

  describe('Suite 1: Rapid scrubbing & play/pause', () => {
    it('S1.1: forwards 100 rapid consecutive scrubber seeks accurately', () => {
      const onSeek = vi.fn();
      render(<TransportDock {...baseDock} currentTime={10} duration={240} onSeek={onSeek} />);

      const scrubber = screen.getByRole('slider', { name: 'Audio timeline position' });
      const seekValues = Array.from({ length: 100 }, (_, i) =>
        Number(((i * 2.37 + 0.1) % 240).toFixed(1))
      );
      seekValues.forEach((v) => fireEvent.change(scrubber, { target: { value: String(v) } }));

      // Identical consecutive values do not emit change events; every distinct one seeks
      expect(onSeek.mock.calls.length).toBeGreaterThanOrEqual(99);
      const sought = onSeek.mock.calls.map((c) => c[0] as number);
      sought.forEach((t) => {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(240);
      });
      expect(sought[sought.length - 1]).toBe(seekValues[seekValues.length - 1]);
    });

    it('S1.2: survives 50 rapid play/pause toggles with alternating labels', async () => {
      const user = userEvent.setup();
      let isPlaying = false;
      const onTogglePlay = vi.fn(() => {
        isPlaying = !isPlaying;
      });
      const { rerender } = render(
        <TransportDock {...baseDock} isPlaying={isPlaying} onTogglePlay={onTogglePlay} />
      );
      const button = screen.getByTestId('transport-play-pause-btn');

      for (let i = 0; i < 50; i++) {
        await user.click(button);
        rerender(<TransportDock {...baseDock} isPlaying={isPlaying} onTogglePlay={onTogglePlay} />);
        expect(button).toHaveAttribute(
          'aria-label',
          isPlaying ? 'Pause playback' : 'Start playback'
        );
      }

      expect(onTogglePlay).toHaveBeenCalledTimes(50);
      expect(isPlaying).toBe(false);
    });

    it('S1.3: restarts reliably over 20 consecutive clicks', async () => {
      const user = userEvent.setup();
      const onSeek = vi.fn();
      render(<TransportDock {...baseDock} currentTime={45} duration={180} onSeek={onSeek} />);

      const restart = screen.getByRole('button', { name: 'Restart track from beginning' });
      for (let i = 0; i < 20; i++) await user.click(restart);

      expect(onSeek).toHaveBeenCalledTimes(20);
      onSeek.mock.calls.forEach((c) => expect(c[0]).toBe(0));
    });
  });

  describe('Suite 2: Boundary & malformed values', () => {
    const times = () => [
      screen.getByTestId('transport-time').textContent,
      screen.getByTestId('transport-duration').textContent,
    ];

    it('S2.1: renders 0:00 / 0:00 for an unloaded track without NaN anywhere', () => {
      const { container } = render(<TransportDock {...baseDock} currentTime={0} duration={0} />);
      expect(times()).toEqual(['0:00', '0:00']);
      const scrubber = screen.getByRole('slider', { name: 'Audio timeline position' });
      expect(scrubber).toHaveAttribute('aria-valuenow', '0');
      expect(scrubber).toHaveAttribute('aria-valuetext', '0:00 of 0:00');
      expect(container.innerHTML).not.toContain('NaN');
    });

    it('S2.2: shows the full duration at the end of the track', () => {
      render(<TransportDock {...baseDock} currentTime={180} duration={180} />);
      expect(times()).toEqual(['3:00', '3:00']);
      const bars = screen.getAllByTestId('waveform-bar');
      expect(bars.every((b) => b.getAttribute('data-played') === 'true')).toBe(true);
    });

    it('S2.3: clamps an overshooting clock to the duration', () => {
      render(<TransportDock {...baseDock} currentTime={210} duration={180} />);
      expect(times()).toEqual(['3:00', '3:00']);
    });

    it('S2.4: clamps a negative clock to 0:00 with no played bars', () => {
      render(<TransportDock {...baseDock} currentTime={-15} duration={120} />);
      expect(times()).toEqual(['0:00', '2:00']);
      const bars = screen.getAllByTestId('waveform-bar');
      expect(bars.some((b) => b.getAttribute('data-played') === 'true')).toBe(false);
    });

    it('S2.5: handles NaN time and duration without throwing', () => {
      const { container } = render(
        <TransportDock {...baseDock} currentTime={NaN} duration={NaN} />
      );
      expect(times()).toEqual(['0:00', '0:00']);
      expect(container.innerHTML).not.toContain('NaN');
    });

    it('S2.6: formats the key chip for 0, positive, negative and missing offsets', () => {
      const chip = () => screen.getByTestId('transport-key-chip');
      const { rerender } = render(<TransportDock {...baseDock} semitones={0} />);
      expect(chip()).toHaveTextContent('Orig key');

      rerender(<TransportDock {...baseDock} semitones={3} />);
      expect(chip()).toHaveTextContent('+3 st');

      rerender(<TransportDock {...baseDock} semitones={-4} />);
      expect(chip()).toHaveTextContent('−4 st');

      rerender(<TransportDock {...baseDock} semitones={undefined} />);
      expect(chip()).toHaveTextContent('Orig key');
    });

    it('S2.7: formats the playback speed (1.0x, 1.25x, 0.75x, 2.0x)', () => {
      const chip = () => screen.getByTestId('transport-key-chip');
      const { rerender } = render(<TransportDock {...baseDock} playbackRate={1.0} />);
      expect(chip()).toHaveTextContent('1.0x');

      rerender(<TransportDock {...baseDock} playbackRate={1.25} />);
      expect(chip()).toHaveTextContent('1.25x');

      rerender(<TransportDock {...baseDock} playbackRate={0.75} />);
      expect(chip()).toHaveTextContent('0.75x');

      rerender(<TransportDock {...baseDock} playbackRate={2} />);
      expect(chip()).toHaveTextContent('2.0x');
    });
  });

  describe('Suite 3: Mix settings quick switch in the App', () => {
    const renderStudio = async () => {
      setTestViewport(375, 667);
      render(<App />);
      await waitFor(() => {
        expect(screen.getByText('Adversarial Stress Anthem')).toBeInTheDocument();
      });
    };

    it('S3.1: switches from the Stage tab to Mix & Theme', async () => {
      const user = userEvent.setup();
      await renderStudio();

      expect(screen.getByRole('tab', { name: /stage/i })).toHaveAttribute('aria-selected', 'true');
      const stagePanel = screen.getByTestId('studio-panel-stage');
      const audioPanel = screen.getByTestId('studio-panel-audio');
      expect(audioPanel.className).toMatch(/\bhidden\b/);

      await user.click(screen.getByTestId('transport-key-chip'));

      expect(screen.getByRole('tab', { name: /mix/i })).toHaveAttribute('aria-selected', 'true');
      expect(audioPanel.className).toContain('block');
      expect(audioPanel.className).not.toMatch(/\bhidden\b/);
      expect(screen.getByTestId('studio-panel-theme').className).not.toMatch(/\bhidden\b/);
      expect(stagePanel.className).toMatch(/\bhidden\b/);
    });

    it('S3.2: switches from the Timeline tab to Mix & Theme', async () => {
      const user = userEvent.setup();
      await renderStudio();

      const timelineTab = screen.getByRole('tab', { name: /timeline/i });
      await user.click(timelineTab);
      const timelinePanel = screen.getByTestId('studio-panel-timeline');
      expect(timelinePanel.className).not.toMatch(/\bhidden\b/);

      await user.click(screen.getByTestId('transport-key-chip'));

      expect(screen.getByRole('tab', { name: /mix/i })).toHaveAttribute('aria-selected', 'true');
      expect(timelineTab).toHaveAttribute('aria-selected', 'false');
      expect(timelinePanel.className).toContain('hidden');
      expect(timelinePanel.className).toContain('md:block');
    });

    it('S3.3: stays on Mix & Theme when already there and scrolls the mix panel into view', async () => {
      const user = userEvent.setup();
      await renderStudio();
      await user.click(screen.getByRole('tab', { name: /mix/i }));

      const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
      await user.click(screen.getByTestId('transport-key-chip'));

      expect(screen.getByRole('tab', { name: /mix/i })).toHaveAttribute('aria-selected', 'true');
      await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByTestId('studio-panel-audio'))
      );
    });

    it('S3.4: handles 30 rapid repeated chip clicks without glitching', async () => {
      const user = userEvent.setup();
      await renderStudio();

      const chip = screen.getByTestId('transport-key-chip');
      for (let i = 0; i < 30; i++) await user.click(chip);

      expect(screen.getByRole('tab', { name: /mix/i })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: /stage/i })).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByRole('tab', { name: /timeline/i })).toHaveAttribute(
        'aria-selected',
        'false'
      );
    });

    it('S3.5: shows the project key on the chip', async () => {
      await renderStudio();
      expect(screen.getByTestId('transport-key-chip')).toHaveTextContent('+2 st');
    });
  });

  describe('Suite 4: Mobile docking & clearance', () => {
    it('S4.1: docks fixed to the bottom on phones and flows in the layout from md', () => {
      render(<TransportDock {...baseDock} />);
      const dock = screen.getByTestId('transport-dock');
      ['fixed', 'inset-x-0', 'bottom-0', 'z-40', 'md:static'].forEach((cls) =>
        expect(dock.className).toContain(cls)
      );
    });

    it('S4.2: pads for the safe-area inset', () => {
      render(<TransportDock {...baseDock} />);
      const dock = screen.getByTestId('transport-dock');
      expect(dock.style.paddingBottom).toContain('safe-area-inset-bottom');
    });

    it('S4.3: reserves bottom clearance for the dock only in the studio', async () => {
      const { unmount } = render(<App />);
      await waitFor(() => {
        expect(screen.getByText('Adversarial Stress Anthem')).toBeInTheDocument();
      });

      const studioMain = screen.getByRole('main');
      expect(studioMain.className).toContain('pb-[calc(var(--dock-height,8.5rem)+1rem)]');
      expect(studioMain.className).toContain('md:pb-0');
      unmount();

      window.history.pushState({}, '', '/');
      render(<App />);
      const libraryMain = screen.getByRole('main');
      expect(libraryMain.className).not.toContain('--dock-height');
      expect(libraryMain.className).toMatch(/pb-4\s+sm:pb-8/);
      expect(screen.queryByTestId('transport-dock')).not.toBeInTheDocument();
    });

    it('S4.4: renders the dock exactly once in the studio, outside the scrolling workspace', async () => {
      render(<App />);
      await waitFor(() => {
        expect(screen.getByText('Adversarial Stress Anthem')).toBeInTheDocument();
      });
      expect(screen.getAllByTestId('transport-dock')).toHaveLength(1);
      expect(screen.getAllByTestId('audio-element')).toHaveLength(1);
      expect(screen.getByRole('main')).not.toContainElement(screen.getByTestId('transport-dock'));
    });

    it('S4.5: keeps every interactive dock control at a compliant touch size', () => {
      const { container } = render(<TransportDock {...baseDock} currentTime={10} />);
      const inspection = assertTouchTargets(container, 44);
      expect(inspection.failed).toHaveLength(0);
      expect(inspection.total).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Suite 5: Horizontal overflow', () => {
    it('S5.1: no horizontal overflow at 375px', () => {
      setTestViewport(375, 667);
      const { container } = render(
        <TransportDock
          {...baseDock}
          isPlaying
          currentTime={95}
          duration={240}
          semitones={-3}
          playbackRate={1.25}
        />
      );
      assertZeroHorizontalOverflow(container, 375);
    });

    it('S5.2: no horizontal overflow at 320px, drawer collapsed and expanded', async () => {
      const user = userEvent.setup();
      setTestViewport(320, 568);
      const { container } = render(<TransportDock {...baseDock} duration={180} />);
      assertZeroHorizontalOverflow(container, 320);

      await user.click(screen.getByTestId('transport-more-toggle'));
      assertZeroHorizontalOverflow(container, 320);
    });

    it('S5.3: no horizontal overflow on the workspace tabs at 320px and 375px', () => {
      const { container: c320 } = render(
        <MobileStudioWorkspaceTabs activeTab="stage" onSelectTab={vi.fn()} hasUnsavedChanges />
      );
      assertZeroHorizontalOverflow(c320, 320);

      const { container: c375 } = render(
        <MobileStudioWorkspaceTabs activeTab="timeline" onSelectTab={vi.fn()} hasUnsavedChanges />
      );
      assertZeroHorizontalOverflow(c375, 375);
    });
  });
});

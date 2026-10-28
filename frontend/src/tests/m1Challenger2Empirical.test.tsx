import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricDisplay } from '../components/LyricDisplay';
import { VisualThemePicker, THEMES } from '../components/VisualThemePicker';
import { ExportModal } from '../components/ExportModal';
import { ExportSubtitleSection } from '../components/export/ExportSubtitleSection';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { LyricLine, ProjectState, SyncDisplayMode } from '../types';
import * as apiModule from '../api';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  assertTouchTargets,
} from './responsiveTestUtils';

describe('Milestone M1 Challenger 2: Adversarial & Empirical Verification', () => {
  const sampleLines: LyricLine[] = [
    {
      id: 1,
      text: 'First verse singing line',
      start_time: 4.0,
      end_time: 7.0,
      singer: 'singer1',
      words: [
        { word: 'First', start_time: 4.0, end_time: 4.6 },
        { word: 'verse', start_time: 4.7, end_time: 5.4 },
        { word: 'singing', start_time: 5.5, end_time: 6.2 },
        { word: 'line', start_time: 6.3, end_time: 7.0 },
      ],
    },
    {
      id: 2,
      text: 'Second duet partner chorus',
      start_time: 12.0,
      end_time: 15.0,
      singer: 'singer2',
      words: [
        { word: 'Second', start_time: 12.0, end_time: 12.6 },
        { word: 'duet', start_time: 12.7, end_time: 13.3 },
        { word: 'partner', start_time: 13.4, end_time: 14.1 },
        { word: 'chorus', start_time: 14.2, end_time: 15.0 },
      ],
    },
    {
      id: 3,
      text: 'Both singers in unison finale',
      start_time: 16.0,
      end_time: 19.0,
      singer: 'both',
      words: [
        { word: 'Both', start_time: 16.0, end_time: 16.5 },
        { word: 'singers', start_time: 16.6, end_time: 17.2 },
        { word: 'in', start_time: 17.3, end_time: 17.6 },
        { word: 'unison', start_time: 17.7, end_time: 18.3 },
        { word: 'finale', start_time: 18.4, end_time: 19.0 },
      ],
    },
  ];

  const mockProject: ProjectState = {
    id: 'proj_m1_challenger_test',
    status: 'ready',
    progress: 100,
    title: 'Adversarial Challenger Song',
    artist: 'Empirical Artist',
    lines: sampleLines,
    semitones: 0,
    guide_volume: 0,
    render_status: 'idle',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    resetTestViewport();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // Focus Area 1: Fullscreen TV Stage Mode Parity & Keyboard Shortcuts
  // =========================================================================
  describe('Focus Area 1: Fullscreen TV Stage Mode Parity & Keyboard Navigation', () => {
    it('C1.1: Keyboard "F" and "f" toggle fullscreen; "Escape" exits fullscreen', () => {
      render(<LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="line" />);
      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveAttribute('data-fullscreen', 'false');

      // Lowercase 'f' enters fullscreen
      fireEvent.keyDown(window, { key: 'f' });
      expect(stage).toHaveAttribute('data-fullscreen', 'true');

      // Uppercase 'F' toggles back to normal
      fireEvent.keyDown(window, { key: 'F' });
      expect(stage).toHaveAttribute('data-fullscreen', 'false');

      // Enter fullscreen again and test 'Escape'
      fireEvent.keyDown(window, { key: 'f' });
      expect(stage).toHaveAttribute('data-fullscreen', 'true');

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(stage).toHaveAttribute('data-fullscreen', 'false');
    });

    it('C1.2: Typing "f" while focused in an input/textarea does NOT trigger fullscreen', () => {
      render(
        <div>
          <input type="text" data-testid="test-input" />
          <LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="line" />
        </div>
      );
      const stage = screen.getByTestId('lyric-display-stage');
      const input = screen.getByTestId('test-input');

      // Focus input and fire keydown with target = input
      input.focus();
      fireEvent.keyDown(input, { key: 'f' });
      expect(stage).toHaveAttribute('data-fullscreen', 'false');
    });

    it('C1.3: Modifier keys (Ctrl+f, Meta+f, Alt+f) do NOT trigger fullscreen toggle', () => {
      render(<LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="line" />);
      const stage = screen.getByTestId('lyric-display-stage');

      fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
      expect(stage).toHaveAttribute('data-fullscreen', 'false');

      fireEvent.keyDown(window, { key: 'f', metaKey: true });
      expect(stage).toHaveAttribute('data-fullscreen', 'false');

      fireEvent.keyDown(window, { key: 'f', altKey: true });
      expect(stage).toHaveAttribute('data-fullscreen', 'false');
    });

    it('C1.4: TV Stage mode maintains exact solid 100% line highlight parity with preview mode', () => {
      render(<LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="line" />);

      // In normal preview mode
      const previewWord0 = screen.getByTestId('word-sung-0');
      expect(parseFloat(previewWord0.style.width)).toBe(100);
      expect(previewWord0.style.clipPath).toBe('inset(0 0.00% 0 0)');

      // Enter Fullscreen TV Stage mode
      fireEvent.keyDown(window, { key: 'f' });
      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveAttribute('data-fullscreen', 'true');
      expect(stage).toHaveAttribute('data-sync-mode', 'line');

      // Assert identical 100% illumination across all words in stage mode
      sampleLines[0].words.forEach((_, idx) => {
        const wordSpan = screen.getByTestId(`word-sung-${idx}`);
        expect(parseFloat(wordSpan.style.width)).toBe(100);
        expect(wordSpan.style.clipPath).toBe('inset(0 0.00% 0 0)');
      });
    });

    it('C1.5: Stage toolbar highlight selector stays available in TV stage and switches modes', async () => {
      const user = userEvent.setup();
      const onSyncModeChange = vi.fn();
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={4.5}
          duration={60}
          syncMode="line"
          onSyncModeChange={onSyncModeChange}
        />
      );

      // Enter stage mode
      fireEvent.keyDown(window, { key: 'f' });
      const lineBtn = screen.getByTestId('sync-mode-line');
      expect(lineBtn).toHaveTextContent('Line');
      expect(lineBtn).toHaveAttribute('aria-pressed', 'true');
      expect(lineBtn).toHaveAttribute('aria-label', 'Line highlight');

      await user.click(screen.getByTestId('sync-mode-word'));
      expect(onSyncModeChange).toHaveBeenCalledWith('word');
    });

    it('C1.6: Floating controls visibility lifecycle: visible when paused, auto-hides after 3s when playing', () => {
      vi.useFakeTimers();

      const { rerender } = render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={4.5}
          duration={60}
          isPlaying={false}
          syncMode="line"
        />
      );

      // Enter fullscreen
      fireEvent.keyDown(window, { key: 'f' });
      const controls = screen.getByTestId('stage-floating-controls');
      expect(controls.className).toContain('opacity-100');

      // Start playing
      rerender(
        <LyricDisplay
          lines={sampleLines}
          currentTime={4.5}
          duration={60}
          isPlaying={true}
          syncMode="line"
        />
      );
      expect(controls.className).toContain('opacity-100');

      // Advance 3000ms -> controls should hide
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(controls.className).toContain('opacity-0');

      // Mousemove restores visibility
      const stage = screen.getByTestId('lyric-display-stage');
      fireEvent.mouseMove(stage);
      expect(controls.className).toContain('opacity-100');

      // Advance 3000ms again -> controls hide
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(controls.className).toContain('opacity-0');

      // Pausing audio immediately restores controls visibility
      rerender(
        <LyricDisplay
          lines={sampleLines}
          currentTime={4.5}
          duration={60}
          isPlaying={false}
          syncMode="line"
        />
      );
      expect(controls.className).toContain('opacity-100');
    });

    it('C1.7: Duet & Singer 2 / Both styling in Fullscreen TV Stage Mode under line mode', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={16.5} // Line 3: Both / Duet
          duration={60}
          syncMode="line"
          bothSungColor="#10b981"
        />
      );

      fireEvent.keyDown(window, { key: 'f' });
      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveAttribute('data-fullscreen', 'true');

      const badge = screen.getByTestId('active-singer-badge');
      expect(badge).toHaveAttribute('data-singer', 'both');
      expect(badge).toHaveTextContent('Both / Duet');

      // Active words illuminate in bothSungColor
      sampleLines[2].words.forEach((_, idx) => {
        const span = screen.getByTestId(`word-sung-${idx}`);
        expect(span).toHaveStyle({ color: '#10b981' });
        expect(parseFloat(span.style.width)).toBe(100);
      });
    });

    it('C1.8: Word click seek interactivity in Fullscreen TV Stage Mode under line mode', async () => {
      const user = userEvent.setup();
      const onSeek = vi.fn();
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={4.5}
          duration={60}
          syncMode="line"
          onSeek={onSeek}
        />
      );

      fireEvent.keyDown(window, { key: 'f' });
      const singingWordBtn = screen.getByRole('button', {
        name: /jump playback to word singing/i,
      });
      await user.click(singingWordBtn);
      expect(onSeek).toHaveBeenCalledWith(5.5);
    });
  });

  // =========================================================================
  // Focus Area 2: Touch Targets Compliance (>= 44px x 44px)
  // =========================================================================
  describe('Focus Area 2: Touch Targets Compliance (>= 44px)', () => {
    it('C2.1: LyricDisplay preview header buttons have >= 44px min dimensions', () => {
      render(<LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="line" />);

      for (const id of ['sync-mode-word', 'sync-mode-line']) {
        const btn = screen.getByTestId(id);
        expect(btn.className).toContain('min-h-[44px]');
        expect(btn.className).toContain('min-w-[44px]');
      }

      const vizToggle = screen.getByTestId('toggle-visualizer-btn');
      expect(vizToggle.className).toContain('min-h-[44px]');
      expect(vizToggle.className).toContain('min-w-[44px]');

      const fullToggle = screen.getByTestId('stage-fullscreen-toggle');
      expect(fullToggle.className).toContain('min-h-[44px]');
      expect(fullToggle.className).toContain('min-w-[44px]');
    });

    it('C2.2: Fullscreen TV Stage floating controls have >= 44px min dimensions', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={4.5}
          duration={60}
          syncMode="line"
          chords={[{ start: 4.0, end: 7.0, chord: 'C' }]}
        />
      );

      // Enter stage mode
      fireEvent.keyDown(window, { key: 'f' });

      const playPause = screen.getByTestId('stage-play-pause-btn');
      expect(playPause.className).toContain('min-h-[44px]');
      expect(playPause.className).toContain('min-w-[44px]');

      const stageSync = screen.getByTestId('sync-mode-word');
      expect(stageSync.className).toContain('min-h-[44px]');
      expect(stageSync.className).toContain('min-w-[44px]');

      // Leaving the stage happens through the toolbar's fullscreen toggle
      const stageExit = screen.getByTestId('stage-fullscreen-toggle');
      expect(stageExit).toHaveAttribute('aria-label', 'Exit fullscreen stage (F)');
      expect(stageExit.className).toContain('min-h-[44px]');
      expect(stageExit.className).toContain('min-w-[44px]');
      expect(screen.queryByTestId('stage-exit-btn')).not.toBeInTheDocument();

      const chordToggle = screen.getByTestId('chord-bar-toggle');
      expect(chordToggle.className).toContain('min-h-[44px]');
      expect(chordToggle.className).toContain('min-w-[44px]');
    });

    it('C2.3: VisualThemePicker format and lyric size buttons meet the touch target requirement', () => {
      render(
        <VisualThemePicker
          selectedTheme={THEMES[0]}
          onSelectTheme={vi.fn()}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
        />
      );

      for (const name of [/16:9 Widescreen/, /9:16 Shorts/, 'Scale 1x', 'Scale 1.5x']) {
        const btn = screen.getByRole('button', { name });
        expect(btn.className).toContain('min-h-[44px]');
      }
    });

    it('C2.4: ExportModal video render sync mode buttons meet >= 44px touch target requirement', () => {
      render(
        <ExportModal
          project={mockProject}
          isOpen={true}
          onClose={vi.fn()}
          onCancelRender={vi.fn()}
          syncMode="line"
        />
      );

      const exportWordBtn = screen.getByTestId('export-sync-mode-word');
      expect(exportWordBtn.className).toContain('min-h-[44px]');
      expect(exportWordBtn.className).toContain('min-w-[44px]');

      const exportLineBtn = screen.getByTestId('export-sync-mode-line');
      expect(exportLineBtn.className).toContain('min-h-[44px]');
      expect(exportLineBtn.className).toContain('min-w-[44px]');
    });

    it('C2.5: ExportSubtitleSection sync mode buttons meet >= 44px touch target requirement', () => {
      render(
        <ExportSubtitleSection
          project={mockProject}
          selectedTheme={THEMES[0]}
          aspectRatio="16:9"
          syncMode="line"
        />
      );

      const subWordBtn = screen.getByTestId('subtitle-sync-mode-word');
      expect(subWordBtn.className).toContain('min-h-[44px]');
      expect(subWordBtn.className).toContain('min-w-[44px]');

      const subLineBtn = screen.getByTestId('subtitle-sync-mode-line');
      expect(subLineBtn.className).toContain('min-h-[44px]');
      expect(subLineBtn.className).toContain('min-w-[44px]');
    });

    it('C2.6: assertTouchTargets validates 0 substandard buttons in sync mode controls', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      render(<LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="line" />, {
        container,
      });

      // Inspect the stage toolbar sync-mode-selector specifically
      const selector = screen.getByTestId('sync-mode-selector');
      const res = assertTouchTargets(selector, 44);
      expect(res.total).toBe(2);
      expect(res.failed).toHaveLength(0);

      document.body.removeChild(container);
    });
  });

  // =========================================================================
  // Focus Area 3: ARIA Attributes & Accessibility Semantics
  // =========================================================================
  describe('Focus Area 3: ARIA Attributes & Accessibility Semantics', () => {
    it('C3.1: Stage toolbar highlight buttons expose aria-pressed and labels in word vs line mode', () => {
      const { rerender } = render(
        <LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="word" />
      );

      expect(screen.getByTestId('sync-mode-word')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('sync-mode-word')).toHaveAttribute(
        'aria-label',
        'Word sweep highlight'
      );
      expect(screen.getByTestId('sync-mode-line')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByTestId('sync-mode-line')).toHaveAttribute('aria-label', 'Line highlight');

      rerender(<LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="line" />);
      expect(screen.getByTestId('sync-mode-word')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByTestId('sync-mode-line')).toHaveAttribute('aria-pressed', 'true');
    });

    it('C3.2: The same highlight selector reflects the mode inside the TV stage', () => {
      const { rerender } = render(
        <LyricDisplay lines={sampleLines} currentTime={4.5} duration={60} syncMode="word" />
      );

      fireEvent.keyDown(window, { key: 'f' });
      expect(screen.getAllByTestId('sync-mode-selector')).toHaveLength(1);
      expect(screen.getByTestId('sync-mode-word')).toHaveAttribute('aria-pressed', 'true');

      rerender(
        <LyricDisplay lines={sampleLines} currentTime={4.5} duration={60} syncMode="line" />
      );
      expect(screen.getByTestId('sync-mode-line')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByTestId('stage-sync-mode-toggle')).not.toBeInTheDocument();
    });

    it('C3.3: Stage toolbar highlight selector is a labelled group of pressed-state buttons', () => {
      render(<LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="line" />);

      const group = screen.getByTestId('sync-mode-selector');
      expect(group).toHaveAttribute('role', 'group');
      expect(group).toHaveAttribute('aria-label', 'Lyric highlight mode');

      const wordBtn = screen.getByTestId('sync-mode-word');
      const lineBtn = screen.getByTestId('sync-mode-line');
      expect(wordBtn).toHaveAttribute('aria-pressed', 'false');
      expect(lineBtn).toHaveAttribute('aria-pressed', 'true');
    });

    it('C3.4: ExportModal video render sync mode selector has role="group", aria-label, and aria-pressed', () => {
      render(
        <ExportModal
          project={mockProject}
          isOpen={true}
          onClose={vi.fn()}
          onCancelRender={vi.fn()}
          syncMode="line"
        />
      );

      const group = screen.getByTestId('export-sync-mode-selector');
      expect(group).toHaveAttribute('role', 'group');
      expect(group).toHaveAttribute('aria-label', 'Video render synchronization mode');

      const wordBtn = screen.getByTestId('export-sync-mode-word');
      const lineBtn = screen.getByTestId('export-sync-mode-line');
      expect(wordBtn).toHaveAttribute('aria-pressed', 'false');
      expect(lineBtn).toHaveAttribute('aria-pressed', 'true');
    });

    it('C3.5: ExportSubtitleSection sync mode selector has role="group", aria-label, and aria-pressed', () => {
      render(
        <ExportSubtitleSection
          project={mockProject}
          selectedTheme={THEMES[0]}
          aspectRatio="16:9"
          syncMode="word"
        />
      );

      const group = screen.getByTestId('subtitle-sync-mode-selector');
      expect(group).toHaveAttribute('role', 'group');
      expect(group).toHaveAttribute('aria-label', 'Subtitle synchronization mode');

      const wordBtn = screen.getByTestId('subtitle-sync-mode-word');
      const lineBtn = screen.getByTestId('subtitle-sync-mode-line');
      expect(wordBtn).toHaveAttribute('aria-pressed', 'true');
      expect(lineBtn).toHaveAttribute('aria-pressed', 'false');
    });

    it('C3.6: Sung word overlays have aria-hidden="true" to prevent double-voicing by screen readers', () => {
      render(<LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="line" />);

      sampleLines[0].words.forEach((w, idx) => {
        const span = screen.getByTestId(`word-sung-${idx}`);
        expect(span).toHaveAttribute('aria-hidden', 'true');

        const btn = screen.getByRole('button', {
          name: new RegExp(`jump playback to word ${w.word}`, 'i'),
        });
        expect(btn).toBeInTheDocument();
      });
    });

    it('C3.7: Active singer badge has role="status" and descriptive aria-label', () => {
      render(<LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="line" />);

      const badge = screen.getByTestId('active-singer-badge');
      expect(badge).toHaveAttribute('role', 'status');
      expect(badge).toHaveAttribute('aria-label', 'Current Singer: Singer 1 / Lead');
    });
  });

  // =========================================================================
  // Focus Area 4: Mobile Small (320px) Responsive Wrapping & Zero Overflow
  // =========================================================================
  describe('Focus Area 4: Mobile 320px Responsive Wrapping & Zero Overflow', () => {
    it('C4.1: LyricDisplay has zero horizontal overflow at 320px viewport in line mode', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <LyricDisplay lines={sampleLines} currentTime={4.5} syncMode="line" />
      );

      assertZeroHorizontalOverflow(container, 320);
    });

    it('C4.2: LyricDisplay with ultra-long lyric line wraps gracefully without horizontal overflow at 320px', () => {
      setTestViewport(320, 568);
      const longLines: LyricLine[] = [
        {
          id: 1,
          text: 'Supercalifragilisticexpialidocious extraordinary continuous harmony across every stanza',
          start_time: 1.0,
          end_time: 10.0,
          words: [
            { word: 'Supercalifragilisticexpialidocious', start_time: 1.0, end_time: 3.0 },
            { word: 'extraordinary', start_time: 3.1, end_time: 5.0 },
            { word: 'continuous', start_time: 5.1, end_time: 7.0 },
            { word: 'harmony', start_time: 7.1, end_time: 8.5 },
            { word: 'across', start_time: 8.6, end_time: 9.0 },
            { word: 'every', start_time: 9.1, end_time: 9.5 },
            { word: 'stanza', start_time: 9.6, end_time: 10.0 },
          ],
        },
      ];

      const { container } = render(
        <LyricDisplay lines={longLines} currentTime={4.0} syncMode="line" />
      );

      assertZeroHorizontalOverflow(container, 320);
    });

    it('C4.3: Fullscreen TV Stage Mode has zero horizontal overflow at 320px viewport', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={4.5}
          duration={60}
          syncMode="line"
          chords={[{ start: 4.0, end: 7.0, chord: 'C' }]}
        />
      );

      fireEvent.keyDown(window, { key: 'f' });
      assertZeroHorizontalOverflow(container, 320);
    });

    it('C4.4: VisualThemePicker has zero horizontal overflow at 320px viewport', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <VisualThemePicker
          selectedTheme={THEMES[0]}
          onSelectTheme={vi.fn()}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
        />
      );

      assertZeroHorizontalOverflow(container, 320);
    });

    it('C4.5: ExportModal has zero horizontal overflow at 320px viewport in idle render state', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <ExportModal
          project={mockProject}
          isOpen={true}
          onClose={vi.fn()}
          onCancelRender={vi.fn()}
          syncMode="line"
        />
      );

      assertZeroHorizontalOverflow(container, 320);
    });

    it('C4.6: ExportSubtitleSection has zero horizontal overflow at 320px viewport', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <ExportSubtitleSection
          project={mockProject}
          selectedTheme={THEMES[0]}
          aspectRatio="16:9"
          syncMode="line"
        />
      );

      assertZeroHorizontalOverflow(container, 320);
    });
  });

  // =========================================================================
  // Focus Area 5: Export Payload & URL Query Parameter Threading
  // =========================================================================
  describe('Focus Area 5: Export Payload & URL Query Parameter Threading', () => {
    it('C5.1: ExportSubtitleSection appends sync_mode=line to .ass export URL when line mode is active', async () => {
      const user = userEvent.setup();
      if (!window.URL.createObjectURL) {
        window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      } else {
        vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:mock-url');
      }
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['ASS Content'], { type: 'text/x-ssa' }),
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="Song.ass"',
        }),
      } as unknown as Response);

      render(
        <ExportSubtitleSection
          project={mockProject}
          selectedTheme={THEMES[0]}
          aspectRatio="16:9"
          syncMode="line"
        />
      );

      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(assBtn);

      expect(apiFetchSpy).toHaveBeenCalledTimes(1);
      const url = apiFetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('/api/project/proj_m1_challenger_test/export/ass');
      expect(url).toContain('sync_mode=line');
    });

    it('C5.2: ExportSubtitleSection appends sync_mode=word when word mode is explicitly passed', async () => {
      const user = userEvent.setup();
      if (!window.URL.createObjectURL) {
        window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      } else {
        vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:mock-url');
      }
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['ASS Content'], { type: 'text/x-ssa' }),
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="Song.ass"',
        }),
      } as unknown as Response);

      render(
        <ExportSubtitleSection
          project={mockProject}
          selectedTheme={THEMES[0]}
          aspectRatio="16:9"
          syncMode="word"
        />
      );

      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(assBtn);

      const url = apiFetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('sync_mode=word');
    });

    it('C5.3: Dynamic sync mode switch in ExportSubtitleSection updates the outgoing URL query parameter', async () => {
      const user = userEvent.setup();
      if (!window.URL.createObjectURL) {
        window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      } else {
        vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:mock-url');
      }
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['ASS Content'], { type: 'text/x-ssa' }),
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="Song.ass"',
        }),
      } as unknown as Response);

      // Sub-test 1: Uncontrolled mode (internal state manages toggle)
      const { unmount } = render(
        <ExportSubtitleSection project={mockProject} selectedTheme={THEMES[0]} aspectRatio="16:9" />
      );

      // User switches to Line-by-Line
      const lineBtn = screen.getByTestId('subtitle-sync-mode-line');
      await user.click(lineBtn);

      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(assBtn);

      expect(apiFetchSpy).toHaveBeenCalledTimes(1);
      const urlUncontrolled = apiFetchSpy.mock.calls[0][0] as string;
      expect(urlUncontrolled).toContain('sync_mode=line');

      unmount();
      apiFetchSpy.mockClear();

      // Sub-test 2: Controlled mode (parent state manages toggle)
      const ControlledWrapper = () => {
        const [mode, setMode] = useState<SyncDisplayMode>('word');
        return (
          <ExportSubtitleSection
            project={mockProject}
            selectedTheme={THEMES[0]}
            aspectRatio="16:9"
            syncMode={mode}
            onSyncModeChange={setMode}
          />
        );
      };

      render(<ControlledWrapper />);

      const controlledLineBtn = screen.getByTestId('subtitle-sync-mode-line');
      await user.click(controlledLineBtn);

      const controlledAssBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(controlledAssBtn);

      expect(apiFetchSpy).toHaveBeenCalledTimes(1);
      const urlControlled = apiFetchSpy.mock.calls[0][0] as string;
      expect(urlControlled).toContain('sync_mode=line');
    });

    it('C5.4: ExportModal direct API fetch includes sync_mode: "line" top-level and in style_config', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
        ok: true,
        json: async () => ({ render_id: 'rnd_123' }),
      } as unknown as Response);

      render(
        <ExportModal
          project={mockProject}
          isOpen={true}
          onClose={vi.fn()}
          onCancelRender={vi.fn()}
          syncMode="line"
        />
      );

      const renderBtn = screen.getByRole('button', { name: /start video render/i });
      await user.click(renderBtn);

      expect(apiFetchSpy).toHaveBeenCalledTimes(1);
      const call = apiFetchSpy.mock.calls[0];
      expect(call[0]).toBe('/api/project/proj_m1_challenger_test/render');
      const body = JSON.parse(call[1]?.body as string);

      expect(body.sync_mode).toBe('line');
      expect(body.style_config).toBeDefined();
      expect(body.style_config.sync_mode).toBe('line');
    });

    it('C5.5: ExportModal onStartRender callback receives syncMode: "line" when line mode is active', async () => {
      const user = userEvent.setup();
      const onStartRender = vi.fn();

      render(
        <ExportModal
          project={mockProject}
          isOpen={true}
          onClose={vi.fn()}
          onStartRender={onStartRender}
          syncMode="line"
        />
      );

      const renderBtn = screen.getByRole('button', { name: /start video render/i });
      await user.click(renderBtn);

      expect(onStartRender).toHaveBeenCalledWith({
        includeVisualizer: false,
        includeCountdown: true,
        syncMode: 'line',
      });
    });

    it('C5.6: Full studio workflow test: syncMode state synchronized between theme hook, controls, and render payload', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as unknown as Response);

      // Wrapper component simulating App.tsx state management
      const TestApp = () => {
        const theme = useVisualTheme();
        const [isExportOpen, setIsExportOpen] = useState(false);

        const handleStartRender = async (options?: { syncMode?: SyncDisplayMode }) => {
          const effectiveSyncMode = options?.syncMode ?? theme.syncMode;
          await apiModule.apiFetch(`/api/project/${mockProject.id}/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              aspect_ratio: theme.aspectRatio,
              sync_mode: effectiveSyncMode,
              style_config: {
                theme_id: theme.selectedTheme.id,
                sync_mode: effectiveSyncMode,
              },
            }),
          });
        };

        return (
          <div>
            <LyricDisplay
              lines={sampleLines}
              currentTime={4.5}
              syncMode={theme.syncMode}
              onSyncModeChange={theme.setSyncMode}
            />
            <VisualThemePicker
              selectedTheme={theme.selectedTheme}
              onSelectTheme={theme.setSelectedTheme}
              aspectRatio={theme.aspectRatio}
              onChangeAspectRatio={theme.setAspectRatio}
              onCustomBgUploaded={theme.setCustomBgId}
            />
            <button data-testid="open-export-btn" onClick={() => setIsExportOpen(true)}>
              Open Export
            </button>
            <ExportModal
              project={mockProject}
              isOpen={isExportOpen}
              onClose={() => setIsExportOpen(false)}
              onStartRender={handleStartRender}
              syncMode={theme.syncMode}
              onSyncModeChange={theme.setSyncMode}
            />
          </div>
        );
      };

      render(<TestApp />);

      // Verify initial state is word mode
      expect(document.documentElement.getAttribute('data-sync-mode')).toBe('word');

      // User switches to Line mode in VisualThemePicker
      const themeLineBtn = screen.getByTestId('sync-mode-line');
      await user.click(themeLineBtn);

      // Verify root data attribute updated
      expect(document.documentElement.getAttribute('data-sync-mode')).toBe('line');

      // Verify LyricDisplay reflects line mode
      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveAttribute('data-sync-mode', 'line');

      // Open ExportModal and start render
      const openExportBtn = screen.getByTestId('open-export-btn');
      await user.click(openExportBtn);

      const renderBtn = screen.getByRole('button', { name: /start video render/i });
      await user.click(renderBtn);

      // Assert API fetch sent line sync mode
      expect(apiFetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse(apiFetchSpy.mock.calls[0][1]?.body as string);
      expect(body.sync_mode).toBe('line');
      expect(body.style_config.sync_mode).toBe('line');
    });
  });
});

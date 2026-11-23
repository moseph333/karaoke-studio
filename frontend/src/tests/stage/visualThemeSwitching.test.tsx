import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisualThemePicker } from '../../components/VisualThemePicker';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { DEFAULT_STAGE_LOOK_ID, STAGE_LOOKS, getStageLook } from '../../theme/stageLooks';
import { ExportModal } from '../../components/ExportModal';
import * as apiModule from '../../api';
import { ProjectState } from '../../types';

const mockProject: ProjectState = {
  id: 'challenger-test-project',
  status: 'ready',
  progress: 100,
  title: 'Challenger Track',
  artist: 'Empirical Challenger',
  duration: 180,
  lines: [
    {
      id: 1,
      start_time: 1.0,
      end_time: 4.0,
      text: 'Adversarial theme stress verification',
      words: [{ word: 'Adversarial', start_time: 1.0, end_time: 4.0 }],
    },
  ],
  semitones: 0,
  guide_volume: 0,
};

describe('M3 Challenger 1: Adversarial Stress Testing (useVisualTheme & VisualThemePicker)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-stage-look');
    document.documentElement.removeAttribute('data-sync-mode');
    vi.restoreAllMocks();
  });

  describe('Adversarial Scenario 2: Reset Behavior (resetThemeDefaults)', () => {
    it('clears all custom overrides, resets font scale & sync mode, and restores active theme defaults', () => {
      const prompter = getStageLook('prompter');
      const { result } = renderHook(() => useVisualTheme(prompter));

      // Apply multiple custom modifications
      act(() => {
        result.current.setCustomSungColor('#123456');
        result.current.setCustomUnsungColor('#654321');
        result.current.setCustomSinger2Color('#aa0000');
        result.current.setCustomBothColor('#00aa00');
        result.current.setFontSizeScale(1.5);
        result.current.setSyncMode('line');
      });

      expect(result.current.customSungColor).toBe('#123456');
      expect(result.current.customUnsungColor).toBe('#654321');
      expect(result.current.fontSizeScale).toBe(1.5);
      expect(result.current.syncMode).toBe('line');
      expect(result.current.activeSungColor).toBe('#123456');
      expect(result.current.activeUnsungColor).toBe('#654321');
      expect(result.current.activeSinger2Color).toBe('#aa0000');
      expect(result.current.activeBothColor).toBe('#00aa00');
      expect(document.documentElement.getAttribute('data-sync-mode')).toBe('line');

      // Call resetThemeDefaults()
      act(() => {
        result.current.resetThemeDefaults();
      });

      // Overrides cleared
      expect(result.current.customSungColor).toBeNull();
      expect(result.current.customUnsungColor).toBeNull();
      expect(result.current.customSinger2Color).toBeNull();
      expect(result.current.customBothColor).toBeNull();
      expect(result.current.fontSizeScale).toBe(1.0);
      expect(result.current.syncMode).toBe('word');

      // Active colors restore to the look's own
      expect(result.current.selectedTheme.id).toBe('prompter');
      expect(result.current.activeSungColor).toBe(prompter.palette.sung);
      expect(result.current.activeUnsungColor).toBe(prompter.palette.unsung);
      expect(result.current.activeSinger2Color).toBe(prompter.palette.singer2);
      expect(result.current.activeBothColor).toBe(prompter.palette.both);

      // Root element attributes sync
      expect(document.documentElement.getAttribute('data-sync-mode')).toBe('word');
      expect(document.documentElement.getAttribute('data-stage-look')).toBe('prompter');
    });

    it('triggers reset from VisualThemePicker UI button', async () => {
      const user = userEvent.setup();
      const onResetMock = vi.fn();

      render(
        <VisualThemePicker
          selectedTheme={getStageLook('marquee')}
          onSelectTheme={vi.fn()}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
          customSungColor="#ff0055"
          customUnsungColor="#00ffff"
          onResetThemeDefaults={onResetMock}
        />
      );

      const resetBtn = screen.getByTestId('reset-theme-defaults-btn');
      expect(resetBtn).toBeInTheDocument();
      await user.click(resetBtn);
      expect(onResetMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Adversarial Scenario 3: Starting Without a Chosen Look', () => {
    it('starts on the default look and behaves robustly', () => {
      const { result } = renderHook(() => useVisualTheme());
      const marquee = getStageLook('marquee');

      expect(DEFAULT_STAGE_LOOK_ID).toBe('marquee');
      expect(result.current.selectedTheme).toBe(marquee);
      expect(result.current.selectedTheme.name).toBe('Marquee');
      expect(result.current.activeSungColor).toBe(marquee.palette.sung);
      expect(result.current.activeUnsungColor).toBe(marquee.palette.unsung);
      expect(result.current.stageBackgroundColor).toBe(marquee.palette.ground);
      expect(result.current.fontSizeScale).toBe(1.0);
      expect(result.current.aspectRatio).toBe('16:9');
      expect(result.current.syncMode).toBe('word');

      // Resetting when already at defaults should be safe and no-op
      act(() => {
        result.current.resetThemeDefaults();
      });
      expect(result.current.selectedTheme.id).toBe('marquee');
      expect(result.current.activeSungColor).toBe(marquee.palette.sung);

      // A custom colour replaces only its own channel
      act(() => {
        result.current.setCustomSungColor('#112233');
      });
      expect(result.current.activeSungColor).toBe('#112233');
      expect(result.current.activeUnsungColor).toBe(marquee.palette.unsung);

      // Resetting clears the override
      act(() => {
        result.current.resetThemeDefaults();
      });
      expect(result.current.activeSungColor).toBe(marquee.palette.sung);

      // Picking another look takes its colours and its ground
      const prompter = getStageLook('prompter');
      act(() => {
        result.current.setSelectedTheme(prompter);
      });
      expect(result.current.selectedTheme.id).toBe('prompter');
      expect(result.current.activeSungColor).toBe(prompter.palette.sung);
      expect(result.current.stageBackgroundColor).toBe(prompter.palette.ground);
    });
  });

  describe('Adversarial Scenario 5: VisualThemePicker Controls & Keyboard Accessibility', () => {
    it('handles keyboard Enter and Space on the look buttons', async () => {
      const user = userEvent.setup();
      const onSelectTheme = vi.fn();
      render(
        <VisualThemePicker
          selectedTheme={getStageLook('marquee')}
          onSelectTheme={onSelectTheme}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
        />
      );

      const songbook = screen.getByRole('button', { name: /^Songbook/ });
      expect(songbook).toHaveAttribute('aria-pressed', 'false');
      songbook.focus();

      // Enter key
      await user.keyboard('{Enter}');
      expect(onSelectTheme).toHaveBeenCalledTimes(1);
      expect(onSelectTheme).toHaveBeenLastCalledWith(getStageLook('songbook'));

      // Space key
      await user.keyboard(' ');
      expect(onSelectTheme).toHaveBeenCalledTimes(2);
      expect(onSelectTheme).toHaveBeenLastCalledWith(getStageLook('songbook'));
    });

    it('triggers color picker callbacks on change', () => {
      const onSungChange = vi.fn();
      const onUnsungChange = vi.fn();

      render(
        <VisualThemePicker
          selectedTheme={getStageLook('marquee')}
          onSelectTheme={vi.fn()}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
          onCustomSungColorChange={onSungChange}
          onCustomUnsungColorChange={onUnsungChange}
        />
      );

      const sungInput = screen.getByTestId('sung-color-picker');
      fireEvent.change(sungInput, { target: { value: '#ff0055' } });
      expect(onSungChange).toHaveBeenCalledWith('#ff0055');

      const unsungInput = screen.getByTestId('unsung-color-picker');
      fireEvent.change(unsungInput, { target: { value: '#00ffcc' } });
      expect(onUnsungChange).toHaveBeenCalledWith('#00ffcc');
    });

    it('triggers font scale callbacks for all 4 options', () => {
      const onScaleChange = vi.fn();

      render(
        <VisualThemePicker
          selectedTheme={getStageLook('marquee')}
          onSelectTheme={vi.fn()}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
          onFontSizeScaleChange={onScaleChange}
        />
      );

      fireEvent.click(screen.getByTestId('font-scale-0.8x'));
      expect(onScaleChange).toHaveBeenCalledWith(0.8);

      fireEvent.click(screen.getByTestId('font-scale-1.2x'));
      expect(onScaleChange).toHaveBeenCalledWith(1.2);

      fireEvent.click(screen.getByTestId('font-scale-1.5x'));
      expect(onScaleChange).toHaveBeenCalledWith(1.5);

      fireEvent.click(screen.getByTestId('font-scale-1x'));
      expect(onScaleChange).toHaveBeenCalledWith(1.0);
    });
  });

  describe('Adversarial Scenario 6: Export Pipeline Theme ID Parity', () => {
    it('verifies ExportModal correctly passes every one of the looks to render endpoint', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(JSON.stringify({ status: 'queued', task_id: 'task_render_all' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      expect(STAGE_LOOKS).toHaveLength(5);
      for (const theme of STAGE_LOOKS) {
        apiFetchSpy.mockClear();
        const { unmount } = render(
          <ExportModal
            project={mockProject}
            isOpen={true}
            onClose={vi.fn()}
            selectedTheme={theme}
            aspectRatio="16:9"
          />
        );

        const renderBtn = screen.getByRole('button', { name: /render 1080p video/i });
        await user.click(renderBtn);

        expect(apiFetchSpy).toHaveBeenCalledWith(
          '/api/project/challenger-test-project/render',
          expect.objectContaining({
            body: expect.stringContaining(`"theme_id":"${theme.id}"`),
          })
        );
        unmount();
      }
    });
  });
});

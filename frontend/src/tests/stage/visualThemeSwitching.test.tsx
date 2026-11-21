import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { THEMES, VisualThemePicker } from '../../components/VisualThemePicker';
import { useVisualTheme, cssToAssColor } from '../../hooks/useVisualTheme';
import { getStagePreset } from '../../theme/stagePresets';
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
    document.documentElement.removeAttribute('data-stage-preset');
    document.documentElement.removeAttribute('data-sync-mode');
    document.documentElement.style.removeProperty('--karaoke-sung-color');
    document.documentElement.style.removeProperty('--karaoke-unsung-color');
    document.documentElement.style.removeProperty('--karaoke-font-family');
    document.documentElement.style.removeProperty('--karaoke-font-scale');
    vi.restoreAllMocks();
  });

  describe('Adversarial Scenario 2: Reset Behavior (resetThemeDefaults)', () => {
    it('clears all custom overrides, resets font scale & sync mode, and restores active theme defaults', () => {
      const { result } = renderHook(() => useVisualTheme(getStagePreset('crt_ktv')));

      // Apply multiple custom modifications
      act(() => {
        result.current.setCustomSungColor('#123456');
        result.current.setCustomUnsungColor('#654321');
        result.current.setFontSizeScale(1.5);
        result.current.setSyncMode('line');
      });

      expect(result.current.customSungColor).toBe('#123456');
      expect(result.current.customUnsungColor).toBe('#654321');
      expect(result.current.fontSizeScale).toBe(1.5);
      expect(result.current.syncMode).toBe('line');
      expect(result.current.activeSungColor).toBe('#123456');
      expect(result.current.activeUnsungColor).toBe('#654321');
      expect(document.documentElement.getAttribute('data-sync-mode')).toBe('line');
      expect(document.documentElement.style.getPropertyValue('--karaoke-font-scale')).toBe('1.5');

      // Call resetThemeDefaults()
      act(() => {
        result.current.resetThemeDefaults();
      });

      // Overrides cleared
      expect(result.current.customSungColor).toBeNull();
      expect(result.current.customUnsungColor).toBeNull();
      expect(result.current.fontSizeScale).toBe(1.0);
      expect(result.current.syncMode).toBe('word');

      // Active colors restore to the crt_ktv preset's defaults
      expect(result.current.activeSungColor).toBe('#22c55e');
      expect(result.current.activeUnsungColor).toBe('#86efac');
      expect(result.current.effectiveTheme.primary_color).toBe('&H005EC522');
      expect(result.current.effectiveTheme.secondary_color).toBe('&H00ACEF86');

      // Root element attributes sync
      expect(document.documentElement.getAttribute('data-sync-mode')).toBe('word');
      expect(document.documentElement.style.getPropertyValue('--karaoke-font-scale')).toBe('1');
      expect(document.documentElement.style.getPropertyValue('--karaoke-sung-color')).toBe(
        '#22c55e'
      );
      expect(document.documentElement.style.getPropertyValue('--karaoke-unsung-color')).toBe(
        '#86efac'
      );
    });

    it('triggers reset from VisualThemePicker UI button', async () => {
      const user = userEvent.setup();
      const onResetMock = vi.fn();

      render(
        <VisualThemePicker
          selectedTheme={THEMES[4]}
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

  describe('Adversarial Scenario 3: Starting Without a Chosen Preset', () => {
    it('starts on Afterglow and behaves robustly', () => {
      const { result } = renderHook(() => useVisualTheme());

      expect(result.current.selectedTheme.id).toBe('afterglow');
      expect(result.current.selectedTheme.name).toBe('Afterglow');
      expect(result.current.activeSungColor).toBe('#fbbf24');
      expect(result.current.activeUnsungColor).toBe('#edebff');
      expect(result.current.fontSizeScale).toBe(1.0);
      expect(result.current.aspectRatio).toBe('16:9');
      expect(result.current.syncMode).toBe('word');
      expect(result.current.effectiveTheme.id).toBe('afterglow');

      // Resetting when already at defaults should be safe and no-op
      act(() => {
        result.current.resetThemeDefaults();
      });
      expect(result.current.selectedTheme.id).toBe('afterglow');
      expect(result.current.activeSungColor).toBe('#fbbf24');

      // A custom colour replaces only its own channel
      act(() => {
        result.current.setCustomSungColor('#112233');
      });
      expect(result.current.activeSungColor).toBe('#112233');
      expect(result.current.activeUnsungColor).toBe('#edebff');

      // Resetting clears the override
      act(() => {
        result.current.resetThemeDefaults();
      });
      expect(result.current.activeSungColor).toBe('#fbbf24');

      // Picking another preset takes its colours
      act(() => {
        result.current.setSelectedTheme(getStagePreset('crt_ktv')!);
      });
      expect(result.current.selectedTheme.id).toBe('crt_ktv');
      expect(result.current.activeSungColor).toBe('#22c55e');
    });
  });

  describe('Adversarial Scenario 4: cssToAssColor Robustness', () => {
    it('correctly converts 6-digit hex colors to BGR format', () => {
      // Hex #RRGGBB -> &H00BBGGRR
      expect(cssToAssColor('#ff0055')).toBe('&H005500FF');
      expect(cssToAssColor('#00ffff')).toBe('&H00FFFF00');
      expect(cssToAssColor('#123456')).toBe('&H00563412');
      expect(cssToAssColor('aabbcc')).toBe('&H00CCBBAA');
    });

    it('correctly expands and converts 3-digit hex colors', () => {
      // #f05 -> #ff0055 -> &H005500FF
      expect(cssToAssColor('#f05')).toBe('&H005500FF');
      expect(cssToAssColor('#fff')).toBe('&H00FFFFFF');
    });

    it('preserves native ASS strings case-insensitively', () => {
      expect(cssToAssColor('&H0015CCFA')).toBe('&H0015CCFA');
      expect(cssToAssColor('&h0015ccfa')).toBe('&H0015CCFA');
    });

    it('falls back to defaultAss on invalid or empty inputs without throwing', () => {
      expect(cssToAssColor('')).toBe('&H0000D7FF');
      expect(cssToAssColor('invalid-color')).toBe('&H0000D7FF');
      expect(cssToAssColor('#xyz123', '&H00CUSTOM')).toBe('&H00CUSTOM');
    });
  });

  describe('Adversarial Scenario 5: VisualThemePicker Controls & Keyboard Accessibility', () => {
    it('handles keyboard Enter and Space navigation on theme cards', () => {
      const onSelectTheme = vi.fn();
      render(
        <VisualThemePicker
          selectedTheme={THEMES[4]}
          onSelectTheme={onSelectTheme}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
        />
      );

      const paperCard = screen.getByRole('button', { name: new RegExp(THEMES[7].name, 'i') });

      // Enter key
      fireEvent.keyDown(paperCard, { key: 'Enter' });
      expect(onSelectTheme).toHaveBeenCalledWith(THEMES[7]);

      // Space key
      fireEvent.keyDown(paperCard, { key: ' ' });
      expect(onSelectTheme).toHaveBeenCalledWith(THEMES[7]);
    });

    it('triggers color picker callbacks on change', () => {
      const onSungChange = vi.fn();
      const onUnsungChange = vi.fn();

      render(
        <VisualThemePicker
          selectedTheme={THEMES[4]}
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
          selectedTheme={THEMES[4]}
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
    it('verifies ExportModal correctly passes every one of the 8 themes to render endpoint', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(JSON.stringify({ status: 'queued', task_id: 'task_render_all' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      for (const theme of THEMES) {
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

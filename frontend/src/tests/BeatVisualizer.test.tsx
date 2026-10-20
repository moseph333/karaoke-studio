import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { BeatVisualizer } from '../components/BeatVisualizer';
import { LyricDisplay } from '../components/LyricDisplay';
import { LyricTimelineEditor } from '../components/LyricTimelineEditor';
import { AudioControls } from '../components/AudioControls';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import {
  setTestViewport,
  resetTestViewport,
  assertTouchTargets,
  assertZeroHorizontalOverflow,
} from './responsiveTestUtils';
import { LyricLine } from '../types';

const mockLines: LyricLine[] = [
  {
    id: 1,
    text: 'Beat visualizer testing line',
    start_time: 2.0,
    end_time: 6.0,
    words: [
      { word: 'Beat', start_time: 2.0, end_time: 3.0 },
      { word: 'visualizer', start_time: 3.0, end_time: 4.5 },
      { word: 'line', start_time: 4.5, end_time: 6.0 },
    ],
  },
];

describe('Beat-Reactive Audio Visualizer & Hotkeys (Requirement R3 / M3)', () => {
  let mockAnalyser: AnalyserNode;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockAnalyser = new window.AudioContext().createAnalyser();
  });

  afterEach(() => {
    resetTestViewport();
    document.body.innerHTML = '';
  });

  describe('Canvas Rendering & Lifecycle', () => {
    it('renders canvas element with testid and aria-hidden attributes', () => {
      render(<BeatVisualizer analyserNode={mockAnalyser} isPlaying={false} />);
      const container = screen.getByTestId('beat-visualizer');
      expect(container).toBeInTheDocument();
      expect(container).toHaveAttribute('aria-hidden', 'true');
      expect(container.querySelector('canvas')).toBeInTheDocument();
    });

    it('preserves absolute positioning class without conflicting relative class', () => {
      render(
        <BeatVisualizer
          analyserNode={mockAnalyser}
          isPlaying={false}
          className="absolute inset-0 z-[1] pointer-events-none"
        />
      );
      const container = screen.getByTestId('beat-visualizer');
      expect(container.className).toContain('absolute');
      expect(container.className).not.toContain('relative');
    });

    it('draws resting frame when paused without leaking requestAnimationFrame loop', () => {
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
      render(<BeatVisualizer analyserNode={mockAnalyser} isPlaying={false} />);
      // Paused state should NOT request continuous animation frames
      expect(rafSpy).not.toHaveBeenCalled();
    });

    it('starts requestAnimationFrame loop when isPlaying is true and cancels on pause', () => {
      const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
      const { rerender } = render(<BeatVisualizer analyserNode={mockAnalyser} isPlaying={true} />);

      rerender(<BeatVisualizer analyserNode={mockAnalyser} isPlaying={false} />);
      expect(cancelSpy).toHaveBeenCalled();
    });

    it('handles null or missing analyserNode gracefully without throwing', () => {
      expect(() => {
        render(<BeatVisualizer analyserNode={null} isPlaying={true} />);
      }).not.toThrow();
    });
  });

  describe('Toggle Controls & Stage Mode Integration', () => {
    it('renders toggle-visualizer-btn in AudioControls with >=44px touch target', () => {
      const onToggle = vi.fn();
      render(
        <AudioControls
          projectId="test-viz"
          currentTime={0}
          duration={100}
          isPlaying={false}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
          onMixChange={vi.fn()}
          showVisualizer={false}
          onToggleVisualizer={onToggle}
        />
      );

      const btn = screen.getByTestId('toggle-visualizer-btn');
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(btn);
      expect(onToggle).toHaveBeenCalledTimes(1);

      const inspection = assertTouchTargets(btn.parentElement!);
      expect(inspection.failed).toHaveLength(0);
    });

    it('renders toggle-visualizer-btn in Stage Mode floating controls when fullscreen', () => {
      const onToggle = vi.fn();
      render(
        <LyricDisplay
          lines={mockLines}
          currentTime={3.0}
          duration={120}
          isPlaying={false}
          showVisualizer={true}
          onToggleVisualizer={onToggle}
        />
      );

      // Enter stage mode
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      const floatingControls = screen.getByTestId('stage-floating-controls');
      expect(floatingControls).toBeInTheDocument();

      const stageToggleBtn = within(floatingControls).getByTestId('toggle-visualizer-btn');
      expect(stageToggleBtn).toBeInTheDocument();
      expect(stageToggleBtn).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(stageToggleBtn);
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('renders BeatVisualizer behind lyrics in LyricDisplay when showVisualizer is true', () => {
      const { rerender } = render(
        <LyricDisplay lines={mockLines} currentTime={3.0} showVisualizer={false} />
      );
      expect(screen.queryByTestId('beat-visualizer')).not.toBeInTheDocument();

      rerender(<LyricDisplay lines={mockLines} currentTime={3.0} showVisualizer={true} />);
      expect(screen.getByTestId('beat-visualizer')).toBeInTheDocument();
    });

    it('forwards showVisualizer, onToggleVisualizer, and analyserNode through LyricTimelineEditor to Live Visual Preview', () => {
      const onToggle = vi.fn();
      render(
        <LyricTimelineEditor
          projectId="test-viz-project"
          lines={mockLines}
          currentTime={3.0}
          duration={120}
          isPlaying={true}
          onSaveLines={vi.fn()}
          onSeek={vi.fn()}
          showVisualizer={true}
          onToggleVisualizer={onToggle}
          analyserNode={mockAnalyser}
        />
      );

      const visualizer = screen.getByTestId('beat-visualizer');
      expect(visualizer).toBeInTheDocument();
      expect(visualizer.className).toContain('absolute');
      expect(visualizer.className).not.toContain('relative');

      const previewToggleBtn = screen.getByTestId('toggle-visualizer-btn');
      expect(previewToggleBtn).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(previewToggleBtn);
      expect(onToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe('Keyboard Shortcut V & Strict Isolation', () => {
    it('toggles visualizer on V keydown (both lower and uppercase)', () => {
      const onToggleVisualizer = vi.fn();
      const Harness = () => {
        useKeyboardShortcuts({ onToggleVisualizer, enabled: true });
        return <div>Shortcut Harness</div>;
      };
      render(<Harness />);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
      expect(onToggleVisualizer).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', bubbles: true }));
      expect(onToggleVisualizer).toHaveBeenCalledTimes(2);
    });

    it('suppresses autorepeat bursts of key V', () => {
      const onToggleVisualizer = vi.fn();
      const Harness = () => {
        useKeyboardShortcuts({ onToggleVisualizer, enabled: true });
        return <div>Shortcut Harness</div>;
      };
      render(<Harness />);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', repeat: true, bubbles: true }));
      expect(onToggleVisualizer).not.toHaveBeenCalled();
    });

    it('ignores V keydown when typing inside input, textarea, or contenteditable', () => {
      const onToggleVisualizer = vi.fn();
      const Harness = () => {
        useKeyboardShortcuts({ onToggleVisualizer, enabled: true });
        return (
          <div>
            <input data-testid="input-target" type="text" />
            <textarea data-testid="textarea-target" />
            <div data-testid="editable-target" contentEditable="true" />
          </div>
        );
      };
      render(<Harness />);

      const input = screen.getByTestId('input-target');
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
      expect(onToggleVisualizer).not.toHaveBeenCalled();

      const textarea = screen.getByTestId('textarea-target');
      textarea.focus();
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
      expect(onToggleVisualizer).not.toHaveBeenCalled();

      const editable = screen.getByTestId('editable-target');
      editable.focus();
      editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
      expect(onToggleVisualizer).not.toHaveBeenCalled();
    });

    it('ignores V keydown when a modal dialog is open (dialog or role="dialog")', () => {
      const onToggleVisualizer = vi.fn();
      const Harness = () => {
        useKeyboardShortcuts({ onToggleVisualizer, enabled: true });
        return (
          <div>
            <dialog open data-testid="native-dialog">
              <button>Inside Dialog</button>
            </dialog>
          </div>
        );
      };
      render(<Harness />);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
      expect(onToggleVisualizer).not.toHaveBeenCalled();
    });

    it('strictly ignores Ctrl+V, Cmd+V, and Alt+V to preserve clipboard paste', () => {
      const onToggleVisualizer = vi.fn();
      const Harness = () => {
        useKeyboardShortcuts({ onToggleVisualizer, enabled: true });
        return <div>Paste Test</div>;
      };
      render(<Harness />);

      // Windows/Linux paste
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true })
      );
      expect(onToggleVisualizer).not.toHaveBeenCalled();

      // macOS paste
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'v', metaKey: true, bubbles: true })
      );
      expect(onToggleVisualizer).not.toHaveBeenCalled();

      // Alt+V
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', altKey: true, bubbles: true }));
      expect(onToggleVisualizer).not.toHaveBeenCalled();
    });
  });

  describe('Responsive Layout & Ergonomics (320px)', () => {
    it('maintains zero horizontal overflow at 320px Mobile Small viewport', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <LyricDisplay lines={mockLines} currentTime={3.0} showVisualizer={true} />
      );

      assertZeroHorizontalOverflow(container, 320);
    });
  });
});

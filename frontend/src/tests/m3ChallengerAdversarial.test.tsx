import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { AudioControls } from '../components/AudioControls';
import { TransportDock } from '../components/transport/TransportDock';
import { LyricDisplay } from '../components/LyricDisplay';
import { ExportModal } from '../components/ExportModal';
import {
  setTestViewport,
  resetTestViewport,
  assertTouchTargets,
  assertZeroHorizontalOverflow,
} from './responsiveTestUtils';
import { LyricLine, ProjectState } from '../types';

const mockLines: LyricLine[] = [
  {
    id: 1,
    text: 'Adversarial challenger test line',
    start_time: 2.0,
    end_time: 6.0,
    words: [
      { word: 'Adversarial', start_time: 2.0, end_time: 3.5 },
      { word: 'challenger', start_time: 3.5, end_time: 5.0 },
      { word: 'line', start_time: 5.0, end_time: 6.0 },
    ],
    singer: 'singer1',
  },
  {
    id: 2,
    text: 'Second line after long gap',
    start_time: 12.0,
    end_time: 16.0,
    words: [
      { word: 'Second', start_time: 12.0, end_time: 13.5 },
      { word: 'line', start_time: 13.5, end_time: 16.0 },
    ],
    singer: 'singer2',
  },
];

const mockProject: ProjectState = {
  id: 'test-proj-challenger',
  title: 'Challenger Song',
  artist: 'Challenger Artist',
  status: 'ready',
  progress: 1.0,
  audio_url: '/audio/test.mp3',
  lines: mockLines,
  semitones: 0,
  guide_volume: 1.0,
  render_status: 'idle',
};

describe('M3 Challenger 2: Adversarial Stress Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    resetTestViewport();
    document.body.innerHTML = '';
  });

  describe('Hotkey V Isolation Stress Testing', () => {
    it('DOES toggle cleanly when user is interacting with player/timeline outside inputs', () => {
      const onToggleVisualizer = vi.fn();
      renderHook(() => useKeyboardShortcuts({ onToggleVisualizer, enabled: true }));

      // Dispatch 'v' keydown
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
      expect(onToggleVisualizer).toHaveBeenCalledTimes(1);

      // Dispatch uppercase 'V' (e.g. CapsLock on without shift)
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'V', shiftKey: false, bubbles: true })
      );
      expect(onToggleVisualizer).toHaveBeenCalledTimes(2);
    });

    it('does NOT toggle visualizer when user is focused on <input>', () => {
      const onToggleVisualizer = vi.fn();
      const Harness = () => {
        useKeyboardShortcuts({ onToggleVisualizer, enabled: true });
        return <input data-testid="test-input" type="text" />;
      };
      render(<Harness />);
      const input = screen.getByTestId('test-input');
      input.focus();

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
      expect(onToggleVisualizer).not.toHaveBeenCalled();

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', bubbles: true }));
      expect(onToggleVisualizer).not.toHaveBeenCalled();
    });

    it('does NOT toggle visualizer when user is focused on <textarea>', () => {
      const onToggleVisualizer = vi.fn();
      const Harness = () => {
        useKeyboardShortcuts({ onToggleVisualizer, enabled: true });
        return <textarea data-testid="test-textarea" />;
      };
      render(<Harness />);
      const textarea = screen.getByTestId('test-textarea');
      textarea.focus();

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
      expect(onToggleVisualizer).not.toHaveBeenCalled();
    });

    it('does NOT toggle visualizer when user is focused on [contenteditable]', () => {
      const onToggleVisualizer = vi.fn();
      const Harness = () => {
        useKeyboardShortcuts({ onToggleVisualizer, enabled: true });
        return <div data-testid="test-editable" contentEditable="true" />;
      };
      render(<Harness />);
      const editable = screen.getByTestId('test-editable');
      editable.focus();

      editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
      expect(onToggleVisualizer).not.toHaveBeenCalled();
    });

    it('does NOT toggle visualizer when <dialog> is open or [role="dialog"] is active', () => {
      const onToggleVisualizer = vi.fn();
      const Harness = () => {
        useKeyboardShortcuts({ onToggleVisualizer, enabled: true });
        return (
          <div>
            <dialog open data-testid="open-dialog">
              <button>In Dialog</button>
            </dialog>
          </div>
        );
      };
      render(<Harness />);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
      expect(onToggleVisualizer).not.toHaveBeenCalled();

      // Test with role="dialog"
      document.body.innerHTML = '';
      const HarnessRole = () => {
        useKeyboardShortcuts({ onToggleVisualizer, enabled: true });
        return (
          <div role="dialog" aria-modal="true">
            <button>In Role Dialog</button>
          </div>
        );
      };
      render(<HarnessRole />);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
      expect(onToggleVisualizer).not.toHaveBeenCalled();
    });

    it('does NOT trigger on Ctrl+V, Cmd+V, Alt+V', () => {
      const onToggleVisualizer = vi.fn();
      renderHook(() => useKeyboardShortcuts({ onToggleVisualizer, enabled: true }));

      // Ctrl+V
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true })
      );
      expect(onToggleVisualizer).not.toHaveBeenCalled();

      // Cmd+V / Meta+V
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'v', metaKey: true, bubbles: true })
      );
      expect(onToggleVisualizer).not.toHaveBeenCalled();

      // Alt+V
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', altKey: true, bubbles: true }));
      expect(onToggleVisualizer).not.toHaveBeenCalled();
    });

    it('does NOT trigger on Shift+V (adversarial challenge)', () => {
      const onToggleVisualizer = vi.fn();
      renderHook(() => useKeyboardShortcuts({ onToggleVisualizer, enabled: true }));

      // Shift+V should NOT trigger toggle visualizer
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'V', shiftKey: true, bubbles: true })
      );
      expect(onToggleVisualizer).not.toHaveBeenCalled();

      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'v', shiftKey: true, bubbles: true })
      );
      expect(onToggleVisualizer).not.toHaveBeenCalled();
    });
  });

  describe('Touch Targets (>= 44px)', () => {
    it('the visualizer toggle lives once, in the stage toolbar, with a min 44px touch target', () => {
      render(
        <div>
          <AudioControls projectId="test-viz" onMixChange={vi.fn()} />
          <LyricDisplay
            lines={mockLines}
            currentTime={0}
            showVisualizer={false}
            onToggleVisualizer={vi.fn()}
          />
        </div>
      );

      expect(screen.getAllByTestId('toggle-visualizer-btn')).toHaveLength(1);
      const btn = screen.getByTestId('toggle-visualizer-btn');
      expect(btn).toBeInTheDocument();
      const cls = btn.className;
      expect(cls.includes('min-h-[44px]') && cls.includes('min-w-[44px]')).toBe(true);
      const inspection = assertTouchTargets(btn.parentElement!);
      expect(inspection.failed).toHaveLength(0);
    });

    it('LyricDisplay Stage Mode toggle-visualizer-btn has min 44px touch target', () => {
      render(
        <LyricDisplay
          lines={mockLines}
          currentTime={3.0}
          duration={120}
          isPlaying={false}
          showVisualizer={true}
          onToggleVisualizer={vi.fn()}
        />
      );

      // In normal mode header
      const headerBtn = screen.getByTestId('toggle-visualizer-btn');
      expect(headerBtn.className).toContain('min-h-[44px]');
      expect(headerBtn.className).toContain('min-w-[44px]');

      // In Stage Mode (fullscreen) the same toolbar toggle stays available
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));
      expect(screen.getByTestId('stage-floating-controls')).toBeInTheDocument();
      const stageBtn = screen
        .getByTestId('stage-toolbar')
        .querySelector('[data-testid="toggle-visualizer-btn"]') as HTMLElement;
      expect(stageBtn).toBeInTheDocument();
      expect(screen.getAllByTestId('toggle-visualizer-btn')).toHaveLength(1);
      expect(stageBtn.className).toContain('min-h-[44px]');
      expect(stageBtn.className).toContain('min-w-[44px]');

      // Specifically assert touch targets on the stage toggle-visualizer-btn
      const wrapper = document.createElement('div');
      wrapper.appendChild(stageBtn.cloneNode(true));
      const inspection = assertTouchTargets(wrapper);
      expect(inspection.failed).toHaveLength(0);
    });

    it('ExportModal toggle-export-visualizer checkbox and container satisfy >= 44px touch target', () => {
      render(
        <ExportModal
          project={mockProject}
          isOpen={true}
          onClose={vi.fn()}
          onStartRender={vi.fn()}
        />
      );

      const checkbox = screen.getByTestId('toggle-export-visualizer');
      expect(checkbox).toBeInTheDocument();
      expect(checkbox.className).toContain('min-h-[44px]');
      expect(checkbox.className).toContain('min-w-[44px]');

      const container = screen.getByTestId('toggle-export-visualizer-container');
      expect(container.className).toContain('min-h-[44px]');
      expect(container.className).toContain('min-w-[44px]');

      const inspection = assertTouchTargets(container.parentElement!);
      expect(inspection.failed).toHaveLength(0);
    });
  });

  describe('Zero Horizontal Overflow at 320px Viewport', () => {
    it('LyricDisplay has zero horizontal overflow at 320px', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <LyricDisplay lines={mockLines} currentTime={3.0} duration={120} showVisualizer={true} />
      );
      assertZeroHorizontalOverflow(container, 320);
    });

    it('LyricDisplay Stage Mode has zero horizontal overflow at 320px', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <LyricDisplay lines={mockLines} currentTime={3.0} duration={120} showVisualizer={true} />
      );
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));
      assertZeroHorizontalOverflow(container, 320);
    });

    it('AudioControls (Mix inspector) and TransportDock have zero horizontal overflow at 320px', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <div>
          <AudioControls projectId="test-viz" initialSemitones={-7} onMixChange={vi.fn()} />
          <TransportDock
            currentTime={0}
            duration={100}
            isPlaying={false}
            onTogglePlay={vi.fn()}
            onSeek={vi.fn()}
          />
        </div>
      );
      assertZeroHorizontalOverflow(container, 320);
    });

    it('ExportModal has zero horizontal overflow at 320px', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <ExportModal
          project={mockProject}
          isOpen={true}
          onClose={vi.fn()}
          onStartRender={vi.fn()}
        />
      );
      assertZeroHorizontalOverflow(container, 320);
    });
  });
});

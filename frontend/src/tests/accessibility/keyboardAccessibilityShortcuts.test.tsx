import React, { useRef, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  useKeyboardShortcuts,
  isInputElement,
  isModalActive,
} from '../../hooks/useKeyboardShortcuts';
import { useFocusTrap, getFocusableElements } from '../../hooks/useFocusTrap';
import { AuthModal } from '../../components/AuthModal';
import { ExportModal } from '../../components/ExportModal';
import { LyricTimelineEditor } from '../../components/LyricTimelineEditor';
import { ProjectState, LyricLine } from '../../types';

// Mock project fixture for modal tests
const mockProject: ProjectState = {
  id: 'proj-m5-test-123',
  status: 'ready',
  progress: 100,
  title: 'Adversarial Test Track',
  artist: 'Challenger',
  lines: [
    {
      id: 1,
      text: 'Hello world adversarial challenge',
      start_time: 2.0,
      end_time: 6.0,
      words: [
        { word: 'Hello', start_time: 2.0, end_time: 3.0 },
        { word: 'world', start_time: 3.0, end_time: 4.0 },
        { word: 'adversarial', start_time: 4.0, end_time: 5.0 },
        { word: 'challenge', start_time: 5.0, end_time: 6.0 },
      ],
    },
  ],
  semitones: 0,
  guide_volume: 0,
  render_status: 'completed',
  video_url: '/output/test.mp4',
  youtube_package: {
    title: 'Adversarial Test Video',
    description: 'Sample description with timestamps',
    tags: ['test', 'karaoke'],
    key_note: 'C Major',
    lyrics: 'Hello world',
    privacy_status: 'public',
  },
};

const mockLyricLines: LyricLine[] = [
  {
    id: 1,
    text: 'Is this the real life',
    start_time: 5.0,
    end_time: 8.0,
    words: [
      { word: 'Is', start_time: 5.0, end_time: 5.5 },
      { word: 'this', start_time: 5.5, end_time: 6.0 },
      { word: 'the', start_time: 6.0, end_time: 6.5 },
      { word: 'real', start_time: 6.5, end_time: 7.2 },
      { word: 'life', start_time: 7.2, end_time: 8.0 },
    ],
  },
];

describe('M5 Challenger 1: Features 41 & 45 Empirical Adversarial Suite', () => {
  let playSpy: ReturnType<typeof vi.fn>;
  let seekSpy: ReturnType<typeof vi.fn>;
  let muteSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    playSpy = vi.fn();
    seekSpy = vi.fn();
    muteSpy = vi.fn();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SECTION 1: Feature 41 - Global Keyboard Shortcuts Stress & Boundary Tests
  // =========================================================================

  describe('Feature 41: Global Keyboard Shortcuts (useKeyboardShortcuts)', () => {
    it('Scenario 1: Rapid Spacebar toggling fires play/pause exactly per discrete keydown', () => {
      const Harness = () => {
        useKeyboardShortcuts({
          onTogglePlay: playSpy,
          onSeek: seekSpy,
          onToggleMute: muteSpy,
          currentTime: 10,
          duration: 100,
        });
        return <div data-testid="harness">Shortcuts Active</div>;
      };

      render(<Harness />);

      // Rapidly trigger 25 non-repeating Space keydown events
      for (let i = 0; i < 25; i++) {
        const ev = new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          repeat: false,
          bubbles: true,
          cancelable: true,
        });
        const prevDefSpy = vi.spyOn(ev, 'preventDefault');
        window.dispatchEvent(ev);
        expect(prevDefSpy).toHaveBeenCalled();
      }

      expect(playSpy).toHaveBeenCalledTimes(25);
    });

    it('Scenario 2: Autorepeat Spacebar bursts are completely suppressed (zero play strobing)', () => {
      const Harness = () => {
        useKeyboardShortcuts({
          onTogglePlay: playSpy,
        });
        return <div>Autorepeat Guard</div>;
      };

      render(<Harness />);

      // Initial legitimate keydown
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          repeat: false,
          bubbles: true,
          cancelable: true,
        })
      );
      expect(playSpy).toHaveBeenCalledTimes(1);

      // Followed by 30 OS autorepeat keydowns
      for (let i = 0; i < 30; i++) {
        const repeatEv = new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          repeat: true,
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(repeatEv);
      }

      // Must remain at 1
      expect(playSpy).toHaveBeenCalledTimes(1);
    });

    it('Scenario 3: Input isolation prevents Space, Arrows, and M/m inside text inputs and search fields', () => {
      const Harness = () => {
        useKeyboardShortcuts({
          onTogglePlay: playSpy,
          onSeek: seekSpy,
          onToggleMute: muteSpy,
          currentTime: 30,
          duration: 120,
        });
        return (
          <div>
            <input type="text" data-testid="text-input" />
            <input type="search" data-testid="search-input" />
            <input type="password" data-testid="password-input" />
            <textarea data-testid="text-area" />
            <select data-testid="select-box">
              <option value="1">Option 1</option>
            </select>
          </div>
        );
      };

      render(<Harness />);

      const textInput = screen.getByTestId('text-input');
      const searchInput = screen.getByTestId('search-input');
      const passwordInput = screen.getByTestId('password-input');
      const textArea = screen.getByTestId('text-area');
      const selectBox = screen.getByTestId('select-box');

      const inputs = [textInput, searchInput, passwordInput, textArea, selectBox];

      inputs.forEach((target) => {
        target.focus();

        // Spacebar inside input
        target.dispatchEvent(
          new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })
        );

        // ArrowLeft & ArrowRight inside input
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

        // 'm' and 'M' inside input
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', bubbles: true }));
      });

      expect(playSpy).not.toHaveBeenCalled();
      expect(seekSpy).not.toHaveBeenCalled();
      expect(muteSpy).not.toHaveBeenCalled();
    });

    it('Scenario 4: Input isolation prevents shortcuts inside range sliders and ARIA roles (slider, textbox, searchbox, spinbutton)', () => {
      const Harness = () => {
        useKeyboardShortcuts({
          onTogglePlay: playSpy,
          onSeek: seekSpy,
          onToggleMute: muteSpy,
          currentTime: 30,
          duration: 120,
        });
        return (
          <div>
            <input type="range" data-testid="range-slider" min="0" max="100" />
            <div role="slider" tabIndex={0} data-testid="aria-slider" />
            <div role="textbox" tabIndex={0} data-testid="aria-textbox" />
            <div role="searchbox" tabIndex={0} data-testid="aria-searchbox" />
            <div role="spinbutton" tabIndex={0} data-testid="aria-spinbutton" />
          </div>
        );
      };

      render(<Harness />);

      const elements = [
        screen.getByTestId('range-slider'),
        screen.getByTestId('aria-slider'),
        screen.getByTestId('aria-textbox'),
        screen.getByTestId('aria-searchbox'),
        screen.getByTestId('aria-spinbutton'),
      ];

      elements.forEach((el) => {
        el.focus();
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
      });

      expect(seekSpy).not.toHaveBeenCalled();
      expect(playSpy).not.toHaveBeenCalled();
      expect(muteSpy).not.toHaveBeenCalled();
    });

    it('Scenario 5: Input isolation handles contenteditable and deeply nested elements inside editable containers', () => {
      const Harness = () => {
        useKeyboardShortcuts({
          onTogglePlay: playSpy,
          onSeek: seekSpy,
          onToggleMute: muteSpy,
        });
        const emptyEditableRef = useRef<HTMLDivElement>(null);
        React.useEffect(() => {
          if (emptyEditableRef.current) {
            emptyEditableRef.current.setAttribute('contenteditable', '');
          }
        }, []);

        return (
          <div>
            <div contentEditable="true" data-testid="editable-root">
              <p>
                <span data-testid="nested-editable-span">Editing nested node</span>
              </p>
            </div>
            <div ref={emptyEditableRef} data-testid="editable-empty-string">
              <span data-testid="nested-span-empty">Empty string editable</span>
            </div>
          </div>
        );
      };

      render(<Harness />);

      const nestedSpan = screen.getByTestId('nested-editable-span');
      const nestedSpanEmpty = screen.getByTestId('nested-span-empty');

      [nestedSpan, nestedSpanEmpty].forEach((target) => {
        target.dispatchEvent(
          new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })
        );
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      });

      expect(playSpy).not.toHaveBeenCalled();
      expect(muteSpy).not.toHaveBeenCalled();
      expect(seekSpy).not.toHaveBeenCalled();
    });

    it('Scenario 6: Modifier keys (Ctrl, Alt, Meta/Cmd) completely suppress shortcuts across all keys', () => {
      const Harness = () => {
        useKeyboardShortcuts({
          onTogglePlay: playSpy,
          onSeek: seekSpy,
          onToggleMute: muteSpy,
          currentTime: 50,
          duration: 100,
        });
        return <div>Modifier Guard</div>;
      };

      render(<Harness />);

      // Spacebar with modifiers
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, bubbles: true })
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', metaKey: true, bubbles: true })
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', altKey: true, bubbles: true })
      );

      // Arrow keys with modifiers
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true })
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', metaKey: true, bubbles: true })
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true })
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true })
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', metaKey: true, bubbles: true })
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true })
      );

      // 'm' with modifiers (e.g. Cmd+M minimize window or Ctrl+M)
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true })
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'm', metaKey: true, bubbles: true })
      );
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', altKey: true, bubbles: true }));
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'M', ctrlKey: true, altKey: true, bubbles: true })
      );

      expect(playSpy).not.toHaveBeenCalled();
      expect(seekSpy).not.toHaveBeenCalled();
      expect(muteSpy).not.toHaveBeenCalled();
    });

    it('Scenario 7: Seeking clamps strictly at 0 and duration, handling audioRef duration fallbacks and NaN resilience', () => {
      const audioEl = document.createElement('audio');
      audioEl.currentTime = 3;
      Object.defineProperty(audioEl, 'duration', { value: 60, writable: true });
      const audioRef = { current: audioEl };

      const Harness = ({ curTime, dur }: { curTime: number; dur: number }) => {
        useKeyboardShortcuts({
          onSeek: seekSpy,
          audioRef,
          currentTime: curTime,
          duration: dur,
          seekStep: 5,
        });
        return <div>Clamping Harness</div>;
      };

      const { rerender } = render(<Harness curTime={3} dur={60} />);

      // Seek backward by 5 from 3 -> should clamp to 0 (not -2)
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
      );
      expect(seekSpy).toHaveBeenLastCalledWith(0);

      // Advance audio element to 58s
      audioEl.currentTime = 58;
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      );
      expect(seekSpy).toHaveBeenLastCalledWith(60); // Clamped at duration (60), not 63

      // Adversarial Case: audio duration is NaN, fallback to props duration
      Object.defineProperty(audioEl, 'duration', { value: NaN, writable: true });
      rerender(<Harness curTime={20} dur={80} />);

      audioEl.currentTime = 78;
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      );
      // Fallback duration 80 is used
      expect(seekSpy).toHaveBeenLastCalledWith(80);

      // Adversarial Case: zero duration clamps to 0
      Object.defineProperty(audioEl, 'duration', { value: 0, writable: true });
      audioEl.currentTime = 0;
      rerender(<Harness curTime={0} dur={0} />);
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
      );
      expect(seekSpy).toHaveBeenLastCalledWith(0);
    });

    it('Scenario 8: Modal presence in DOM completely suppresses all shortcuts even when focus is on body', () => {
      const Harness = () => {
        useKeyboardShortcuts({
          onTogglePlay: playSpy,
          onSeek: seekSpy,
          onToggleMute: muteSpy,
          currentTime: 10,
          duration: 100,
        });
        return <div>Modal Suppression Harness</div>;
      };

      render(<Harness />);

      // Verify shortcuts work initially
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })
      );
      expect(playSpy).toHaveBeenCalledTimes(1);

      // Mount an active modal dialog in DOM
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      document.body.appendChild(modal);

      // Attempt all shortcuts with focus on document.body
      document.body.focus();
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })
      );
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));

      expect(playSpy).toHaveBeenCalledTimes(1); // Still 1, not 2
      expect(seekSpy).not.toHaveBeenCalled();
      expect(muteSpy).not.toHaveBeenCalled();

      // Remove modal from DOM -> shortcuts resume immediately
      modal.remove();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
      expect(muteSpy).toHaveBeenCalledTimes(1);
    });

    it('Scenario 9: Arrow keys ignore Shift+Arrow navigation (reserved for range selection)', () => {
      const Harness = () => {
        useKeyboardShortcuts({
          onSeek: seekSpy,
          currentTime: 50,
          duration: 100,
        });
        return <div>Shift Arrow Guard</div>;
      };

      render(<Harness />);

      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true })
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })
      );

      expect(seekSpy).not.toHaveBeenCalled();
    });

    it('Scenario 10: Typing sentences with "m" inside an input never toggles mute', async () => {
      const user = userEvent.setup();

      const Harness = () => {
        useKeyboardShortcuts({
          onToggleMute: muteSpy,
        });
        return (
          <div>
            <input type="text" data-testid="search-bar" />
          </div>
        );
      };

      render(<Harness />);

      const searchBar = screen.getByTestId('search-bar');
      searchBar.focus();

      // Type words containing multiple 'm' characters
      await user.type(searchBar, 'modern music mastering');

      expect(muteSpy).not.toHaveBeenCalled();
      expect(searchBar).toHaveValue('modern music mastering');
    });

    it('Scenario 11: Dynamic options updates (seekStep, enabled toggle) react immediately', () => {
      const Harness = ({ step, isEnabled }: { step: number; isEnabled: boolean }) => {
        useKeyboardShortcuts({
          onSeek: seekSpy,
          currentTime: 20,
          duration: 100,
          seekStep: step,
          enabled: isEnabled,
        });
        return <div>Dynamic Options</div>;
      };

      const { rerender } = render(<Harness step={5} isEnabled={true} />);

      // Seek forward with step 5
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(seekSpy).toHaveBeenLastCalledWith(25);

      // Re-render with step 10
      rerender(<Harness step={10} isEnabled={true} />);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(seekSpy).toHaveBeenLastCalledWith(30);

      // Re-render with enabled: false (e.g. project unready)
      rerender(<Harness step={10} isEnabled={false} />);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(seekSpy).toHaveBeenCalledTimes(2); // No new call
    });
  });

  // =========================================================================
  // SECTION 2: Feature 45 - Modal Focus Trapping (useFocusTrap) Adversarial
  // =========================================================================

  describe('Feature 45: Modal Focus Trapping (useFocusTrap)', () => {
    interface MultiTrapModalProps {
      isOpen: boolean;
      onClose?: () => void;
      escapeDeactivates?: boolean;
    }

    const ComplexModal: React.FC<MultiTrapModalProps> = ({
      isOpen,
      onClose,
      escapeDeactivates = true,
    }) => {
      const containerRef = useFocusTrap<HTMLDivElement>({
        isOpen,
        onClose,
        escapeDeactivates,
      });

      if (!isOpen) return null;

      return (
        <div
          ref={containerRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          data-testid="complex-dialog"
        >
          <button type="button" data-testid="elem-1">
            Btn 1
          </button>
          <a href="#test" data-testid="elem-2">
            Link 2
          </a>
          <input type="text" data-testid="elem-3" />
          <button type="button" disabled data-testid="elem-disabled">
            Disabled
          </button>
          <button type="button" style={{ display: 'none' }} data-testid="elem-hidden">
            Hidden
          </button>
          <button type="button" tabIndex={-1} data-testid="elem-tabindex-neg">
            Tabindex -1
          </button>
          <textarea data-testid="elem-4" />
          <button type="button" data-testid="elem-5">
            Btn 5
          </button>
        </div>
      );
    };

    it('Scenario 12: Tab cycles continuously across multiple wraps without escaping to background', async () => {
      const user = userEvent.setup();
      render(<ComplexModal isOpen={true} />);

      const el1 = screen.getByTestId('elem-1');
      const el2 = screen.getByTestId('elem-2');
      const el3 = screen.getByTestId('elem-3');
      const el4 = screen.getByTestId('elem-4');
      const el5 = screen.getByTestId('elem-5');

      // Initial focus placed on first focusable element
      expect(el1).toHaveFocus();

      // Focus last element
      el5.focus();
      expect(el5).toHaveFocus();

      // Multi-cycle wrap forward: 5 -> 1 -> 2 -> 3 -> 4 -> 5 -> 1
      await user.tab();
      expect(el1).toHaveFocus();

      await user.tab();
      expect(el2).toHaveFocus();

      await user.tab();
      expect(el3).toHaveFocus();

      await user.tab();
      expect(el4).toHaveFocus();

      await user.tab();
      expect(el5).toHaveFocus();

      // Second wrap
      await user.tab();
      expect(el1).toHaveFocus();
    });

    it('Scenario 13: Shift+Tab cycles continuously in reverse across multiple wraps', async () => {
      const user = userEvent.setup();
      render(<ComplexModal isOpen={true} />);

      const el1 = screen.getByTestId('elem-1');
      const el4 = screen.getByTestId('elem-4');
      const el5 = screen.getByTestId('elem-5');

      expect(el1).toHaveFocus();

      // Shift+Tab from first element wraps to last element (el5)
      await user.tab({ shift: true });
      expect(el5).toHaveFocus();

      // Shift+Tab from el5 goes to el4
      await user.tab({ shift: true });
      expect(el4).toHaveFocus();

      // Shift+Tab all the way back to el1 and wrap again
      el1.focus();
      await user.tab({ shift: true });
      expect(el5).toHaveFocus();
    });

    it('Scenario 14: Modal with a single focusable element keeps focus trapped on Tab and Shift+Tab', async () => {
      const user = userEvent.setup();

      const SingleItemModal: React.FC<{ isOpen: boolean }> = ({ isOpen }) => {
        const containerRef = useFocusTrap<HTMLDivElement>({ isOpen });
        if (!isOpen) return null;
        return (
          <div ref={containerRef} role="dialog" aria-modal="true" tabIndex={-1}>
            <button type="button" data-testid="lonely-btn">
              Only Button
            </button>
          </div>
        );
      };

      render(<SingleItemModal isOpen={true} />);

      const lonelyBtn = screen.getByTestId('lonely-btn');
      expect(lonelyBtn).toHaveFocus();

      // Tab should not escape
      await user.tab();
      expect(lonelyBtn).toHaveFocus();

      // Shift+Tab should not escape
      await user.tab({ shift: true });
      expect(lonelyBtn).toHaveFocus();
    });

    it('Scenario 15: Modal with zero focusable elements focuses container and prevents Tab escape', async () => {
      const user = userEvent.setup();

      const EmptyModal: React.FC<{ isOpen: boolean }> = ({ isOpen }) => {
        const containerRef = useFocusTrap<HTMLDivElement>({ isOpen });
        if (!isOpen) return null;
        return (
          <div
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            data-testid="empty-dialog"
          >
            <p>Static informational message only with no interactive controls.</p>
          </div>
        );
      };

      render(<EmptyModal isOpen={true} />);

      const dialogContainer = screen.getByTestId('empty-dialog');
      // Container fallback focus
      expect(dialogContainer).toHaveFocus();

      // Tab and Shift+Tab must be prevented
      await user.tab();
      expect(dialogContainer).toHaveFocus();

      await user.tab({ shift: true });
      expect(dialogContainer).toHaveFocus();
    });

    it('Scenario 16: Recovers focus back into dialog if focus is somehow placed on body or external element', async () => {
      const user = userEvent.setup();
      render(
        <div>
          <button type="button" data-testid="outside-button">
            Outside Button
          </button>
          <ComplexModal isOpen={true} />
        </div>
      );

      const el1 = screen.getByTestId('elem-1');
      const el5 = screen.getByTestId('elem-5');

      // Force external focus (e.g. simulated assistive technology or script bug)
      const outsideBtn = screen.getByTestId('outside-button');
      outsideBtn.focus();
      expect(outsideBtn).toHaveFocus();

      // Pressing Tab inside window recovers focus to dialog first element
      await user.tab();
      expect(el1).toHaveFocus();

      // Force external focus again
      outsideBtn.focus();
      expect(outsideBtn).toHaveFocus();

      // Pressing Shift+Tab recovers focus to dialog last element
      await user.tab({ shift: true });
      expect(el5).toHaveFocus();
    });

    it('Scenario 17: Escape dismisses modal, stops event propagation, and restores trigger element focus', async () => {
      const user = userEvent.setup();

      const HostComponent = () => {
        const [isOpen, setIsOpen] = useState(false);
        const triggerRef = useRef<HTMLButtonElement>(null);

        return (
          <div>
            <button
              ref={triggerRef}
              type="button"
              data-testid="invoking-trigger"
              onClick={() => setIsOpen(true)}
            >
              Open Dialog
            </button>
            <ComplexModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
          </div>
        );
      };

      render(<HostComponent />);

      const triggerBtn = screen.getByTestId('invoking-trigger');
      triggerBtn.focus();
      expect(triggerBtn).toHaveFocus();

      // Click trigger to open modal
      await user.click(triggerBtn);
      expect(screen.getByTestId('elem-1')).toHaveFocus();

      // Dispatch Escape with spies on stopPropagation and preventDefault
      const escapeEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      const stopPropSpy = vi.spyOn(escapeEvent, 'stopPropagation');
      const prevDefSpy = vi.spyOn(escapeEvent, 'preventDefault');

      act(() => {
        window.dispatchEvent(escapeEvent);
      });

      // Verify stopPropagation and preventDefault were called
      expect(stopPropSpy).toHaveBeenCalledTimes(1);
      expect(prevDefSpy).toHaveBeenCalledTimes(1);

      // Modal closed
      expect(screen.queryByTestId('complex-dialog')).toBeNull();

      // Focus returned to invoking button
      expect(triggerBtn).toHaveFocus();
    });

    it('Scenario 18: If escapeDeactivates is false, Escape does NOT dismiss modal and event is not swallowed', () => {
      const onCloseSpy = vi.fn();

      render(<ComplexModal isOpen={true} onClose={onCloseSpy} escapeDeactivates={false} />);

      const escapeEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      const stopPropSpy = vi.spyOn(escapeEvent, 'stopPropagation');
      const prevDefSpy = vi.spyOn(escapeEvent, 'preventDefault');

      window.dispatchEvent(escapeEvent);

      expect(onCloseSpy).not.toHaveBeenCalled();
      expect(stopPropSpy).not.toHaveBeenCalled();
      expect(prevDefSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId('complex-dialog')).toBeInTheDocument();
    });

    it('Scenario 19: Dynamic DOM changes inside open modal are incorporated into next Tab cycle', async () => {
      const user = userEvent.setup();

      const DynamicModal: React.FC<{ isOpen: boolean }> = ({ isOpen }) => {
        const [showExtra, setShowExtra] = useState(false);
        const containerRef = useFocusTrap<HTMLDivElement>({ isOpen });

        if (!isOpen) return null;

        return (
          <div ref={containerRef} role="dialog" aria-modal="true" tabIndex={-1}>
            <button type="button" data-testid="static-btn">
              Static
            </button>
            <button type="button" onClick={() => setShowExtra(true)} data-testid="toggle-btn">
              Add Extra
            </button>
            {showExtra && (
              <button type="button" data-testid="extra-btn">
                Newly Added
              </button>
            )}
          </div>
        );
      };

      render(<DynamicModal isOpen={true} />);

      const toggleBtn = screen.getByTestId('toggle-btn');
      await user.click(toggleBtn);

      const extraBtn = screen.getByTestId('extra-btn');
      expect(extraBtn).toBeInTheDocument();

      // Focus extraBtn and press Tab -> should wrap back to static-btn
      extraBtn.focus();
      await user.tab();
      expect(screen.getByTestId('static-btn')).toHaveFocus();
    });

    it('Scenario 20: Detached trigger does not cause exceptions on modal close', async () => {
      const Host = () => {
        const [isOpen, setIsOpen] = useState(false);
        const [triggerMounted, setTriggerMounted] = useState(true);

        return (
          <div>
            {triggerMounted && (
              <button
                type="button"
                data-testid="disappearing-trigger"
                onClick={() => {
                  setIsOpen(true);
                  setTriggerMounted(false); // remove trigger immediately upon opening
                }}
              >
                Open & Detach
              </button>
            )}
            <ComplexModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
          </div>
        );
      };

      const user = userEvent.setup();
      render(<Host />);

      const trigger = screen.getByTestId('disappearing-trigger');
      await user.click(trigger);

      // Trigger was removed
      expect(screen.queryByTestId('disappearing-trigger')).toBeNull();

      // Close modal via Escape -> must not throw
      const escapeEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        window.dispatchEvent(escapeEvent);
      });

      expect(screen.queryByTestId('complex-dialog')).toBeNull();
    });
  });

  // =========================================================================
  // SECTION 3: Real Modal Component Integration (AuthModal, ExportModal, LyricTimelineEditor)
  // =========================================================================

  describe('Section 3: Real Modal Component Integration', () => {
    it('Scenario 21: AuthModal traps focus on passphrase input and suppresses global shortcuts', async () => {
      const user = userEvent.setup();
      const onSuccess = vi.fn();
      const onClose = vi.fn();

      const Harness = () => {
        useKeyboardShortcuts({
          onTogglePlay: playSpy,
          onSeek: seekSpy,
          onToggleMute: muteSpy,
        });
        return <AuthModal isOpen={true} onSuccess={onSuccess} onClose={onClose} />;
      };

      render(<Harness />);

      // Passphrase input must receive initial focus
      const passwordInput = screen.getByPlaceholderText(/enter studio password/i);
      expect(passwordInput).toHaveFocus();

      // Pressing Space inside passphrase input must NOT trigger play/pause
      await user.keyboard(' ');
      expect(playSpy).not.toHaveBeenCalled();

      // Pressing 'm' inside passphrase input must NOT mute
      await user.keyboard('m');
      expect(muteSpy).not.toHaveBeenCalled();

      // Escape does NOT close AuthModal (hardened access gate)
      await user.keyboard('{Escape}');
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('Scenario 22: ExportModal traps focus, allows Tab cycle through actions, and closes on Escape', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      const Harness = () => {
        useKeyboardShortcuts({
          onTogglePlay: playSpy,
          onSeek: seekSpy,
          onToggleMute: muteSpy,
        });
        return <ExportModal project={mockProject} isOpen={true} onClose={onClose} />;
      };

      render(<Harness />);

      // While ExportModal is open, global spacebar is suppressed
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })
      );
      expect(playSpy).not.toHaveBeenCalled();

      // Tab moves across modal buttons
      await user.tab();
      expect(document.activeElement).not.toBe(document.body);

      // Escape triggers onClose
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Scenario 23: LyricTimelineEditor discard modal traps focus on Keep Editing / Discard Changes buttons and dismisses cleanly', async () => {
      const user = userEvent.setup();

      render(
        <LyricTimelineEditor
          lines={mockLyricLines}
          currentTime={5.0}
          duration={60.0}
          onSeek={seekSpy}
          onSaveLines={vi.fn()}
        />
      );

      // Nudge word boundary to create unsaved dirty state
      const nudgeBtn = screen.getByRole('button', { name: /nudge line 1 0.2s later/i });
      await user.click(nudgeBtn);

      // Discard Changes button appears
      const discardBtn = screen.getByRole('button', { name: /discard changes/i });
      await user.click(discardBtn);

      // Confirmation dialog is displayed with role="dialog"
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(screen.getByText(/Discard Unsaved Timing Changes\?/i)).toBeInTheDocument();

      const keepEditingBtn = within(dialog).getByRole('button', { name: /keep editing/i });
      const discardChangesConfirmBtn = within(dialog).getByRole('button', {
        name: /^discard changes$/i,
      });

      // Tab between the two buttons in the modal
      keepEditingBtn.focus();
      expect(keepEditingBtn).toHaveFocus();

      await user.tab();
      expect(discardChangesConfirmBtn).toHaveFocus();

      // Tab wraps back to Keep Editing
      await user.tab();
      expect(keepEditingBtn).toHaveFocus();

      // Escape dismisses the confirmation dialog
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  // =========================================================================
  // SECTION 4: Helper Functions Invariance and Edge Cases
  // =========================================================================

  describe('Section 4: Helper Functions Edge Cases', () => {
    it('Scenario 24: isInputElement returns false for falsy or non-HTML elements', () => {
      expect(isInputElement(null)).toBe(false);
      expect(isInputElement(undefined as unknown as EventTarget)).toBe(false);
      expect(isInputElement({} as EventTarget)).toBe(false);
    });

    it('Scenario 25: isModalActive returns false when no modal or dialog exists', () => {
      expect(isModalActive(null)).toBe(false);
      const regularDiv = document.createElement('div');
      expect(isModalActive(regularDiv)).toBe(false);
    });

    it('Scenario 26: getFocusableElements filters invalid, hidden, and tabindex=-1 items', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <button id="b1">Valid</button>
        <button id="b2" disabled>Disabled</button>
        <a id="b3">No Href</a>
        <a id="b4" href="https://example.com">With Href</a>
        <input id="b5" type="text" />
        <input id="b6" type="hidden" />
        <div id="b7" tabindex="0">Tabbable Div</div>
        <div id="b8" tabindex="-1">Non-Tabbable Div</div>
        <button id="b9" style="visibility: hidden">Invisible</button>
      `;
      document.body.appendChild(container);

      const focusable = getFocusableElements(container);
      const ids = focusable.map((el) => el.id);

      expect(ids).toContain('b1');
      expect(ids).toContain('b4');
      expect(ids).toContain('b5');
      expect(ids).toContain('b7');

      expect(ids).not.toContain('b2');
      expect(ids).not.toContain('b3');
      expect(ids).not.toContain('b8');
      expect(ids).not.toContain('b9');

      container.remove();
    });
  });
});

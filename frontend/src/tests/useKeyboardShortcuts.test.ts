import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useKeyboardShortcuts,
  isInputElement,
  isModalActive,
  isOtherModalActive,
} from '../hooks/useKeyboardShortcuts';

describe('useKeyboardShortcuts (Feature 41)', () => {
  let playFn: () => void;
  let seekFn: (time: number) => void;
  let muteFn: () => void;

  beforeEach(() => {
    playFn = vi.fn();
    seekFn = vi.fn();
    muteFn = vi.fn();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Clear any modal dialog elements added during tests
    document.querySelectorAll('[role="dialog"], [aria-modal="true"]').forEach((el) => el.remove());
  });

  it('triggers onTogglePlay on Spacebar press and calls preventDefault', () => {
    renderHook(() =>
      useKeyboardShortcuts({
        onTogglePlay: playFn,
        onSeek: seekFn,
        onToggleMute: muteFn,
        currentTime: 10,
        duration: 100,
      })
    );

    const event = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    window.dispatchEvent(event);

    expect(playFn).toHaveBeenCalledTimes(1);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('ignores repeating Spacebar press to avoid play/pause strobing', () => {
    renderHook(() =>
      useKeyboardShortcuts({
        onTogglePlay: playFn,
        currentTime: 10,
        duration: 100,
      })
    );

    const repeatingEvent = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      repeat: true,
      bubbles: true,
      cancelable: true,
    });

    window.dispatchEvent(repeatingEvent);

    expect(playFn).not.toHaveBeenCalled();
  });

  it('seeks backward by 5 seconds on ArrowLeft, clamped at 0', () => {
    renderHook(() =>
      useKeyboardShortcuts({
        onSeek: seekFn,
        currentTime: 3, // seeking back 5 should clamp to 0
        duration: 100,
        seekStep: 5,
      })
    );

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    window.dispatchEvent(event);

    expect(seekFn).toHaveBeenCalledWith(0);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('seeks forward by 5 seconds on ArrowRight, clamped at duration', () => {
    renderHook(() =>
      useKeyboardShortcuts({
        onSeek: seekFn,
        currentTime: 98, // seeking forward 5 should clamp to 100
        duration: 100,
        seekStep: 5,
      })
    );

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    window.dispatchEvent(event);

    expect(seekFn).toHaveBeenCalledWith(100);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('ignores arrow keys when shiftKey is active', () => {
    renderHook(() =>
      useKeyboardShortcuts({
        onSeek: seekFn,
        currentTime: 50,
        duration: 100,
      })
    );

    const shiftLeftEvent = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      shiftKey: true,
      bubbles: true,
    });

    window.dispatchEvent(shiftLeftEvent);

    expect(seekFn).not.toHaveBeenCalled();
  });

  it('toggles mute on "m" and "M" keypress', () => {
    renderHook(() =>
      useKeyboardShortcuts({
        onToggleMute: muteFn,
      })
    );

    const lowerM = new KeyboardEvent('keydown', { key: 'm', bubbles: true, cancelable: true });
    window.dispatchEvent(lowerM);
    expect(muteFn).toHaveBeenCalledTimes(1);

    const upperM = new KeyboardEvent('keydown', { key: 'M', bubbles: true, cancelable: true });
    window.dispatchEvent(upperM);
    expect(muteFn).toHaveBeenCalledTimes(2);
  });

  it('ignores repeating "m" keypress', () => {
    renderHook(() =>
      useKeyboardShortcuts({
        onToggleMute: muteFn,
      })
    );

    const repeatM = new KeyboardEvent('keydown', {
      key: 'm',
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(repeatM);

    expect(muteFn).not.toHaveBeenCalled();
  });

  it('suppresses shortcuts when modifier keys (Ctrl, Meta, Alt) are pressed', () => {
    renderHook(() =>
      useKeyboardShortcuts({
        onTogglePlay: playFn,
        onToggleMute: muteFn,
      })
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', metaKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', altKey: true }));

    expect(playFn).not.toHaveBeenCalled();
    expect(muteFn).not.toHaveBeenCalled();
  });

  it('suppresses shortcuts when focus is inside text input, textarea, or select', () => {
    renderHook(() =>
      useKeyboardShortcuts({
        onTogglePlay: playFn,
      })
    );

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      bubbles: true,
    });
    input.dispatchEvent(event);

    expect(playFn).not.toHaveBeenCalled();
    input.remove();
  });

  it('suppresses shortcuts when an active modal dialog exists in the document', () => {
    renderHook(() =>
      useKeyboardShortcuts({
        onTogglePlay: playFn,
      })
    );

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);

    const event = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(playFn).not.toHaveBeenCalled();
    dialog.remove();
  });

  it('does not register shortcuts when enabled is false', () => {
    renderHook(() =>
      useKeyboardShortcuts({
        onTogglePlay: playFn,
        enabled: false,
      })
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));

    expect(playFn).not.toHaveBeenCalled();
  });

  it('cleans up event listener when unmounted', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts({
        onTogglePlay: playFn,
      })
    );

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('uses audioRef currentTime and duration when provided', () => {
    const audio = document.createElement('audio');
    audio.currentTime = 40;
    Object.defineProperty(audio, 'duration', { value: 120, writable: true });
    const audioRef = { current: audio };

    renderHook(() =>
      useKeyboardShortcuts({
        onSeek: seekFn,
        audioRef,
        currentTime: 0,
        duration: 0,
      })
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(seekFn).toHaveBeenCalledWith(45);
  });

  describe('isInputElement and isModalActive helper functions', () => {
    it('correctly identifies inputs, textareas, selects, and contenteditable', () => {
      expect(isInputElement(null)).toBe(false);

      const input = document.createElement('input');
      expect(isInputElement(input)).toBe(true);

      const textarea = document.createElement('textarea');
      expect(isInputElement(textarea)).toBe(true);

      const select = document.createElement('select');
      expect(isInputElement(select)).toBe(true);

      const editable = document.createElement('div');
      editable.contentEditable = 'true';
      expect(isInputElement(editable)).toBe(true);

      const textboxRole = document.createElement('div');
      textboxRole.setAttribute('role', 'textbox');
      expect(isInputElement(textboxRole)).toBe(true);

      const regularDiv = document.createElement('div');
      expect(isInputElement(regularDiv)).toBe(false);
    });

    it('correctly detects active modals in DOM or ancestors', () => {
      expect(isModalActive(null)).toBe(false);

      const regularDiv = document.createElement('div');
      document.body.appendChild(regularDiv);
      expect(isModalActive(regularDiv)).toBe(false);

      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      document.body.appendChild(dialog);
      expect(isModalActive(regularDiv)).toBe(true);

      dialog.remove();
      regularDiv.remove();
    });
  });

  describe('Help modal shortcut and isolation (Milestone 1)', () => {
    let helpFn: () => void;

    beforeEach(() => {
      helpFn = vi.fn();
    });

    it('triggers onToggleHelp on "?" keypress and calls preventDefault', () => {
      renderHook(() =>
        useKeyboardShortcuts({
          onToggleHelp: helpFn,
        })
      );

      const event = new KeyboardEvent('keydown', {
        key: '?',
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      window.dispatchEvent(event);

      expect(helpFn).toHaveBeenCalledTimes(1);
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('ignores repeating "?" keypress to prevent toggle strobing', () => {
      renderHook(() =>
        useKeyboardShortcuts({
          onToggleHelp: helpFn,
        })
      );

      const repeatingEvent = new KeyboardEvent('keydown', {
        key: '?',
        repeat: true,
        bubbles: true,
        cancelable: true,
      });

      window.dispatchEvent(repeatingEvent);

      expect(helpFn).not.toHaveBeenCalled();
    });

    it('suppresses "?" when modifier keys (Ctrl, Meta, Alt) are pressed', () => {
      renderHook(() =>
        useKeyboardShortcuts({
          onToggleHelp: helpFn,
        })
      );

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', ctrlKey: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', metaKey: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', altKey: true }));

      expect(helpFn).not.toHaveBeenCalled();
    });

    it('allows "?" when shiftKey is active (standard Shift + / input)', () => {
      renderHook(() =>
        useKeyboardShortcuts({
          onToggleHelp: helpFn,
        })
      );

      const event = new KeyboardEvent('keydown', {
        key: '?',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });

      window.dispatchEvent(event);

      expect(helpFn).toHaveBeenCalledTimes(1);
    });

    it('suppresses "?" when focus is inside text input, textarea, select, contenteditable, or ARIA input roles', () => {
      renderHook(() =>
        useKeyboardShortcuts({
          onToggleHelp: helpFn,
        })
      );

      const input = document.createElement('input');
      const textarea = document.createElement('textarea');
      const select = document.createElement('select');
      const editable = document.createElement('div');
      editable.contentEditable = 'true';
      const textbox = document.createElement('div');
      textbox.setAttribute('role', 'textbox');
      const slider = document.createElement('div');
      slider.setAttribute('role', 'slider');

      const elements = [input, textarea, select, editable, textbox, slider];
      elements.forEach((el) => {
        document.body.appendChild(el);
        const event = new KeyboardEvent('keydown', {
          key: '?',
          bubbles: true,
          cancelable: true,
        });
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
        el.dispatchEvent(event);
        expect(preventDefaultSpy).not.toHaveBeenCalled();
        el.remove();
      });

      expect(helpFn).not.toHaveBeenCalled();
    });

    it('suppresses "?" when document.activeElement is an input even if dispatched on window', () => {
      renderHook(() =>
        useKeyboardShortcuts({
          onToggleHelp: helpFn,
        })
      );

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const event = new KeyboardEvent('keydown', {
        key: '?',
        bubbles: true,
      });
      window.dispatchEvent(event);

      expect(helpFn).not.toHaveBeenCalled();
      input.remove();
    });

    it('suppresses "?" when another modal dialog (Auth, Export, etc.) is active in the document', () => {
      renderHook(() =>
        useKeyboardShortcuts({
          onToggleHelp: helpFn,
        })
      );

      const authModal = document.createElement('div');
      authModal.setAttribute('role', 'dialog');
      authModal.setAttribute('aria-modal', 'true');
      document.body.appendChild(authModal);

      const event = new KeyboardEvent('keydown', {
        key: '?',
        bubbles: true,
      });
      window.dispatchEvent(event);

      expect(helpFn).not.toHaveBeenCalled();
      authModal.remove();
    });

    it('allows "?" to fire when Help modal (data-modal="help") is active, enabling toggle close', () => {
      renderHook(() =>
        useKeyboardShortcuts({
          onToggleHelp: helpFn,
        })
      );

      const helpModal = document.createElement('div');
      helpModal.setAttribute('role', 'dialog');
      helpModal.setAttribute('aria-modal', 'true');
      helpModal.setAttribute('data-modal', 'help');
      document.body.appendChild(helpModal);

      const event = new KeyboardEvent('keydown', {
        key: '?',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);

      expect(helpFn).toHaveBeenCalledTimes(1);
      helpModal.remove();
    });

    it('silences all transport shortcuts (Space, ArrowLeft, ArrowRight, M) when Help modal is open', () => {
      renderHook(() =>
        useKeyboardShortcuts({
          onTogglePlay: playFn,
          onSeek: seekFn,
          onToggleMute: muteFn,
          currentTime: 20,
          duration: 100,
        })
      );

      const helpModal = document.createElement('div');
      helpModal.setAttribute('role', 'dialog');
      helpModal.setAttribute('aria-modal', 'true');
      helpModal.setAttribute('data-modal', 'help');
      document.body.appendChild(helpModal);

      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })
      );
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', bubbles: true }));

      expect(playFn).not.toHaveBeenCalled();
      expect(seekFn).not.toHaveBeenCalled();
      expect(muteFn).not.toHaveBeenCalled();

      helpModal.remove();
    });
  });

  describe('isOtherModalActive and updated isInputElement helper functions', () => {
    it('isOtherModalActive correctly differentiates Help modal from other modals', () => {
      expect(isOtherModalActive()).toBe(false);

      const helpModal = document.createElement('div');
      helpModal.setAttribute('role', 'dialog');
      helpModal.setAttribute('data-modal', 'help');
      document.body.appendChild(helpModal);
      expect(isOtherModalActive()).toBe(false);

      const otherModal = document.createElement('div');
      otherModal.setAttribute('role', 'dialog');
      document.body.appendChild(otherModal);
      expect(isOtherModalActive()).toBe(true);

      otherModal.remove();
      expect(isOtherModalActive()).toBe(false);

      helpModal.remove();
    });

    it('isInputElement handles slider and spinbutton roles and nested children', () => {
      const slider = document.createElement('div');
      slider.setAttribute('role', 'slider');
      expect(isInputElement(slider)).toBe(true);

      const sliderThumb = document.createElement('span');
      slider.appendChild(sliderThumb);
      expect(isInputElement(sliderThumb)).toBe(true);

      const spinbutton = document.createElement('div');
      spinbutton.setAttribute('role', 'spinbutton');
      expect(isInputElement(spinbutton)).toBe(true);

      const spinChild = document.createElement('span');
      spinbutton.appendChild(spinChild);
      expect(isInputElement(spinChild)).toBe(true);
    });

    it('isInputElement without arguments checks document.activeElement', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      expect(isInputElement()).toBe(true);

      input.blur();
      expect(isInputElement()).toBe(false);

      input.remove();
    });
  });
});

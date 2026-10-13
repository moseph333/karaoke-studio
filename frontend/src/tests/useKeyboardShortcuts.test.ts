import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts, isInputElement, isModalActive } from '../hooks/useKeyboardShortcuts';

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
    document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
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
});

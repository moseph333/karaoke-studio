import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, renderHook, screen, fireEvent } from '@testing-library/react';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { HelpModal } from '../../components/HelpModal';
import { LyricDisplay } from '../../components/LyricDisplay';
import { LyricLine } from '../../types';
import { characterShortcutsEnabled, setCharacterShortcutsEnabled } from '../../utils/shortcutPrefs';

/** Dispatches a keydown from `target` (bubbling to window) and returns the event. */
function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key === ' ' ? 'Space' : undefined,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function mount<T extends HTMLElement>(element: T): T {
  document.body.appendChild(element);
  return element;
}

describe('global shortcuts leave keys to focused controls', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('ignores keys a focused widget already handled', () => {
    const onSeek = vi.fn();
    const onTogglePlay = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onSeek, onTogglePlay, currentTime: 30, duration: 90 }));
    const radio = mount(document.createElement('button'));
    radio.setAttribute('role', 'radio');
    radio.addEventListener('keydown', (e) => e.preventDefault()); // the radio group moves

    press(radio, 'ArrowRight');
    press(radio, ' ');

    expect(onSeek).not.toHaveBeenCalled();
    expect(onTogglePlay).not.toHaveBeenCalled();
  });

  it('lets Space press a button reached with the keyboard', () => {
    const onTogglePlay = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onTogglePlay }));
    const button = mount(document.createElement('button'));
    button.focus();

    const event = press(button, ' ');

    expect(onTogglePlay).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false); // the browser presses the button
  });

  it('keeps Space as play/pause on a control the user just clicked', () => {
    const onTogglePlay = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onTogglePlay }));
    const lineButton = mount(document.createElement('button'));
    const label = lineButton.appendChild(document.createElement('span'));

    fireEvent.pointerDown(label); // a click lands on the button's text
    const event = press(lineButton, ' ');

    expect(onTogglePlay).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('treats a clicked control as keyboard-focused again after Tab', () => {
    const onTogglePlay = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onTogglePlay }));
    const button = mount(document.createElement('button'));

    fireEvent.pointerDown(button);
    press(button, 'Tab');
    press(button, ' ');

    expect(onTogglePlay).not.toHaveBeenCalled();
  });

  it('keeps Space as play/pause on links, where Space would scroll', () => {
    const onTogglePlay = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onTogglePlay }));
    const link = mount(document.createElement('a'));
    link.href = '#lyrics';

    press(link, ' ');

    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('does not claim keys whose action is unavailable (library and processing views)', () => {
    renderHook(() => useKeyboardShortcuts({ onToggleHelp: vi.fn() }));

    for (const key of [' ', 'ArrowLeft', 'ArrowRight', 'm', 'v', 'c', '[', ']', 'r']) {
      expect(press(window, key).defaultPrevented).toBe(false);
    }
  });
});

describe('single-key shortcuts can be turned off', () => {
  afterEach(() => {
    setCharacterShortcutsEnabled(true);
  });

  it('is on by default and remembers the choice', () => {
    expect(characterShortcutsEnabled()).toBe(true);
    setCharacterShortcutsEnabled(false);
    expect(characterShortcutsEnabled()).toBe(false);
    expect(localStorage.getItem('karaoke_char_shortcuts_v1')).toBe('off');
  });

  it('ignores letter and symbol keys when off, while Space and the arrows keep working', () => {
    const handlers = {
      onTogglePlay: vi.fn(),
      onSeek: vi.fn(),
      onToggleMute: vi.fn(),
      onToggleVisualizer: vi.fn(),
      onToggleChordBar: vi.fn(),
      onToggleHelp: vi.fn(),
      onReplayLine: vi.fn(),
    };
    renderHook(() => useKeyboardShortcuts({ ...handlers, currentTime: 30, duration: 90 }));
    setCharacterShortcutsEnabled(false);

    for (const key of ['m', 'v', 'c', 'r', '?']) press(window, key);
    press(window, ' ');
    press(window, 'ArrowRight');

    expect(handlers.onToggleMute).not.toHaveBeenCalled();
    expect(handlers.onToggleVisualizer).not.toHaveBeenCalled();
    expect(handlers.onToggleChordBar).not.toHaveBeenCalled();
    expect(handlers.onReplayLine).not.toHaveBeenCalled();
    expect(handlers.onToggleHelp).not.toHaveBeenCalled();
    expect(handlers.onTogglePlay).toHaveBeenCalledTimes(1);
    expect(handlers.onSeek).toHaveBeenCalledWith(35);
  });

  it('has a switch in the Help dialog', () => {
    render(<HelpModal isOpen onClose={vi.fn()} />);
    const toggle = screen.getByRole('switch', { name: 'Letter and symbol shortcuts' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(characterShortcutsEnabled()).toBe(false);
  });
});

describe('the fullscreen F key', () => {
  const lines: LyricLine[] = [
    { id: 1, text: 'Hold the stage', start_time: 2, end_time: 5, words: [] },
  ];
  const stage = () => screen.getByTestId('lyric-display-stage');
  // Fullscreen is React state set from a window listener, so flush it inside act()
  const pressOnStage = (target: EventTarget, key: string, init?: KeyboardEventInit) =>
    act(() => {
      press(target, key, init);
    });

  afterEach(() => {
    setCharacterShortcutsEnabled(true);
    document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
    vi.useRealTimers();
  });

  it('toggles the fullscreen stage', () => {
    render(<LyricDisplay lines={lines} currentTime={3} duration={60} />);
    pressOnStage(window, 'f');
    expect(stage()).toHaveAttribute('data-fullscreen', 'true');
  });

  it('ignores a held key, an open dialog, a text field and switched-off shortcuts', () => {
    render(<LyricDisplay lines={lines} currentTime={3} duration={60} />);

    pressOnStage(window, 'f', { repeat: true });
    const field = document.body.appendChild(document.createElement('div'));
    field.setAttribute('role', 'textbox');
    pressOnStage(field, 'f');
    field.remove();
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    pressOnStage(window, 'f');
    dialog.remove();
    setCharacterShortcutsEnabled(false);
    pressOnStage(window, 'f');

    expect(stage()).toHaveAttribute('data-fullscreen', 'false');
  });

  it('brings back hidden fullscreen controls on any key', () => {
    vi.useFakeTimers();
    render(<LyricDisplay lines={lines} currentTime={3} duration={60} isPlaying />);
    pressOnStage(window, 'f');
    act(() => {
      vi.advanceTimersByTime(3100); // idle: the controls fade out
    });
    expect(screen.getByTestId('stage-toolbar').className).toContain('opacity-0');

    pressOnStage(window, 'Tab');

    expect(screen.getByTestId('stage-toolbar').className).toContain('opacity-100');
  });
});

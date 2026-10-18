/**
 * Empirical Stress and Adversarial Test Suite for Milestone 1
 *
 * Verifies HelpModal keyboard shortcut '?', input/modal isolation, transport silencing,
 * and responsive layout non-regression under adversarial stress conditions.
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, renderHook } from '@testing-library/react';
import { HelpModal } from '../components/HelpModal';
import { AuthModal } from '../components/AuthModal';
import { ExportModal } from '../components/ExportModal';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { EditMetadataModal } from '../components/EditMetadataModal';
import App from '../App';
import {
  useKeyboardShortcuts,
  isInputElement,
  isModalActive,
  isOtherModalActive,
} from '../hooks/useKeyboardShortcuts';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  assertTouchTargets,
} from './responsiveTestUtils';

describe('Milestone 1 Empirical Stress & Adversarial Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetTestViewport();
    document.body.innerHTML = '';
  });

  describe('Adversarial Dimension 1: Rapid and Repeating "?" Dispatches', () => {
    it('silences 50 consecutive repeating "?" keydown events (repeat: true)', () => {
      const onToggleHelp = vi.fn();
      renderHook(() => useKeyboardShortcuts({ onToggleHelp }));

      for (let i = 0; i < 50; i++) {
        const repeatingEvent = new KeyboardEvent('keydown', {
          key: '?',
          repeat: true,
          bubbles: true,
          cancelable: true,
        });
        const preventDefaultSpy = vi.spyOn(repeatingEvent, 'preventDefault');
        window.dispatchEvent(repeatingEvent);
        expect(preventDefaultSpy).not.toHaveBeenCalled();
      }

      expect(onToggleHelp).toHaveBeenCalledTimes(0);
    });

    it('processes each non-repeating rapid "?" dispatch without drop or race', () => {
      const onToggleHelp = vi.fn();
      renderHook(() => useKeyboardShortcuts({ onToggleHelp }));

      for (let i = 0; i < 20; i++) {
        const nonRepeatingEvent = new KeyboardEvent('keydown', {
          key: '?',
          repeat: false,
          bubbles: true,
          cancelable: true,
        });
        const preventDefaultSpy = vi.spyOn(nonRepeatingEvent, 'preventDefault');
        window.dispatchEvent(nonRepeatingEvent);
        expect(preventDefaultSpy).toHaveBeenCalled();
      }

      expect(onToggleHelp).toHaveBeenCalledTimes(20);
    });

    it('toggles open and closed state cleanly in a stateful host component under rapid triggers', async () => {
      const TestHost: React.FC = () => {
        const [isOpen, setIsOpen] = useState(false);
        useKeyboardShortcuts({
          onToggleHelp: () => setIsOpen((prev) => !prev),
        });
        return (
          <div>
            <span data-testid="status">{isOpen ? 'OPEN' : 'CLOSED'}</span>
            <HelpModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
          </div>
        );
      };

      render(<TestHost />);
      expect(screen.getByTestId('status')).toHaveTextContent('CLOSED');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Trigger 1: Open
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true })
        );
      });
      expect(screen.getByTestId('status')).toHaveTextContent('OPEN');
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Trigger 2: Repeating while open (must be ignored)
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: '?', repeat: true, bubbles: true, cancelable: true })
        );
      });
      expect(screen.getByTestId('status')).toHaveTextContent('OPEN');
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Trigger 3: Non-repeating while open (cleanly toggles closed)
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: '?', repeat: false, bubbles: true, cancelable: true })
        );
      });
      expect(screen.getByTestId('status')).toHaveTextContent('CLOSED');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('Adversarial Dimension 2: Modifier Combinations with "?"', () => {
    it('silences "?" whenever Ctrl, Alt, or Meta/Command is pressed', () => {
      const onToggleHelp = vi.fn();
      renderHook(() => useKeyboardShortcuts({ onToggleHelp }));

      const modifierScenarios = [
        { ctrlKey: true },
        { altKey: true },
        { metaKey: true },
        { ctrlKey: true, altKey: true },
        { ctrlKey: true, metaKey: true },
        { altKey: true, metaKey: true },
        { ctrlKey: true, shiftKey: true },
        { altKey: true, shiftKey: true },
        { metaKey: true, shiftKey: true },
        { ctrlKey: true, altKey: true, metaKey: true, shiftKey: true },
      ];

      for (const scenario of modifierScenarios) {
        const event = new KeyboardEvent('keydown', {
          key: '?',
          bubbles: true,
          cancelable: true,
          ...scenario,
        });
        const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
        window.dispatchEvent(event);
        expect(preventDefaultSpy).not.toHaveBeenCalled();
      }

      expect(onToggleHelp).toHaveBeenCalledTimes(0);
    });

    it('permits Shift+? and standalone ? key events', () => {
      const onToggleHelp = vi.fn();
      renderHook(() => useKeyboardShortcuts({ onToggleHelp }));

      // Shift+?
      const shiftEvent = new KeyboardEvent('keydown', {
        key: '?',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      const shiftSpy = vi.spyOn(shiftEvent, 'preventDefault');
      window.dispatchEvent(shiftEvent);
      expect(shiftSpy).toHaveBeenCalled();
      expect(onToggleHelp).toHaveBeenCalledTimes(1);

      // Standalone ? (e.g. keyboards with direct ? key)
      const plainEvent = new KeyboardEvent('keydown', {
        key: '?',
        shiftKey: false,
        bubbles: true,
        cancelable: true,
      });
      const plainSpy = vi.spyOn(plainEvent, 'preventDefault');
      window.dispatchEvent(plainEvent);
      expect(plainSpy).toHaveBeenCalled();
      expect(onToggleHelp).toHaveBeenCalledTimes(2);
    });
  });

  describe('Adversarial Dimension 3: Form Controls, ContentEditable & ARIA Roles Isolation', () => {
    it('blocks "?" and preserves default typing across all standard and ARIA input variants', () => {
      const onToggleHelp = vi.fn();
      renderHook(() => useKeyboardShortcuts({ onToggleHelp }));

      const inputTypes = ['text', 'search', 'number', 'password', 'email', 'url'];
      const standaloneElements: HTMLElement[] = [];

      inputTypes.forEach((type) => {
        const input = document.createElement('input');
        input.type = type;
        standaloneElements.push(input);
      });

      const textarea = document.createElement('textarea');
      standaloneElements.push(textarea);

      const select = document.createElement('select');
      standaloneElements.push(select);

      const contentEditableTrue = document.createElement('div');
      contentEditableTrue.setAttribute('contenteditable', 'true');
      standaloneElements.push(contentEditableTrue);

      const contentEditableEmpty = document.createElement('div');
      contentEditableEmpty.setAttribute('contenteditable', '');
      standaloneElements.push(contentEditableEmpty);

      const ariaRoles = ['textbox', 'searchbox', 'slider', 'spinbutton'];
      ariaRoles.forEach((role) => {
        const el = document.createElement('div');
        el.setAttribute('role', role);
        standaloneElements.push(el);
      });

      // Nested child elements inside inputs/contenteditables/ARIA controls
      const nestedParents: HTMLElement[] = [];

      const parentTextbox = document.createElement('div');
      parentTextbox.setAttribute('role', 'textbox');
      const innerSpan = document.createElement('span');
      parentTextbox.appendChild(innerSpan);
      nestedParents.push(innerSpan);

      const parentSlider = document.createElement('div');
      parentSlider.setAttribute('role', 'slider');
      const sliderThumb = document.createElement('span');
      parentSlider.appendChild(sliderThumb);
      nestedParents.push(sliderThumb);

      const parentSpin = document.createElement('div');
      parentSpin.setAttribute('role', 'spinbutton');
      const spinBtn = document.createElement('button');
      parentSpin.appendChild(spinBtn);
      nestedParents.push(spinBtn);

      const parentEditable = document.createElement('div');
      parentEditable.setAttribute('contenteditable', 'true');
      const editableP = document.createElement('p');
      const editableStrong = document.createElement('strong');
      editableP.appendChild(editableStrong);
      parentEditable.appendChild(editableP);
      nestedParents.push(editableStrong);

      const allTestElements = [...standaloneElements, ...nestedParents];

      allTestElements.forEach((el) => {
        // If el has a parent node, ensure its outermost ancestor is in document.body
        let rootNode: HTMLElement = el;
        while (rootNode.parentElement && rootNode.parentElement !== document.body) {
          rootNode = rootNode.parentElement;
        }
        if (!document.body.contains(rootNode)) {
          document.body.appendChild(rootNode);
        }

        if (typeof el.focus === 'function') {
          el.focus();
        }

        expect(isInputElement(el)).toBe(true);

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

      expect(onToggleHelp).toHaveBeenCalledTimes(0);
    });
  });

  describe('Adversarial Dimension 4: document.activeElement Isolation on Window Dispatches', () => {
    it('blocks "?" when keydown is dispatched on window or body while activeElement is an input', () => {
      const onToggleHelp = vi.fn();
      renderHook(() => useKeyboardShortcuts({ onToggleHelp }));

      const targets = [
        document.createElement('input'),
        document.createElement('textarea'),
        document.createElement('select'),
      ];

      targets.forEach((inputEl) => {
        document.body.appendChild(inputEl);
        inputEl.focus();
        expect(document.activeElement).toBe(inputEl);

        // 1. Dispatched on window
        const winEvent = new KeyboardEvent('keydown', {
          key: '?',
          bubbles: true,
          cancelable: true,
        });
        const winSpy = vi.spyOn(winEvent, 'preventDefault');
        window.dispatchEvent(winEvent);
        expect(winSpy).not.toHaveBeenCalled();

        // 2. Dispatched on document.body
        const bodyEvent = new KeyboardEvent('keydown', {
          key: '?',
          bubbles: true,
          cancelable: true,
        });
        const bodySpy = vi.spyOn(bodyEvent, 'preventDefault');
        document.body.dispatchEvent(bodyEvent);
        expect(bodySpy).not.toHaveBeenCalled();

        inputEl.blur();
        inputEl.remove();
      });

      expect(onToggleHelp).toHaveBeenCalledTimes(0);
    });
  });

  describe('Adversarial Dimension 5: Real Modal Dialog Presence Isolation', () => {
    it('suppresses "?" when AuthModal is active in DOM', () => {
      const onToggleHelp = vi.fn();
      renderHook(() => useKeyboardShortcuts({ onToggleHelp }));

      const { unmount } = render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(isOtherModalActive()).toBe(true);

      const event = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true });
      window.dispatchEvent(event);

      expect(onToggleHelp).toHaveBeenCalledTimes(0);
      unmount();
      expect(isOtherModalActive()).toBe(false);
    });

    it('suppresses "?" when ExportModal is active in DOM', () => {
      const onToggleHelp = vi.fn();
      renderHook(() => useKeyboardShortcuts({ onToggleHelp }));

      const mockProject = {
        id: 'test-proj-1',
        title: 'Stress Track',
        artist: 'Tester',
        status: 'ready',
        lines: [{ text: 'Hello', start_time: 1.0, end_time: 2.0 }],
      } as unknown as Parameters<typeof ExportModal>[0]['project'];

      const { unmount } = render(
        <ExportModal isOpen={true} project={mockProject} onClose={vi.fn()} />
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(isOtherModalActive()).toBe(true);

      const event = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true });
      window.dispatchEvent(event);

      expect(onToggleHelp).toHaveBeenCalledTimes(0);
      unmount();
      expect(isOtherModalActive()).toBe(false);
    });

    it('suppresses "?" when DeleteConfirmModal is active in DOM', () => {
      const onToggleHelp = vi.fn();
      renderHook(() => useKeyboardShortcuts({ onToggleHelp }));

      const { unmount } = render(
        <DeleteConfirmModal
          isOpen={true}
          projectId="test-proj-1"
          projectTitle="Stress Track"
          onClose={vi.fn()}
          onDeleted={vi.fn()}
        />
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(isOtherModalActive()).toBe(true);

      const event = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true });
      window.dispatchEvent(event);

      expect(onToggleHelp).toHaveBeenCalledTimes(0);
      unmount();
      expect(isOtherModalActive()).toBe(false);
    });

    it('suppresses "?" when EditMetadataModal is active in DOM', () => {
      const onToggleHelp = vi.fn();
      renderHook(() => useKeyboardShortcuts({ onToggleHelp }));

      const { unmount } = render(
        <EditMetadataModal
          isOpen={true}
          project={{ id: 'test-proj-1', title: 'Stress Track', artist: 'Tester' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(isOtherModalActive()).toBe(true);

      const event = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true });
      window.dispatchEvent(event);

      expect(onToggleHelp).toHaveBeenCalledTimes(0);
      unmount();
      expect(isOtherModalActive()).toBe(false);
    });
  });

  describe('Adversarial Dimension 6: 100% Silencing of Transport Shortcuts Under HelpModal', () => {
    it('silences Space, ArrowLeft, ArrowRight, and M across all DOM targets when HelpModal is open', () => {
      const playFn = vi.fn();
      const seekFn = vi.fn();
      const muteFn = vi.fn();
      const helpFn = vi.fn();

      renderHook(() =>
        useKeyboardShortcuts({
          onTogglePlay: playFn,
          onSeek: seekFn,
          onToggleMute: muteFn,
          onToggleHelp: helpFn,
          currentTime: 25,
          duration: 120,
        })
      );

      render(<HelpModal isOpen={true} onClose={vi.fn()} />);

      const modalDialog = screen.getByRole('dialog');
      expect(modalDialog).toBeInTheDocument();
      expect(isModalActive(modalDialog)).toBe(true);
      expect(isModalActive(null)).toBe(true);

      const closeButton = screen.getByRole('button', { name: /close help and usage guide/i });
      const shortcutsTab = screen.getByRole('tab', { name: /keyboard shortcuts/i });

      const testTargets = [window, document.body, modalDialog, closeButton, shortcutsTab];

      testTargets.forEach((target) => {
        // Space
        const spaceEvent = new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(spaceEvent);

        // ArrowLeft
        const leftEvent = new KeyboardEvent('keydown', {
          key: 'ArrowLeft',
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(leftEvent);

        // ArrowRight
        const rightEvent = new KeyboardEvent('keydown', {
          key: 'ArrowRight',
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(rightEvent);

        // 'm' and 'M'
        const lowerMEvent = new KeyboardEvent('keydown', {
          key: 'm',
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(lowerMEvent);

        const upperMEvent = new KeyboardEvent('keydown', {
          key: 'M',
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(upperMEvent);
      });

      expect(playFn).toHaveBeenCalledTimes(0);
      expect(seekFn).toHaveBeenCalledTimes(0);
      expect(muteFn).toHaveBeenCalledTimes(0);

      // Verify that '?' STILL triggers helpFn (allowing user to toggle-close the HelpModal)
      const helpEvent = new KeyboardEvent('keydown', {
        key: '?',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(helpEvent);
      expect(helpFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Adversarial Dimension 7: Responsive Geometry & Zero Horizontal Scrollbar at 320px/375px', () => {
    it('verifies zero horizontal page overflow for HelpModal at 320px and 375px across both tabs', () => {
      for (const width of [320, 375]) {
        setTestViewport(width, 700);

        // Shortcuts Tab
        const { unmount: unmount1 } = render(
          <HelpModal isOpen={true} onClose={vi.fn()} initialTab="shortcuts" />
        );
        const dialog1 = screen.getByRole('dialog');
        assertZeroHorizontalOverflow(dialog1, width);
        unmount1();

        // Guide Tab
        const { unmount: unmount2 } = render(
          <HelpModal isOpen={true} onClose={vi.fn()} initialTab="guide" />
        );
        const dialog2 = screen.getByRole('dialog');
        assertZeroHorizontalOverflow(dialog2, width);
        unmount2();
      }
    });

    it('verifies touch target dimensions (>=44px) inside HelpModal at 320px mobile viewport', () => {
      setTestViewport(320, 600);
      render(<HelpModal isOpen={true} onClose={vi.fn()} />);

      const dialog = screen.getByRole('dialog');
      const inspection = assertTouchTargets(dialog, 44);

      // Every interactive button and tab in HelpModal must comply
      expect(inspection.failed).toHaveLength(0);
      expect(inspection.total).toBeGreaterThanOrEqual(4); // Close button, 2 tabs, footer button
    });

    it('verifies zero horizontal overflow on full App header with Help trigger at 320px and 375px', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false, user: 'Friend' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      });

      for (const width of [320, 375]) {
        setTestViewport(width, 650);
        let unmountFn: () => void;

        await act(async () => {
          const res = render(<App />);
          unmountFn = res.unmount;
        });

        const header = screen.getByRole('banner');
        expect(header).toBeInTheDocument();

        // Ensure Help button is rendered inside header
        const helpBtn = screen.getByRole('button', { name: /help and studio usage guide \(\?\)/i });
        expect(helpBtn).toBeInTheDocument();

        assertZeroHorizontalOverflow(header, width);

        unmountFn!();
      }
    });
  });
});

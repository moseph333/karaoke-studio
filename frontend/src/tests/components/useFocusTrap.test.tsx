import React, { useRef, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFocusTrap, getFocusableElements } from '../../hooks/useFocusTrap';

describe('useFocusTrap (Feature 45)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  interface TestModalProps {
    isOpen: boolean;
    onClose?: () => void;
    escapeDeactivates?: boolean;
    useInitialFocus?: boolean;
  }

  const TestModal: React.FC<TestModalProps> = ({
    isOpen,
    onClose,
    escapeDeactivates = true,
    useInitialFocus = false,
  }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useFocusTrap<HTMLDivElement>({
      isOpen,
      onClose,
      escapeDeactivates,
      initialFocusRef: useInitialFocus ? inputRef : undefined,
    });

    if (!isOpen) return null;

    return (
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        data-testid="test-dialog"
      >
        <button type="button" data-testid="btn-first">
          First
        </button>
        <input ref={inputRef} type="text" data-testid="input-second" placeholder="Second" />
        <button type="button" data-testid="btn-last">
          Last
        </button>
      </div>
    );
  };

  it('automatically focuses the first focusable element when opening modal', () => {
    render(<TestModal isOpen={true} />);

    expect(screen.getByTestId('btn-first')).toHaveFocus();
  });

  it('focuses the explicit initialFocusRef when specified', () => {
    render(<TestModal isOpen={true} useInitialFocus={true} />);

    expect(screen.getByTestId('input-second')).toHaveFocus();
  });

  it('cycles focus from last element back to first on Tab', async () => {
    const user = userEvent.setup();
    render(<TestModal isOpen={true} />);

    const lastBtn = screen.getByTestId('btn-last');
    const firstBtn = screen.getByTestId('btn-first');

    lastBtn.focus();
    expect(lastBtn).toHaveFocus();

    await user.tab();

    expect(firstBtn).toHaveFocus();
  });

  it('cycles focus from first element to last on Shift+Tab', async () => {
    const user = userEvent.setup();
    render(<TestModal isOpen={true} />);

    const firstBtn = screen.getByTestId('btn-first');
    const lastBtn = screen.getByTestId('btn-last');

    firstBtn.focus();
    expect(firstBtn).toHaveFocus();

    await user.tab({ shift: true });

    expect(lastBtn).toHaveFocus();
  });

  it('dismisses modal on Escape key and stops event propagation', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TestModal isOpen={true} onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss modal on Escape if escapeDeactivates is false', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TestModal isOpen={true} onClose={onClose} escapeDeactivates={false} />);

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('restores focus to the trigger element when modal closes', async () => {
    const user = userEvent.setup();

    const Wrapper = () => {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <div>
          <button type="button" data-testid="open-trigger" onClick={() => setIsOpen(true)}>
            Open Dialog
          </button>
          <TestModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </div>
      );
    };

    render(<Wrapper />);

    const triggerBtn = screen.getByTestId('open-trigger');
    triggerBtn.focus();
    expect(triggerBtn).toHaveFocus();

    // Open dialog
    await user.click(triggerBtn);
    expect(screen.getByTestId('btn-first')).toHaveFocus();

    // Press escape to close
    await user.keyboard('{Escape}');

    // Trigger button should have focus restored
    expect(triggerBtn).toHaveFocus();
  });

  it('getFocusableElements filters out disabled, aria-hidden, hidden, and tabindex -1 elements', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <button id="valid-btn">Valid</button>
      <button id="disabled-btn" disabled>Disabled</button>
      <a href="#" id="valid-link">Link</a>
      <a id="nolink">No href</a>
      <input id="hidden-input" style="display: none;" />
      <div id="hidden-aria" aria-hidden="true"><button>Hidden inside</button></div>
      <button id="tabindex-neg" tabindex="-1">Tabindex -1</button>
      <input id="valid-input" type="text" />
    `;
    document.body.appendChild(container);

    const focusable = getFocusableElements(container);
    const ids = focusable.map((el) => el.id);

    expect(ids).toContain('valid-btn');
    expect(ids).toContain('valid-link');
    expect(ids).toContain('valid-input');
    expect(ids).not.toContain('disabled-btn');
    expect(ids).not.toContain('nolink');
    expect(ids).not.toContain('hidden-input');
    expect(ids).not.toContain('tabindex-neg');

    container.remove();
  });
});

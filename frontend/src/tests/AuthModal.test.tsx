import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthModal } from '../components/AuthModal';

describe('AuthModal (Feature 45 Focus Trap & A11y)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('renders modal with required ARIA attributes', () => {
    render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'auth-modal-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'auth-modal-desc');
    expect(screen.getByText('Studio Access Gate')).toBeInTheDocument();
  });

  it('places initial focus on the studio passphrase input', () => {
    render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/studio passphrase/i);
    expect(passwordInput).toHaveFocus();
  });

  it('calls onClose when clicking close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={onClose} />);

    const closeBtn = screen.getByRole('button', {
      name: /close studio authentication dialog/i,
    });
    await user.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when pressing Escape key', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cycles focus within modal on Tab key navigation', async () => {
    const user = userEvent.setup();
    render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />);

    const closeBtn = screen.getByRole('button', {
      name: /close studio authentication dialog/i,
    });
    const passwordInput = screen.getByLabelText(/studio passphrase/i);
    const usernameInput = screen.getByLabelText(/your nickname/i);
    const submitBtn = screen.getByRole('button', { name: /enter studio/i });

    // Type password so submit button is enabled and focusable
    await user.type(passwordInput, 'studio-secret');
    expect(passwordInput).toHaveFocus();

    await user.tab();
    expect(usernameInput).toHaveFocus();

    await user.tab();
    expect(submitBtn).toHaveFocus();

    await user.tab();
    expect(closeBtn).toHaveFocus();

    // From close button back to password
    await user.tab();
    expect(passwordInput).toHaveFocus();
  });

  it('does not render when isOpen is false', () => {
    render(<AuthModal isOpen={false} onSuccess={vi.fn()} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

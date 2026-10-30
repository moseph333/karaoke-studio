import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthModal } from '../../components/AuthModal';

describe('AuthModal (Hardened Studio Access Gate, Focus Trap & A11y)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('renders modal with required ARIA attributes and no close button', () => {
    render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'auth-modal-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'auth-modal-desc');
    expect(screen.getByText('Studio Access Gate')).toBeInTheDocument();

    // Must not render an X / close button even if onClose is provided
    expect(
      screen.queryByRole('button', { name: /close studio authentication dialog/i })
    ).not.toBeInTheDocument();
  });

  it('places initial focus on the studio passphrase input', () => {
    render(<AuthModal isOpen={true} onSuccess={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/studio passphrase/i);
    expect(passwordInput).toHaveFocus();
  });

  it('does not close or call onClose when pressing Escape key or clicking backdrop', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('requires both shared passphrase and username to enable submission and authenticate', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'ok', token: 'signed.token', username: 'Alex' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(<AuthModal isOpen={true} onSuccess={onSuccess} />);

    const passwordInput = screen.getByLabelText(/studio passphrase/i);
    const usernameInput = screen.getByLabelText(/your nickname/i);
    const submitBtn = screen.getByRole('button', { name: /enter studio/i });

    expect(submitBtn).toBeDisabled();

    // Only password filled -> still disabled until username is entered
    await user.type(passwordInput, 'studio-secret');
    expect(submitBtn).toBeDisabled();

    // Both password and username filled -> enabled
    await user.type(usernameInput, 'Alex');
    expect(submitBtn).not.toBeDisabled();

    await user.click(submitBtn);
    expect(onSuccess).toHaveBeenCalledWith('Alex', 'signed.token');
  });

  it('cycles focus within modal on Tab key navigation', async () => {
    const user = userEvent.setup();
    render(<AuthModal isOpen={true} onSuccess={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/studio passphrase/i);
    const usernameInput = screen.getByLabelText(/your nickname/i);
    const submitBtn = screen.getByRole('button', { name: /enter studio/i });

    // Type password and username so submit button is enabled and focusable
    await user.type(passwordInput, 'studio-secret');
    expect(passwordInput).toHaveFocus();

    await user.tab();
    expect(usernameInput).toHaveFocus();
    await user.type(usernameInput, 'Alex');

    await user.tab();
    expect(submitBtn).toHaveFocus();

    // From submit button back to password
    await user.tab();
    expect(passwordInput).toHaveFocus();
  });

  it('does not render when isOpen is false', () => {
    render(<AuthModal isOpen={false} onSuccess={vi.fn()} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

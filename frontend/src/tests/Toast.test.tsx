import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastItem, ToastContainer } from '../components/Toast';
import { ToastProvider, useToast } from '../hooks/useToast';
import { Toast } from '../types';
import { expectTouchTarget } from './responsiveTestUtils';

describe('Toast Component & ToastProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces a success toast through the polite live region', () => {
    const mockToast: Toast = {
      id: 'toast-1',
      message: 'Backing track separated successfully',
      type: 'success',
      duration: 4000,
      createdAt: Date.now(),
    };

    render(<ToastContainer toasts={[mockToast]} onDismiss={vi.fn()} />);

    const message = screen.getByText('Backing track separated successfully');
    expect(message.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    expect(message.closest('[data-toast-type]')).toHaveAttribute('data-toast-type', 'success');
  });

  it('stacks above the transport dock and draws variants from theme tokens', () => {
    render(
      <ToastContainer
        toasts={[
          { id: 't-ok', message: 'Saved', type: 'success', duration: 0, createdAt: Date.now() },
        ]}
        onDismiss={vi.fn()}
      />
    );
    const region = screen.getByLabelText('Notifications');
    expect(region.className).toContain('bottom-[calc(var(--dock-height,0px)+1rem)]');
    const toast = screen.getByText('Saved').closest('[data-toast-type]') as HTMLElement;
    expect(toast.className).toContain('border-theme-success/45');
    expect(toast.className).not.toMatch(/slate|emerald/);
    expectTouchTarget(screen.getByRole('button', { name: /dismiss notification/i }), 36);
  });

  it('announces error toasts through the assertive live region', () => {
    const mockErrorToast: Toast = {
      id: 'toast-err',
      message: 'Failed to connect to LRCLIB lyric server',
      type: 'error',
      duration: 4000,
      createdAt: Date.now(),
    };

    render(<ToastContainer toasts={[mockErrorToast]} onDismiss={vi.fn()} />);

    const message = screen.getByText('Failed to connect to LRCLIB lyric server');
    expect(message.closest('[aria-live]')).toHaveAttribute('aria-live', 'assertive');
  });

  it('keeps both live regions mounted before any toast arrives', async () => {
    const Trigger = () => {
      const { toast } = useToast();
      return <button onClick={() => toast.error('Upload failed')}>fail</button>;
    };
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    const region = screen.getByRole('region', { name: 'Notifications' });
    const assertive = region.querySelector('[aria-live="assertive"]');
    expect(region.querySelector('[aria-live="polite"]')).toBeInTheDocument();
    expect(assertive).toBeInTheDocument();
    expect(region).toHaveTextContent('');

    await userEvent.setup().click(screen.getByRole('button', { name: 'fail' }));

    // The same, pre-existing region now holds the message (what screen readers announce)
    expect(region.querySelector('[aria-live="assertive"]')).toBe(assertive);
    expect(assertive).toHaveTextContent('Upload failed');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('calls onDismiss when close button is clicked', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const mockToast: Toast = {
      id: 'toast-dismiss-me',
      message: 'Dismissable alert',
      type: 'info',
      duration: 4000,
      createdAt: Date.now(),
    };

    render(<ToastItem toast={mockToast} onDismiss={onDismiss} />);

    const closeBtn = screen.getByRole('button', { name: /dismiss notification/i });
    await user.click(closeBtn);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('toast-dismiss-me');
  });

  it('runs its action and then dismisses itself', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const onClick = vi.fn();
    const mockToast: Toast = {
      id: 'toast-action',
      message: 'Karaoke Studio has been updated.',
      type: 'info',
      duration: 0,
      createdAt: Date.now(),
      action: { label: 'Reload', onClick },
    };

    render(<ToastItem toast={mockToast} onDismiss={onDismiss} />);

    const actionBtn = screen.getByRole('button', { name: 'Reload' });
    expectTouchTarget(actionBtn);
    await user.click(actionBtn);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('toast-action');
  });

  it('shows no action button on plain toasts', () => {
    render(
      <ToastItem
        toast={{ id: 'plain', message: 'Saved', type: 'success', createdAt: 1 }}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getAllByRole('button')).toHaveLength(1); // only "Dismiss notification"
  });

  it('auto-dismisses after duration elapsed using fake timers', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const mockToast: Toast = {
      id: 'toast-auto-fade',
      message: 'Auto fading toast',
      type: 'success',
      duration: 3000,
      createdAt: Date.now(),
    };

    render(<ToastItem toast={mockToast} onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(onDismiss).toHaveBeenCalledWith('toast-auto-fade');
  });

  it('does not auto-dismiss when duration is 0', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const mockToast: Toast = {
      id: 'toast-persistent',
      message: 'Persistent studio warning',
      type: 'warning',
      duration: 0,
      createdAt: Date.now(),
    };

    render(<ToastItem toast={mockToast} onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('pauses auto-dismiss timer on mouse enter and resumes on mouse leave', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const mockToast: Toast = {
      id: 'toast-hover-pause',
      message: 'Hover to pause timer',
      type: 'info',
      duration: 2000,
      createdAt: Date.now(),
    };

    const { container } = render(<ToastItem toast={mockToast} onDismiss={onDismiss} />);
    const toastEl = container.firstElementChild as HTMLElement;

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Mouse enter pauses
    act(() => {
      fireEvent.mouseEnter(toastEl);
    });

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    // Mouse leave resumes
    act(() => {
      fireEvent.mouseLeave(toastEl);
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onDismiss).toHaveBeenCalledWith('toast-hover-pause');
  });

  it('renders stacked toasts in ToastContainer', () => {
    const mockToasts: Toast[] = [
      { id: 't1', message: 'First toast', type: 'info', createdAt: 1 },
      { id: 't2', message: 'Second toast', type: 'success', createdAt: 2 },
    ];

    render(<ToastContainer toasts={mockToasts} onDismiss={vi.fn()} />);

    expect(screen.getByText('First toast')).toBeInTheDocument();
    expect(screen.getByText('Second toast')).toBeInTheDocument();
  });

  it('integrates seamlessly with ToastProvider and useToast hook', async () => {
    const user = userEvent.setup();

    const TestConsumer = () => {
      const { toast } = useToast();
      return (
        <div>
          <button onClick={() => toast.success('Track export finished')}>Export Track</button>
          <button onClick={() => toast.error('Render pipeline stalled')}>Trigger Error</button>
        </div>
      );
    };

    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    );

    expect(screen.queryByText('Track export finished')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /export track/i }));
    expect(screen.getByText('Track export finished')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /trigger error/i }));
    expect(screen.getByText('Render pipeline stalled')).toBeInTheDocument();
  });

  it('passes an action through showToast and removes the toast once it is used', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    const TestConsumer = () => {
      const { showToast } = useToast();
      return (
        <button
          onClick={() => showToast('New version ready', 'info', 0, { label: 'Reload', onClick })}
        >
          Announce
        </button>
      );
    };

    render(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Announce' }));
    expect(screen.getByText('New version ready')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('New version ready')).not.toBeInTheDocument();
  });

  it('provides safe fallback when useToast is invoked outside ToastProvider', () => {
    const StandaloneComponent: React.FC = () => {
      const { toast, showToast } = useToast();
      return (
        <button
          onClick={() => {
            toast.error('noop');
            showToast('noop');
          }}
        >
          Standalone
        </button>
      );
    };

    expect(() => render(<StandaloneComponent />)).not.toThrow();
  });
});

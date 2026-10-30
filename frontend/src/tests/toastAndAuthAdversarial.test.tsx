import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastContainer, ToastItem } from '../components/Toast';
import { ToastProvider, useToast } from '../hooks/useToast';
import { LyricTimelineEditor } from '../components/LyricTimelineEditor';
import {
  apiFetch,
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  clearAuth,
  AUTH_UNAUTHORIZED_EVENT,
} from '../api';
import { LyricLine, Toast, ToastType } from '../types';

describe('M4 Challenger 2: Adversarial Stress Testing', () => {
  // ---------------------------------------------------------------------------
  // Target 1: Toast Notification System Stress Testing
  // ---------------------------------------------------------------------------
  describe('Target 1: Toast Notification System', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('auto-dismisses at exact duration threshold using fake timers', () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();
      const toast: Toast = {
        id: 'toast-exact-timer',
        message: 'Exact timer test',
        type: 'info',
        duration: 1500,
        createdAt: Date.now(),
      };

      render(<ToastItem toast={toast} onDismiss={onDismiss} />);

      act(() => {
        vi.advanceTimersByTime(1499);
      });
      expect(onDismiss).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(2);
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(onDismiss).toHaveBeenCalledWith('toast-exact-timer');
    });

    it('hover-pause suspends auto-dismiss timer and unhover restarts countdown', () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();
      const toast: Toast = {
        id: 'toast-hover-stress',
        message: 'Hover pause test',
        type: 'warning',
        duration: 2000,
        createdAt: Date.now(),
      };

      const { container } = render(<ToastItem toast={toast} onDismiss={onDismiss} />);
      const toastEl = container.firstElementChild as HTMLElement;

      // Elapse half duration
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(onDismiss).not.toHaveBeenCalled();

      // Mouse enters: pause
      act(() => {
        fireEvent.mouseEnter(toastEl);
      });

      // Advance well past initial duration while hovering
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(onDismiss).not.toHaveBeenCalled();

      // Mouse leaves: resumes
      act(() => {
        fireEvent.mouseLeave(toastEl);
      });

      // Advance just before fresh duration
      act(() => {
        vi.advanceTimersByTime(1999);
      });
      expect(onDismiss).not.toHaveBeenCalled();

      // Advance across threshold
      act(() => {
        vi.advanceTimersByTime(5);
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(onDismiss).toHaveBeenCalledWith('toast-hover-stress');
    });

    it('multiple rapid mouseEnter / mouseLeave cycles do not cause premature or duplicate dismissal', () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();
      const toast: Toast = {
        id: 'toast-rapid-hover',
        message: 'Rapid hover cycles',
        type: 'info',
        duration: 2000,
        createdAt: Date.now(),
      };

      const { container } = render(<ToastItem toast={toast} onDismiss={onDismiss} />);
      const toastEl = container.firstElementChild as HTMLElement;

      // Rapidly toggle hover state 5 times with flushed renders between events
      for (let i = 0; i < 5; i++) {
        act(() => {
          fireEvent.mouseEnter(toastEl);
        });
        act(() => {
          vi.advanceTimersByTime(500);
        });
        act(() => {
          fireEvent.mouseLeave(toastEl);
        });
        act(() => {
          vi.advanceTimersByTime(500);
        });
      }

      // Should not be dismissed yet because each leave reset timer to 2000ms and only 500ms elapsed
      expect(onDismiss).not.toHaveBeenCalled();

      // Now let it run full 2000ms after last leave
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('clicking manual close button dismisses toast immediately', async () => {
      const user = userEvent.setup();
      const onDismiss = vi.fn();
      const toast: Toast = {
        id: 'toast-instant-dismiss',
        message: 'Instant close test',
        type: 'error',
        duration: 10000,
        createdAt: Date.now(),
      };

      render(<ToastItem toast={toast} onDismiss={onDismiss} />);

      const closeBtn = screen.getByRole('button', { name: /dismiss notification/i });
      await user.click(closeBtn);

      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(onDismiss).toHaveBeenCalledWith('toast-instant-dismiss');
    });

    it('does not set auto-dismiss timer when duration <= 0', () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();
      const persistentToast: Toast = {
        id: 'toast-zero-dur',
        message: 'Zero duration toast',
        type: 'info',
        duration: 0,
        createdAt: Date.now(),
      };

      render(<ToastItem toast={persistentToast} onDismiss={onDismiss} />);

      act(() => {
        vi.advanceTimersByTime(60000);
      });
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('announces all 4 toast types through the live region of the right level', () => {
      const types: Array<{ type: ToastType; live: string }> = [
        { type: 'info', live: 'polite' },
        { type: 'success', live: 'polite' },
        { type: 'warning', live: 'polite' },
        { type: 'error', live: 'assertive' },
      ];

      for (const { type, live } of types) {
        const { unmount } = render(
          <ToastContainer
            toasts={[{ id: `t-${type}`, message: `${type} message`, type, createdAt: Date.now() }]}
            onDismiss={vi.fn()}
          />
        );

        const el = screen.getByText(`${type} message`).closest('[aria-live]');
        expect(el).toHaveAttribute('aria-live', live);
        // The toast itself carries no live role: it is added to a region that already exists
        expect(
          screen.getByText(`${type} message`).closest('[data-toast-type]')
        ).not.toHaveAttribute('role');
        unmount();
      }
    });

    it('useToast consumed outside ToastProvider exposes safe no-op functions for ALL methods', () => {
      let contextResult!: ReturnType<typeof useToast>;

      const ProbeComponent = () => {
        contextResult = useToast();
        return null;
      };

      render(<ProbeComponent />);

      expect(contextResult.toasts).toEqual([]);
      expect(contextResult.showToast('test')).toBe('');
      expect(contextResult.success('test')).toBe('');
      expect(contextResult.error('test')).toBe('');
      expect(contextResult.info('test')).toBe('');
      expect(contextResult.warning('test')).toBe('');
      expect(() => contextResult.dismissToast('id')).not.toThrow();
      expect(() => contextResult.clearToasts()).not.toThrow();

      // Nested toast object helpers
      expect(contextResult.toast.show('test')).toBe('');
      expect(contextResult.toast.success('test')).toBe('');
      expect(contextResult.toast.error('test')).toBe('');
      expect(contextResult.toast.info('test')).toBe('');
      expect(contextResult.toast.warning('test')).toBe('');
      expect(() => contextResult.toast.dismiss('id')).not.toThrow();
      expect(() => contextResult.toast.clear()).not.toThrow();
    });

    it('handles multiple stacked toasts in ToastProvider with selective dismissal and clear', async () => {
      const user = userEvent.setup();

      const MultiToastTrigger = () => {
        const { toast } = useToast();
        return (
          <div>
            <button onClick={() => toast.info('Toast A')}>Add A</button>
            <button onClick={() => toast.success('Toast B')}>Add B</button>
            <button onClick={() => toast.error('Toast C')}>Add C</button>
            <button onClick={() => toast.clear()}>Clear All</button>
          </div>
        );
      };

      render(
        <ToastProvider>
          <MultiToastTrigger />
        </ToastProvider>
      );

      await user.click(screen.getByRole('button', { name: /add a/i }));
      await user.click(screen.getByRole('button', { name: /add b/i }));
      await user.click(screen.getByRole('button', { name: /add c/i }));

      expect(screen.getByText('Toast A')).toBeInTheDocument();
      expect(screen.getByText('Toast B')).toBeInTheDocument();
      expect(screen.getByText('Toast C')).toBeInTheDocument();

      // Dismiss middle toast B
      const closeButtons = screen.getAllByRole('button', { name: /dismiss notification/i });
      expect(closeButtons).toHaveLength(3);
      await user.click(closeButtons[1]); // Dismiss B

      expect(screen.getByText('Toast A')).toBeInTheDocument();
      expect(screen.queryByText('Toast B')).not.toBeInTheDocument();
      expect(screen.getByText('Toast C')).toBeInTheDocument();

      // Clear all
      await user.click(screen.getByRole('button', { name: /clear all/i }));
      expect(screen.queryByText('Toast A')).not.toBeInTheDocument();
      expect(screen.queryByText('Toast C')).not.toBeInTheDocument();
    });

    it('defaults to 4000ms auto-dismiss duration when duration property is undefined', () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();
      const toastWithoutDuration: Toast = {
        id: 'toast-no-dur',
        message: 'No duration specified',
        type: 'info',
        createdAt: Date.now(),
      };

      render(<ToastItem toast={toastWithoutDuration} onDismiss={onDismiss} />);

      act(() => {
        vi.advanceTimersByTime(3999);
      });
      expect(onDismiss).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(2);
      });
      expect(onDismiss).toHaveBeenCalledWith('toast-no-dur');
    });

    it('dismissToast with nonexistent ID does not mutate or crash active toasts', async () => {
      const user = userEvent.setup();

      const Trigger = () => {
        const { toast, toasts } = useToast();
        return (
          <div>
            <button onClick={() => toast.info('Existing Toast')}>Add</button>
            <button onClick={() => toast.dismiss('non-existent-id')}>Dismiss Ghost</button>
            <span data-testid="count">{toasts.length}</span>
          </div>
        );
      };

      render(
        <ToastProvider>
          <Trigger />
        </ToastProvider>
      );

      await user.click(screen.getByRole('button', { name: /^add$/i }));
      expect(screen.getByTestId('count')).toHaveTextContent('1');

      await user.click(screen.getByRole('button', { name: /dismiss ghost/i }));
      expect(screen.getByTestId('count')).toHaveTextContent('1');
      expect(screen.getByText('Existing Toast')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Target 2: LyricTimelineEditor Unsaved Edits Guard Stress Testing
  // ---------------------------------------------------------------------------
  describe('Target 2: LyricTimelineEditor Unsaved Edits Guard', () => {
    const mockLines: LyricLine[] = [
      {
        id: 101,
        text: 'Carry on carry on',
        start_time: 12.0,
        end_time: 16.0,
        words: [
          { word: 'Carry', start_time: 12.0, end_time: 13.0 },
          { word: 'on', start_time: 13.0, end_time: 14.0 },
          { word: 'carry', start_time: 14.0, end_time: 15.0 },
          { word: 'on', start_time: 15.0, end_time: 16.0 },
        ],
      },
    ];

    const baseProps = {
      lines: mockLines,
      currentTime: 10.0,
      duration: 120.0,
      onSeek: vi.fn(),
      onSaveLines: vi.fn(),
    };

    it('detects deep dirty state when timing changes and cleans up when restored', async () => {
      const user = userEvent.setup();
      const onDirtyChange = vi.fn();

      render(<LyricTimelineEditor {...baseProps} onDirtyChange={onDirtyChange} />);

      expect(screen.queryByText(/Save Timing Changes/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Discard Changes/i)).not.toBeInTheDocument();

      // Nudge earlier -> dirty
      const rewindBtn = screen.getByRole('button', { name: /nudge line 101 0.2s earlier/i });
      await user.click(rewindBtn);

      expect(screen.getByText(/Save Timing Changes/i)).toBeInTheDocument();
      expect(screen.getByText(/Discard Changes/i)).toBeInTheDocument();
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);

      // Nudge later -> returns to exact original values
      const forwardBtn = screen.getByRole('button', { name: /nudge line 101 0.2s later/i });
      await user.click(forwardBtn);

      expect(screen.queryByText(/Save Timing Changes/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Discard Changes/i)).not.toBeInTheDocument();
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it('detects dirty state when word-level timing inputs are modified', async () => {
      const user = userEvent.setup();
      const onDirtyChange = vi.fn();

      render(<LyricTimelineEditor {...baseProps} onDirtyChange={onDirtyChange} />);

      // Expand line word editor
      const expandBtn = screen.getByRole('button', { name: /expand word timings for line 101/i });
      await user.click(expandBtn);

      const numberInputs = screen.getAllByRole('spinbutton');
      expect(numberInputs.length).toBeGreaterThanOrEqual(2);

      // Edit first word's start time from 12.0 to 12.25
      await user.clear(numberInputs[0]);
      await user.type(numberInputs[0], '12.25');
      await user.tab(); // typed times are committed when the field loses focus

      expect(screen.getByText(/Save Timing Changes/i)).toBeInTheDocument();
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });

    it('sets e.returnValue on beforeunload event when dirty, cleans up when clean', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...baseProps} />);

      // Initial clean beforeunload check
      const cleanEvent = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(cleanEvent);
      expect(cleanEvent.defaultPrevented).toBe(false);

      // Make dirty
      const rewindBtn = screen.getByRole('button', { name: /nudge line 101 0.2s earlier/i });
      await user.click(rewindBtn);

      // Dirty beforeunload check
      const dirtyEvent = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(dirtyEvent);
      expect(dirtyEvent.defaultPrevented).toBe(true);

      // Restore to clean
      const forwardBtn = screen.getByRole('button', { name: /nudge line 101 0.2s later/i });
      await user.click(forwardBtn);

      // Cleaned up beforeunload check
      const restoredEvent = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(restoredEvent);
      expect(restoredEvent.defaultPrevented).toBe(false);
    });

    it('clicking Discard Changes opens confirmation dialog with role="dialog"', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...baseProps} />);

      const rewindBtn = screen.getByRole('button', { name: /nudge line 101 0.2s earlier/i });
      await user.click(rewindBtn);

      const discardBtn = screen.getByRole('button', { name: /discard changes/i });
      await user.click(discardBtn);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(within(dialog).getByText(/Discard Unsaved Timing Changes\?/i)).toBeInTheDocument();
    });

    it('clicking Keep Editing in confirmation modal preserves dirty state and closes dialog', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...baseProps} />);

      const rewindBtn = screen.getByRole('button', { name: /nudge line 101 0.2s earlier/i });
      await user.click(rewindBtn);

      const discardBtn = screen.getByRole('button', { name: /discard changes/i });
      await user.click(discardBtn);

      const keepEditingBtn = screen.getByRole('button', { name: /keep editing/i });
      await user.click(keepEditingBtn);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      // Edits remain and dirty controls remain active
      expect(screen.getByText(/Save Timing Changes/i)).toBeInTheDocument();
      expect(screen.getByText(/11.8s - 15.8s/i)).toBeInTheDocument();
    });

    it('confirming Discard Changes reverts timings to baseline and clears dirty state', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...baseProps} />);

      const rewindBtn = screen.getByRole('button', { name: /nudge line 101 0.2s earlier/i });
      await user.click(rewindBtn);
      expect(screen.getByText(/11.8s - 15.8s/i)).toBeInTheDocument();

      const discardBtn = screen.getByRole('button', { name: /discard changes/i });
      await user.click(discardBtn);

      const dialog = screen.getByRole('dialog');
      const confirmDiscardBtn = within(dialog).getByRole('button', { name: /discard changes/i });
      await user.click(confirmDiscardBtn);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByText(/12.0s - 16.0s/i)).toBeInTheDocument();
      expect(screen.queryByText(/Save Timing Changes/i)).not.toBeInTheDocument();
    });

    it('preserves dirty state and user edits if onSaveLines rejects with an error', async () => {
      const user = userEvent.setup();
      const rejectingSave = vi.fn().mockRejectedValue(new Error('500 Internal Server Error'));

      render(<LyricTimelineEditor {...baseProps} onSaveLines={rejectingSave} />);

      const rewindBtn = screen.getByRole('button', { name: /nudge line 101 0.2s earlier/i });
      await user.click(rewindBtn);

      const saveBtn = screen.getByRole('button', { name: /save timing changes/i });
      await user.click(saveBtn);

      expect(rejectingSave).toHaveBeenCalledTimes(1);

      // Verify dirty state and modified timings are preserved
      expect(screen.getByText(/Save Timing Changes/i)).toBeInTheDocument();
      expect(screen.getByText(/11.8s - 15.8s/i)).toBeInTheDocument();
    });

    it('clears dirty state and updates baseline when onSaveLines resolves successfully', async () => {
      const user = userEvent.setup();
      const resolvingSave = vi.fn().mockResolvedValue(true);

      render(<LyricTimelineEditor {...baseProps} onSaveLines={resolvingSave} />);

      const rewindBtn = screen.getByRole('button', { name: /nudge line 101 0.2s earlier/i });
      await user.click(rewindBtn);

      const saveBtn = screen.getByRole('button', { name: /save timing changes/i });
      await user.click(saveBtn);

      expect(resolvingSave).toHaveBeenCalledTimes(1);

      // Once resolved, dirty state is cleared
      expect(screen.queryByText(/Save Timing Changes/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Discard Changes/i)).not.toBeInTheDocument();
    });

    it('does not clobber user dirty edits when parent passes new lines prop', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<LyricTimelineEditor {...baseProps} />);

      const rewindBtn = screen.getByRole('button', { name: /nudge line 101 0.2s earlier/i });
      await user.click(rewindBtn);
      expect(screen.getByText(/11.8s - 15.8s/i)).toBeInTheDocument();

      // Parent updates prop lines with fresh array
      rerender(<LyricTimelineEditor {...baseProps} lines={[...mockLines]} />);

      // Edits should remain untouched
      expect(screen.getByText(/11.8s - 15.8s/i)).toBeInTheDocument();
      expect(screen.getByText(/Save Timing Changes/i)).toBeInTheDocument();
    });

    it('renders cleanly with empty lines array without throwing errors', () => {
      expect(() => {
        render(<LyricTimelineEditor {...baseProps} lines={[]} />);
      }).not.toThrow();

      expect(screen.getByText('♪ Instrumental Break ♪')).toBeInTheDocument();
      expect(screen.getByText('-- End of song --')).toBeInTheDocument();
    });

    it('clamps negative word timings entered by user to zero', async () => {
      const user = userEvent.setup();
      render(<LyricTimelineEditor {...baseProps} />);

      const expandBtn = screen.getByRole('button', { name: /expand word timings for line 101/i });
      await user.click(expandBtn);

      const inputs = screen.getAllByRole('spinbutton');
      // Set start_time to -5.0
      await user.clear(inputs[0]);
      await user.type(inputs[0], '-5.0');
      await user.tab(); // typed times are committed (and clamped) when the field loses focus

      // The input should reflect clamped value >= 0
      expect(Number(inputs[0].getAttribute('value'))).toBeGreaterThanOrEqual(0);
    });

    it('functions normally when optional onDirtyChange callback is omitted', async () => {
      const user = userEvent.setup();
      const propsWithoutDirty = { ...baseProps, onDirtyChange: undefined };

      render(<LyricTimelineEditor {...propsWithoutDirty} />);

      const rewindBtn = screen.getByRole('button', { name: /nudge line 101 0.2s earlier/i });
      await expect(user.click(rewindBtn)).resolves.not.toThrow();
      expect(screen.getByText(/Save Timing Changes/i)).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Target 3: Consolidated Auth Interceptor (api.ts) Stress Testing
  // ---------------------------------------------------------------------------
  describe('Target 3: Consolidated Auth Interceptor (api.ts)', () => {
    beforeEach(() => {
      localStorage.clear();
      clearAuth();
      vi.restoreAllMocks();
    });

    it('injects dual headers (X-App-Password and Authorization Bearer) when token is present', async () => {
      setAuthToken('secret-session-token-999');
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await apiFetch('/api/protected/resource');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0];
      const headers = init?.headers as Headers;
      expect(headers.get('X-App-Password')).toBe('secret-session-token-999');
      expect(headers.get('Authorization')).toBe('Bearer secret-session-token-999');
      expect(init?.credentials).toBe('include');
    });

    it('does not overwrite explicitly passed X-App-Password or Authorization headers', async () => {
      setAuthToken('default-token');
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));

      await apiFetch('/api/test', {
        headers: {
          'X-App-Password': 'custom-password',
          Authorization: 'Bearer custom-token',
        },
      });

      const [, init] = fetchSpy.mock.calls[0];
      const headers = init?.headers as Headers;
      expect(headers.get('X-App-Password')).toBe('custom-password');
      expect(headers.get('Authorization')).toBe('Bearer custom-token');
    });

    it('does not inject auth headers when no token is present', async () => {
      clearAuthToken();
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));

      await apiFetch('/api/test');

      const [, init] = fetchSpy.mock.calls[0];
      const headers = init?.headers as Headers;
      expect(headers.get('X-App-Password')).toBeNull();
      expect(headers.get('Authorization')).toBeNull();
    });

    it('401 response on protected endpoint clears token and dispatches karaoke_unauthorized event', async () => {
      setAuthToken('stale-auth-token');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Unauthorized', { status: 401 })
      );
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      const res = await apiFetch('/api/project/abc/mix');

      expect(res.status).toBe(401);
      expect(getAuthToken()).toBeNull();
      expect(localStorage.getItem('karaoke_auth_token')).toBeNull();

      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      const dispatchedEvent = dispatchSpy.mock.calls[0][0] as CustomEvent;
      expect(dispatchedEvent.type).toBe(AUTH_UNAUTHORIZED_EVENT);
    });

    it('401 response on /api/auth/status does NOT purge token or dispatch event', async () => {
      setAuthToken('status-check-token');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Unauthorized', { status: 401 })
      );
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      const res = await apiFetch('/api/auth/status');

      expect(res.status).toBe(401);
      expect(getAuthToken()).toBe('status-check-token');
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('401 response on /api/auth/login does NOT purge token or dispatch event', async () => {
      setAuthToken('login-attempt-token');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Unauthorized', { status: 401 })
      );
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password: 'bad' }),
      });

      expect(res.status).toBe(401);
      expect(getAuthToken()).toBe('login-attempt-token');
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('exempts /api/auth/status even with query parameters or URL object', async () => {
      setAuthToken('url-check-token');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Unauthorized', { status: 401 })
      );
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      const testUrl = new URL('http://localhost:8000/api/auth/status?probe=1');
      const res = await apiFetch(testUrl);

      expect(res.status).toBe(401);
      expect(getAuthToken()).toBe('url-check-token');
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('purges token and emits event on paths containing "auth" that are not status/login', async () => {
      setAuthToken('author-token');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Unauthorized', { status: 401 })
      );
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      // Endpoint path contains 'author' which is not exempt
      const res = await apiFetch('/api/author/catalog');

      expect(res.status).toBe(401);
      expect(getAuthToken()).toBeNull();
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
    });

    it('operates safely with memoryToken when localStorage throws', async () => {
      // Simulate localStorage security exception (e.g. iframe restrictions)
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError: The operation is insecure.');
      });
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('SecurityError: The operation is insecure.');
      });

      setAuthToken('memory-fallback-token');
      expect(getAuthToken()).toBe('memory-fallback-token');

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));

      await apiFetch('/api/test');
      const [, init] = fetchSpy.mock.calls[0];
      const headers = init?.headers as Headers;
      expect(headers.get('X-App-Password')).toBe('memory-fallback-token');

      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    });

    it('does not purge token or emit unauthorized event on non-401 HTTP errors (403, 404, 500)', async () => {
      setAuthToken('valid-token');
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      for (const status of [400, 403, 404, 500, 502]) {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(`Error ${status}`, { status })
        );

        const res = await apiFetch('/api/project/1/mix');
        expect(res.status).toBe(status);
        expect(getAuthToken()).toBe('valid-token');
        expect(dispatchSpy).not.toHaveBeenCalled();
      }
    });

    it('propagates network fetch rejections directly to the caller', async () => {
      setAuthToken('valid-token');
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(apiFetch('/api/test')).rejects.toThrow('Failed to fetch');
      // Token should not be cleared on network drop
      expect(getAuthToken()).toBe('valid-token');
    });

    it('preserves existing Headers instance and merges auth headers seamlessly', async () => {
      setAuthToken('bearer-token-123');
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));

      const customHeaders = new Headers();
      customHeaders.set('Content-Type', 'application/json');
      customHeaders.set('X-Custom-Trace', 'trace-id-xyz');

      await apiFetch('/api/data', { headers: customHeaders });

      const [, init] = fetchSpy.mock.calls[0];
      const merged = init?.headers as Headers;
      expect(merged.get('Content-Type')).toBe('application/json');
      expect(merged.get('X-Custom-Trace')).toBe('trace-id-xyz');
      expect(merged.get('X-App-Password')).toBe('bearer-token-123');
      expect(merged.get('Authorization')).toBe('Bearer bearer-token-123');
    });
  });
});

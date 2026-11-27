/**
 * Authentication Modal Component
 *
 * The studio access gate: shared passphrase plus a nickname. It sits above every other
 * layer. While a passphrase is required and nobody is signed in it cannot be dismissed (no
 * close button, Escape and backdrop clicks ignored); opened from the profile button to switch
 * nickname it can be closed, and when the server has no passphrase it only asks for the
 * nickname.
 */

import React, { useState, useRef, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { apiFetch, getAuthUser, setAuthToken, setAuthUser, readApiError } from '../api';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { TEXT_LIMITS } from '../utils/textLimits';

interface AuthModalProps {
  isOpen: boolean;
  onSuccess: (username: string, token: string) => void;
  onClose?: () => void;
  /** Switching profile while signed in: Escape, a backdrop click or Cancel close it. */
  dismissable?: boolean;
  /** False when the server has no passphrase (APP_PASSWORD unset): nickname only. */
  requirePassword?: boolean;
}

const inputCls =
  'w-full min-h-[44px] border border-theme-border bg-transparent px-3.5 py-2.5 text-base text-theme-text placeholder:text-theme-text-muted focus:border-theme-accent focus:outline-none focus:ring-1 focus:ring-theme-focus sm:text-sm';
const labelCls = 'block text-sm font-semibold text-theme-text';

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onSuccess,
  onClose,
  dismissable = false,
  requirePassword = true,
}) => {
  const canDismiss = dismissable && Boolean(onClose);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState(() => (getAuthUser() === 'Friend' ? '' : getAuthUser()));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const usernameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setError(null);
      const savedUser = getAuthUser();
      setUsername(savedUser === 'Friend' ? '' : savedUser);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedPassword = password.trim();
    const trimmedUsername = username.trim();

    if (requirePassword && !trimmedPassword) {
      setError('Please enter the studio passphrase');
      passwordInputRef.current?.focus();
      return;
    }

    if (!trimmedUsername) {
      setError('Please enter a username / nickname');
      usernameInputRef.current?.focus();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          password: trimmedPassword,
          username: trimmedUsername,
        }),
      });

      if (!res.ok) {
        throw new Error(await readApiError(res, 'Incorrect passphrase. Please try again.'));
      }

      const data = await res.json();
      const confirmedUser = (data.username || trimmedUsername).trim();
      const token = data.token || trimmedPassword;

      setAuthToken(token);
      setAuthUser(confirmedUser);
      setPassword('');

      onSuccess(confirmedUser, token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={canDismiss ? onClose : undefined}
      titleId="auth-modal-title"
      descriptionId="auth-modal-desc"
      size="md"
      layer="gate"
      dismissOnBackdrop={canDismiss}
      dismissOnEscape={canDismiss}
      showDragHandle
      initialFocusRef={requirePassword ? passwordInputRef : usernameInputRef}
      overlayClassName="bg-theme-overlay/90"
    >
      <div className="space-y-5 sm:space-y-6">
        <div className="space-y-3 border-b-2 border-theme-border pb-4">
          <h2
            id="auth-modal-title"
            className="ks-display text-[36px] font-black leading-[0.9] text-theme-text sm:text-[44px]"
          >
            {canDismiss ? 'Switch Profile' : 'Welcome to Karaoke Studio'}
          </h2>
          <p id="auth-modal-desc" className="text-base text-theme-text-muted">
            {requirePassword
              ? 'Enter the passphrase you were given and pick a name for your songs.'
              : 'Choose the nickname your new tracks are tagged with.'}
          </p>
        </div>

        {error && (
          <div
            className="flex items-start gap-2 text-sm font-semibold text-theme-danger"
            role="alert"
            aria-live="assertive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {requirePassword && (
            <div className="space-y-1.5">
              <label htmlFor="auth-password" className={labelCls}>
                Studio passphrase
              </label>
              <input
                ref={passwordInputRef}
                id="auth-password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className={inputCls}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="auth-username" className={labelCls}>
              Your nickname
            </label>
            <input
              ref={usernameInputRef}
              id="auth-username"
              name="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={TEXT_LIMITS.singer}
              required
              className={inputCls}
            />
            <p className="text-sm text-theme-text-muted">
              Songs you make are listed under this name.
            </p>
          </div>

          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={(requirePassword && !password.trim()) || !username.trim()}
            loading={loading}
          >
            {canDismiss ? 'Switch Profile' : 'Enter Studio'}
          </Button>
          {canDismiss && (
            <Button variant="ghost" fullWidth onClick={onClose}>
              Cancel
            </Button>
          )}
        </form>
      </div>
    </Dialog>
  );
};

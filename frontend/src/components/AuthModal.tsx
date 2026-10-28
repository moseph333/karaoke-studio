/**
 * Authentication Modal Component
 *
 * The studio access gate: shared passphrase plus a nickname. It sits above every other
 * layer and cannot be dismissed (no close button, Escape and backdrop clicks ignored).
 */

import React, { useState, useRef, useEffect } from 'react';
import { Lock, User, AlertCircle, ArrowRight } from 'lucide-react';
import { apiFetch, getAuthUser, setAuthToken, setAuthUser } from '../api';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';

interface AuthModalProps {
  isOpen: boolean;
  onSuccess: (username: string, token: string) => void;
  onClose?: () => void;
}

const inputCls =
  'w-full min-h-[44px] rounded-theme-md border border-theme-border-subtle bg-theme-bg px-3.5 py-2.5 text-base text-theme-text placeholder:text-theme-text-muted focus:border-theme-accent focus:outline-none focus:ring-2 focus:ring-theme-focus/60 sm:text-sm';
const labelCls = 'flex items-center gap-1.5 text-xs font-semibold text-theme-text';

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onSuccess }) => {
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

    if (!trimmedPassword) {
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
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Incorrect passphrase. Please try again.');
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
      titleId="auth-modal-title"
      descriptionId="auth-modal-desc"
      size="md"
      layer="gate"
      dismissOnBackdrop={false}
      dismissOnEscape={false}
      showDragHandle
      initialFocusRef={passwordInputRef}
      overlayClassName="bg-theme-overlay/90 backdrop-blur-md"
    >
      <div className="space-y-5 sm:space-y-6">
        <div className="space-y-2 text-center">
          <div className="inline-flex rounded-theme-lg bg-gradient-accent p-3 text-theme-accent-text shadow-theme-glow">
            <Lock className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2
            id="auth-modal-title"
            className="font-theme-heading text-2xl font-extrabold tracking-tight text-theme-text"
          >
            Studio Access Gate
          </h2>
          <p id="auth-modal-desc" className="text-sm text-theme-text-muted">
            Enter the shared studio passphrase and your nickname to start producing tracks.
          </p>
        </div>

        {error && (
          <div
            className="flex items-center gap-2.5 rounded-theme-md border border-theme-danger/35 bg-theme-danger/10 p-3 text-xs text-theme-danger"
            role="alert"
            aria-live="assertive"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="auth-password" className={labelCls}>
              <Lock className="h-3.5 w-3.5 text-theme-highlight" aria-hidden="true" />
              Studio Passphrase
            </label>
            <input
              ref={passwordInputRef}
              id="auth-password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter studio password..."
              autoComplete="current-password"
              required
              className={`${inputCls} font-mono`}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="auth-username" className={labelCls}>
              <User className="h-3.5 w-3.5 text-theme-highlight" aria-hidden="true" />
              Your Nickname / Handle
            </label>
            <input
              ref={usernameInputRef}
              id="auth-username"
              name="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. Alex"
              autoComplete="username"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={64}
              required
              className={inputCls}
            />
            <p className="text-[11px] text-theme-text-muted">
              Tracks you create will be tagged under this name in your personal workspace.
            </p>
          </div>

          <Button
            type="submit"
            variant="gradient"
            size="lg"
            fullWidth
            disabled={!password.trim() || !username.trim()}
            loading={loading}
            rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
            className="min-h-[44px] text-sm"
          >
            Enter Studio
          </Button>
        </form>
      </div>
    </Dialog>
  );
};

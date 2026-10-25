/**
 * Authentication Modal Component
 *
 * Provides passphrase entry and user alias configuration for studio access.
 * Manages modal focus trapping, credential validation, and local credential storage.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Lock, User, AlertCircle, ArrowRight } from 'lucide-react';
import { apiFetch, getAuthUser, setAuthToken, setAuthUser } from '../api';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface AuthModalProps {
  isOpen: boolean;
  onSuccess: (username: string, token: string) => void;
  onClose?: () => void;
}

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

  const modalRef = useFocusTrap<HTMLDivElement>({
    isOpen,
    initialFocusRef: passwordInputRef,
    escapeDeactivates: false,
  });

  if (!isOpen) return null;

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
    <div
      ref={modalRef}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      aria-describedby="auth-modal-desc"
    >
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl space-y-5 sm:space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-2xl bg-gradient-to-tr from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 text-cyan-400">
            <Lock className="w-6 h-6" aria-hidden="true" />
          </div>
          <h2
            id="auth-modal-title"
            className="text-2xl font-extrabold text-white tracking-tight font-['Montserrat']"
          >
            Studio Access Gate
          </h2>
          <p id="auth-modal-desc" className="text-xs text-slate-400">
            Enter the shared studio passphrase and your nickname to start producing tracks.
          </p>
        </div>

        {error && (
          <div
            className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2.5 text-rose-300 text-xs"
            role="alert"
            aria-live="assertive"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="auth-password"
              className="text-xs font-semibold text-slate-300 flex items-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
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
              className="w-full min-h-[44px] px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="auth-username"
              className="text-xs font-semibold text-slate-300 flex items-center gap-1.5"
            >
              <User className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
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
              className="w-full min-h-[44px] px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            />
            <p className="text-[11px] text-slate-500">
              Tracks you create will be tagged under this name in your personal workspace.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !password.trim() || !username.trim()}
            className="w-full min-h-[44px] py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="inline-block w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <>
                <span>Enter Studio</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

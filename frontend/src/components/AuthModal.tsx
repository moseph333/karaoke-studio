import React, { useState, useRef } from 'react';
import { Lock, User, AlertCircle, ArrowRight, X } from 'lucide-react';
import { apiFetch, getAuthUser, setAuthToken, setAuthUser } from '../api';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface AuthModalProps {
  isOpen: boolean;
  onSuccess: (username: string, token: string) => void;
  onClose?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onSuccess, onClose }) => {
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState(getAuthUser() === 'Friend' ? '' : getAuthUser());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const modalRef = useFocusTrap<HTMLDivElement>({
    isOpen,
    onClose,
    initialFocusRef: passwordInputRef,
    escapeDeactivates: Boolean(onClose),
  });

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Please enter the studio passphrase');
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
          password: password.trim(),
          username: username.trim() || 'Friend',
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Incorrect passphrase. Please try again.');
      }

      const data = await res.json();
      const confirmedUser = data.username || username.trim() || 'Friend';
      const token = data.token || password.trim();

      setAuthToken(token);
      setAuthUser(confirmedUser);

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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      aria-describedby="auth-modal-desc"
    >
      <div className="relative w-full max-w-md p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl space-y-6">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close studio authentication dialog"
            className="absolute top-5 right-5 p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        )}
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
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter studio password..."
              required
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent font-mono"
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
              id="auth-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. Alex"
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            />
            <p className="text-[11px] text-slate-500">
              Tracks you create will be tagged under this name in your personal workspace.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || !password.trim()}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

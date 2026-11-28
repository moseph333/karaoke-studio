/**
 * The host screen's sign-in: one passphrase, the show's or the studio's.
 *
 * Before the screen opens it is a gate with no way round it. Over an open screen (`onClose`
 * is given) it is a dialog that can be put away: when the sign-in has ended, since the host
 * may have a song to pause first, and when it is about to (`endsIn`), since the night can
 * start without it.
 */

import React, { useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button, Dialog, Input } from '../ui';

export interface ShowSignInProps {
  /** The server has a show passphrase (a venue's sign-in), so the dialog says it takes one. */
  hasShowPassphrase: boolean;
  /** Resolves to an error message, or null once signed in. */
  onSignIn: (passphrase: string) => Promise<string | null>;
  /** The show is open behind the dialog: it can be closed, and says "again". */
  onClose?: () => void;
  /** Seconds the sign-in still has: the dialog is asking early, before the night. */
  endsIn?: number | null;
}

/** "in about 3 hours", for a sign-in with that long left. */
function howSoon(seconds: number): string {
  const hours = Math.round(seconds / 3600);
  if (hours < 1) return 'in less than an hour';
  return hours === 1 ? 'in about an hour' : `in about ${hours} hours`;
}

export const ShowSignIn: React.FC<ShowSignInProps> = ({
  hasShowPassphrase,
  onSignIn,
  onClose,
  endsIn = null,
}) => {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const again = Boolean(onClose);
  const early = again && endsIn !== null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !passphrase.trim()) return;
    setBusy(true);
    setError(null);
    const problem = await onSignIn(passphrase);
    setBusy(false);
    if (problem) {
      setError(problem);
      inputRef.current?.focus();
    }
  };

  return (
    <Dialog
      open
      titleId="show-sign-in-title"
      descriptionId="show-sign-in-desc"
      size="md"
      layer="gate"
      onClose={onClose}
      dismissOnBackdrop={false}
      dismissOnEscape={again}
      initialFocusRef={inputRef}
      overlayClassName="bg-theme-overlay/90"
    >
      <div className="space-y-5">
        <div className="space-y-3 border-b-2 border-theme-border pb-4">
          <h2
            id="show-sign-in-title"
            className="ks-display text-[36px] font-black leading-[0.9] text-theme-text sm:text-[44px]"
          >
            {early ? 'Sign in for tonight' : again ? 'Sign in again' : 'Run the show'}
          </h2>
          <p id="show-sign-in-desc" className="text-base text-theme-text-muted">
            {early &&
              `This sign-in ends ${howSoon(endsIn)}, which could be in the middle of a song. `}
            {hasShowPassphrase
              ? 'Enter the show passphrase you were given, or the studio passphrase.'
              : 'Enter the studio passphrase.'}
          </p>
        </div>

        {error && (
          <div
            className="flex items-start gap-2 text-sm font-semibold text-theme-danger"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="show-passphrase"
              className="block text-sm font-semibold text-theme-text"
            >
              Passphrase
            </label>
            <Input
              ref={inputRef}
              id="show-passphrase"
              name="password"
              type="password"
              value={passphrase}
              autoComplete="current-password"
              required
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={!passphrase.trim()}
            loading={busy}
          >
            {again ? 'Sign in' : 'Open the host screen'}
          </Button>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              fullWidth
              className="min-h-[44px]"
              onClick={onClose}
            >
              {early ? 'Carry on without' : 'Not now'}
            </Button>
          )}
        </form>
      </div>
    </Dialog>
  );
};

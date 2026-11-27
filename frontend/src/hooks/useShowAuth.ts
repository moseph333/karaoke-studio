/**
 * Who may run the show: the host screen's sign-in.
 *
 * A server with a studio passphrase asks for one. The host screen takes either: the studio
 * passphrase, which opens everything, or the server's show passphrase (when it has one), which
 * only runs a show and is what a venue's host is given. A show sign-in cannot leave for the
 * library and the studio (`studio` is false), since nothing there would answer it.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AUTH_UNAUTHORIZED_EVENT,
  apiFetch,
  getAuthUser,
  readApiError,
  setAuthToken,
  setShowToken,
} from '../api';

export type ShowAccess = 'checking' | 'open' | 'locked';

export interface UseShowAuth {
  access: ShowAccess;
  /** Signed in with the studio passphrase (or the server has none): the app is open too. */
  studio: boolean;
  /** The server has a show passphrase, so the sign-in says it takes one. */
  hasShowPassphrase: boolean;
  /** Signs in with a passphrase of either kind; resolves to an error message, or null. */
  signIn: (passphrase: string) => Promise<string | null>;
}

interface Status {
  auth_required?: boolean;
  authenticated?: boolean;
  show?: boolean;
  show_authenticated?: boolean;
}

const WRONG = 'That passphrase is not right. Try again.';
const TOO_MANY = 'Too many tries. Wait a minute, then try again.';
const NO_ANSWER = 'The server did not answer. Try again in a moment.';

async function post(url: string, body: unknown): Promise<Response> {
  return apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function useShowAuth(): UseShowAuth {
  const [access, setAccess] = useState<ShowAccess>('checking');
  const [studio, setStudio] = useState(false);
  const [hasShowPassphrase, setHasShowPassphrase] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/auth/status')
      .then((response) => response.json() as Promise<Status>)
      .then((status) => {
        if (cancelled) return;
        setHasShowPassphrase(status.show === true);
        if (!status.auth_required || status.authenticated) {
          setStudio(true);
          setAccess('open');
        } else if (status.show_authenticated) {
          setStudio(false);
          setAccess('open');
        } else {
          setAccess('locked');
        }
      })
      .catch(() => {
        // The server is away: show the screen, whose own requests will say so
        if (!cancelled) setAccess('open');
      });

    const signedOut = () => {
      setStudio(false);
      setAccess('locked');
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, signedOut);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, signedOut);
    };
  }, []);

  const signIn = useCallback(
    async (passphrase: string): Promise<string | null> => {
      const password = passphrase.trim();
      if (!password) return WRONG;
      try {
        // The show passphrase first: it is the one a venue's host has
        if (hasShowPassphrase) {
          const asShow = await post('/api/auth/show-login', { password });
          if (asShow.ok) {
            const data = (await asShow.json()) as { token?: string };
            setShowToken(data.token ?? null);
            setStudio(false);
            setAccess('open');
            return null;
          }
          if (asShow.status === 429) return TOO_MANY;
        }
        const asStudio = await post('/api/auth/login', { password, username: getAuthUser() });
        if (asStudio.ok) {
          const data = (await asStudio.json()) as { token?: string };
          setAuthToken(data.token ?? password);
          setStudio(true);
          setAccess('open');
          return null;
        }
        if (asStudio.status === 429) return TOO_MANY;
        if (asStudio.status === 401) return WRONG;
        return await readApiError(asStudio, WRONG);
      } catch {
        return NO_ANSWER;
      }
    },
    [hasShowPassphrase]
  );

  return { access, studio, hasShowPassphrase, signIn };
}

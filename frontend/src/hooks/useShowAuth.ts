/**
 * Who may run the show: the host screen's sign-in.
 *
 * A server with a studio passphrase asks for one. The host screen takes either: the studio
 * passphrase, which opens everything, or the server's show passphrase (when it has one), which
 * only runs a show and is what a venue's host is given. A show sign-in cannot leave for the
 * library and the studio (`studio` is false), since nothing there would answer it.
 *
 * A sign-in that ends while the screen is open (`ended`) does not shut it: the song on stage
 * is the room's, so the screen stays and asks for the passphrase beside it. `session` counts
 * the sign-ins made here, so the screen can try again what the ended one refused.
 *
 * A show sign-in lasts seven days and a venue runs a show every week, so the screen trades
 * its show token for a new one when it opens and every few hours while it is open
 * (`POST /api/auth/show-renew`): a venue is asked for its passphrase again only after a week
 * without a show. The studio's sign-in is not renewed. Opened with a studio sign-in that
 * would end within the night (`endsIn`), the screen asks for the passphrase before anybody is
 * singing, which is the one moment that costs nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUTH_UNAUTHORIZED_EVENT,
  apiFetch,
  getAuthUser,
  getShowToken,
  readApiError,
  setAuthToken,
  setShowToken,
} from '../api';

/** `ended`: the screen was open and the server has since stopped taking its sign-in. */
export type ShowAccess = 'checking' | 'open' | 'locked' | 'ended';

export interface UseShowAuth {
  access: ShowAccess;
  /** Signed in with the studio passphrase (or the server has none): the app is open too. */
  studio: boolean;
  /** The server has a show passphrase, so the sign-in says it takes one. */
  hasShowPassphrase: boolean;
  /** How many times this screen has signed in: it goes up when a passphrase is taken. */
  session: number;
  /** Seconds the studio sign-in had left when the screen opened, when that is within a
   *  night's length; null otherwise, and once the host has signed in again. */
  endsIn: number | null;
  /** Signs in with a passphrase of either kind; resolves to an error message, or null. */
  signIn: (passphrase: string) => Promise<string | null>;
}

interface Status {
  auth_required?: boolean;
  authenticated?: boolean;
  show?: boolean;
  show_authenticated?: boolean;
  /** Seconds the session token has left; null for none, or the passphrase itself. */
  expires_in?: number | null;
}

const WRONG = 'That passphrase is not right. Try again.';
const TOO_MANY = 'Too many tries. Wait a minute, then try again.';
const NO_ANSWER = 'The server did not answer. Try again in a moment.';

/** A studio sign-in with less than this left would end during a night that starts now. */
export const ENDS_SOON_SEC = 12 * 60 * 60;
/** A show token this old is traded for a new one. */
export const SHOW_RENEW_AFTER_MS = 6 * 60 * 60 * 1000;
/** How often an open screen looks at its token's age; it also looks when it is come back to. */
const SHOW_RENEW_CHECK_MS = 30 * 60 * 1000;

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
  const [session, setSession] = useState(0);
  const [endsIn, setEndsIn] = useState<number | null>(null);

  // --- Keeping a show sign-in going ------------------------------------------------------
  /** When this screen last got a show token: by signing in, or by renewing one. */
  const renewedAt = useRef(0);
  const renewing = useRef(false);
  const renew = useCallback(async () => {
    if (renewing.current || !getShowToken()) return;
    renewing.current = true;
    try {
      const response = await post('/api/auth/show-renew', {});
      if (!response.ok) return;
      const data = (await response.json()) as { token?: string };
      // No token in the answer: the server renewed nothing, and the one in hand stays. One
      // that was cleared meanwhile (a 401) is not put back behind the host's back
      if (data.token && getShowToken()) {
        setShowToken(data.token);
        renewedAt.current = Date.now();
      }
    } catch {
      // The server is away: the token in hand stays, and the next look tries again
    } finally {
      renewing.current = false;
    }
  }, []);

  const isOpen = access === 'open';
  useEffect(() => {
    if (!isOpen) return;
    const look = () => {
      if (Date.now() - renewedAt.current >= SHOW_RENEW_AFTER_MS) void renew();
    };
    const seen = () => {
      if (document.visibilityState !== 'hidden') look();
    };
    const timer = setInterval(look, SHOW_RENEW_CHECK_MS);
    window.addEventListener('focus', look);
    document.addEventListener('visibilitychange', seen);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', look);
      document.removeEventListener('visibilitychange', seen);
    };
  }, [isOpen, renew]);

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
          const left = status.auth_required ? status.expires_in : null;
          if (typeof left === 'number' && left < ENDS_SOON_SEC) setEndsIn(left);
        } else if (status.show_authenticated) {
          setStudio(false);
          setAccess('open');
          // Opened with a show sign-in of some age: it starts the night with a whole week
          void renew();
        } else {
          setAccess('locked');
        }
      })
      .catch(() => {
        // The server is away: show the screen, whose own requests will say so
        if (!cancelled) setAccess('open');
      });

    // A screen that was open stays open: it only says the sign-in has ended
    const signedOut = () => {
      setStudio(false);
      setAccess((was) => (was === 'open' || was === 'ended' ? 'ended' : 'locked'));
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, signedOut);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, signedOut);
    };
  }, [renew]);

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
            renewedAt.current = Date.now();
            setStudio(false);
            setAccess('open');
            setEndsIn(null);
            setSession((count) => count + 1);
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
          setEndsIn(null);
          setSession((count) => count + 1);
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

  return { access, studio, hasShowPassphrase, session, endsIn, signIn };
}

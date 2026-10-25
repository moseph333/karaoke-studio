/**
 * Studio Authentication & Profile Hook
 *
 * Manages passphrase-protected workspace authentication status,
 * current user profile, and automatic prompting on unauthorized API events.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  apiFetch,
  getAuthToken,
  setAuthToken as saveAuthToken,
  clearAuthToken,
  getAuthUser,
  setAuthUser,
  AUTH_UNAUTHORIZED_EVENT,
} from '../api';

export function useStudioAuth() {
  const [authRequired, setAuthRequired] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(getAuthToken()));
  const [internalShowAuthModal, setInternalShowAuthModal] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => getAuthUser());
  const [authToken, setAuthToken] = useState(() => getAuthToken() || '');

  // Check server auth requirement on load
  useEffect(() => {
    apiFetch('/api/auth/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.auth_required) {
          setAuthRequired(true);
          if (!data.authenticated) {
            clearAuthToken();
            setAuthToken('');
            setIsAuthenticated(false);
            setInternalShowAuthModal(true);
          } else {
            setIsAuthenticated(true);
            if (typeof data.username === 'string' && data.username.trim()) {
              const serverUser = data.username.trim();
              if (getAuthUser() === 'Friend') {
                setAuthUser(serverUser);
                setCurrentUser(serverUser);
              }
            }
          }
        } else {
          setAuthRequired(false);
          setIsAuthenticated(true);
          setInternalShowAuthModal(false);
        }
      })
      .catch(() => {});

    const handleUnauthorized = () => {
      clearAuthToken();
      setAuthRequired(true);
      setIsAuthenticated(false);
      setAuthToken('');
      setInternalShowAuthModal(true);
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  const isAuthLocked = authRequired && !isAuthenticated;
  const showAuthModal = internalShowAuthModal || isAuthLocked;

  const setShowAuthModal = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      setInternalShowAuthModal((prev) => {
        const next = typeof value === 'function' ? value(prev) : value;
        if (!next && authRequired && !isAuthenticated) {
          return true;
        }
        return next;
      });
    },
    [authRequired, isAuthenticated]
  );

  const handleAuthSuccess = useCallback((username: string, token: string) => {
    const cleanUser = username.trim() || 'Friend';
    setCurrentUser(cleanUser);
    setAuthUser(cleanUser);
    setAuthToken(token);
    saveAuthToken(token);
    setIsAuthenticated(true);
    setInternalShowAuthModal(false);
  }, []);

  return {
    authRequired,
    isAuthenticated,
    isAuthLocked,
    showAuthModal,
    setShowAuthModal,
    currentUser,
    setCurrentUser,
    authToken,
    setAuthToken,
    handleAuthSuccess,
  };
}

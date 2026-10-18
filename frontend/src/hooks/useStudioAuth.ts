/**
 * Studio Authentication & Profile Hook
 *
 * Manages passphrase-protected workspace authentication status,
 * current user profile, and automatic prompting on unauthorized API events.
 */

import { useState, useEffect } from 'react';
import { apiFetch } from '../api';

export function useStudioAuth() {
  const [authRequired, setAuthRequired] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [currentUser, setCurrentUser] = useState(
    localStorage.getItem('karaoke_user_name') || 'Friend'
  );
  const [authToken, setAuthToken] = useState(localStorage.getItem('karaoke_auth_token') || '');

  // Check server auth requirement on load
  useEffect(() => {
    apiFetch('/api/auth/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.auth_required) {
          setAuthRequired(true);
          if (!data.authenticated) {
            localStorage.removeItem('karaoke_auth_token');
            setAuthToken('');
            setShowAuthModal(true);
          }
        } else {
          setAuthRequired(false);
          setShowAuthModal(false);
        }
      })
      .catch(() => {});

    const handleUnauthorized = () => setShowAuthModal(true);
    window.addEventListener('karaoke_unauthorized', handleUnauthorized);
    return () => window.removeEventListener('karaoke_unauthorized', handleUnauthorized);
  }, []);

  const handleAuthSuccess = (username: string, token: string) => {
    setCurrentUser(username);
    setAuthToken(token);
    setShowAuthModal(false);
  };

  return {
    authRequired,
    showAuthModal,
    setShowAuthModal,
    currentUser,
    setCurrentUser,
    authToken,
    setAuthToken,
    handleAuthSuccess,
  };
}

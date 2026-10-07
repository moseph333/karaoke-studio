/**
 * Centralized API client for YouTube Karaoke Studio.
 * Automatically attaches auth tokens, transmits credentials/cookies,
 * and broadcasts unauthorized events to trigger the studio passphrase gate.
 */
export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('karaoke_auth_token');
  const headers = new Headers(options.headers || {});

  if (token && !headers.has('X-App-Password')) {
    headers.set('X-App-Password', token);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && !url.includes('/api/auth/status')) {
    window.dispatchEvent(new CustomEvent('karaoke_unauthorized'));
  }

  return res;
}

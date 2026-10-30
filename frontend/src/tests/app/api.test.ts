import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  apiFetch,
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  getAuthUser,
  setAuthUser,
  clearAuth,
  AUTH_UNAUTHORIZED_EVENT,
} from '../../api';

describe('Consolidated apiFetch & Credential Management (Feature 40)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAuth();
    vi.restoreAllMocks();
  });

  it('manages auth tokens via helper methods with localStorage persistence', () => {
    expect(getAuthToken()).toBeNull();

    setAuthToken('my-passphrase-token');
    expect(getAuthToken()).toBe('my-passphrase-token');
    expect(localStorage.getItem('karaoke_auth_token')).toBe('my-passphrase-token');

    clearAuthToken();
    expect(getAuthToken()).toBeNull();
    expect(localStorage.getItem('karaoke_auth_token')).toBeNull();
  });

  it('manages user nickname via helper methods defaulting to Friend', () => {
    expect(getAuthUser()).toBe('Friend');

    setAuthUser('ProducerAlex');
    expect(getAuthUser()).toBe('ProducerAlex');
    expect(localStorage.getItem('karaoke_user_name')).toBe('ProducerAlex');

    clearAuth();
    expect(getAuthUser()).toBe('Friend');
  });

  it('attaches both X-App-Password and Authorization Bearer headers from stored token', async () => {
    setAuthToken('secret-passphrase-123');
    const mockResponse = new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await apiFetch('/api/test');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0];
    const headers = options?.headers as Headers;
    expect(headers.get('X-App-Password')).toBe('secret-passphrase-123');
    expect(headers.get('Authorization')).toBe('Bearer secret-passphrase-123');
    expect(options?.credentials).toBe('include');
  });

  it('preserves existing headers if already supplied in options', async () => {
    setAuthToken('local-token');
    const mockResponse = new Response('{}', { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await apiFetch('/api/test', {
      headers: {
        'X-App-Password': 'custom-override-pass',
        Authorization: 'Bearer custom-bearer-override',
      },
    });

    const [, options] = fetchSpy.mock.calls[0];
    const headers = options?.headers as Headers;
    expect(headers.get('X-App-Password')).toBe('custom-override-pass');
    expect(headers.get('Authorization')).toBe('Bearer custom-bearer-override');
  });

  it('does not set authentication headers if stored token is absent', async () => {
    const mockResponse = new Response('{}', { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await apiFetch('/api/test');

    const [, options] = fetchSpy.mock.calls[0];
    const headers = options?.headers as Headers;
    expect(headers.get('X-App-Password')).toBeNull();
    expect(headers.get('Authorization')).toBeNull();
  });

  it('dispatches karaoke_unauthorized event and clears token on 401 response', async () => {
    setAuthToken('stale-token');
    const mockResponse = new Response('Unauthorized', { status: 401 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const res = await apiFetch('/api/project/123/mix');

    expect(res.status).toBe(401);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe(AUTH_UNAUTHORIZED_EVENT);
    expect(getAuthToken()).toBeNull();
  });

  it('does not dispatch karaoke_unauthorized or clear token on 401 for /api/auth/status', async () => {
    setAuthToken('initial-token');
    const mockResponse = new Response('Unauthorized', { status: 401 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const res = await apiFetch('/api/auth/status');

    expect(res.status).toBe(401);
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(getAuthToken()).toBe('initial-token');
  });

  it('does not dispatch karaoke_unauthorized or clear token on 401 for /api/auth/login', async () => {
    const mockResponse = new Response(JSON.stringify({ detail: 'Invalid credentials' }), {
      status: 401,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'wrong' }),
    });

    expect(res.status).toBe(401);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('returns response cleanly on 200 OK without dispatching events', async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const res = await apiFetch('/api/projects');

    expect(res.status).toBe(200);
    expect(dispatchSpy).not.toHaveBeenCalled();
    const data = await res.json();
    expect(data).toEqual({ ok: true });
  });

  it('supports URL object instances and custom credentials options', async () => {
    const mockResponse = new Response('{}', { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    const testUrl = new URL('http://localhost:8000/api/projects?scope=all');
    await apiFetch(testUrl, { credentials: 'same-origin' });

    expect(fetchSpy).toHaveBeenCalledWith(
      testUrl,
      expect.objectContaining({ credentials: 'same-origin' })
    );
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch } from '../api';

describe('apiFetch', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('attaches X-App-Password header from localStorage when present', async () => {
    localStorage.setItem('karaoke_auth_token', 'secret-passphrase-123');
    const mockResponse = new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await apiFetch('/api/test');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0];
    const headers = options?.headers as Headers;
    expect(headers.get('X-App-Password')).toBe('secret-passphrase-123');
    expect(options?.credentials).toBe('include');
  });

  it('preserves existing X-App-Password header if already supplied in options', async () => {
    localStorage.setItem('karaoke_auth_token', 'local-token');
    const mockResponse = new Response('{}', { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await apiFetch('/api/test', {
      headers: { 'X-App-Password': 'custom-override-token' },
    });

    const [, options] = fetchSpy.mock.calls[0];
    const headers = options?.headers as Headers;
    expect(headers.get('X-App-Password')).toBe('custom-override-token');
  });

  it('does not set X-App-Password if localStorage token is absent', async () => {
    const mockResponse = new Response('{}', { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);

    await apiFetch('/api/test');

    const [, options] = fetchSpy.mock.calls[0];
    const headers = options?.headers as Headers;
    expect(headers.get('X-App-Password')).toBeNull();
  });

  it('dispatches karaoke_unauthorized event on 401 response for non-status endpoints', async () => {
    const mockResponse = new Response('Unauthorized', { status: 401 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const res = await apiFetch('/api/project/123/mix');

    expect(res.status).toBe(401);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe('karaoke_unauthorized');
  });

  it('does not dispatch karaoke_unauthorized on 401 for /api/auth/status', async () => {
    const mockResponse = new Response('Unauthorized', { status: 401 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse);
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const res = await apiFetch('/api/auth/status');

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
});

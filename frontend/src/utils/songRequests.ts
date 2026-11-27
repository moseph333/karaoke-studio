/**
 * Song requests: the songs a show's host could not find, kept on the server for the owner
 * to make (`/api/show/requests`).
 *
 * A singer asks for a song; the host looks for a karaoke video of it and in the library
 * ("Add a singer" on the host screen) and, when neither has it, files a request: the words
 * typed, who asked and the name of the night. The studio's home screen lists the requests;
 * the owner finds the song there and makes it, or removes the request. A song asked for
 * again is one request counted again.
 */

import { apiFetch, readApiError } from '../api';

export const SONG_REQUEST_MAX = 120;

export interface SongRequest {
  id: string;
  /** The song as the host typed it. */
  song: string;
  /** The first few singers who asked for it. */
  singers: string[];
  /** The name of the night it was last asked at; empty when none was sent. */
  show: string;
  /** How many times it has been asked for. */
  count: number;
  /** When it was last asked for, in seconds since 1970. */
  requested_at: number;
}

export type SongRequestResult =
  { ok: true; requests: SongRequest[]; request?: SongRequest } | { ok: false; error: string };

/** Typed words as a request keeps them: one line, single spaces, cut to length. */
export function cleanSongRequest(words: string): string {
  return words.replace(/\s+/g, ' ').trim().slice(0, SONG_REQUEST_MAX).trim();
}

function asRequest(value: unknown): SongRequest | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.song !== 'string' || !raw.song.trim()) return null;
  return {
    id: raw.id,
    song: raw.song,
    singers: Array.isArray(raw.singers)
      ? raw.singers.filter((name): name is string => typeof name === 'string' && name !== '')
      : [],
    show: typeof raw.show === 'string' ? raw.show : '',
    count: typeof raw.count === 'number' && raw.count > 0 ? Math.round(raw.count) : 1,
    requested_at: typeof raw.requested_at === 'number' ? raw.requested_at : 0,
  };
}

/** The requests in a response's body, or null when it is not a list of them. */
export function parseSongRequests(body: unknown): SongRequest[] | null {
  const list = (body as { requests?: unknown } | null)?.requests;
  if (!Array.isArray(list)) return null;
  return list.map(asRequest).filter((request): request is SongRequest => request !== null);
}

function namesInWords(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Who asked for a song, how often and where, in one line; empty when nothing is known. */
export function songRequestNote(request: SongRequest): string {
  const parts: string[] = [];
  if (request.singers.length > 0) parts.push(`Asked for by ${namesInWords(request.singers)}`);
  if (request.count > 1) parts.push(`${request.count} times`);
  if (request.show) parts.push(request.show);
  return parts.join(' · ');
}

/** The request list, or null when the server did not give one. */
export async function fetchSongRequests(): Promise<SongRequest[] | null> {
  try {
    const response = await apiFetch('/api/show/requests');
    if (!response.ok) return null;
    return parseSongRequests(await response.json());
  } catch {
    return null;
  }
}

async function answer(response: Response, fallback: string): Promise<SongRequestResult> {
  if (!response.ok) return { ok: false, error: await readApiError(response, fallback) };
  const body: unknown = await response.json();
  const requests = parseSongRequests(body);
  if (!requests) return { ok: false, error: fallback };
  const request = asRequest((body as { request?: unknown } | null)?.request) ?? undefined;
  return { ok: true, requests, ...(request ? { request } : {}) };
}

const UNREACHABLE = 'Could not reach the server. Try again in a moment.';

/** Files a request for a song. */
export async function sendSongRequest(
  song: string,
  singer = '',
  show = ''
): Promise<SongRequestResult> {
  try {
    const response = await apiFetch('/api/show/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        song: cleanSongRequest(song),
        ...(singer ? { singer } : {}),
        ...(show ? { show } : {}),
      }),
    });
    return await answer(response, 'The request could not be saved.');
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

/** Takes a request off the list (the studio only: a show sign-in is refused). */
export async function removeSongRequest(id: string): Promise<SongRequestResult> {
  try {
    const response = await apiFetch(`/api/show/requests/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return await answer(response, 'The request could not be removed.');
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

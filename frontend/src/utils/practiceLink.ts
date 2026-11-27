/**
 * `/?project=…&practice=1` opens a song in practice: the address keeps the parameter while
 * practice is on, so a reload or a kept link comes back to it.
 */

export const PRACTICE_PARAM = 'practice';

export function opensPractice(search: string): boolean {
  return new URLSearchParams(search).has(PRACTICE_PARAM);
}

/** The current address with the parameter set or taken out. */
export function urlWithPractice(
  location: Pick<Location, 'pathname' | 'search' | 'hash'>,
  on: boolean
): string {
  const params = new URLSearchParams(location.search);
  if (on) params.set(PRACTICE_PARAM, '1');
  else params.delete(PRACTICE_PARAM);
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
}

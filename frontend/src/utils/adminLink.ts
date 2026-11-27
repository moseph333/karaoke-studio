/**
 * `/?admin=1` opens the Server settings page: a link the owner can keep. The parameter leaves
 * the address once the page has opened.
 *
 * Apart from utils/serverSettings so the first load reads the address without fetching the
 * list of settings, which belongs to the page's own chunk.
 */

export const ADMIN_PARAM = 'admin';

export function opensServerSettings(search: string): boolean {
  return new URLSearchParams(search).has(ADMIN_PARAM);
}

/** The current address without the parameter. */
export function urlWithoutAdminParam(location: Pick<Location, 'pathname' | 'search' | 'hash'>) {
  const params = new URLSearchParams(location.search);
  params.delete(ADMIN_PARAM);
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
}

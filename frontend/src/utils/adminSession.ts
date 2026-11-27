/**
 * The owner's admin token: what the Server settings page gets for the admin passphrase and
 * sends with its requests. Kept in this browser (for the token's seven days), apart from the
 * studio session, and only ever sent in a header.
 */

export const ADMIN_TOKEN_KEY = 'karaoke_admin_token';
export const ADMIN_TOKEN_HEADER = 'X-Admin-Token';

// Used only where the browser refuses storage (a private window): the unlock then lasts for
// this page
let memoryToken = '';

export function getAdminToken(): string {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY) ?? '';
  } catch {
    return memoryToken;
  }
}

export function setAdminToken(token: string): void {
  try {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    memoryToken = '';
  } catch {
    memoryToken = token;
  }
}

export function clearAdminToken(): void {
  memoryToken = '';
  try {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // Nothing was kept
  }
}

/** The header that carries the token, or none without one. */
export function adminHeaders(): Record<string, string> {
  const token = getAdminToken();
  return token ? { [ADMIN_TOKEN_HEADER]: token } : {};
}

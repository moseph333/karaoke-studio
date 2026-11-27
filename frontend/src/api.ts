/**
 * Consolidated API client and credential manager for Karaoke Studio.
 * Centralizes auth token and username retrieval, dual header injection
 * (X-App-Password and Authorization: Bearer), credentials inclusion,
 * and unified 401 Unauthorized event dispatch.
 */

export const AUTH_TOKEN_KEY = 'karaoke_auth_token';
export const AUTH_USER_KEY = 'karaoke_user_name';
export const AUTH_UNAUTHORIZED_EVENT = 'karaoke_unauthorized';

// In-memory fallback if localStorage is unavailable (e.g. sandboxed iframes)
let memoryToken: string | null = null;
let memoryUser: string | null = null;

/**
 * Retrieve current studio authentication token from storage or memory.
 */
export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

/**
 * Save studio authentication token to storage and memory.
 */
export function setAuthToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // Retain memoryToken
  }
}

/**
 * Clear stored authentication token.
 */
export function clearAuthToken(): void {
  setAuthToken(null);
}

// --- A show-only sign-in ------------------------------------------------------------------
// A venue's host signs in with the server's show passphrase, which only runs a show
// (`/?show=1`): the token it is traded for goes in `X-Show-Token`, never in the studio's
// headers, where the server would count it as a wrong studio passphrase.

export const SHOW_TOKEN_KEY = 'karaoke_show_token';
let memoryShowToken: string | null = null;

export function getShowToken(): string | null {
  try {
    return localStorage.getItem(SHOW_TOKEN_KEY) ?? memoryShowToken;
  } catch {
    return memoryShowToken;
  }
}

export function setShowToken(token: string | null): void {
  memoryShowToken = token;
  try {
    if (token) localStorage.setItem(SHOW_TOKEN_KEY, token);
    else localStorage.removeItem(SHOW_TOKEN_KEY);
  } catch {
    // Kept in memory
  }
}

/**
 * Retrieve current user nickname from storage or memory.
 */
export function getAuthUser(): string {
  try {
    return localStorage.getItem(AUTH_USER_KEY) ?? memoryUser ?? 'Friend';
  } catch {
    return memoryUser ?? 'Friend';
  }
}

/**
 * Save user nickname to storage and memory.
 */
export function setAuthUser(username: string): void {
  memoryUser = username;
  try {
    localStorage.setItem(AUTH_USER_KEY, username);
  } catch {
    // Retain memoryUser
  }
}

/**
 * Clear all authentication and user identity state.
 */
export function clearAuth(): void {
  clearAuthToken();
  memoryUser = null;
  try {
    localStorage.removeItem(AUTH_USER_KEY);
  } catch {
    // Retain clean state
  }
}

// Pydantic's prefix on a message a validator wrote for people ("That is a Bandcamp album…")
const VALIDATOR_MESSAGE = /^Value error, /;

/**
 * A readable message from a FastAPI error `detail`: a string for HTTP errors, a list of
 * `{loc, msg}` for validation errors (422), which used to surface as "[object Object]".
 * A message one of the server's own validators wrote is shown as written, without the
 * field name or Pydantic's "Value error, " prefix.
 */
export function formatApiDetail(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      const { loc, msg } = (item ?? {}) as { loc?: unknown; msg?: unknown };
      if (typeof msg !== 'string' || !msg) return [];
      if (VALIDATOR_MESSAGE.test(msg)) return [msg.replace(VALIDATOR_MESSAGE, '')];
      const field = Array.isArray(loc)
        ? loc.filter((part) => part !== 'body' && part !== 'query').join('.')
        : '';
      return [field ? `${field}: ${msg}` : msg];
    });
    if (messages.length > 0) return messages.join('; ');
  }
  return fallback;
}

/** The error message for a failed response: its JSON `detail` when it has one. */
export async function readApiError(res: Pick<Response, 'json'>, fallback: string): Promise<string> {
  try {
    const data: unknown = await res.json();
    return formatApiDetail((data as { detail?: unknown } | null)?.detail, fallback);
  } catch {
    return fallback;
  }
}

/**
 * Centralized fetch wrapper attaching credentials and handling 401 interception.
 */
export async function apiFetch(url: string | URL, options: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});

  // Inject authentication headers if token exists and not already provided
  if (token) {
    if (!headers.has('X-App-Password')) {
      headers.set('X-App-Password', token);
    }
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  const showToken = getShowToken();
  if (showToken && !headers.has('X-Show-Token')) headers.set('X-Show-Token', showToken);

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: options.credentials ?? 'include',
  });

  const urlString = typeof url === 'string' ? url : url.toString();
  const isAuthExempt =
    urlString.includes('/api/auth/status') ||
    urlString.includes('/api/auth/login') ||
    urlString.includes('/api/auth/show-login');

  if (res.status === 401 && !isAuthExempt) {
    clearAuthToken();
    setShowToken(null);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
    }
  }

  return res;
}

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

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: options.credentials ?? 'include',
  });

  const urlString = typeof url === 'string' ? url : url.toString();
  const isAuthExempt =
    urlString.includes('/api/auth/status') || urlString.includes('/api/auth/login');

  if (res.status === 401 && !isAuthExempt) {
    clearAuthToken();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
    }
  }

  return res;
}

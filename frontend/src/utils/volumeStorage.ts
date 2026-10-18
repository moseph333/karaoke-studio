/**
 * Volume Storage Utilities
 *
 * LocalStorage persistence helpers for master volume level and mute state.
 * Includes defensive fallback handling for environments where localStorage is restricted.
 */

export const MASTER_VOLUME_STORAGE_KEY = 'karaoke_master_volume';
export const MASTER_MUTED_STORAGE_KEY = 'karaoke_master_muted';

export function getStoredMasterVolume(fallback = 1.0): number {
  try {
    const raw = localStorage.getItem(MASTER_VOLUME_STORAGE_KEY);
    if (raw !== null) {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        return parsed;
      }
    }
  } catch {
    // Storage access restricted
  }
  return fallback;
}

export function setStoredMasterVolume(volume: number): void {
  try {
    localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, volume.toString());
  } catch {
    // Storage access restricted
  }
}

export function getStoredMasterMuted(fallback = false): boolean {
  try {
    const raw = localStorage.getItem(MASTER_MUTED_STORAGE_KEY);
    if (raw !== null) {
      return raw === 'true';
    }
  } catch {
    // Storage access restricted
  }
  return fallback;
}

export function setStoredMasterMuted(isMuted: boolean): void {
  try {
    localStorage.setItem(MASTER_MUTED_STORAGE_KEY, isMuted ? 'true' : 'false');
  } catch {
    // Storage access restricted
  }
}

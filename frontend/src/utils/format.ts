/**
 * Shared display formatters for times, keys and playback rates.
 */

/** Formats seconds as m:ss (or h:mm:ss beyond one hour). Invalid input renders 0:00. */
export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = s.toString().padStart(2, '0');
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

/** Formats a job timer (elapsed, remaining) as m:ss, or "--:--" when it is unknown. */
export function formatTimer(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || seconds < 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** How long ago a background job last reported: "Pulse just now", "Pulse 12s ago". */
export function formatHeartbeat(lastHeartbeat: number | undefined, now: number): string {
  if (!lastHeartbeat) return 'Active';
  const diffSec = Math.max(0, Math.round((now - lastHeartbeat) / 1000));
  return diffSec < 2 ? 'Pulse just now' : `Pulse ${diffSec}s ago`;
}

/** Formats a semitone offset: 0 → "Original key", +2 → "+2 st", -3 → "−3 st". */
export function formatSemitones(semitones: number, originalLabel = 'Original key'): string {
  if (!Number.isFinite(semitones) || semitones === 0) return originalLabel;
  return semitones > 0 ? `+${semitones} st` : `−${Math.abs(semitones)} st`;
}

/** Compact semitone badge: 0 → "0", 2 → "+2", -1 → "−1". */
export function formatSemitonesShort(semitones: number): string {
  if (!Number.isFinite(semitones) || semitones === 0) return '0';
  return semitones > 0 ? `+${semitones}` : `−${Math.abs(semitones)}`;
}

/** Formats a playback rate: 1 → "1.0x", 0.75 → "0.75x". */
export function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '1.0x';
  return Number.isInteger(rate) ? `${rate.toFixed(1)}x` : `${rate}x`;
}

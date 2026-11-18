/**
 * Size limits of the studio's uploads, from the JSON the server enforces them with
 * (`backend/assets/shared/upload_limits.json`). Checking here refuses an oversized file
 * before any of it is sent; the server still has the last word.
 */

import uploadLimits from '@shared/upload_limits.json';

const MB = 1024 * 1024;

/** True for a background video (MP4 or WebM), which has a higher limit than an image. */
export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|webm)$/i.test(file.name);
}

function tooLarge(file: File, limitMb: number, what: string): string | null {
  return file.size > limitMb * MB
    ? `${what} exceeds ${limitMb}MB limit. Please choose a smaller file.`
    : null;
}

/** Why a replacement instrumental is too large to upload, or null when it fits. */
export function instrumentalTooLarge(file: File): string | null {
  return tooLarge(file, uploadLimits.instrumental_mb, 'Instrumental file');
}

/** Why a stage background is too large to upload, or null when it fits. */
export function backgroundTooLarge(file: File): string | null {
  return isVideoFile(file)
    ? tooLarge(file, uploadLimits.background_video_mb, 'Background video')
    : tooLarge(file, uploadLimits.background_image_mb, 'Background image');
}

/**
 * Audio Error Parsing Utilities
 *
 * Provides standardized error code decoding and actionable error messages
 * for HTMLMediaElement playback failures across browsers.
 */

export interface AudioPlaybackError {
  code: number;
  codeName:
    | 'MEDIA_ERR_ABORTED'
    | 'MEDIA_ERR_NETWORK'
    | 'MEDIA_ERR_DECODE'
    | 'MEDIA_ERR_SRC_NOT_SUPPORTED'
    | 'MEDIA_ERR_UNKNOWN';
  message: string;
  timestamp: number;
}

export function parseMediaError(error: MediaError | null): AudioPlaybackError {
  if (!error) {
    return {
      code: 0,
      codeName: 'MEDIA_ERR_UNKNOWN',
      message: 'An unknown audio playback error occurred.',
      timestamp: Date.now(),
    };
  }

  switch (error.code) {
    case 1:
      return {
        code: 1,
        codeName: 'MEDIA_ERR_ABORTED',
        message: 'Audio playback was aborted. Click Retry to reload the track.',
        timestamp: Date.now(),
      };
    case 2:
      return {
        code: 2,
        codeName: 'MEDIA_ERR_NETWORK',
        message: 'Network error loading audio stream. Please check server connectivity.',
        timestamp: Date.now(),
      };
    case 3:
      return {
        code: 3,
        codeName: 'MEDIA_ERR_DECODE',
        message: 'Audio decoding failed. The audio stream may be corrupt or incomplete.',
        timestamp: Date.now(),
      };
    case 4:
      return {
        code: 4,
        codeName: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
        message: 'Audio format not supported or file not found on server.',
        timestamp: Date.now(),
      };
    default:
      return {
        code: error.code,
        codeName: 'MEDIA_ERR_UNKNOWN',
        message: error.message || 'An unexpected audio playback error occurred.',
        timestamp: Date.now(),
      };
  }
}

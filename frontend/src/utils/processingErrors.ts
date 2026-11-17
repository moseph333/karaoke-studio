/**
 * Plain words for a song that failed to process. The server reports the error as the failing
 * step raised it (yt-dlp for YouTube, SoundCloud, Bandcamp, Vimeo and Internet Archive links,
 * FFmpeg, the separation engine); this maps the common ones to what
 * happened and what to try, and anything else to a general answer. The raw message stays
 * available on the failure screen under "Technical details".
 */

import type { ProjectState } from '../types';

export interface ErrorExplanation {
  /** What happened, in one sentence. */
  summary: string;
  /** What to try next. */
  advice: string;
}

const OWN_FILE = 'download the audio yourself and add it under Local Audio File';

// The first rule that matches wins, so the specific reasons come before the general ones
// ("Video unavailable. This video is private" is a private video, not a removed one)
const RULES: { test: RegExp; summary: string; advice: string }[] = [
  {
    test: /interrupted by a server restart/i,
    summary: 'The server restarted while this song was being made.',
    advice: 'Nothing is wrong with the song. Try again.',
  },
  {
    // An Internet Archive item of a whole album or concert
    test: /holds \d+ recordings/i,
    summary: 'This link holds several recordings, such as a whole album.',
    advice: 'Open the one song you want on that site and paste its link.',
  },
  {
    test: /\bprivate\b/i,
    summary: 'This video is private, so the server cannot download it.',
    advice: `Pick another upload of the song, or ${OWN_FILE}.`,
  },
  {
    test: /age[- ]restrict|confirm your age|sign in to confirm|not a bot|log ?in required/i,
    summary:
      'YouTube asked for a sign-in before handing over this video (an age limit or a bot check).',
    advice: `Try again in a while, pick another upload of the song, or ${OWN_FILE}.`,
  },
  {
    // Vimeo, for most videos, and password-protected uploads on any site
    test: /logged[- ]in|--cookies|protected by a password|--video-password/i,
    summary: 'The site asked for a sign-in or a password before handing over this song.',
    advice: `Many Vimeo videos need one. Pick another copy of the song (YouTube, SoundCloud or Bandcamp), or ${OWN_FILE}.`,
  },
  {
    test: /\b(in|from) your (country|region)\b|geo[- ]?(restrict|block)/i,
    summary: 'This song is blocked in the region the server is in.',
    advice: `Pick another upload of the song, or ${OWN_FILE}.`,
  },
  {
    test: /video unavailable|has been removed|no longer available|does not exist|account.{0,20}terminated|http error 404/i,
    summary: 'This song is no longer available at that link.',
    advice: `Pick another upload of the song, or ${OWN_FILE}.`,
  },
  {
    test: /no space left|disk (is )?(almost )?full|not enough (free )?(disk )?space/i,
    summary: 'The server ran out of disk space.',
    advice: 'Delete songs you no longer need from the library, then try again.',
  },
  {
    test: /no separation engine|stem separation|\bdemucs\b|roformer|separation (timed out|stalled|failed)|out of memory|\bcuda\b/i,
    summary: 'Separating the vocals from the music failed.',
    advice:
      'Try again. If it keeps failing, add the song again with Fast picked under Advanced options.',
  },
  {
    test: /timed? ?out|connection|network|temporar|too many requests|http error (429|5\d\d)|unable to download|name resolution/i,
    summary: 'The download did not get through.',
    advice: 'This is usually temporary. Try again in a minute.',
  },
  {
    test: /ffmpeg|could not (read|decode)|invalid data|unsupported|not found or empty/i,
    summary: 'The audio could not be read.',
    advice: 'Try another upload of the song, or another audio file (MP3, WAV, FLAC or M4A).',
  },
];

const UNKNOWN: ErrorExplanation = {
  summary: 'Something went wrong while making this song.',
  advice: `Try again. If it fails the same way, pick another upload of the song or ${OWN_FILE}.`,
};

export function explainProcessingError(error?: string | null): ErrorExplanation {
  const text = error ?? '';
  const rule = RULES.find((r) => r.test.test(text));
  return rule ? { summary: rule.summary, advice: rule.advice } : UNKNOWN;
}

/** Songs made from an uploaded file: the server can start a linked song again, but an upload
 * has to be sent again. */
export function isUploadedSong(project: Pick<ProjectState, 'id'>): boolean {
  return project.id.startsWith('local_');
}

/** What "Try again" sends to start a linked song again: its link, kept from the start, else
 * its YouTube video id (songs from before links were kept). Another site's track id cannot
 * be downloaded from, so it is never sent. */
export function retryInput(project: Pick<ProjectState, 'id' | 'track_id' | 'url'>): string {
  return project.url || project.track_id || project.id;
}

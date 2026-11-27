/**
 * How long a song's title and artist, a singer's name and pasted lyrics may be, in
 * characters, from the JSON the server refuses longer text with
 * (`backend/assets/shared/text_limits.json`). A field that stops at its limit never sends
 * text the server answers 422 to.
 */

import textLimits from '@shared/text_limits.json';

export const TEXT_LIMITS: Readonly<{
  title: number;
  artist: number;
  singer: number;
  lyrics: number;
}> = textLimits;

/** True when lyrics fill their field, where a paste may have been cut short. */
export function lyricsAtLimit(text: string): boolean {
  return text.length >= TEXT_LIMITS.lyrics;
}

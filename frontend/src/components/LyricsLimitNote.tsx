/**
 * Says that pasted lyrics filled their field. The field stops at the server's limit, and a
 * paste that runs past it is cut there without a word from the browser.
 */

import React from 'react';
import { TEXT_LIMITS, lyricsAtLimit } from '../utils/textLimits';

export const LyricsLimitNote: React.FC<{ text: string }> = ({ text }) =>
  lyricsAtLimit(text) ? (
    <p role="status" className="text-sm text-theme-warning">
      Lyrics stop at {TEXT_LIMITS.lyrics.toLocaleString('en-US')} characters. Anything pasted after
      that was left out.
    </p>
  ) : null;

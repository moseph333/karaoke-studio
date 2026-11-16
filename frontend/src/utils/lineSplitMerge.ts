/**
 * Splitting a lyric line in two and merging two lines into one, keeping every word's timing.
 * Both return the whole list numbered again from 1 (as inserting and deleting lines do), or
 * null when the edit does not apply.
 */

import type { LyricLine } from '../types';
import { joinLyricTokens, needsSpace } from './lyrics';

const renumber = (lines: LyricLine[]) => lines.map((l, idx) => ({ ...l, id: idx + 1 }));

/** Without the server's marks that no longer hold once a line is reshaped by hand. */
function reshaped(line: LyricLine): LyricLine {
  const { romaji: _romaji, added: _added, confidence: _confidence, ...rest } = line;
  return rest;
}

/** The line split after its word `wordIndex`: the first part ends with that word, the second
 * starts with the next. Needs a word on each side. */
export function splitLineAfterWord(
  lines: LyricLine[],
  lineId: number,
  wordIndex: number
): LyricLine[] | null {
  const at = lines.findIndex((l) => l.id === lineId);
  const line = lines[at];
  if (!line || wordIndex < 0 || wordIndex >= (line.words?.length ?? 0) - 1) return null;
  const head = line.words.slice(0, wordIndex + 1);
  const tail = line.words.slice(wordIndex + 1);
  const tokens = line.words.map((w) => w.word);
  const written = joinLyricTokens(tokens, line.text);
  // The second part's text starts where its first word does in the written line
  const headText = joinLyricTokens(
    head.map((w) => w.word),
    written
  );
  const tailText = joinLyricTokens(
    tail.map((w) => w.word),
    written.slice(headText.length)
  );
  const first: LyricLine = {
    ...reshaped(line),
    text: headText,
    words: head,
    end_time: head[head.length - 1].end_time,
  };
  const second: LyricLine = {
    ...reshaped(line),
    text: tailText,
    words: tail,
    start_time: tail[0].start_time,
  };
  return renumber([...lines.slice(0, at), first, second, ...lines.slice(at + 1)]);
}

/** The line joined with the one after it: its words, then the next line's, spanning both.
 * The first line's singer part is kept. */
export function mergeLineWithNext(lines: LyricLine[], lineId: number): LyricLine[] | null {
  const at = lines.findIndex((l) => l.id === lineId);
  const line = lines[at];
  const next = lines[at + 1];
  if (!line || !next) return null;
  const lastWord = line.words[line.words.length - 1]?.word ?? line.text.slice(-1);
  const firstWord = next.words[0]?.word ?? next.text.slice(0, 1);
  const gap = line.text && next.text && needsSpace(lastWord, firstWord) ? ' ' : '';
  const merged: LyricLine = {
    ...reshaped(line),
    text: `${line.text}${gap}${next.text}`,
    words: [...line.words, ...next.words],
    start_time: Math.min(line.start_time, next.start_time),
    end_time: Math.max(line.end_time, next.end_time),
  };
  return renumber([...lines.slice(0, at), merged, ...lines.slice(at + 2)]);
}

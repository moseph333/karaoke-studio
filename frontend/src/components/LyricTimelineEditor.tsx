import React, { useState } from 'react';
import { LyricLine, WordTiming } from '../types';
import { Clock, Play, Edit3, Check, ChevronRight, FastForward, Rewind, Sparkles } from 'lucide-react';

interface LyricTimelineEditorProps {
  lines: LyricLine[];
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  onSaveLines: (updatedLines: LyricLine[]) => void;
  albumArtUrl?: string;
  themeSungColor?: string;
  themeUnsungColor?: string;
}

export const LyricTimelineEditor: React.FC<LyricTimelineEditorProps> = ({
  lines,
  currentTime,
  onSeek,
  onSaveLines,
  albumArtUrl,
  themeSungColor = '#facc15',
  themeUnsungColor = '#ffffff',
}) => {
  const [editableLines, setEditableLines] = useState<LyricLine[]>(lines);
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync if prop lines change and no local edits
  React.useEffect(() => {
    setEditableLines(lines);
    setHasChanges(false);
  }, [lines]);

  // Find currently active line and next line
  const activeLineIndex = editableLines.findIndex(
    (l) => currentTime >= l.start_time - 1.5 && currentTime <= l.end_time + 1.0
  );
  
  const currentLine = activeLineIndex >= 0 ? editableLines[activeLineIndex] : null;
  const nextLine = activeLineIndex >= 0 && activeLineIndex + 1 < editableLines.length
    ? editableLines[activeLineIndex + 1]
    : (!currentLine && editableLines.length > 0 ? editableLines[0] : null);

  // Handle nudging an entire line by offset seconds
  const nudgeLine = (lineId: number, offset: number) => {
    const updated = editableLines.map((l) => {
      if (l.id !== lineId) return l;
      const newStart = Math.max(0, parseFloat((l.start_time + offset).toFixed(3)));
      const newEnd = Math.max(newStart + 0.5, parseFloat((l.end_time + offset).toFixed(3)));
      const newWords = l.words.map((w) => ({
        ...w,
        start_time: Math.max(0, parseFloat((w.start_time + offset).toFixed(3))),
        end_time: Math.max(0.1, parseFloat((w.end_time + offset).toFixed(3))),
      }));
      return { ...l, start_time: newStart, end_time: newEnd, words: newWords };
    });
    setEditableLines(updated);
    setHasChanges(true);
  };

  // Handle editing a single word timing
  const updateWordTiming = (lineId: number, wordIndex: number, field: 'start_time' | 'end_time', value: number) => {
    const updated = editableLines.map((l) => {
      if (l.id !== lineId) return l;
      const words = [...l.words];
      words[wordIndex] = { ...words[wordIndex], [field]: Math.max(0, parseFloat(value.toFixed(3))) };
      
      // Update line boundaries to encompass all words
      const lineStart = Math.min(...words.map(w => w.start_time));
      const lineEnd = Math.max(...words.map(w => w.end_time));
      return { ...l, start_time: lineStart, end_time: lineEnd, words };
    });
    setEditableLines(updated);
    setHasChanges(true);
  };

  const handleSave = () => {
    onSaveLines(editableLines);
    setHasChanges(false);
  };

  // Helper for word sweep calculation
  const getWordProgress = (word: WordTiming) => {
    if (currentTime < word.start_time) return 0;
    if (currentTime > word.end_time) return 100;
    const dur = word.end_time - word.start_time;
    if (dur <= 0) return 100;
    return Math.min(100, Math.max(0, ((currentTime - word.start_time) / dur) * 100));
  };

  // Countdown cue calculation
  const showCountdown = currentLine && (currentLine.start_time - currentTime) > 0 && (currentLine.start_time - currentTime) <= 3.0;
  const countdownSeconds = showCountdown ? Math.ceil(currentLine!.start_time - currentTime) : 0;

  return (
    <div className="space-y-6">
      {/* 1. Live Karaoke Stage Preview */}
      <div className="relative aspect-video w-full rounded-2xl overflow-hidden shadow-2xl border border-slate-800 bg-slate-950 flex flex-col justify-end p-8 select-none">
        {/* Dynamic blurred album background */}
        {albumArtUrl && (
          <div
            className="absolute inset-0 bg-cover bg-center filter blur-3xl opacity-35 scale-110 pointer-events-none transition-all duration-700"
            style={{ backgroundImage: `url(${albumArtUrl})` }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent pointer-events-none" />

        {/* Live Badge */}
        <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/80 border border-slate-700/60 backdrop-blur text-xs font-medium text-slate-300">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
          Live Visual Preview
        </div>

        {/* Countdown Cue Display */}
        {showCountdown && (
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 flex items-center gap-3 text-cyan-400 font-extrabold text-3xl font-['Montserrat'] animate-bounce">
            <span className={countdownSeconds >= 3 ? 'text-yellow-400 scale-125' : 'text-slate-600'}>●</span>
            <span className={countdownSeconds >= 2 ? 'text-yellow-400 scale-125' : 'text-slate-600'}>●</span>
            <span className={countdownSeconds >= 1 ? 'text-yellow-400 scale-125' : 'text-slate-600'}>●</span>
          </div>
        )}

        {/* Current & Upcoming Lyrics Lines */}
        <div className="relative z-10 space-y-4 text-center max-w-4xl mx-auto w-full">
          {/* Active Line (Line 1) */}
          <div className="min-h-[5rem] flex items-center justify-center">
            {currentLine ? (
              <div className="text-3xl md:text-5xl font-extrabold font-['Montserrat'] tracking-tight flex flex-wrap justify-center gap-x-3 gap-y-1">
                {currentLine.words.map((w, idx) => {
                  const progress = getWordProgress(w);
                  return (
                    <span
                      key={idx}
                      onClick={() => onSeek(w.start_time)}
                      className="relative cursor-pointer transition-transform hover:scale-105"
                      title={`${w.word} (${w.start_time.toFixed(2)}s - ${w.end_time.toFixed(2)}s)`}
                    >
                      {/* Unsung text */}
                      <span style={{ color: themeUnsungColor }} className="drop-shadow-md">
                        {w.word}
                      </span>
                      {/* Progressive Sung overlay clip */}
                      <span
                        className="absolute inset-0 overflow-hidden whitespace-nowrap drop-shadow-[0_0_12px_rgba(250,204,21,0.6)]"
                        style={{
                          width: `${progress}%`,
                          color: themeSungColor,
                          transition: progress > 0 && progress < 100 ? 'width 60ms linear' : 'none',
                        }}
                      >
                        {w.word}
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-xl text-slate-500 font-medium italic">
                {currentTime < (editableLines[0]?.start_time || 0) ? '♪ Instrumental Intro ♪' : '♪ Instrumental Break ♪'}
              </p>
            )}
          </div>

          {/* Upcoming Line (Line 2) */}
          <div className="min-h-[2.5rem] flex items-center justify-center">
            {nextLine ? (
              <p className="text-xl md:text-2xl font-bold font-['Montserrat'] text-slate-400/80 drop-shadow">
                {nextLine.text}
              </p>
            ) : (
              <span className="text-sm text-slate-600">-- End of song --</span>
            )}
          </div>
        </div>
      </div>

      {/* 2. Visual Timeline & Precision Word Editor */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-cyan-400" />
              Word-by-Word Timeline Editor
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Click any line to jump audio. Nudge words or lines to fine-tune sync with the beat.
            </p>
          </div>
          {hasChanges && (
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 transition-all animate-pulse"
            >
              <Check className="w-4 h-4" />
              Save Timing Changes
            </button>
          )}
        </div>

        {/* Scrollable list of lines */}
        <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
          {editableLines.map((line) => {
            const isCurrentlyActive = currentLine?.id === line.id;
            const isExpanded = selectedLineId === line.id;

            return (
              <div
                key={line.id}
                className={`p-3 rounded-xl border transition-all ${
                  isCurrentlyActive
                    ? 'bg-cyan-950/40 border-cyan-500/70 shadow-md'
                    : 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div
                    onClick={() => {
                      onSeek(line.start_time);
                      setSelectedLineId(isExpanded ? null : line.id);
                    }}
                    className="flex items-center gap-3 cursor-pointer flex-1 overflow-hidden"
                  >
                    <span className="font-mono text-xs text-slate-400 bg-slate-900 px-2 py-1 rounded">
                      {line.start_time.toFixed(1)}s - {line.end_time.toFixed(1)}s
                    </span>
                    <span
                      className={`text-sm font-semibold truncate ${
                        isCurrentlyActive ? 'text-cyan-300 font-bold' : 'text-slate-200'
                      }`}
                    >
                      {line.text}
                    </span>
                  </div>

                  {/* Nudge & Expand Controls */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => nudgeLine(line.id, -0.2)}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                      title="Nudge 0.2s earlier"
                    >
                      <Rewind className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => nudgeLine(line.id, 0.2)}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                      title="Nudge 0.2s later"
                    >
                      <FastForward className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedLineId(isExpanded ? null : line.id)}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
                      title="Expand word timings"
                    >
                      <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* Expanded Word-Level Timing Inputs */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {line.words.map((w, wIdx) => (
                      <div
                        key={wIdx}
                        className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs"
                      >
                        <span
                          onClick={() => onSeek(w.start_time)}
                          className="font-bold text-white cursor-pointer hover:text-cyan-400 mr-2"
                        >
                          {w.word}
                        </span>
                        <div className="flex items-center gap-1 font-mono text-[11px]">
                          <input
                            type="number"
                            step="0.05"
                            value={w.start_time}
                            onChange={(e) => updateWordTiming(line.id, wIdx, 'start_time', parseFloat(e.target.value))}
                            className="w-14 p-1 rounded bg-slate-950 border border-slate-700 text-center text-slate-200"
                          />
                          <span className="text-slate-500">-</span>
                          <input
                            type="number"
                            step="0.05"
                            value={w.end_time}
                            onChange={(e) => updateWordTiming(line.id, wIdx, 'end_time', parseFloat(e.target.value))}
                            className="w-14 p-1 rounded bg-slate-950 border border-slate-700 text-center text-slate-200"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

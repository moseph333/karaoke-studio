/**
 * Interactive Waveform Scrubber Component
 *
 * Dual-mode audio energy visualization (instant envelope from vocal activity + Web Audio peaks),
 * progress tracking playhead, click-and-drag scrubbing, and internal accessible range slider.
 */

import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Tooltip } from '../Tooltip';

export interface LyricLine {
  start?: number;
  end?: number;
  words?: Array<{ start?: number; end?: number; text?: string }>;
  [key: string]: unknown;
}

export interface WaveformScrubberProps {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  audioUrl?: string;
  lines?: LyricLine[];
  isPlaying?: boolean;
  className?: string;
}

const BAR_COUNT = 100;

export const WaveformScrubber: React.FC<WaveformScrubberProps> = ({
  currentTime,
  duration,
  onSeek,
  audioUrl,
  lines,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [decodedPeaks, setDecodedPeaks] = useState<number[] | null>(null);

  // Mode A: Instant deterministic energy envelope (0ms, no network, runs everywhere)
  const fallbackBars = useMemo(() => {
    const bars: number[] = [];
    const totalDuration = duration > 0 ? duration : 100;

    for (let i = 0; i < BAR_COUNT; i++) {
      const centerTime = ((i + 0.5) / BAR_COUNT) * totalDuration;
      const windowWidth = totalDuration / BAR_COUNT;

      // Check vocal line activity
      const hasVocal = lines?.some(
        (l) =>
          (l.start ?? 0) <= centerTime + windowWidth && (l.end ?? 0) >= centerTime - windowWidth
      );

      const baseEnergy = hasVocal ? 0.72 : 0.24;
      // Deterministic harmonics to create natural waveform peaks and valleys
      const harmonic = 0.18 * Math.sin(i * 0.42) + 0.08 * Math.cos(i * 0.85);
      const height = Math.min(1.0, Math.max(0.12, baseEnergy + harmonic));
      bars.push(height);
    }
    return bars;
  }, [duration, lines]);

  // Mode B: Web Audio API peak extraction if AudioContext is available
  useEffect(() => {
    const targetUrl = audioUrl;
    if (!targetUrl || typeof window === 'undefined') return;
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    let isCancelled = false;
    const abortController = new AbortController();

    async function extractPeaks() {
      if (!targetUrl) return;
      try {
        const response = await fetch(targetUrl, {
          signal: abortController.signal,
          credentials: 'same-origin',
        });
        if (!response.ok) return;
        const arrayBuffer = await response.arrayBuffer();
        if (isCancelled) return;

        const audioCtx = new AudioContextClass();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        if (isCancelled) {
          audioCtx.close().catch(() => {});
          return;
        }

        const channelData = audioBuffer.getChannelData(0);
        const step = Math.floor(channelData.length / BAR_COUNT);
        const peaks: number[] = [];

        for (let i = 0; i < BAR_COUNT; i++) {
          const start = i * step;
          const end = Math.min(start + step, channelData.length);
          let sum = 0;
          for (let j = start; j < end; j++) {
            sum += Math.abs(channelData[j]);
          }
          const avg = end > start ? sum / (end - start) : 0;
          peaks.push(Math.min(1.0, Math.max(0.12, avg * 3.5)));
        }

        if (!isCancelled) {
          setDecodedPeaks(peaks);
        }
        audioCtx.close().catch(() => {});
      } catch {
        // Fallback gracefully to Mode A
      }
    }

    extractPeaks();

    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [audioUrl]);

  const bars = decodedPeaks || fallbackBars;
  const progressPercent =
    duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const seekFromClientX = useCallback(
    (clientX: number) => {
      if (!containerRef.current || duration <= 0 || isNaN(clientX)) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (!rect || !rect.width || isNaN(rect.width)) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      if (!isNaN(ratio)) {
        onSeek(ratio * duration);
      }
    },
    [duration, onSeek]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Avoid re-capturing if triggered directly by the input
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_err) {
      void _err;
    }
    setIsDragging(true);
    const clientX = e.clientX ?? (e.nativeEvent as unknown as MouseEvent)?.clientX;
    if (clientX !== undefined && !isNaN(clientX)) {
      seekFromClientX(clientX);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      const clientX = e.clientX ?? (e.nativeEvent as unknown as MouseEvent)?.clientX;
      if (clientX !== undefined && !isNaN(clientX)) {
        seekFromClientX(clientX);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (_err) {
        void _err;
      }
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`relative flex flex-col gap-1.5 select-none ${className}`}>
      <div
        ref={containerRef}
        data-testid="waveform-scrubber"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative h-14 w-full bg-slate-950/80 border border-slate-800/90 rounded-xl overflow-hidden cursor-pointer flex items-end px-1 gap-[2px] group"
      >
        {/* Waveform Bars */}
        {bars.map((height, i) => {
          const barPercent = ((i + 0.5) / bars.length) * 100;
          const isPlayed = barPercent <= progressPercent;
          return (
            <div
              key={i}
              data-testid="waveform-bar"
              className={`flex-1 rounded-full transition-colors duration-75 ${
                isPlayed
                  ? 'bg-gradient-to-t from-cyan-500 to-blue-400'
                  : 'bg-slate-700/60 group-hover:bg-slate-600/70'
              }`}
              style={{ height: `${Math.max(12, Math.round(height * 100))}%` }}
            />
          );
        })}

        {/* Playhead Progress Needle */}
        <div
          data-testid="waveform-playhead"
          className="absolute top-0 bottom-0 w-0.5 bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.9)] pointer-events-none z-10"
          style={{ left: `${progressPercent}%` }}
        />

        {/* Accessible Range Input Overlay (Preserves Keyboard Navigation & A11y Tests) */}
        <Tooltip
          content="Scrub audio timeline (±5s seek)"
          hotkey={['←', '→']}
          position="top"
          className="w-full absolute inset-0 opacity-0 cursor-pointer"
        >
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            aria-label="Audio timeline position"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration) || 100}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
            className="w-full h-full opacity-0 cursor-pointer z-20 touch-none py-2"
          />
        </Tooltip>
      </div>
    </div>
  );
};

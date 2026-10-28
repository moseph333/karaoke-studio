/**
 * Interactive Waveform Scrubber Component
 *
 * Dual-mode audio energy visualization (instant envelope from vocal activity + Web Audio peaks),
 * progress tracking playhead, click-and-drag scrubbing, and internal accessible range slider.
 */

import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Tooltip } from '../Tooltip';

export interface LyricLine {
  id?: number;
  text?: string;
  start?: number;
  end?: number;
  start_time?: number;
  end_time?: number;
  words?: Array<{
    start?: number;
    end?: number;
    start_time?: number;
    end_time?: number;
    text?: string;
    word?: string;
  }>;
}

export interface WaveformScrubberProps {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  audioUrl?: string;
  lines?: LyricLine[];
  isPlaying?: boolean;
  className?: string;
  /** Pre-computed normalized peaks (0-1); skips client-side decoding when provided. */
  peaks?: number[] | null;
  /** Render lyric line start markers along the track. */
  showMarkers?: boolean;
}

const BAR_COUNT = 100;

export const WaveformScrubber: React.FC<WaveformScrubberProps> = ({
  currentTime,
  duration,
  onSeek,
  audioUrl,
  lines,
  className = '',
  peaks,
  showMarkers = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [decodedPeaks, setDecodedPeaks] = useState<number[] | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);

  // Mode A: Instant deterministic energy envelope (0ms, no network, runs everywhere)
  const fallbackBars = useMemo(() => {
    const bars: number[] = [];
    const totalDuration = Number.isFinite(duration) && duration > 0 ? duration : 100;

    for (let i = 0; i < BAR_COUNT; i++) {
      const centerTime = ((i + 0.5) / BAR_COUNT) * totalDuration;
      const windowWidth = totalDuration / BAR_COUNT;

      // Check vocal line activity
      const hasVocal = lines?.some((l) => {
        const lStart = (typeof l.start_time === 'number' ? l.start_time : l.start) ?? 0;
        const lEnd = (typeof l.end_time === 'number' ? l.end_time : l.end) ?? 0;
        return lStart <= centerTime + windowWidth && lEnd >= centerTime - windowWidth;
      });

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
    if (peaks && peaks.length > 0) return;
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
  }, [audioUrl, peaks]);

  const providedBars = useMemo(() => {
    if (!peaks || peaks.length === 0) return null;
    if (peaks.length === BAR_COUNT) return peaks.map((p) => Math.min(1, Math.max(0.12, p)));
    // Resample arbitrary-length peaks to BAR_COUNT buckets (max per bucket)
    const out: number[] = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      const start = Math.floor((i / BAR_COUNT) * peaks.length);
      const end = Math.max(start + 1, Math.floor(((i + 1) / BAR_COUNT) * peaks.length));
      let m = 0;
      for (let j = start; j < end && j < peaks.length; j++) m = Math.max(m, peaks[j] || 0);
      out.push(Math.min(1, Math.max(0.12, m)));
    }
    return out;
  }, [peaks]);

  const bars = providedBars || decodedPeaks || fallbackBars;

  const markerPercents = useMemo(() => {
    if (!showMarkers || !lines || !Number.isFinite(duration) || duration <= 0) return [];
    return lines
      .map((l) => (typeof l.start_time === 'number' ? l.start_time : l.start) ?? -1)
      .filter((t) => t >= 0 && t <= duration)
      .map((t) => (t / duration) * 100);
  }, [showMarkers, lines, duration]);
  const progressPercent =
    Number.isFinite(duration) && duration > 0
      ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
      : 0;

  const seekFromClientX = useCallback(
    (clientX: number) => {
      if (!containerRef.current || !Number.isFinite(duration) || duration <= 0 || isNaN(clientX))
        return;
      const rect = containerRef.current.getBoundingClientRect();
      const inputEl = containerRef.current.querySelector('input');
      const inputRect = inputEl ? inputEl.getBoundingClientRect() : null;
      const activeRect =
        rect && rect.width > 0 ? rect : inputRect && inputRect.width > 0 ? inputRect : rect;
      const width =
        activeRect && activeRect.width > 0
          ? activeRect.width
          : containerRef.current.clientWidth || 300;
      if (!width || isNaN(width)) return;
      const left = activeRect ? activeRect.left : 0;
      const ratio = Math.max(0, Math.min(1, (clientX - left) / width));
      if (!isNaN(ratio)) {
        const targetTime = ratio * duration;
        if (Number.isFinite(targetTime)) {
          onSeek(targetTime);
        }
      }
    },
    [duration, onSeek]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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
    if (containerRef.current && e.pointerType !== 'touch') {
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width > 0 && Number.isFinite(e.clientX)) {
        setHoverRatio(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
      }
    }
    if (isDragging) {
      const clientX = e.clientX ?? (e.nativeEvent as unknown as MouseEvent)?.clientX;
      if (clientX !== undefined && !isNaN(clientX)) {
        seekFromClientX(clientX);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      const clientX = e.clientX ?? (e.nativeEvent as unknown as MouseEvent)?.clientX;
      if (clientX !== undefined && !isNaN(clientX)) {
        seekFromClientX(clientX);
      }
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (_err) {
        void _err;
      }
    }
  };

  const formatTime = (secs: number) => {
    if (!Number.isFinite(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      ref={containerRef}
      data-testid="waveform-scrubber"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => setHoverRatio(null)}
      className={`group relative flex h-14 w-full cursor-pointer select-none items-center gap-[2px] overflow-hidden rounded-theme-md px-0.5 touch-none ${className}`}
    >
      {/* Waveform Bars */}
      {bars.map((height, i) => {
        const barPercent = ((i + 0.5) / bars.length) * 100;
        const isPlayed = barPercent <= progressPercent;
        return (
          <div
            key={i}
            data-testid="waveform-bar"
            data-played={isPlayed ? 'true' : 'false'}
            className={`flex-1 rounded-full transition-colors duration-100 ${
              isPlayed
                ? 'bg-theme-sung'
                : 'bg-theme-text-muted/25 group-hover:bg-theme-text-muted/35'
            }`}
            style={{ height: `${Math.max(12, Math.round(height * 100))}%` }}
          />
        );
      })}

      {/* Lyric line markers */}
      {markerPercents.map((pct, i) => (
        <span
          key={`m-${i}`}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-theme-highlight/70"
          style={{ left: `${pct}%` }}
        />
      ))}

      {/* Hover position indicator */}
      {hoverRatio !== null && Number.isFinite(duration) && duration > 0 && !isDragging && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-1 z-10 w-px bg-theme-text/50"
            style={{ left: `${hoverRatio * 100}%` }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-0.5 z-30 -translate-x-1/2 rounded-theme-sm bg-theme-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-theme-text shadow-theme-sm"
            style={{ left: `${Math.min(96, Math.max(4, hoverRatio * 100))}%` }}
          >
            {formatTime(hoverRatio * duration)}
          </span>
        </>
      )}

      {/* Playhead Progress Needle */}
      <div
        data-testid="waveform-playhead"
        className="pointer-events-none absolute inset-y-0 z-10 w-0.5 rounded-full bg-theme-text shadow-theme-glow"
        style={{ left: `${progressPercent}%` }}
      />

      {/* Accessible Range Input Overlay (Preserves Keyboard Navigation & A11y Tests) */}
      <Tooltip
        content="Scrub audio timeline (±5s seek)"
        hotkey={['←', '→']}
        position="top"
        className="w-full absolute inset-0 cursor-pointer z-20"
      >
        <input
          type="range"
          min={0}
          max={Number.isFinite(duration) && duration > 0 ? duration : 100}
          step={0.1}
          value={currentTime}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (Number.isFinite(val) && Number.isFinite(duration) && duration > 0) {
              onSeek(val);
            }
          }}
          aria-label="Audio timeline position"
          aria-valuemin={0}
          aria-valuemax={Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 100}
          aria-valuenow={Math.round(currentTime)}
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
          className="w-full h-full min-h-[44px] opacity-0 cursor-pointer z-20 touch-none py-2"
        />
      </Tooltip>
    </div>
  );
};

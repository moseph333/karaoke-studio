/**
 * Beat-Reactive Audio Visualizer Component
 *
 * High-performance HTML5 Canvas visualizer driven directly by Web Audio AnalyserNode.
 * Operates in a dedicated requestAnimationFrame loop with zero React state updates to
 * guarantee that sub-frame lyric sweeps in LyricDisplay maintain smooth 60fps.
 */

import React, { useRef, useEffect } from 'react';

export interface BeatVisualizerProps {
  analyserNode: AnalyserNode | null;
  isPlaying?: boolean;
  themeSungColor?: string;
  themeUnsungColor?: string;
  className?: string;
  barCount?: number;
}

function toRgba(hexOrColor: string, alpha: number): string {
  const clean = hexOrColor.trim();
  if (clean.startsWith('#')) {
    const hex = clean.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
    } else if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
    }
  }
  return clean;
}

export const BeatVisualizer: React.FC<BeatVisualizerProps> = ({
  analyserNode,
  isPlaying = false,
  themeSungColor = '#06b6d4',
  className = '',
  barCount = 32,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Pre-allocated buffers to prevent Garbage Collection pauses
  const freqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const peaksRef = useRef<Float32Array>(new Float32Array(barCount));
  const dimensionsRef = useRef<{ width: number; height: number; dpr: number }>({
    width: 0,
    height: 0,
    dpr: 1,
  });

  // Track container dimensions with ResizeObserver (zero-reflow inside RAF)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateDimensions = () => {
      const rect = container.getBoundingClientRect();
      const parentRect = container.parentElement?.getBoundingClientRect();
      const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      const rawWidth =
        rect.width || container.clientWidth || parentRect?.width || container.offsetWidth || 640;
      const rawHeight =
        rect.height ||
        container.clientHeight ||
        parentRect?.height ||
        container.offsetHeight ||
        360;
      const width = Math.max(1, Math.floor(rawWidth));
      const height = Math.max(1, Math.floor(rawHeight));

      dimensionsRef.current = { width, height, dpr };

      if (canvasRef.current) {
        canvasRef.current.width = width * dpr;
        canvasRef.current.height = height * dpr;
      }
    };

    updateDimensions();

    let disconnectFn: (() => void) | undefined;
    if (typeof ResizeObserver === 'function') {
      try {
        const resizeObserver = new ResizeObserver(() => {
          updateDimensions();
        });
        if (typeof resizeObserver?.observe === 'function') {
          resizeObserver.observe(container);
          disconnectFn = () => resizeObserver.disconnect?.();
        }
      } catch {
        // Fallback gracefully
      }
    }

    return () => {
      disconnectFn?.();
    };
  }, []);

  // Main 60fps Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Allocate buffer once based on analyser frequencyBinCount
    const binCount = analyserNode?.frequencyBinCount || 64;
    if (!freqDataRef.current || freqDataRef.current.length !== binCount) {
      freqDataRef.current = new Uint8Array(new ArrayBuffer(binCount));
    }
    const freqData = freqDataRef.current;
    const peaks = peaksRef.current;

    let animationFrameId: number;

    const draw = () => {
      let { width, height } = dimensionsRef.current;
      const { dpr } = dimensionsRef.current;
      if ((width <= 1 || height <= 1) && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const parentRect = containerRef.current.parentElement?.getBoundingClientRect();
        width = Math.max(1, Math.floor(rect.width || parentRect?.width || 640));
        height = Math.max(1, Math.floor(rect.height || parentRect?.height || 360));
        dimensionsRef.current = { width, height, dpr };
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      if (width <= 0 || height <= 0) {
        if (isPlaying) animationFrameId = requestAnimationFrame(draw);
        return;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      let hasLiveSignal = false;
      if (isPlaying && analyserNode) {
        analyserNode.getByteFrequencyData(freqData);
        for (let k = 0; k < freqData.length; k++) {
          if (freqData[k] > 0) {
            hasLiveSignal = true;
            break;
          }
        }
      } else {
        freqData.fill(0);
      }

      // Synthesize smooth beat-reactive energy if playing while AnalyserNode is unavailable or muted
      if (isPlaying && !hasLiveSignal) {
        const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
        const beatPulse = Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 4.2), 2);
        for (let k = 0; k < freqData.length; k++) {
          const bandRatio = k / freqData.length;
          const envelope = Math.exp(-bandRatio * 2.2);
          const wave1 = 0.5 + 0.5 * Math.sin(t * 7.5 - k * 0.45);
          const wave2 = 0.5 + 0.5 * Math.cos(t * 11.3 + k * 0.7);
          const energy =
            (0.28 + 0.45 * beatPulse * envelope + 0.27 * (wave1 * 0.6 + wave2 * 0.4)) *
            (0.45 + 0.55 * (1 - bandRatio * 0.65));
          freqData[k] = Math.min(255, Math.max(18, Math.floor(energy * 235)));
        }
      }

      // Calculate bass beat energy (bins 0 to 4: sub-bass & kick drum)
      let bassSum = 0;
      const bassBins = Math.min(5, freqData.length);
      for (let b = 0; b < bassBins; b++) {
        bassSum += freqData[b];
      }
      const bassEnergy = isPlaying ? bassSum / (bassBins * 255) : 0.22; // 0.0 to 1.0

      // Render ambient bass glow in the center background
      if (bassEnergy > 0.05) {
        const glowRadius = Math.min(width, height) * (0.35 + bassEnergy * 0.3);
        const radial = ctx.createRadialGradient(
          width / 2,
          height * 0.78,
          8,
          width / 2,
          height * 0.78,
          glowRadius
        );
        radial.addColorStop(0, toRgba(themeSungColor, Math.min(0.45, 0.12 + bassEnergy * 0.28)));
        radial.addColorStop(1, 'rgba(15, 23, 42, 0)');
        ctx.fillStyle = radial;
        ctx.fillRect(0, 0, width, height);
      }

      // Symmetrical spectrum layout (mirrored from center outward)
      const halfCount = Math.floor(barCount / 2);
      const totalBars = halfCount * 2;
      const slotWidth = width / (totalBars + 2);
      const barWidth = Math.max(3, slotWidth * 0.68);
      const maxBarHeight = height * 0.68;

      for (let i = 0; i < halfCount; i++) {
        // Map frequency band non-linearly to emphasize musical range
        const freqIndex = Math.min(
          freqData.length - 1,
          Math.floor(Math.pow(i / halfCount, 1.35) * (freqData.length * 0.8))
        );
        const rawValue = freqData[freqIndex] || 0;
        // Resting equalizer silhouette when paused so toggling visualizer ON gives immediate visual feedback
        const idleSilhouette =
          0.14 + 0.22 * Math.exp(-Math.pow(i / (halfCount * 0.55), 2)) + 0.06 * Math.cos(i * 0.85);
        const normalized = isPlaying ? Math.max(0.08, rawValue / 255) : idleSilhouette;

        const currentHeight = Math.max(6, normalized * maxBarHeight);

        // Update floating peak caps with gravity decay
        if (currentHeight >= peaks[i] || !isPlaying) {
          peaks[i] = currentHeight;
        } else {
          peaks[i] = Math.max(6, peaks[i] - 1.8);
        }

        // Draw symmetrical pairs: left side and right side
        const leftX = width / 2 - (i + 1) * slotWidth;
        const rightX = width / 2 + i * slotWidth;
        const baseY = height - 4;

        [leftX, rightX].forEach((x) => {
          // Bar gradient from theme color to translucent base
          const gradient = ctx.createLinearGradient(x, baseY - currentHeight, x, baseY);
          gradient.addColorStop(0, toRgba(themeSungColor, 0.92));
          gradient.addColorStop(0.6, toRgba(themeSungColor, 0.55));
          gradient.addColorStop(1, toRgba(themeSungColor, 0.12));

          ctx.fillStyle = gradient;
          ctx.shadowBlur = 8 + bassEnergy * 12;
          ctx.shadowColor = themeSungColor;

          // Draw bar with rounded top cap
          const radius = Math.min(barWidth / 2, 4);
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(x, baseY - currentHeight, barWidth, currentHeight, [
              radius,
              radius,
              0,
              0,
            ]);
          } else {
            ctx.rect(x, baseY - currentHeight, barWidth, currentHeight);
          }
          ctx.fill();

          // Draw glowing floating peak cap dot
          const peakY = baseY - peaks[i] - 3;
          ctx.fillStyle = '#ffffff';
          ctx.shadowBlur = 8;
          ctx.shadowColor = themeSungColor;
          ctx.beginPath();
          ctx.arc(x + barWidth / 2, peakY, Math.min(2.5, barWidth / 2), 0, Math.PI * 2);
          ctx.fill();
        });
      }

      ctx.restore();

      if (isPlaying) {
        animationFrameId = requestAnimationFrame(draw);
      }
    };

    if (isPlaying) {
      animationFrameId = requestAnimationFrame(draw);
    } else {
      // Draw resting state frame once when paused
      draw();
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isPlaying, analyserNode, themeSungColor, barCount]);

  const positionClass = /\b(absolute|fixed|sticky|relative)\b/.test(className) ? '' : 'relative';

  return (
    <div
      ref={containerRef}
      data-testid="beat-visualizer"
      aria-hidden="true"
      className={`${positionClass} w-full h-full overflow-hidden select-none pointer-events-none ${className}`.trim()}
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};

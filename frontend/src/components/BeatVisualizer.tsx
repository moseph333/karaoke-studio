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
      const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));

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
      const { width, height, dpr } = dimensionsRef.current;
      if (width <= 0 || height <= 0) {
        if (isPlaying) animationFrameId = requestAnimationFrame(draw);
        return;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      if (isPlaying && analyserNode) {
        analyserNode.getByteFrequencyData(freqData);
      } else {
        freqData.fill(0);
      }

      // Calculate bass beat energy (bins 0 to 4: sub-bass & kick drum)
      let bassSum = 0;
      const bassBins = Math.min(5, freqData.length);
      for (let b = 0; b < bassBins; b++) {
        bassSum += freqData[b];
      }
      const bassEnergy = bassSum / (bassBins * 255); // 0.0 to 1.0

      // Render subtle ambient bass glow in the center background
      if (bassEnergy > 0.05) {
        const glowRadius = Math.min(width, height) * (0.3 + bassEnergy * 0.25);
        const radial = ctx.createRadialGradient(
          width / 2,
          height * 0.75,
          10,
          width / 2,
          height * 0.75,
          glowRadius
        );
        radial.addColorStop(
          0,
          `${themeSungColor}${Math.floor(bassEnergy * 45)
            .toString(16)
            .padStart(2, '0')}`
        );
        radial.addColorStop(1, 'rgba(15, 23, 42, 0)');
        ctx.fillStyle = radial;
        ctx.fillRect(0, 0, width, height);
      }

      // Symmetrical spectrum layout (mirrored from center outward)
      const halfCount = Math.floor(barCount / 2);
      const totalBars = halfCount * 2;
      const slotWidth = width / (totalBars + 2);
      const barWidth = Math.max(2, slotWidth * 0.65);
      const maxBarHeight = height * 0.7;

      for (let i = 0; i < halfCount; i++) {
        // Map frequency band non-linearly to emphasize musical range
        const freqIndex = Math.min(
          freqData.length - 1,
          Math.floor(Math.pow(i / halfCount, 1.4) * (freqData.length * 0.8))
        );
        const rawValue = freqData[freqIndex] || 0;
        const normalized = isPlaying ? rawValue / 255 : 0.08; // resting idle height when paused

        const currentHeight = Math.max(4, normalized * maxBarHeight);

        // Update floating peak caps with gravity decay
        if (currentHeight >= peaks[i]) {
          peaks[i] = currentHeight;
        } else {
          peaks[i] = Math.max(4, peaks[i] - 1.8);
        }

        // Draw symmetrical pairs: left side and right side
        const leftX = width / 2 - (i + 1) * slotWidth;
        const rightX = width / 2 + i * slotWidth;
        const baseY = height - 4;

        [leftX, rightX].forEach((x) => {
          // Bar gradient from theme color to transparent base
          const gradient = ctx.createLinearGradient(x, baseY - currentHeight, x, baseY);
          gradient.addColorStop(0, themeSungColor);
          gradient.addColorStop(0.6, `${themeSungColor}99`);
          gradient.addColorStop(1, `${themeSungColor}11`);

          ctx.fillStyle = gradient;
          ctx.shadowBlur = 6 + bassEnergy * 10;
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

  return (
    <div
      ref={containerRef}
      data-testid="beat-visualizer"
      aria-hidden="true"
      className={`relative w-full h-full overflow-hidden select-none pointer-events-none ${className}`}
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};

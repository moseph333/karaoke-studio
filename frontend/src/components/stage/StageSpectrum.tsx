/**
 * Stage Spectrum
 *
 * The spectrum background: the music's frequencies (log-spaced, bass on the left) as a glow
 * rising from the bottom, tinted from palette[0] to palette[1] and brighter where louder,
 * like the exported video's showcqt layer (backend/services/stage_backgrounds.py). Drawn on a
 * quarter-size canvas and blurred, as the export draws small and upscales.
 *
 * Heights and brightness follow curves measured from the export: a tone of amplitude A (1 =
 * full scale) draws a bar 12.9A - 0.035 of the bar area tall at brightness 8.08A^0.7 (both
 * capped at 1). The analyser reports such a tone 21.82 dB below its level, which recovers A.
 */

import React, { useEffect, useRef } from 'react';
import { SPECTRUM } from '../../theme/stageBackgrounds';

export interface StageSpectrumProps {
  analyserNode?: AnalyserNode | null;
  isPlaying?: boolean;
  palette: [string, string, string];
  /** Draw nothing that moves (reduced motion). */
  frozen?: boolean;
}

const ANALYSER_OFFSET_DB = 21.82;

/** The studio analyser is small (64 bins); a second one sees the bass in detail. */
function attachAnalyser(source: AnalyserNode): { analyser: AnalyserNode; detach: () => void } {
  const context = (source as Partial<AnalyserNode>).context;
  if (!context || typeof context.createAnalyser !== 'function') {
    return { analyser: source, detach: () => {} };
  }
  const own = context.createAnalyser();
  own.fftSize = 8192;
  own.smoothingTimeConstant = 0.6;
  try {
    source.connect(own);
  } catch {
    return { analyser: source, detach: () => {} };
  }
  return {
    analyser: own,
    detach: () => {
      try {
        source.disconnect(own);
      } catch {
        // Already gone with its audio context
      }
    },
  };
}

export const StageSpectrum: React.FC<StageSpectrumProps> = ({
  analyserNode,
  isPlaying = false,
  palette,
  frozen = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const [low, high] = palette;

  useEffect(() => {
    if (!analyserNode) return;
    const { analyser, detach } = attachAnalyser(analyserNode);
    analyserRef.current = analyser;
    dataRef.current = new Float32Array(analyser.frequencyBinCount);
    return () => {
      detach();
      analyserRef.current = null;
    };
  }, [analyserNode]);

  // Quarter of the stage size, like the export's 480x270 layer, with its glow blur
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const height = canvas.clientHeight || 360;
      canvas.width = Math.max(1, Math.round((canvas.clientWidth || 640) / 4));
      canvas.height = Math.max(1, Math.round(height / 4));
      canvas.style.filter = `blur(${(SPECTRUM.blur * height).toFixed(2)}px)`;
    };
    resize();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const draw = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      const analyser = analyserRef.current;
      const data = dataRef.current;
      if (!analyser || !data || !isPlaying || frozen) return;
      analyser.getFloatFrequencyData(data);
      const nyquist = (analyser.context?.sampleRate ?? 44100) / 2;
      const barsHeight = height * SPECTRUM.height;
      const tint = ctx.createLinearGradient(0, 0, width, 0);
      tint.addColorStop(0, low);
      tint.addColorStop(1, high);
      ctx.fillStyle = tint;
      const ratio = SPECTRUM.maxHz / SPECTRUM.minHz;
      for (let x = 0; x < width; x++) {
        const hz = SPECTRUM.minHz * ratio ** ((x + 0.5) / width);
        // Between two bins, so a low tone draws a peak instead of a block
        const position = Math.min(data.length - 1.001, (hz / nyquist) * data.length);
        const bin = Math.floor(position);
        const db = data[bin] + (data[bin + 1] - data[bin]) * (position - bin);
        const amplitude = Number.isFinite(db) ? 10 ** ((db + ANALYSER_OFFSET_DB) / 20) : 0;
        const bar = Math.min(1, 12.9 * amplitude - 0.035);
        if (bar <= 0) continue;
        ctx.globalAlpha = Math.min(1, 8.08 * amplitude ** 0.7);
        ctx.fillRect(x, height - bar * barsHeight, 1, bar * barsHeight);
      }
      ctx.globalAlpha = 1;
    };

    draw();
    if (!isPlaying || frozen) return;
    let frame = 0;
    const tick = () => {
      draw();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, frozen, low, high]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="stage-spectrum"
      className="absolute inset-0 h-full w-full"
    />
  );
};

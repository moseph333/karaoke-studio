/**
 * Stage Background
 *
 * The backdrop behind the stage lyrics, drawn the way exported videos draw it
 * (backend/services/video_renderer.py): the stage colour, then one of the song's cover art
 * (still or drifting), aurora orbs, the spectrum, or an uploaded image/video. Cover art uses
 * the export's own processed still (artworkUrl); aurora and spectrum add the export's
 * readability scrim. Moving styles follow the song time, so a paused stage shows the
 * exported frame at that moment.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../utils/cn';
import type { StageBackgroundMedia } from '../../hooks/useVisualTheme';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import {
  AURORA_ORB_COUNT,
  StageBackgroundStyle,
  driftLayer,
  orbCentre,
  orbGradient,
  orbSize,
  scrimGradient,
} from '../../theme/stageBackgrounds';
import { StageSpectrum } from './StageSpectrum';

export type { StageBackgroundMedia };

export interface StageBackgroundProps {
  baseColor?: string;
  /** The song's thumbnail, shown through a CSS imitation of the export when no artworkUrl. */
  albumArtUrl?: string;
  /** The export's processed cover-art still (the backdrop route), drawn as it is. */
  artworkUrl?: string;
  media?: StageBackgroundMedia | null;
  tone?: 'dark' | 'light';
  style?: StageBackgroundStyle;
  /** Song time in seconds. */
  time?: number;
  palette?: [string, string, string];
  aspect?: '16:9' | '9:16';
  analyserNode?: AnalyserNode | null;
  isPlaying?: boolean;
}

const DEFAULT_PALETTE: [string, string, string] = ['#fbbf24', '#f472b6', '#5eead4'];
// The export blurs art by a Gaussian of about 5.4% of the frame's shorter side, then maps
// brightness like this (its eq filter); the imitation zooms a little to hide the blur's edge
const ART_IMITATION_FILTER = 'brightness(0.6532) contrast(1.684)';
const ART_IMITATION_BLUR = 0.0544;

/** The stage's measured size (falls back to 640x360 before layout, e.g. in tests). */
function useBoxSize(ref: React.RefObject<HTMLElement>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 640, height: 360 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    };
    update();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** False once the image has failed to load, so a missing still shows the stage colour. */
function useImageAvailable(url: string | undefined): boolean {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!url || typeof Image === 'undefined') return;
    const image = new Image();
    image.onerror = () => setFailedUrl(url);
    image.src = url;
    return () => {
      image.onerror = null;
    };
  }, [url]);
  return Boolean(url) && failedUrl !== url;
}

export const StageBackground: React.FC<StageBackgroundProps> = ({
  baseColor,
  albumArtUrl,
  artworkUrl,
  media,
  tone = 'dark',
  style = 'artwork',
  time = 0,
  palette = DEFAULT_PALETTE,
  aspect = '16:9',
  analyserNode,
  isPlaying = false,
}) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const box = useBoxSize(boxRef);
  const reducedMotion = usePrefersReducedMotion();
  const t = reducedMotion ? 0 : time;

  // An uploaded background video loops forever; with reduced motion it holds still
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoUrl = media?.kind === 'video' ? media.url : undefined;
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    if (reducedMotion) {
      video.pause();
    } else {
      video.play()?.catch(() => {});
    }
  }, [reducedMotion, videoUrl]);
  const kind = media ? 'custom' : style === 'custom' ? 'artwork' : style;
  const isArt = kind === 'artwork' || kind === 'drift';
  const artworkAvailable = useImageAvailable(isArt ? artworkUrl : undefined);
  const gradients = useMemo(
    () => palette.slice(0, AURORA_ORB_COUNT).map((color) => orbGradient(color, tone)),
    [palette, tone]
  );

  let art: React.ReactNode = null;
  if (isArt && artworkUrl && artworkAvailable) {
    const image = { backgroundImage: `url("${artworkUrl}")` };
    art =
      kind === 'drift' ? (
        <div
          data-testid="stage-album-art"
          data-style="drift"
          className="absolute bg-cover bg-center will-change-transform"
          style={{ ...image, ...driftLayer(t, aspect) }}
        />
      ) : (
        <div
          data-testid="stage-album-art"
          className="absolute inset-0 bg-cover bg-center"
          style={image}
        />
      );
  } else if (isArt && albumArtUrl && !artworkUrl) {
    const blur = ART_IMITATION_BLUR * Math.min(box.width, box.height);
    art = (
      <div
        data-testid="stage-album-art"
        className={cn(
          'absolute bg-cover bg-center',
          kind === 'drift' ? 'will-change-transform' : 'inset-0 scale-[1.15]'
        )}
        style={{
          backgroundImage: `url(${albumArtUrl})`,
          filter: `blur(${blur.toFixed(1)}px) ${ART_IMITATION_FILTER}`,
          ...(kind === 'drift' ? driftLayer(t, aspect) : {}),
        }}
      />
    );
  }

  return (
    <div
      ref={boxRef}
      aria-hidden="true"
      data-background-style={kind}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        data-testid="stage-base-bg"
        className="absolute inset-0"
        style={{ backgroundColor: baseColor }}
      />
      {art}
      {kind === 'aurora' && (
        <div data-testid="stage-aurora" className="absolute inset-0">
          {gradients.map((background, i) => {
            const size = orbSize(box.width, box.height);
            const centre = orbCentre(i, t);
            const x = centre.x * box.width - size / 2;
            const y = centre.y * box.height - size / 2;
            return (
              <div
                key={i}
                data-testid={`stage-aurora-orb-${i}`}
                className="absolute left-0 top-0 will-change-transform"
                style={{
                  width: size,
                  height: size,
                  background,
                  transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`,
                }}
              />
            );
          })}
        </div>
      )}
      {kind === 'spectrum' && (
        <StageSpectrum
          analyserNode={analyserNode}
          isPlaying={isPlaying}
          palette={palette}
          frozen={reducedMotion}
        />
      )}
      {media &&
        (media.kind === 'video' ? (
          <video
            ref={videoRef}
            data-testid="stage-custom-bg"
            className="absolute inset-0 h-full w-full object-cover"
            src={media.url}
            autoPlay={!reducedMotion}
            muted
            loop
            playsInline
          />
        ) : (
          <img
            data-testid="stage-custom-bg"
            className="absolute inset-0 h-full w-full object-cover"
            src={media.url}
            alt=""
          />
        ))}
      {(kind === 'aurora' || kind === 'spectrum') && (
        <div
          data-testid="stage-scrim"
          className="absolute inset-0"
          style={{ backgroundImage: scrimGradient(tone) }}
        />
      )}
    </div>
  );
};

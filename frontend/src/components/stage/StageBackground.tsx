/**
 * Stage Background
 *
 * Layered backdrop for the live stage, matching how exports are composited:
 * base color → blurred album art → custom image/video → readability scrim.
 */

import React from 'react';
import { cn } from '../../utils/cn';
import type { StageBackgroundMedia } from '../../hooks/useVisualTheme';

export type { StageBackgroundMedia };

export interface StageBackgroundProps {
  baseColor?: string;
  albumArtUrl?: string;
  media?: StageBackgroundMedia | null;
  tone?: 'dark' | 'light';
}

export const StageBackground: React.FC<StageBackgroundProps> = ({
  baseColor,
  albumArtUrl,
  media,
  tone = 'dark',
}) => (
  <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
    <div
      data-testid="stage-base-bg"
      className="absolute inset-0"
      style={{
        backgroundColor: baseColor,
        backgroundImage:
          tone === 'light'
            ? 'radial-gradient(120% 80% at 50% 0%, rgb(0 0 0 / 0.04), transparent 60%)'
            : 'radial-gradient(120% 80% at 50% 0%, rgb(255 255 255 / 0.07), transparent 62%)',
      }}
    />
    {albumArtUrl && !media && (
      <div
        data-testid="stage-album-art"
        className="absolute inset-0 scale-110 bg-cover bg-center opacity-35 blur-3xl transition-all duration-700"
        style={{ backgroundImage: `url(${albumArtUrl})` }}
      />
    )}
    {media &&
      (media.kind === 'video' ? (
        <video
          data-testid="stage-custom-bg"
          className="absolute inset-0 h-full w-full object-cover"
          src={media.url}
          autoPlay
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
    <div
      className={cn(
        'absolute inset-0',
        tone === 'light'
          ? 'bg-gradient-to-t from-white/75 via-white/25 to-white/5'
          : 'bg-gradient-to-t from-black/75 via-black/30 to-black/10'
      )}
    />
  </div>
);

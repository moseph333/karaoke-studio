/**
 * Stage Toolbar
 *
 * The single home for stage view toggles: highlight mode (word sweep / line), beat
 * visualizer, chord bar and fullscreen. Uses dark video-player style overlays that read
 * on any stage background; in fullscreen it fades out with the floating controls.
 */

import React from 'react';
import { Activity, Maximize, Minimize, Music2 } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { focusRing } from '../ui/variants';
import { cn } from '../../utils/cn';
import { SyncDisplayMode } from '../../types';

export interface StageToolbarProps {
  isFullscreen: boolean;
  visible: boolean;
  syncMode: SyncDisplayMode;
  onSyncModeChange: (mode: SyncDisplayMode) => void;
  isVisualizerActive: boolean;
  onToggleVisualizer: () => void;
  isChordBarVisible: boolean;
  onToggleChordBar: () => void;
  onToggleFullscreen: () => void;
}

const SYNC_OPTIONS: { mode: SyncDisplayMode; text: string; label: string; hint: string }[] = [
  {
    mode: 'word',
    text: 'Word',
    label: 'Word sweep highlight',
    hint: 'Sweep each word as it is sung',
  },
  { mode: 'line', text: 'Line', label: 'Line highlight', hint: 'Light up whole lines at once' },
];

export const StageToolbar: React.FC<StageToolbarProps> = ({
  isFullscreen,
  visible,
  syncMode,
  onSyncModeChange,
  isVisualizerActive,
  onToggleVisualizer,
  isChordBarVisible,
  onToggleChordBar,
  onToggleFullscreen,
}) => (
  <div
    data-testid="stage-toolbar"
    className={cn(
      'absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 p-2 transition-opacity duration-300 sm:p-3',
      visible ? 'opacity-100' : 'pointer-events-none opacity-0'
    )}
  >
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-theme-pill border border-white/15 bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white/90 shadow-theme-sm backdrop-blur-md">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-theme-danger motion-safe:animate-pulse"
      />
      <span className="truncate">{isFullscreen ? 'TV stage' : 'Live preview'}</span>
    </span>

    <div className="flex shrink-0 items-center gap-1.5">
      <div
        role="group"
        aria-label="Lyric highlight mode"
        data-testid="sync-mode-selector"
        className="flex items-center rounded-theme-md border border-white/15 bg-black/45 p-0.5 backdrop-blur-md"
      >
        {SYNC_OPTIONS.map((opt) => {
          const active = syncMode === opt.mode;
          return (
            <button
              key={opt.mode}
              type="button"
              data-testid={`sync-mode-${opt.mode}`}
              aria-label={opt.label}
              aria-pressed={active}
              title={opt.hint}
              onClick={() => onSyncModeChange(opt.mode)}
              className={cn(
                'min-h-[44px] min-w-[44px] rounded-[calc(var(--theme-radius-md)-2px)] px-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors md:min-h-[32px]',
                focusRing,
                active ? 'bg-white text-black shadow-theme-sm' : 'text-white/70 hover:text-white'
              )}
            >
              {opt.text}
            </button>
          );
        })}
      </div>

      <IconButton
        data-testid="toggle-visualizer-btn"
        icon={<Activity className="h-4 w-4" aria-hidden="true" />}
        label="Beat visualizer"
        hotkey="V"
        tooltipPosition="bottom"
        variant="overlay"
        pressed={isVisualizerActive}
        onClick={onToggleVisualizer}
      />
      <IconButton
        data-testid="chord-bar-toggle"
        icon={<Music2 className="h-4 w-4" aria-hidden="true" />}
        label="Chord bar"
        hotkey="C"
        tooltipPosition="bottom"
        variant="overlay"
        pressed={isChordBarVisible}
        onClick={onToggleChordBar}
      />
      <IconButton
        data-testid="stage-fullscreen-toggle"
        icon={
          isFullscreen ? (
            <Minimize className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Maximize className="h-4 w-4" aria-hidden="true" />
          )
        }
        label={isFullscreen ? 'Exit fullscreen stage (F)' : 'Enter fullscreen stage (F)'}
        tooltip={isFullscreen ? 'Exit fullscreen stage' : 'Fullscreen TV stage'}
        hotkey="F"
        tooltipPosition="bottom"
        tooltipAlign="end"
        variant="overlay"
        onClick={onToggleFullscreen}
      />
    </div>
  </div>
);

/**
 * A show's "Now singing": who is on stage, the controls for their song, and what stands in
 * the way when it is not playing. With nobody on, it calls the next singer in the queue.
 * A library song's stage is shown here as well (it is the one the stage window follows). A
 * video plays on the stage window, and here once more without sound, following that one
 * (`ShowStageMonitor`).
 */

import React, { useEffect, useState } from 'react';
import { Check, Pause, Play, RotateCcw, SkipForward, Volume2 } from 'lucide-react';
import { LyricDisplay } from '../LyricDisplay';
import { PlaybackClockContext, usePlaybackValue } from '../../hooks/usePlaybackClock';
import { useProjectStageInputs } from '../../hooks/useProjectStageInputs';
import { StageLeaderIdContext } from '../../hooks/useStageLeader';
import type { ShowTrouble, UseShowPlayer } from '../../hooks/useShowPlayer';
import type { UseVisualThemeReturn } from '../../hooks/useVisualTheme';
import type { ProjectState } from '../../types';
import { formatTime } from '../../utils/format';
import type { ShowEntry } from '../../utils/showQueue';
import { Button, ProgressBar, Slider } from '../ui';
import { ShowStageMonitor } from './ShowStageMonitor';

export interface ShowNowSingingProps {
  player: UseShowPlayer;
  /** The first singer waiting, called when nobody is on. */
  next: ShowEntry | null;
  theme: UseVisualThemeReturn;
  onOpenStage: () => void;
}

const label = 'text-sm font-semibold uppercase tracking-wide';

function songOf(entry: ShowEntry): string {
  const { source } = entry;
  return source.kind === 'library' && source.artist
    ? `${source.title} · ${source.artist}`
    : source.title;
}

/** A library song's position, read off the playback clock a whole second at a time. */
const SongSecond: React.FC<{ children: (second: number) => React.ReactNode }> = ({ children }) => {
  const second = usePlaybackValue((time) => Math.floor(time));
  return <>{children(second)}</>;
};

const Position: React.FC<{
  time: number;
  duration: number;
  onSeek: (time: number) => void;
}> = ({ time, duration, onSeek }) => {
  // While the thumb is held the slider shows where it is, not where the song is
  const [held, setHeld] = useState<number | null>(null);
  useEffect(() => {
    setHeld(null);
  }, [duration]);
  const max = Math.max(1, Math.floor(duration));
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 text-right text-sm tabular-nums text-theme-text-muted">
        {formatTime(held ?? time)}
      </span>
      <Slider
        label="Song position"
        testId="show-position"
        className="min-w-0 flex-1"
        min={0}
        max={max}
        step={1}
        value={Math.min(max, Math.floor(held ?? time))}
        valueText={(value) => `${formatTime(value)} of ${formatTime(duration)}`}
        disabled={duration <= 0}
        onChange={setHeld}
        onChangeEnd={(value) => {
          setHeld(null);
          onSeek(value);
        }}
      />
      <span className="w-12 text-sm tabular-nums text-theme-text-muted">
        {formatTime(duration)}
      </span>
    </div>
  );
};

const Trouble: React.FC<{
  trouble: ShowTrouble;
  onOpenStage: () => void;
  onRetry: () => void;
}> = ({ trouble, onOpenStage, onRetry }) => {
  if (trouble.kind === 'fetching') {
    return (
      <div role="status" className="flex flex-col gap-2 text-sm text-theme-text">
        <p>
          This video only plays on YouTube itself, so the server is fetching a copy. It starts when
          the copy is ready.
        </p>
        <ProgressBar value={trouble.progress} label="Fetching a copy of the video" />
      </div>
    );
  }
  if (trouble.kind === 'no-stage') {
    return (
      <div role="status" className="flex flex-wrap items-center gap-3 text-sm text-theme-text">
        <p>A video plays on the stage window, and none is open.</p>
        <Button variant="primary" className="min-h-[44px]" onClick={onOpenStage}>
          Open it for this video
        </Button>
      </div>
    );
  }
  if (trouble.kind === 'blocked') {
    return (
      <p role="alert" className="text-sm text-theme-warning">
        The browser is holding the sound back. Click once in the stage window, then press Play.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-sm text-theme-warning">
        {trouble.message}
      </p>
      <Button variant="secondary" className="min-h-[44px]" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
};

const SongStage: React.FC<{
  project: ProjectState;
  player: UseShowPlayer;
  theme: UseVisualThemeReturn;
}> = ({ project, player, theme }) => {
  const { audio } = player;
  const stage = useProjectStageInputs(project, theme);
  return (
    <LyricDisplay
      lines={project.lines}
      duration={audio.duration}
      isPlaying={audio.isPlaying}
      playbackRate={audio.playbackRate}
      audioRef={audio.audioRef}
      onSeek={audio.handleSeek}
      onTogglePlay={player.toggle}
      albumArtUrl={project.thumbnail_url}
      artworkUrl={stage.artworkUrl}
      backgroundMedia={stage.backgroundMedia}
      backgroundStyle={stage.backgroundStyle}
      backgroundPalette={theme.backgroundPalette}
      selectedTheme={theme.selectedTheme}
      themeSungColor={theme.activeSungColor}
      themeUnsungColor={theme.activeUnsungColor}
      singer2SungColor={theme.activeSinger2Color}
      bothSungColor={theme.activeBothColor}
      partNames={project.part_names}
      aspectRatio={theme.aspectRatio}
      fontSizeScale={theme.fontSizeScale}
      trackTitle={project.title}
      trackArtist={project.artist}
      showVisualizer={theme.showVisualizer}
      onToggleVisualizer={theme.toggleVisualizer}
      chords={project.chords}
      showChordBar={theme.showChordBar}
      onToggleChordBar={theme.toggleChordBar}
      keyHint={project.vocal_range?.estimated_key}
      syncMode={theme.syncMode}
      onSyncModeChange={theme.setSyncMode}
    />
  );
};

export const ShowNowSinging: React.FC<ShowNowSingingProps> = ({
  player,
  next,
  theme,
  onOpenStage,
}) => {
  const { current, project, trouble } = player;

  if (!current) {
    return (
      <section aria-labelledby="show-now-heading" className="flex flex-col gap-3">
        <h2 id="show-now-heading" className={`${label} text-theme-text-muted`}>
          {next ? 'Up next' : 'Nobody is on'}
        </h2>
        {next ? (
          <>
            <p className="ks-display break-words text-[48px] font-black text-theme-text sm:text-[72px]">
              {next.singer}
            </p>
            <p className="text-lg text-theme-text">{songOf(next)}</p>
            <div>
              <Button
                variant="primary"
                size="lg"
                className="min-h-[44px]"
                leftIcon={<Play className="h-5 w-5" aria-hidden="true" />}
                onClick={() => player.start(next)}
              >
                Start the song
              </Button>
            </div>
          </>
        ) : (
          <p className="text-lg text-theme-text-muted">
            Add a singer and their song, then start them from here.
          </p>
        )}
      </section>
    );
  }

  const ready = !trouble || trouble.kind === 'blocked';
  const { scene } = player;
  const videoScene = scene.kind === 'youtube' || scene.kind === 'file' ? scene : null;
  return (
    <section aria-labelledby="show-now-heading" className="flex flex-col gap-4">
      <h2 id="show-now-heading" className={`${label} text-theme-accent`}>
        Now singing
      </h2>
      <div>
        <p className="ks-display break-words text-[48px] font-black text-theme-text sm:text-[72px]">
          {current.singer}
        </p>
        <p className="text-lg text-theme-text">{songOf(current)}</p>
      </div>

      {trouble && <Trouble trouble={trouble} onOpenStage={onOpenStage} onRetry={player.retry} />}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          className="min-h-[44px] min-w-[7rem]"
          leftIcon={
            player.isPlaying ? (
              <Pause className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )
          }
          disabled={!ready}
          loading={player.isLoading}
          loadingLabel="Starting"
          onClick={player.toggle}
        >
          {player.isPlaying ? 'Pause' : 'Play'}
        </Button>
        <Button
          variant="secondary"
          className="min-h-[44px]"
          leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
          disabled={!ready}
          onClick={player.restart}
        >
          From the top
        </Button>
        <Button
          variant="secondary"
          className="min-h-[44px]"
          leftIcon={<Check className="h-4 w-4" aria-hidden="true" />}
          onClick={player.finish}
        >
          Song is over
        </Button>
        <Button
          variant="ghost"
          className="min-h-[44px]"
          leftIcon={<SkipForward className="h-4 w-4" aria-hidden="true" />}
          onClick={player.skip}
        >
          Skip
        </Button>
      </div>

      {project ? (
        <PlaybackClockContext.Provider value={player.audio.clock}>
          <SongSecond>
            {(second) => <Position time={second} duration={player.duration} onSeek={player.seek} />}
          </SongSecond>
          <div className="max-w-3xl" data-testid="show-song-stage">
            {/* Signed as the host's, so the stage window draws it and no studio tab's */}
            <StageLeaderIdContext.Provider value={player.stage.hostId}>
              <SongStage project={project} player={player} theme={theme} />
            </StageLeaderIdContext.Provider>
          </div>
        </PlaybackClockContext.Provider>
      ) : (
        player.isVideo &&
        ready && (
          <>
            <Position time={player.videoTime} duration={player.duration} onSeek={player.seek} />
            {videoScene ? (
              // A new playing is a new monitor, as it is a new player on the stage window
              <ShowStageMonitor
                key={`${videoScene.kind === 'youtube' ? videoScene.videoId : videoScene.url}:${videoScene.play}`}
                scene={videoScene}
                playing={player.isPlaying}
                time={player.videoTime}
              />
            ) : (
              <p className="text-sm text-theme-text-muted">The video plays on the stage window.</p>
            )}
          </>
        )
      )}

      <div className="flex max-w-sm items-center gap-3">
        <Volume2 className="h-4 w-4 shrink-0 text-theme-text-muted" aria-hidden="true" />
        <Slider
          label="Volume"
          testId="show-volume"
          className="min-w-0 flex-1"
          min={0}
          max={1}
          step={0.05}
          value={player.volume}
          valueText={(value) => `${Math.round(value * 100)}%`}
          onChange={player.setVolume}
        />
      </div>
    </section>
  );
};

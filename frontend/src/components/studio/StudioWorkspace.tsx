/**
 * Studio Workspace
 *
 * The one-screen studio: song header, stage preview and timeline editor in the main
 * column, and the Audio Mix / Stage Look inspector on the right. On phones the three
 * areas become tabs (Stage / Timeline / Mix & Theme) and the page scrolls normally.
 */

import React from 'react';
import { StudioMetaHeader } from '../StudioMetaHeader';
import { MobileStudioWorkspaceTabs } from '../MobileStudioWorkspaceTabs';
import { LyricTimelineEditor } from '../LyricTimelineEditor';
import { AudioControls } from '../AudioControls';
import { VisualThemePicker } from '../VisualThemePicker';
import { LyricLine, ProjectState, StudioWorkspaceTab } from '../../types';
import type { UseStudioAudioReturn } from '../../hooks/useStudioAudio';
import type { UseMixControllerReturn } from '../../hooks/useMixController';
import type { UseVisualThemeReturn } from '../../hooks/useVisualTheme';
import type { UseQualityJobsReturn } from '../../hooks/useQualityJobs';
import { normalizeSingerRole } from '../stage/singers';
import { cn } from '../../utils/cn';

export interface StudioWorkspaceProps {
  project: ProjectState;
  activeTab: StudioWorkspaceTab;
  onSelectTab: (tab: StudioWorkspaceTab) => void;
  hasUnsavedChanges: boolean;
  onLyricsDirtyChange: (isDirty: boolean) => void;
  onSaveLines: (lines: LyricLine[]) => Promise<void>;
  onEditChord: (index: number, chord: string) => void;
  onOpenEditModal: () => void;
  onOpenDeleteModal: () => void;
  onCustomInstrumentalUploaded: (url: string) => void;
  audio: UseStudioAudioReturn;
  mix: UseMixControllerReturn;
  theme: UseVisualThemeReturn;
  showVisualizer: boolean;
  onToggleVisualizer: () => void;
  showChordBar: boolean;
  onToggleChordBar: () => void;
  /** Stem re-separation and lyric re-alignment jobs. */
  quality?: UseQualityJobsReturn;
}

/** Mobile tab visibility; every panel is visible from `md` up. */
const panelVisibility = (active: StudioWorkspaceTab, ...tabs: StudioWorkspaceTab[]) =>
  tabs.includes(active) ? 'block' : 'hidden md:block';

export const StudioWorkspace: React.FC<StudioWorkspaceProps> = ({
  project,
  activeTab,
  onSelectTab,
  hasUnsavedChanges,
  onLyricsDirtyChange,
  onSaveLines,
  onEditChord,
  onOpenEditModal,
  onOpenDeleteModal,
  onCustomInstrumentalUploaded,
  audio,
  mix,
  theme,
  showVisualizer,
  onToggleVisualizer,
  showChordBar,
  onToggleChordBar,
  quality,
}) => {
  const syncJobActive = ['queued', 'running'].includes(project.sync_job?.status ?? '');
  const hasDuetLines = project.lines.some((l) => normalizeSingerRole(l.singer) !== 'singer1');

  return (
    <div
      data-testid="studio-workspace"
      data-stage-size={theme.stageSize}
      className={cn(
        'flex flex-col gap-3 px-3 pt-3 sm:px-4',
        'md:grid md:grid-cols-[minmax(0,1fr)_minmax(300px,340px)] md:items-start md:gap-4 md:pb-3',
        'lg:grid-cols-[minmax(0,1fr)_360px] lg:px-6',
        'studio:h-full studio:min-h-0 studio:items-stretch'
      )}
    >
      <section
        aria-label="Stage and timeline"
        className="flex min-w-0 flex-col gap-3 studio:min-h-0"
      >
        <StudioMetaHeader
          project={project}
          onOpenEditModal={onOpenEditModal}
          onOpenDeleteModal={onOpenDeleteModal}
        />

        <MobileStudioWorkspaceTabs
          activeTab={activeTab}
          onSelectTab={onSelectTab}
          hasUnsavedChanges={hasUnsavedChanges}
        />

        <div
          data-testid="workspace-stage-timeline-container"
          className={cn(
            panelVisibility(activeTab, 'stage', 'timeline'),
            'studio:min-h-0 studio:flex-1'
          )}
        >
          <LyricTimelineEditor
            lines={project.lines}
            currentTime={audio.currentTime}
            getCurrentTime={audio.getCurrentTime}
            duration={audio.duration}
            isPlaying={audio.isPlaying}
            playbackRate={audio.playbackRate}
            audioRef={audio.audioRef}
            onTogglePlay={audio.handleTogglePlay}
            onSeek={audio.handleSeek}
            onSaveLines={onSaveLines}
            albumArtUrl={project.thumbnail_url}
            backgroundMedia={theme.stageBackground}
            selectedTheme={theme.selectedTheme}
            themeSungColor={theme.activeSungColor}
            themeUnsungColor={theme.activeUnsungColor}
            singer2SungColor={theme.activeSinger2Color}
            bothSungColor={theme.activeBothColor}
            onDirtyChange={onLyricsDirtyChange}
            aspectRatio={theme.aspectRatio}
            fontSizeScale={theme.fontSizeScale}
            projectId={project.id}
            trackTitle={project.title}
            trackArtist={project.artist}
            showVisualizer={showVisualizer}
            onToggleVisualizer={onToggleVisualizer}
            analyserNode={audio.analyserNode}
            chords={project.chords}
            showChordBar={showChordBar}
            onToggleChordBar={onToggleChordBar}
            semitones={mix.semitones}
            onSemitonesChange={mix.setSemitones}
            keyHint={project.vocal_range?.estimated_key}
            onEditChord={onEditChord}
            syncMode={theme.syncMode}
            onSyncModeChange={theme.setSyncMode}
            activeWorkspaceTab={activeTab}
            syncJob={project.sync_job}
            onStartBackgroundRealign={quality?.startBackgroundRealign}
            onCancelRealign={quality ? () => void quality.cancelRealign() : undefined}
          />
        </div>
      </section>

      <aside
        aria-label="Inspector"
        className="flex min-w-0 flex-col gap-3 studio:-mr-1 studio:min-h-0 studio:overflow-y-auto studio:pr-1"
      >
        <div
          id="workspace-panel-mix-audio"
          role="tabpanel"
          aria-labelledby="workspace-tab-mix"
          tabIndex={0}
          data-testid="studio-panel-audio"
          className={cn(panelVisibility(activeTab, 'mix'), 'rounded-theme-xl scroll-mt-3')}
        >
          <AudioControls
            projectId={project.id}
            instrumentalUrl={project.instrumental_url}
            vocalsUrl={project.vocals_url}
            semitones={mix.semitones}
            guideVolume={mix.guideVolume}
            onSemitonesChange={mix.setSemitones}
            onGuideVolumeChange={mix.setGuideVolume}
            onGuideVolumeCommit={mix.commitGuideVolume}
            isRemixing={mix.isRemixing}
            isMixPending={mix.isPending && !mix.isRemixing}
            onRequestRemix={() => void mix.applyNow()}
            onCustomInstrumentalUploaded={onCustomInstrumentalUploaded}
            vocalRange={project.vocal_range}
            separation={project.separation}
            separationJob={project.separation_job}
            onImproveStems={quality?.openReseparate}
            onCancelReseparation={quality ? () => void quality.cancelReseparation() : undefined}
            stemsBusyReason={
              syncJobActive ? 'Wait for the lyric re-alignment to finish first' : null
            }
          />
        </div>

        <div
          id="workspace-panel-mix-theme"
          role="tabpanel"
          aria-labelledby="workspace-tab-mix"
          tabIndex={0}
          data-testid="studio-panel-theme"
          className={cn(panelVisibility(activeTab, 'mix'), 'rounded-theme-xl')}
        >
          <VisualThemePicker
            selectedTheme={theme.selectedTheme}
            onSelectTheme={theme.setSelectedTheme}
            aspectRatio={theme.aspectRatio}
            onChangeAspectRatio={theme.setAspectRatio}
            onCustomBgUploaded={theme.setCustomBgId}
            customBgId={theme.customBgId}
            customSungColor={theme.customSungColor}
            onCustomSungColorChange={theme.setCustomSungColor}
            customUnsungColor={theme.customUnsungColor}
            onCustomUnsungColorChange={theme.setCustomUnsungColor}
            fontSizeScale={theme.fontSizeScale}
            onFontSizeScaleChange={theme.setFontSizeScale}
            onResetThemeDefaults={theme.resetThemeDefaults}
            showDuetColors={hasDuetLines}
            customSinger2Color={theme.customSinger2Color}
            onCustomSinger2ColorChange={theme.setCustomSinger2Color}
            customBothColor={theme.customBothColor}
            onCustomBothColorChange={theme.setCustomBothColor}
            stageSize={theme.stageSize}
            onStageSizeChange={theme.setStageSize}
          />
        </div>
      </aside>
    </div>
  );
};

/**
 * Studio Workspace
 *
 * The one-screen studio: song header, stage preview and timeline editor in the main
 * column, and the Audio Mix / Stage Look inspector on the right. On phones the three
 * areas become tabs (Stage / Timeline / Mix & Look) and the page scrolls normally.
 */

import React, { useMemo } from 'react';
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
import { useCapabilities } from '../../hooks/useCapabilities';
import type { GuideAction } from '../../utils/guideActions';
import { checkupFixCount } from '../../utils/songCheckup';
import { normalizeSingerRole } from '../stage/singers';
import { FirstSongCard } from './FirstSongCard';
import { useWorkspaceTabs, workspacePanelProps } from './workspacePanels';
import { cn } from '../../utils/cn';
import { isJobActive, vocalSplitBusyReason } from '../../utils/jobs';
import { singerPartsInLines } from '../../utils/vocalLevels';

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
  /** Opens the song check-up from the header's status badges. */
  onOpenCheckup?: () => void;
  onCustomInstrumentalUploaded: (url: string) => void;
  audio: UseStudioAudioReturn;
  mix: UseMixControllerReturn;
  theme: UseVisualThemeReturn;
  showVisualizer: boolean;
  onToggleVisualizer: () => void;
  showChordBar: boolean;
  onToggleChordBar: () => void;
  /** Stem re-separation, lyric re-alignment, vocal split and song loop jobs. */
  quality?: UseQualityJobsReturn;
  /** The getting-started card for a first-time user, and where its steps go. */
  showFirstSongCard?: boolean;
  onDismissFirstSongCard?: () => void;
  onGuideAction?: (action: GuideAction) => void;
}

/** Mobile tab visibility; every panel is visible from `md` up. */
const panelVisibility = (active: StudioWorkspaceTab, ...tabs: StudioWorkspaceTab[]) =>
  tabs.includes(active) ? 'block' : 'hidden md:block';

const StudioWorkspaceView: React.FC<StudioWorkspaceProps> = ({
  project,
  activeTab,
  onSelectTab,
  hasUnsavedChanges,
  onLyricsDirtyChange,
  onSaveLines,
  onEditChord,
  onOpenEditModal,
  onOpenDeleteModal,
  onOpenCheckup,
  onCustomInstrumentalUploaded,
  audio,
  mix,
  theme,
  showVisualizer,
  onToggleVisualizer,
  showChordBar,
  onToggleChordBar,
  quality,
  showFirstSongCard = false,
  onDismissFirstSongCard,
  onGuideAction,
}) => {
  const asTabs = useWorkspaceTabs();
  const firstSongCard = showFirstSongCard && onDismissFirstSongCard && onGuideAction;
  const toCheck = useMemo(
    () => (firstSongCard ? checkupFixCount(project) : 0),
    [firstSongCard, project]
  );
  const syncJobActive = isJobActive(project.sync_job);
  const vocalSplitActive = isJobActive(project.vocal_split_job);
  // What this server can run (vocal splits, song loops), asked only where one can be started
  const capabilities = useCapabilities(Boolean(quality));
  const splitCapabilities = capabilities?.separation.vocal_parts;
  const splitBusyReason = vocalSplitBusyReason(project);
  const singerParts = useMemo(() => singerPartsInLines(project.lines), [project.lines]);
  const vocalParts = useMemo(
    () => ({
      levels: mix.vocalLevels,
      guideVolume: mix.guideVolume,
      onLevelsChange: mix.setVocalLevels,
      onLevelsCommit: mix.commitVocalLevels,
      singerParts,
      partNames: project.part_names,
      // One split runs at a time: each row shows its own job and waits for the other's
      ...(quality
        ? Object.fromEntries(
            (
              [
                ['split', 'lead_backing'],
                ['voiceSplit', 'male_female'],
              ] as const
            ).map(([prop, kind]) => {
              const job = project.vocal_split_job;
              const other = job && job.kind !== kind && isJobActive(job);
              return [
                prop,
                {
                  split: project.vocal_splits?.[kind],
                  job: job?.kind === kind ? job : null,
                  capability: splitCapabilities?.find((split) => split.id === kind),
                  onSplit: () => void quality.startVocalSplit(kind),
                  onCancel: () => void quality.cancelVocalSplit(),
                  busyReason:
                    splitBusyReason ??
                    (other ? 'Wait for the other vocal split to finish first' : null),
                },
              ];
            })
          )
        : {}),
    }),
    [
      mix.vocalLevels,
      mix.guideVolume,
      mix.setVocalLevels,
      mix.commitVocalLevels,
      singerParts,
      project.part_names,
      quality,
      project.vocal_splits,
      project.vocal_split_job,
      splitCapabilities,
      splitBusyReason,
    ]
  );
  const songLoopCapability = capabilities?.song_loop;
  const songLoop = useMemo(
    () =>
      quality
        ? {
            loop: project.song_loop,
            job: project.song_loop_job,
            capability: songLoopCapability,
            onMake: (prompt: string) => void quality.startSongLoop(prompt),
            onCancel: () => void quality.cancelSongLoop(),
            onRemove: () => void quality.removeSongLoop(),
          }
        : undefined,
    [quality, project.song_loop, project.song_loop_job, songLoopCapability]
  );
  // The song's loop is drawn like an uploaded video; a song without one shows its cover art
  const loopUrl = project.song_loop?.url;
  const showsLoop = theme.backgroundStyle === 'loop';
  const backgroundMedia = useMemo(
    () => (showsLoop && loopUrl ? { url: loopUrl, kind: 'video' as const } : theme.stageBackground),
    [showsLoop, loopUrl, theme.stageBackground]
  );
  const backgroundStyle = showsLoop && !loopUrl ? 'artwork' : theme.backgroundStyle;
  const hasDuetLines = project.lines.some((l) => normalizeSingerRole(l.singer) !== 'singer1');
  // The cover art exactly as exports draw it (the larger, panned still for the drift)
  const artworkUrl = project.thumbnail_url
    ? `/api/project/${encodeURIComponent(project.id)}/backdrop?aspect=${
        theme.aspectRatio === '9:16' ? '9:16' : '16:9'
      }${theme.backgroundStyle === 'drift' ? '&drift=1' : ''}&look=${theme.selectedTheme.id}`
    : undefined;

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
          onOpenCheckup={onOpenCheckup}
        />

        {firstSongCard && (
          <FirstSongCard
            toCheck={toCheck}
            onAction={onGuideAction}
            onDismiss={onDismissFirstSongCard}
          />
        )}

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
            getCurrentTime={audio.getCurrentTime}
            duration={audio.duration}
            isPlaying={audio.isPlaying}
            playbackRate={audio.playbackRate}
            audioRef={audio.audioRef}
            onTogglePlay={audio.handleTogglePlay}
            onSeek={audio.handleSeek}
            onSaveLines={onSaveLines}
            albumArtUrl={project.thumbnail_url}
            artworkUrl={artworkUrl}
            backgroundMedia={backgroundMedia}
            backgroundStyle={backgroundStyle}
            backgroundPalette={theme.backgroundPalette}
            selectedTheme={theme.selectedTheme}
            themeSungColor={theme.activeSungColor}
            themeUnsungColor={theme.activeUnsungColor}
            singer2SungColor={theme.activeSinger2Color}
            bothSungColor={theme.activeBothColor}
            partNames={project.part_names}
            syncReport={project.sync_report}
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
        // Beside the stage and timeline on desktop, divided from them by a rule
        className="flex min-w-0 flex-col gap-1 studio:-mr-1 studio:min-h-0 studio:overflow-y-auto studio:border-l-2 studio:border-theme-border studio:pl-5 studio:pr-1"
      >
        <div
          id="workspace-panel-mix-audio"
          {...workspacePanelProps('mix', asTabs)}
          data-testid="studio-panel-audio"
          className={cn(panelVisibility(activeTab, 'mix'), 'scroll-mt-3')}
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
              syncJobActive
                ? 'Wait for the lyric re-alignment to finish first'
                : vocalSplitActive
                  ? 'Wait for the vocal split to finish first'
                  : null
            }
            vocalParts={vocalParts}
          />
        </div>

        <div
          id="workspace-panel-mix-theme"
          {...workspacePanelProps('mix', asTabs)}
          data-testid="studio-panel-theme"
          className={cn(panelVisibility(activeTab, 'mix'), '')}
        >
          <VisualThemePicker
            selectedTheme={theme.selectedTheme}
            onSelectTheme={theme.setSelectedTheme}
            aspectRatio={theme.aspectRatio}
            onChangeAspectRatio={theme.setAspectRatio}
            onCustomBgUploaded={theme.setCustomBgId}
            customBgId={theme.customBgId}
            backgroundStyle={theme.backgroundStyle}
            onBackgroundStyleChange={theme.setBackgroundStyle}
            hasArtwork={Boolean(project.thumbnail_url)}
            songLoop={songLoop}
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

// Memoized: the app re-renders for dialogs, toasts and the header; the workspace only
// when its own inputs change
export const StudioWorkspace = React.memo(StudioWorkspaceView);

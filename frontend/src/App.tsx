/**
 * Karaoke Studio Main Application Shell
 *
 * Root orchestrator coordinating intake (search/upload), background processing
 * state transitions, active studio dashboard, global keyboard shortcuts, and dialog modals.
 */

import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { TrackSearch } from './components/TrackSearch';
import { StudioHeader } from './components/StudioHeader';
import { ProcessingView } from './components/ProcessingView';
import { RenderProgressAnnouncer } from './components/RenderProgressAnnouncer';
import { StudioModals } from './components/StudioModals';
import { StudioWorkspace } from './components/studio/StudioWorkspace';
import { TransportDock } from './components/transport/TransportDock';
import { LyricLine, SyncDisplayMode, StudioWorkspaceTab } from './types';
import { useProjectChords } from './hooks/useProjectChords';
import { useTrackIntake } from './hooks/useTrackIntake';
import { useQualityJobs } from './hooks/useQualityJobs';
import { apiFetch, readApiError } from './api';
import { useProjectPolling } from './hooks/useProjectPolling';
import { useRenderOutcomeToast } from './hooks/useRenderOutcomeToast';
import { useToast } from './hooks/useToast';
import { useUpdatePrompt } from './hooks/useUpdatePrompt';
import { isInputElement, isModalActive, useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useStudioAudio } from './hooks/useStudioAudio';
import { useStableHandlers } from './hooks/useStableHandlers';
import { PlaybackClockContext } from './hooks/usePlaybackClock';
import { useStudioAuth } from './hooks/useStudioAuth';
import { useVisualTheme } from './hooks/useVisualTheme';
import { useMixController } from './hooks/useMixController';
import { useStudioCommands } from './hooks/useStudioCommands';
import { useWaveformPeaksState } from './hooks/useWaveformPeaks';
import { isGeneratedStyle } from './theme/stageBackgrounds';
import { CommandPaletteProvider } from './components/commandPalette/CommandPaletteProvider';
import { AppThemeProvider, AppThemeContext, useAppTheme } from './context/AppThemeContext';
import { cn } from './utils/cn';
import { focusQuietly } from './utils/focusIntent';
import { pageTitle } from './utils/pageTitle';
import type { AudioPlaybackError } from './utils/audioErrors';

export const AppContent: React.FC = () => {
  const { toast } = useToast();
  useUpdatePrompt();
  useAppTheme();
  const { project, setProject, isReconnecting, retryPolling } = useProjectPolling(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isLyricsDirty, setIsLyricsDirty] = useState(false);
  const [showStudioDeleteModal, setShowStudioDeleteModal] = useState(false);
  const [showStudioEditModal, setShowStudioEditModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);

  // Mobile Studio Workspace Navigation State (Stage / Timeline / Mix)
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<StudioWorkspaceTab>('stage');
  const [trackedProjectId, setTrackedProjectId] = useState<string | undefined>(project?.id);

  // Reset to 'stage' synchronously when switching active projects or resetting
  if (trackedProjectId !== project?.id) {
    setTrackedProjectId(project?.id);
    setActiveWorkspaceTab('stage');
  }

  // Stage look & preview toggles, remembered across reloads
  const theme = useVisualTheme(undefined, { persist: true });
  const { showVisualizer, showChordBar } = theme;

  // Authentication & Friend Profile Hook
  const {
    showAuthModal,
    setShowAuthModal,
    currentUser,
    authToken,
    handleAuthSuccess,
    authRequired,
    isAuthLocked,
  } = useStudioAuth();

  // Audio Playback Hook
  const audio = useStudioAudio(project);
  const { audioRef, duration, isPlaying, isMuted, setIsPlaying } = audio;
  const { queueSeek } = audio;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('project');
    const tParam = params.get('t');
    if (!projectId) return;

    apiFetch(`/api/project/${projectId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.id) {
          setProject(data);
          const seekTime = tParam ? parseFloat(tParam) : NaN;
          if (!isNaN(seekTime)) queueSeek(seekTime);
        }
      })
      .catch((e) => console.error('Failed to load project from URL parameter', e));
  }, [setProject, queueSeek]);

  const handleCancelProcess = async () => {
    if (!project?.id) return;
    try {
      const res = await apiFetch(`/api/project/${project.id}/cancel`, { method: 'POST' });
      if (!res.ok) toast.error(await readApiError(res, 'Could not cancel processing'));
    } catch (e) {
      console.error('Cancel failed', e);
      toast.error('Could not reach the server to cancel processing');
    }
    setProject(null);
  };

  const handleCancelRender = async () => {
    if (!project?.id) return;
    try {
      const res = await apiFetch(`/api/project/${project.id}/cancel-render`, {
        method: 'POST',
      });
      if (!res.ok) toast.error(await readApiError(res, 'Could not cancel the render'));
    } catch (e) {
      console.error('Cancel render failed', e);
      toast.error('Could not reach the server to cancel the render');
    }
    setProject((prev) => (prev ? { ...prev, render_status: 'idle', render_progress: 0 } : null));
    setIsExportOpen(false);
  };

  const isStudioReady = Boolean(project && project.status === 'ready');
  const openExport = useCallback(() => setIsExportOpen(true), []);
  useRenderOutcomeToast(project, openExport);

  // The tab title names the open song (and its progress while it is processed)
  const title = pageTitle(project);
  useEffect(() => {
    document.title = title;
  }, [title]);

  // When the screen changes (library, processing, studio) the control that had focus is
  // gone; move focus to the new screen's heading so keyboard and screen reader users land
  // at its top instead of on the page body
  const view = !project ? 'library' : isStudioReady ? 'studio' : 'processing';
  const previousViewRef = useRef(view);
  useEffect(() => {
    if (previousViewRef.current === view) return;
    previousViewRef.current = view;
    if (isModalActive() || isInputElement(document.activeElement)) return;
    focusQuietly(document.querySelector<HTMLElement>('main [data-view-heading]'));
  }, [view]);

  // Keep the open song in the address bar (?project=…) so a reload reopens it; the
  // deep-link loader above reads it back
  const projectId = project?.id;
  const previousProjectIdRef = useRef(projectId);
  useEffect(() => {
    const closedProject = Boolean(previousProjectIdRef.current) && !projectId;
    previousProjectIdRef.current = projectId;
    const params = new URLSearchParams(window.location.search);
    if (projectId && params.get('project') !== projectId) {
      params.set('project', projectId);
      params.delete('t');
    } else if (closedProject) {
      params.delete('project');
      params.delete('t');
    } else {
      return;
    }
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', url);
  }, [projectId]);

  const { chordHistory, handleEditChord } = useProjectChords({
    project,
    setProject,
    isStudioReady,
  });
  const waveform = useWaveformPeaksState(project?.id, isStudioReady, project?.master_audio_url);
  const intake = useTrackIntake({ currentUser, setProject });
  const quality = useQualityJobs({ project, setProject });

  const handleToggleChordBar = theme.toggleChordBar;
  const handleToggleVisualizer = theme.toggleVisualizer;

  // Key + guide vocal mix: requested values render immediately, the server re-mix is
  // debounced and the new master swaps in without losing the playback position.
  const mix = useMixController({
    projectId: isStudioReady ? project?.id : undefined,
    initialSemitones: project?.semitones ?? 0,
    initialGuideVolume: project?.guide_volume ?? 0,
    onApplied: ({ semitones, guideVolume, masterAudioUrl }) =>
      setProject((prev) =>
        prev
          ? {
              ...prev,
              master_audio_url: masterAudioUrl ?? prev.master_audio_url,
              semitones,
              guide_volume: guideVolume,
            }
          : prev
      ),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to apply audio mix'),
  });

  const handleOpenMixSettings = useCallback(() => {
    setActiveWorkspaceTab('mix');
    window.requestAnimationFrame(() => {
      const panel = document.getElementById('workspace-panel-mix-audio');
      if (!panel) return;
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      panel.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
      panel.focus({ preventScroll: true });
    });
  }, []);

  useKeyboardShortcuts({
    onTogglePlay: isStudioReady ? audio.handleTogglePlay : undefined,
    onSeek: isStudioReady ? audio.handleSeek : undefined,
    onToggleMute: isStudioReady ? audio.handleToggleMute : undefined,
    onToggleVisualizer: isStudioReady ? handleToggleVisualizer : undefined,
    onToggleChordBar: isStudioReady ? handleToggleChordBar : undefined,
    onToggleHelp: () => setShowHelpModal((prev) => !prev),
    lines: isStudioReady ? project?.lines : undefined,
    precisionSeeking: isStudioReady,
    fineSeekStep: 1,
    coarseSeekStep: 15,
    audioRef,
    getCurrentTime: audio.getCurrentTime,
    duration,
    enabled: !showAuthModal,
    seekStep: 5,
  });

  // Save edited lyric timings to backend
  const handleSaveLines = async (updatedLines: LyricLine[]) => {
    if (!project?.id) return;
    try {
      const res = await apiFetch(`/api/project/${project.id}/lyrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: updatedLines }),
      });
      if (res.ok) {
        setProject((prev) => (prev ? { ...prev, lines: updatedLines } : null));
      } else {
        throw new Error(await readApiError(res, 'Server returned non-200 while saving lyrics'));
      }
    } catch (err) {
      console.error('Failed to update lyrics:', err);
      throw err;
    }
  };

  // Trigger Video Render with custom theme, colors & font size scale
  const handleStartRender = async (options?: {
    includeVisualizer?: boolean;
    includeCountdown?: boolean;
    includeChords?: boolean;
    syncMode?: SyncDisplayMode;
  }) => {
    if (!project?.id) return;
    setIsExportOpen(true);
    const effectiveSyncMode = options?.syncMode ?? theme.syncMode;
    const style = theme.backgroundStyle;
    const generated = isGeneratedStyle(style);

    try {
      const res = await apiFetch(`/api/project/${project.id}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semitones: mix.semitones,
          guide_volume: mix.guideVolume,
          aspect_ratio: theme.aspectRatio,
          // The upload only when it is the chosen background (it outranks every style)
          custom_bg_id: style === 'custom' ? theme.customBgId || undefined : undefined,
          sync_mode: effectiveSyncMode,
          include_visualizer: options?.includeVisualizer ?? showVisualizer,
          include_countdown: options?.includeCountdown ?? true,
          include_chords: options?.includeChords ?? false,
          style_config: {
            theme_id: theme.selectedTheme.id,
            primary_color: theme.customSungColor || theme.selectedTheme.primary_color,
            secondary_color: theme.customUnsungColor || theme.selectedTheme.secondary_color,
            font_size_scale: theme.fontSizeScale,
            sync_mode: effectiveSyncMode,
            // Match the live preview: duet colors and the preset backdrop behind artwork
            singer2_color: theme.activeSinger2Color,
            both_color: theme.activeBothColor,
            background_color: theme.stageBackgroundColor,
            // Cover art is the renderer's default; generated styles also need colours and tone
            background_style: style === 'artwork' || style === 'custom' ? undefined : style,
            background_palette: generated ? theme.backgroundPalette : undefined,
            background_tone:
              generated && theme.selectedTheme.tone === 'light' ? 'light' : undefined,
          },
        }),
      });
      if (!res.ok) {
        // e.g. 409 while this song already renders, 400 before its stems are ready
        toast.error(await readApiError(res, 'Could not start the video render'));
        return;
      }
      setProject((prev) =>
        prev ? { ...prev, render_status: 'queued', render_progress: 10 } : null
      );
    } catch (err) {
      console.error('Render request failed:', err);
      toast.error('Could not reach the server to start the render');
    }
  };

  const handleStudioProjectDeleted = () => {
    setIsLyricsDirty(false);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    setIsPlaying(false);

    setProject(null);
    setActiveWorkspaceTab('stage');
    setShowStudioDeleteModal(false);
    toast.success('Project deleted successfully');
  };

  const resetToLibrary = () => {
    setProject(null);
    setActiveWorkspaceTab('stage');
  };

  // Fixed identities for the handlers given to the memoized header, workspace and dock
  const handlers = useStableHandlers({
    toggleHelp: () => setShowHelpModal((prev) => !prev),
    openAuth: () => setShowAuthModal(true),
    newSong: resetToLibrary,
    saveLines: handleSaveLines,
    openEditModal: () => setShowStudioEditModal(true),
    openDeleteModal: () => setShowStudioDeleteModal(true),
    customInstrumentalUploaded: (url: string) =>
      setProject((prev) => (prev ? { ...prev, instrumental_url: url } : prev)),
    playbackEnded: () => setIsPlaying(false),
    playbackError: (err: AudioPlaybackError) => {
      console.error('Audio playback error:', err);
      setIsPlaying(false);
    },
  });

  useStudioCommands({
    project,
    isStudioReady,
    hasUnsavedEdits: isLyricsDirty || chordHistory.isDirty,
    audio,
    mix,
    theme,
    onOpenExport: () => setIsExportOpen(true),
    onOpenEdit: () => setShowStudioEditModal(true),
    onOpenDelete: () => setShowStudioDeleteModal(true),
    onOpenHelp: () => setShowHelpModal(true),
    onNewSong: resetToLibrary,
    onOpenProject: (p) => {
      setProject(p);
      setActiveWorkspaceTab('stage');
    },
    onSelectTab: setActiveWorkspaceTab,
    quality,
  });

  const handleStudioMetadataSaved = (updated: { id: string; title: string; artist: string }) => {
    setProject((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
    setShowStudioEditModal(false);
    toast.success('Project details updated');
  };

  return (
    // The playback position is a store, not App state: only the components reading it
    // re-render on each media timeupdate
    <PlaybackClockContext.Provider value={audio.clock}>
      <div
        className={cn(
          'min-h-screen bg-theme-bg text-theme-text flex flex-col font-theme-body',
          isStudioReady && 'studio:h-[100dvh] studio:overflow-hidden'
        )}
      >
        <div
          className={cn(
            'flex-1 flex flex-col',
            isStudioReady && 'studio:min-h-0',
            showAuthModal && 'pointer-events-none select-none'
          )}
          {...(showAuthModal
            ? ({ inert: '', 'aria-hidden': 'true' } as Record<string, string>)
            : {})}
        >
          <StudioHeader
            currentUser={currentUser}
            project={project}
            isLyricsDirty={isLyricsDirty || chordHistory.isDirty}
            onOpenHelp={handlers.toggleHelp}
            onOpenAuth={handlers.openAuth}
            onNewSong={handlers.newSong}
            isExportModalOpen={isExportOpen}
            onOpenExportModal={openExport}
          />

          <main
            className={cn(
              'flex-1 w-full mx-auto',
              isStudioReady
                ? 'max-w-screen-2xl pb-[calc(var(--dock-height,8.5rem)+1rem)] md:pb-0 studio:min-h-0'
                : 'max-w-7xl px-3 sm:px-4 pt-4 sm:pt-8 pb-4 sm:pb-8'
            )}
          >
            {!project ? (
              <TrackSearch
                onSelectTrack={intake.handleSelectTrack}
                onUploadTrack={intake.handleUploadTrack}
                separationQuality={intake.separationQuality}
                onSeparationQualityChange={intake.setSeparationQuality}
                onOpenProject={(p) => {
                  setProject(p);
                  setActiveWorkspaceTab('stage');
                }}
                isLoading={intake.loading}
                currentUser={currentUser}
                authToken={authToken}
              />
            ) : project.status !== 'ready' ? (
              <ProcessingView
                project={project}
                isReconnecting={isReconnecting}
                onRetryPolling={retryPolling}
                onCancelProcess={handleCancelProcess}
                onResetProject={() => {
                  setProject(null);
                  setActiveWorkspaceTab('stage');
                }}
              />
            ) : (
              <StudioWorkspace
                project={project}
                activeTab={activeWorkspaceTab}
                onSelectTab={setActiveWorkspaceTab}
                hasUnsavedChanges={isLyricsDirty || chordHistory.isDirty}
                onLyricsDirtyChange={setIsLyricsDirty}
                onSaveLines={handlers.saveLines}
                onEditChord={handleEditChord}
                onOpenEditModal={handlers.openEditModal}
                onOpenDeleteModal={handlers.openDeleteModal}
                onCustomInstrumentalUploaded={handlers.customInstrumentalUploaded}
                audio={audio}
                mix={mix}
                theme={theme}
                showVisualizer={showVisualizer}
                onToggleVisualizer={handleToggleVisualizer}
                showChordBar={showChordBar}
                onToggleChordBar={handleToggleChordBar}
                quality={quality}
              />
            )}
          </main>

          {/* Transport dock: fixed mini-player on phones, docked bar on desktop */}
          {isStudioReady && project && (
            <TransportDock
              masterAudioUrl={project.master_audio_url}
              lines={project.lines}
              duration={duration}
              isPlaying={isPlaying}
              onTogglePlay={audio.handleTogglePlay}
              onSeek={audio.handleSeek}
              audioRef={audioRef}
              onTimeUpdate={audio.handleTimeUpdate}
              onLoadedMetadata={audio.handleLoadedMetadata}
              onEnded={handlers.playbackEnded}
              onPlaybackError={handlers.playbackError}
              initialMuted={isMuted}
              onMuteChange={audio.setIsMuted}
              playbackRate={audio.playbackRate}
              onPlaybackRateChange={audio.setPlaybackRate}
              semitones={mix.semitones}
              isRemixing={mix.isRemixing}
              onOpenMixSettings={handleOpenMixSettings}
              peaks={waveform.peaks}
              peaksPending={!waveform.settled}
              mediaTitle={project.title}
              mediaArtist={project.artist}
              mediaArtworkUrl={project.thumbnail_url}
            />
          )}
          {isStudioReady && project && <RenderProgressAnnouncer project={project} />}
        </div>

        {/* Studio Modal Dialogs */}
        <StudioModals
          project={project}
          isExportOpen={isExportOpen}
          onCloseExport={() => setIsExportOpen(false)}
          onCancelRender={handleCancelRender}
          onStartRender={handleStartRender}
          selectedTheme={theme.effectiveTheme}
          aspectRatio={theme.aspectRatio}
          activeSemitones={mix.semitones}
          syncMode={theme.syncMode}
          onSyncModeChange={theme.setSyncMode}
          primaryColor={theme.customSungColor || undefined}
          secondaryColor={theme.customUnsungColor || undefined}
          singer2Color={theme.activeSinger2Color}
          bothColor={theme.activeBothColor}
          backgroundColor={theme.stageBackgroundColor}
          fontSizeScale={theme.fontSizeScale}
          showAuthModal={showAuthModal}
          onAuthSuccess={handleAuthSuccess}
          onCloseAuth={() => setShowAuthModal(false)}
          authDismissable={!isAuthLocked}
          authRequiresPassword={authRequired}
          showHelpModal={showHelpModal}
          onCloseHelp={() => setShowHelpModal(false)}
          showStudioDeleteModal={showStudioDeleteModal}
          onCloseStudioDelete={() => setShowStudioDeleteModal(false)}
          onStudioProjectDeleted={handleStudioProjectDeleted}
          showStudioEditModal={showStudioEditModal}
          onCloseStudioEdit={() => setShowStudioEditModal(false)}
          onStudioMetadataSaved={handleStudioMetadataSaved}
          quality={quality}
          hasUnsavedLyricEdits={isLyricsDirty}
        />
      </div>
    </PlaybackClockContext.Provider>
  );
};

export const App: React.FC = () => {
  const existingContext = useContext(AppThemeContext);
  const content = (
    <CommandPaletteProvider>
      <AppContent />
    </CommandPaletteProvider>
  );
  return existingContext ? content : <AppThemeProvider>{content}</AppThemeProvider>;
};

export default App;

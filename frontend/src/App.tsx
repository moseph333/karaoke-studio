/**
 * Karaoke Studio Main Application Shell
 *
 * Root orchestrator coordinating intake (search/upload), background processing
 * state transitions, active studio dashboard, global keyboard shortcuts, and dialog modals.
 */

import React, { Suspense, useState, useEffect, useCallback, useContext, useRef } from 'react';
import { TrackSearch } from './components/TrackSearch';
import { StudioHeader } from './components/StudioHeader';
import { ProcessingView } from './components/ProcessingView';
import { RenderProgressAnnouncer } from './components/RenderProgressAnnouncer';
import { StudioModals } from './components/StudioModals';
import { InstallAppDialog } from './components/InstallAppDialog';
import { StudioSkeleton, WhenShown } from './components/studio/StudioSkeleton';
import { StudioWorkspace, TransportDock } from './deferredScreens';
import { LyricLine, ProjectState, SyncDisplayMode, StudioWorkspaceTab } from './types';
import type { EditedMetadata } from './components/EditMetadataModal';
import { useProjectChords } from './hooks/useProjectChords';
import { useVocalRangeBackfill } from './hooks/useVocalRangeBackfill';
import { useTrackIntake } from './hooks/useTrackIntake';
import { useQualityJobs } from './hooks/useQualityJobs';
import { apiFetch, readApiError } from './api';
import { useProjectPolling } from './hooks/useProjectPolling';
import { useRenderOutcomeToast } from './hooks/useRenderOutcomeToast';
import { useFirstSongGuide } from './hooks/useFirstSongGuide';
import { useGuideActions } from './hooks/useGuideActions';
import { isUploadedSong, retryInput } from './utils/processingErrors';
import type { HelpTab } from './utils/guideActions';
import { useToast } from './hooks/useToast';
import { useUpdatePrompt } from './hooks/useUpdatePrompt';
import { useServerUpdatePrompt } from './hooks/useServerUpdatePrompt';
import { useUpdateDrainNotice } from './hooks/useUpdateDrainNotice';
import { useInstallPrompt } from './hooks/useInstallPrompt';
import { PROJECT_PARAM, useProjectHistory } from './hooks/useProjectHistory';
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
import { SHARE_PARAMS, sharedIntakeQuery, urlWithoutShareParams } from './utils/sharedLink';
import {
  SHORTCUT_PARAM,
  forgetLastProject,
  launchShortcut,
  readLastProject,
  rememberLastProject,
  urlWithoutShortcut,
} from './utils/appShortcut';
import type { AudioPlaybackError } from './utils/audioErrors';

export const AppContent: React.FC = () => {
  const { toast } = useToast();
  useUpdatePrompt();
  useServerUpdatePrompt();
  useUpdateDrainNotice();
  useAppTheme();
  const { project, setProject, isReconnecting, retryPolling } = useProjectPolling(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isLyricsDirty, setIsLyricsDirty] = useState(false);
  const [showStudioDeleteModal, setShowStudioDeleteModal] = useState(false);
  const [showStudioEditModal, setShowStudioEditModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  // Help opens on its shortcut list, except from guidance that points at "Fix a problem"
  const [helpTab, setHelpTab] = useState<HelpTab>('shortcuts');
  const toggleHelp = useCallback(() => {
    setHelpTab('shortcuts');
    setShowHelpModal((prev) => !prev);
  }, []);
  const [showCheckup, setShowCheckup] = useState(false);
  const [showInstallSteps, setShowInstallSteps] = useState(false);
  const openInstallSteps = useCallback(() => setShowInstallSteps(true), []);
  const installApp = useInstallPrompt(openInstallSteps);

  // Mobile Studio Workspace Navigation State (Stage / Timeline / Mix)
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<StudioWorkspaceTab>('stage');
  const [trackedProjectId, setTrackedProjectId] = useState<string | undefined>(project?.id);

  // Reset to 'stage' and close the song's dialogs synchronously when switching active
  // projects or resetting
  if (trackedProjectId !== project?.id) {
    setTrackedProjectId(project?.id);
    setActiveWorkspaceTab('stage');
    setShowCheckup(false);
    // A dialog left open over one song (Back was pressed, the song was switched from the
    // palette) must not reopen over the library or the next song
    setIsExportOpen(false);
    setShowStudioEditModal(false);
    setShowStudioDeleteModal(false);
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

  // Fetches a song in full, then opens it; a failure says so and stays put. The song asked
  // for last wins, whichever reply arrives first.
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const openingRef = useRef<string | null>(null);
  const fetchAndOpenProject = useCallback(
    (
      projectId: string,
      {
        seekTime,
        onFailed,
        onMissing,
      }: { seekTime?: number; onFailed?: () => void; onMissing?: () => void } = {}
    ) => {
      setActiveWorkspaceTab('stage');
      openingRef.current = projectId;
      setOpeningProjectId(projectId);
      apiFetch(`/api/project/${projectId}`)
        .then(async (res) => {
          // Signed out: the sign-in dialog is the message, and the address keeps the song
          // for the retry after signing in
          if (res.status === 401) return null;
          if (res.status === 404) onMissing?.();
          if (!res.ok) throw new Error(await readApiError(res, 'Could not open this song'));
          const data: ProjectState | null = await res.json();
          if (!data?.id) throw new Error('Could not open this song');
          return data;
        })
        .then((data) => {
          if (!data || openingRef.current !== projectId) return;
          setProject(data);
          if (seekTime !== undefined && !isNaN(seekTime)) queueSeek(seekTime);
        })
        .catch((err) => {
          if (openingRef.current !== projectId) return;
          console.error('Failed to open project', err);
          toast.error(err instanceof Error ? err.message : 'Could not open this song');
          onFailed?.();
        })
        .finally(() => {
          if (openingRef.current !== projectId) return;
          openingRef.current = null;
          setOpeningProjectId(null);
        });
    },
    [setProject, queueSeek, toast]
  );

  // Opens a song by id: from a ?project= link (with an optional ?t= seek) or a history
  // entry. A song that cannot be opened is taken out of the address again: left there, the
  // next song opened would replace that entry and Back would leave the app.
  const openProjectById = useCallback(
    (projectId: string, seekTime?: number, onMissing?: () => void) =>
      fetchAndOpenProject(projectId, {
        seekTime,
        onMissing,
        onFailed: () => {
          const params = new URLSearchParams(window.location.search);
          if (params.get(PROJECT_PARAM) !== projectId) return;
          params.delete(PROJECT_PARAM);
          params.delete('t');
          const query = params.toString();
          window.history.replaceState(
            window.history.state,
            '',
            `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
          );
        },
      }),
    [fetchAndOpenProject]
  );

  // A library card: the list holds card-sized entries (marked `summary`), so the song is
  // fetched in full first. Other callers (uploads, tests' fixtures) pass whole songs.
  const openLibraryProject = useCallback(
    (p: ProjectState) => {
      if (p.summary) {
        fetchAndOpenProject(p.id);
        return;
      }
      setActiveWorkspaceTab('stage');
      setProject(p);
    },
    [setProject, fetchAndOpenProject]
  );

  // The song named in the address: on load, and again after signing in when the first
  // attempt was turned away
  const openProjectRef = useRef(project);
  openProjectRef.current = project;
  useEffect(() => {
    if (openProjectRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get(PROJECT_PARAM);
    const tParam = params.get('t');
    if (!projectId) return;
    openProjectById(projectId, tParam ? parseFloat(tParam) : undefined);
  }, [openProjectById, authToken]);

  // Something shared into the installed app (Android share sheet): pre-fill the song search
  // with it, then tidy the address bar
  const [sharedQuery, setSharedQuery] = useState(() =>
    sharedIntakeQuery(new URLSearchParams(window.location.search))
  );
  if (sharedQuery && project) setSharedQuery(null); // used once; the library opens empty later
  useEffect(() => {
    if (!SHARE_PARAMS.some((key) => new URLSearchParams(window.location.search).has(key))) return;
    window.history.replaceState(window.history.state, '', urlWithoutShareParams(window.location));
  }, []);

  // Launched from the installed app's icon menu (`shortcuts` in the manifest): "New song"
  // and "Upload audio" set up the intake card, "Continue last song" reopens the song this
  // device had open last. The parameter then leaves the address.
  const [shortcut, setShortcut] = useState(() =>
    launchShortcut(new URLSearchParams(window.location.search))
  );
  if (shortcut && project) setShortcut(null); // used once, like a share
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has(SHORTCUT_PARAM)) return;
    const launched = launchShortcut(params);
    window.history.replaceState(window.history.state, '', urlWithoutShortcut(window.location));
    const lastProjectId = launched === 'resume' ? readLastProject() : null;
    if (lastProjectId) openProjectById(lastProjectId, undefined, forgetLastProject);
  }, [openProjectById]);
  useEffect(() => {
    if (project?.id) rememberLastProject(project.id);
  }, [project?.id]);

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
  // First finished song in this browser: the studio shows its getting-started steps
  const firstSong = useFirstSongGuide();

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
  const headingFocusPending = useRef(false);
  const focusViewHeading = useCallback(() => {
    const heading = document.querySelector<HTMLElement>('main [data-view-heading]');
    // The studio's code may still be loading: its heading takes focus once it is shown
    headingFocusPending.current = !heading;
    if (!heading || isModalActive() || isInputElement(document.activeElement)) return;
    focusQuietly(heading);
  }, []);
  useEffect(() => {
    if (previousViewRef.current === view) return;
    previousViewRef.current = view;
    focusViewHeading();
  }, [view, focusViewHeading]);
  const handleStudioShown = useCallback(() => {
    if (headingFocusPending.current) focusViewHeading();
  }, [focusViewHeading]);

  const { chordHistory, handleEditChord } = useProjectChords({
    project,
    setProject,
    isStudioReady,
  });
  useVocalRangeBackfill({ project, setProject });
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

  // Guidance buttons (the song check-up's fixes) take the user to the tool they name
  const runGuideAction = useGuideActions({
    project,
    isPlaying,
    onTogglePlay: audio.handleTogglePlay,
    onSeek: audio.handleSeek,
    onSelectTab: setActiveWorkspaceTab,
    onOpenMix: handleOpenMixSettings,
    onOpenExport: openExport,
    onOpenCheckup: () => setShowCheckup(true),
    onOpenHelpFix: () => {
      setHelpTab('fix');
      setShowHelpModal(true);
    },
    onCloseGuidance: () => {
      setShowCheckup(false);
      setShowHelpModal(false);
    },
  });

  useKeyboardShortcuts({
    onTogglePlay: isStudioReady ? audio.handleTogglePlay : undefined,
    onSeek: isStudioReady ? audio.handleSeek : undefined,
    onToggleMute: isStudioReady ? audio.handleToggleMute : undefined,
    onToggleVisualizer: isStudioReady ? handleToggleVisualizer : undefined,
    onToggleChordBar: isStudioReady ? handleToggleChordBar : undefined,
    onToggleHelp: toggleHelp,
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

  // ?project=… in the address bar (a reload reopens the song) and a history entry per song,
  // so Back, including the Android back gesture in the installed app, returns to the library
  useProjectHistory({
    projectId: project?.id,
    hasUnsavedEdits: isLyricsDirty || chordHistory.isDirty,
    onBackToLibrary: resetToLibrary,
    onRestoreProject: openProjectById,
  });

  // Fixed identities for the handlers given to the memoized header, workspace and dock
  const handlers = useStableHandlers({
    toggleHelp,
    openAuth: () => setShowAuthModal(true),
    newSong: resetToLibrary,
    saveLines: handleSaveLines,
    openEditModal: () => setShowStudioEditModal(true),
    openDeleteModal: () => setShowStudioDeleteModal(true),
    openCheckup: () => setShowCheckup(true),
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
    onOpenHelp: () => {
      setHelpTab('shortcuts');
      setShowHelpModal(true);
    },
    onOpenCheckup: handlers.openCheckup,
    onShowFirstSongSteps: firstSong.visible ? undefined : firstSong.show,
    onNewSong: resetToLibrary,
    // The palette's song list is a snapshot that can be half a minute old: open the song
    // as the server has it now
    onOpenProject: (p) => fetchAndOpenProject(p.id),
    onSelectTab: setActiveWorkspaceTab,
    quality,
    onInstallApp: installApp.canInstall ? installApp.install : undefined,
  });

  const handleStudioMetadataSaved = (updated: EditedMetadata) => {
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
          // Landscape phones: keep content out of the notch and rounded corners
          'pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)]',
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
            onInstallApp={installApp.showHeaderButton ? installApp.install : undefined}
          />

          <main
            className={cn(
              'flex-1 w-full mx-auto',
              isStudioReady
                ? 'max-w-screen-2xl pb-[calc(var(--dock-height,8.5rem)+1rem)] md:pb-0 studio:min-h-0'
                : cn(
                    'max-w-7xl px-3 sm:px-4 pt-4 sm:pt-8',
                    // Where the page draws under the gesture bar or home indicator, the last
                    // card stays clear of it
                    'pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:pb-[calc(2rem+env(safe-area-inset-bottom,0px))]'
                  )
            )}
          >
            {!project ? (
              <TrackSearch
                onSelectTrack={intake.handleSelectTrack}
                onUploadTrack={intake.handleUploadTrack}
                separationQuality={intake.separationQuality}
                onSeparationQualityChange={intake.setSeparationQuality}
                onOpenProject={openLibraryProject}
                openingProjectId={openingProjectId}
                isLoading={intake.loading}
                currentUser={currentUser}
                authToken={authToken}
                initialQuery={sharedQuery ?? undefined}
                initialMode={shortcut === 'upload' ? 'local' : undefined}
                focusSearch={shortcut === 'new'}
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
                // The server starts a song again from its link (a YouTube song also from its
                // id); an upload is sent again
                onRetry={
                  isUploadedSong(project)
                    ? undefined
                    : () => void intake.handleSelectTrack(retryInput(project), undefined, project)
                }
                isRetrying={intake.loading}
              />
            ) : (
              <Suspense fallback={<StudioSkeleton />}>
                <WhenShown onShown={handleStudioShown} />
                {/* Keyed by song: another song starts with a fresh editor, never with the
                    previous song's unsaved lines, filters or open tools */}
                <StudioWorkspace
                  key={project.id}
                  project={project}
                  activeTab={activeWorkspaceTab}
                  onSelectTab={setActiveWorkspaceTab}
                  hasUnsavedChanges={isLyricsDirty || chordHistory.isDirty}
                  onLyricsDirtyChange={setIsLyricsDirty}
                  onSaveLines={handlers.saveLines}
                  onEditChord={handleEditChord}
                  onOpenEditModal={handlers.openEditModal}
                  onOpenDeleteModal={handlers.openDeleteModal}
                  onOpenCheckup={handlers.openCheckup}
                  onCustomInstrumentalUploaded={handlers.customInstrumentalUploaded}
                  audio={audio}
                  mix={mix}
                  theme={theme}
                  showVisualizer={showVisualizer}
                  onToggleVisualizer={handleToggleVisualizer}
                  showChordBar={showChordBar}
                  onToggleChordBar={handleToggleChordBar}
                  quality={quality}
                  showFirstSongCard={firstSong.visible}
                  onDismissFirstSongCard={firstSong.dismiss}
                  onGuideAction={runGuideAction}
                />
              </Suspense>
            )}
          </main>

          {/* Transport dock: fixed mini-player on phones, docked bar on desktop */}
          {isStudioReady && project && (
            <Suspense fallback={null}>
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
            </Suspense>
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
          helpTab={helpTab}
          onCloseHelp={() => setShowHelpModal(false)}
          onShowFirstSongSteps={firstSong.visible ? undefined : firstSong.show}
          showStudioDeleteModal={showStudioDeleteModal}
          onCloseStudioDelete={() => setShowStudioDeleteModal(false)}
          onStudioProjectDeleted={handleStudioProjectDeleted}
          showStudioEditModal={showStudioEditModal}
          onCloseStudioEdit={() => setShowStudioEditModal(false)}
          onStudioMetadataSaved={handleStudioMetadataSaved}
          quality={quality}
          hasUnsavedLyricEdits={isLyricsDirty}
          showCheckup={showCheckup}
          onCloseCheckup={() => setShowCheckup(false)}
          onGuideAction={runGuideAction}
        />
        <InstallAppDialog
          isOpen={showInstallSteps}
          onClose={() => setShowInstallSteps(false)}
          onHideButton={installApp.showHeaderButton ? installApp.hideHeaderButton : undefined}
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

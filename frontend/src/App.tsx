/**
 * Karaoke Studio Main Application Shell
 *
 * Root orchestrator coordinating intake (search/upload), background processing
 * state transitions, active studio dashboard, global keyboard shortcuts, and dialog modals.
 */

import React, { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { TrackSearch } from './components/TrackSearch';
import { StudioHeader } from './components/StudioHeader';
import { ProcessingView } from './components/ProcessingView';
import { StudioModals } from './components/StudioModals';
import { StudioWorkspace } from './components/studio/StudioWorkspace';
import { TransportDock } from './components/transport/TransportDock';
import { LyricLine, ChordSegment, SyncDisplayMode, StudioWorkspaceTab } from './types';
import { useChordHistory } from './hooks/useChordHistory';
import { apiFetch } from './api';
import { useProjectPolling } from './hooks/useProjectPolling';
import { useToast } from './hooks/useToast';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useStudioAudio } from './hooks/useStudioAudio';
import { useStudioAuth } from './hooks/useStudioAuth';
import { useVisualTheme } from './hooks/useVisualTheme';
import { useMixController } from './hooks/useMixController';
import { AppThemeProvider, AppThemeContext, useAppTheme } from './context/AppThemeContext';
import { cn } from './utils/cn';

export const AppContent: React.FC = () => {
  const { toast } = useToast();
  useAppTheme();
  const { project, setProject, isReconnecting, retryPolling } = useProjectPolling(null);
  const [loading, setLoading] = useState(false);
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
  const { showAuthModal, setShowAuthModal, currentUser, authToken, handleAuthSuccess } =
    useStudioAuth();

  // Audio Playback Hook
  const audio = useStudioAudio(project);
  const { audioRef, currentTime, duration, isPlaying, isMuted, setCurrentTime, setIsPlaying } =
    audio;
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
      await apiFetch(`/api/project/${project.id}/cancel`, { method: 'POST' });
    } catch (e) {
      console.error('Cancel failed', e);
    }
    setProject(null);
  };

  const handleCancelRender = async () => {
    if (!project?.id) return;
    try {
      await apiFetch(`/api/project/${project.id}/cancel-render`, {
        method: 'POST',
      });
    } catch (e) {
      console.error('Cancel render failed', e);
    }
    setProject((prev) => (prev ? { ...prev, render_status: 'idle', render_progress: 0 } : null));
    setIsExportOpen(false);
  };

  const isStudioReady = Boolean(project && project.status === 'ready');
  const [initialChords, setInitialChords] = useState<ChordSegment[]>([]);

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

  // Load chords for project when ready
  useEffect(() => {
    if (!project?.id || project.status !== 'ready') return;
    if (project.chords && project.chords.length > 0) return;

    apiFetch(`/api/project/${project.id}/chords`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.chords && Array.isArray(data.chords)) {
          setInitialChords(data.chords);
          setProject((prev) =>
            prev && prev.id === data.project_id ? { ...prev, chords: data.chords } : prev
          );
        }
      })
      .catch((e) => console.error('Failed to load project chords', e));
  }, [project?.id, project?.status, project?.chords, setProject]);

  // Sync initial baseline chords when project changes or chords arrive
  const prevProjectIdRef = useRef<string | undefined>(project?.id);
  useEffect(() => {
    if (!project?.id) {
      setInitialChords([]);
      prevProjectIdRef.current = undefined;
    } else if (prevProjectIdRef.current !== project.id) {
      prevProjectIdRef.current = project.id;
      setInitialChords(project.chords && project.chords.length > 0 ? project.chords : []);
    } else if (project.chords && project.chords.length > 0 && initialChords.length === 0) {
      setInitialChords(project.chords);
    }
  }, [project?.id, project?.chords, initialChords.length]);

  const chordHistoryRef = useRef<ReturnType<typeof useChordHistory> | null>(null);

  // Save edited chord progression to backend
  const handleSaveChords = useCallback(
    async (updatedChords?: ChordSegment[]): Promise<boolean> => {
      if (!project?.id) return false;
      const chordsToSave = updatedChords ?? project.chords ?? [];
      try {
        const res = await apiFetch(`/api/project/${project.id}/chords`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chords: chordsToSave }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          const savedChords = (data?.chords as ChordSegment[]) || chordsToSave;
          setProject((prev) => (prev ? { ...prev, chords: savedChords } : null));
          chordHistoryRef.current?.updateBaseline(savedChords);
          toast.success('Chord progression saved');
          return true;
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || 'Failed to save chords');
        }
      } catch (err: unknown) {
        console.error('Failed to save chords:', err);
        toast.error(err instanceof Error ? err.message : 'Error saving chords');
        throw err;
      }
    },
    [project?.id, project?.chords, setProject, toast]
  );

  // 50-step bounded Undo / Redo history stack hook
  const chordHistory = useChordHistory({
    projectId: project?.id,
    initialChords,
    currentChords: project?.chords,
    enabled: isStudioReady,
    onApplySnapshot: (restoredChords) => {
      setProject((prev) => (prev ? { ...prev, chords: restoredChords } : null));
      handleSaveChords(restoredChords).catch((e) =>
        console.error('Failed to persist snapshot chords', e)
      );
    },
    onSaveSuccess: (savedChords) => {
      setProject((prev) => (prev ? { ...prev, chords: savedChords } : null));
    },
  });
  chordHistoryRef.current = chordHistory;

  // Inline chord cue modification handler
  const handleEditChord = useCallback(
    async (index: number, newChord: string) => {
      if (!project?.chords || index < 0 || index >= project.chords.length) return;
      const current = project.chords;
      chordHistory.pushSnapshot(current);

      const updated = current.map((c, i) => (i === index ? { ...c, chord: newChord } : c));
      setProject((prev) => (prev ? { ...prev, chords: updated } : null));

      try {
        await handleSaveChords(updated);
      } catch (e) {
        console.error('Failed to persist edited chord', e);
      }
    },
    [project?.chords, chordHistory, handleSaveChords, setProject]
  );

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
    currentTime,
    duration,
    enabled: !showAuthModal,
    seekStep: 5,
  });

  // Start processing a new track
  const handleSelectTrack = async (urlOrId: string, customLyrics?: string) => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url_or_id: urlOrId,
          custom_lyrics: customLyrics,
          created_by: currentUser || 'Friend',
        }),
      });
      if (!res.ok) throw new Error('Failed to initiate processing');
      const data = await res.json();
      setProject({
        id: data.project_id,
        status: 'queued',
        progress: 5,
        lines: [],
        semitones: 0,
        guide_volume: 0,
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error processing track');
    } finally {
      setLoading(false);
    }
  };

  // Start processing an uploaded local audio track
  const handleUploadTrack = async (params: {
    file: File;
    title?: string;
    artist?: string;
    customLyrics?: string;
    createdBy?: string;
  }) => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', params.file);
      if (params.title) formData.append('title', params.title);
      if (params.artist) formData.append('artist', params.artist);
      if (params.customLyrics) formData.append('custom_lyrics', params.customLyrics);
      formData.append('created_by', params.createdBy || currentUser || 'Friend');

      const res = await apiFetch('/api/upload-track', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to upload audio track');
      }
      const data = await res.json();
      setProject({
        id: data.project_id,
        status: 'queued',
        progress: 5,
        lines: [],
        semitones: 0,
        guide_volume: 0,
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error uploading audio track');
      throw err;
    } finally {
      setLoading(false);
    }
  };

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
        throw new Error('Server returned non-200 while saving lyrics');
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

    try {
      await apiFetch(`/api/project/${project.id}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semitones: mix.semitones,
          guide_volume: mix.guideVolume,
          aspect_ratio: theme.aspectRatio,
          custom_bg_id: theme.customBgId || undefined,
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
          },
        }),
      });
      setProject((prev) =>
        prev ? { ...prev, render_status: 'queued', render_progress: 10 } : null
      );
    } catch (err) {
      console.error('Render request failed:', err);
    }
  };

  const handleStudioProjectDeleted = () => {
    setIsLyricsDirty(false);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    setIsPlaying(false);
    setCurrentTime(0);

    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    setProject(null);
    setActiveWorkspaceTab('stage');
    setShowStudioDeleteModal(false);
    toast.success('Project deleted successfully');
  };

  const handleStudioMetadataSaved = (updated: { id: string; title: string; artist: string }) => {
    setProject((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
    setShowStudioEditModal(false);
    toast.success('Project details updated');
  };

  return (
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
        {...(showAuthModal ? ({ inert: '', 'aria-hidden': 'true' } as Record<string, string>) : {})}
      >
        <StudioHeader
          currentUser={currentUser}
          project={project}
          isLyricsDirty={isLyricsDirty || chordHistory.isDirty}
          onOpenHelp={() => setShowHelpModal((prev) => !prev)}
          onOpenAuth={() => setShowAuthModal(true)}
          onNewSong={() => {
            setProject(null);
            setActiveWorkspaceTab('stage');
          }}
          isExportModalOpen={isExportOpen}
          onOpenExportModal={() => setIsExportOpen(true)}
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
              onSelectTrack={handleSelectTrack}
              onUploadTrack={handleUploadTrack}
              onOpenProject={(p) => {
                setProject(p);
                setActiveWorkspaceTab('stage');
              }}
              isLoading={loading}
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
              onSaveLines={handleSaveLines}
              onEditChord={handleEditChord}
              onOpenEditModal={() => setShowStudioEditModal(true)}
              onOpenDeleteModal={() => setShowStudioDeleteModal(true)}
              onCustomInstrumentalUploaded={(url) =>
                setProject((prev) => (prev ? { ...prev, instrumental_url: url } : prev))
              }
              audio={audio}
              mix={mix}
              theme={theme}
              showVisualizer={showVisualizer}
              onToggleVisualizer={handleToggleVisualizer}
              showChordBar={showChordBar}
              onToggleChordBar={handleToggleChordBar}
            />
          )}
        </main>

        {/* Transport dock: fixed mini-player on phones, docked bar on desktop */}
        {isStudioReady && project && (
          <TransportDock
            masterAudioUrl={project.master_audio_url}
            lines={project.lines}
            currentTime={currentTime}
            duration={duration}
            isPlaying={isPlaying}
            onTogglePlay={audio.handleTogglePlay}
            onSeek={audio.handleSeek}
            audioRef={audioRef}
            onTimeUpdate={audio.handleTimeUpdate}
            onLoadedMetadata={audio.handleLoadedMetadata}
            onEnded={() => setIsPlaying(false)}
            onPlaybackError={(err) => {
              console.error('Audio playback error:', err);
              setIsPlaying(false);
            }}
            initialMuted={isMuted}
            onMuteChange={audio.setIsMuted}
            playbackRate={audio.playbackRate}
            onPlaybackRateChange={audio.setPlaybackRate}
            semitones={mix.semitones}
            isRemixing={mix.isRemixing}
            onOpenMixSettings={handleOpenMixSettings}
          />
        )}
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
        showHelpModal={showHelpModal}
        onCloseHelp={() => setShowHelpModal(false)}
        showStudioDeleteModal={showStudioDeleteModal}
        onCloseStudioDelete={() => setShowStudioDeleteModal(false)}
        onStudioProjectDeleted={handleStudioProjectDeleted}
        showStudioEditModal={showStudioEditModal}
        onCloseStudioEdit={() => setShowStudioEditModal(false)}
        onStudioMetadataSaved={handleStudioMetadataSaved}
      />
    </div>
  );
};

export const App: React.FC = () => {
  const existingContext = useContext(AppThemeContext);
  if (existingContext) {
    return <AppContent />;
  }
  return (
    <AppThemeProvider>
      <AppContent />
    </AppThemeProvider>
  );
};

export default App;

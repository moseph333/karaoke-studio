/**
 * Karaoke Studio Main Application Shell
 *
 * Root orchestrator coordinating intake (search/upload), background processing
 * state transitions, active studio dashboard, global keyboard shortcuts, and dialog modals.
 */

import React, { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { TrackSearch } from './components/TrackSearch';
import { AudioControls } from './components/AudioControls';
import { LyricTimelineEditor } from './components/LyricTimelineEditor';
import { VisualThemePicker } from './components/VisualThemePicker';
import { StudioHeader } from './components/StudioHeader';
import { ProcessingView } from './components/ProcessingView';
import { StudioMetaHeader } from './components/StudioMetaHeader';
import { StudioModals } from './components/StudioModals';
import { LyricLine, ChordSegment, SyncDisplayMode } from './types';
import { useChordHistory } from './hooks/useChordHistory';
import { apiFetch } from './api';
import { useProjectPolling } from './hooks/useProjectPolling';
import { useToast } from './hooks/useToast';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useStudioAudio } from './hooks/useStudioAudio';
import { useStudioAuth } from './hooks/useStudioAuth';
import { useVisualTheme } from './hooks/useVisualTheme';
import { AppThemeProvider, AppThemeContext, useAppTheme } from './context/AppThemeContext';

export const AppContent: React.FC = () => {
  const { toast } = useToast();
  useAppTheme();
  const { project, setProject } = useProjectPolling(null);
  const [loading, setLoading] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isLyricsDirty, setIsLyricsDirty] = useState(false);
  const [showStudioDeleteModal, setShowStudioDeleteModal] = useState(false);
  const [showStudioEditModal, setShowStudioEditModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showVisualizer, setShowVisualizer] = useState(false);

  // Theme & Visual Styling Hook
  const theme = useVisualTheme();

  // Authentication & Friend Profile Hook
  const { showAuthModal, setShowAuthModal, currentUser, authToken, handleAuthSuccess } =
    useStudioAuth();

  // Audio Playback Hook
  const audio = useStudioAudio(project);
  const {
    audioRef,
    currentTime,
    duration,
    isPlaying,
    isMuted,
    setCurrentTime,
    setIsPlaying,
    setIsMuted,
  } = audio;

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
          if (!isNaN(seekTime)) setCurrentTime(seekTime);
        }
      })
      .catch((e) => console.error('Failed to load project from URL parameter', e));
  }, [setProject, setCurrentTime]);

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
  const [showChordBar, setShowChordBar] = useState(false);
  const [activeSemitones, setActiveSemitones] = useState(0);
  const [initialChords, setInitialChords] = useState<ChordSegment[]>([]);

  const handleToggleChordBar = () => setShowChordBar((prev) => !prev);
  const handleToggleVisualizer = () => setShowVisualizer((prev) => !prev);
  const handleSemitonesChange = (semi: number) => setActiveSemitones(semi);

  useEffect(() => {
    if (project?.semitones !== undefined) {
      setActiveSemitones(project.semitones);
    }
  }, [project?.semitones]);

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
    audioRef,
    currentTime,
    duration,
    enabled: true,
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

  // Re-mix master audio with pitch and guide vocal changes
  const handleMixChange = async (semitones: number, guideVolume: number) => {
    if (!project?.id) return;
    const wasPlaying = isPlaying;
    if (audioRef.current) audioRef.current.pause();

    try {
      const res = await apiFetch(`/api/project/${project.id}/mix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ semitones, guide_volume: guideVolume }),
      });
      if (res.ok) {
        const data = await res.json();
        setProject((prev) =>
          prev
            ? {
                ...prev,
                master_audio_url: data.master_audio_url,
                semitones,
                guide_volume: guideVolume,
              }
            : null
        );
        if (audioRef.current) {
          audioRef.current.load();
          audioRef.current.currentTime = currentTime;
          if (wasPlaying) {
            audioRef.current.play().then(() => setIsPlaying(true));
          }
        }
      }
    } catch (err) {
      console.error('Mix failed:', err);
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
          semitones: activeSemitones ?? project.semitones ?? 0,
          guide_volume: project.guide_volume || 0,
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
    setShowStudioDeleteModal(false);
    toast.success('Project deleted successfully');
  };

  const handleStudioMetadataSaved = (updated: { id: string; title: string; artist: string }) => {
    setProject((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
    setShowStudioEditModal(false);
    toast.success('Project details updated');
  };

  return (
    <div className="min-h-screen bg-[#0d0f17] text-slate-100 flex flex-col font-['Inter']">
      {/* Top Navbar */}
      <StudioHeader
        currentUser={currentUser}
        project={project}
        isLyricsDirty={isLyricsDirty || chordHistory.isDirty}
        onOpenHelp={() => setShowHelpModal((prev) => !prev)}
        onOpenAuth={() => setShowAuthModal(true)}
        onNewSong={() => setProject(null)}
        onStartRender={handleStartRender}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8 w-full">
        {!project ? (
          <TrackSearch
            onSelectTrack={handleSelectTrack}
            onUploadTrack={handleUploadTrack}
            onOpenProject={(p) => setProject(p)}
            isLoading={loading}
            currentUser={currentUser}
            authToken={authToken}
          />
        ) : project.status !== 'ready' ? (
          <ProcessingView
            project={project}
            onCancelProcess={handleCancelProcess}
            onResetProject={() => setProject(null)}
          />
        ) : (
          /* Studio Dashboard */
          <div className="space-y-8">
            {/* Song Meta Header */}
            <StudioMetaHeader
              project={project}
              onOpenEditModal={() => setShowStudioEditModal(true)}
              onOpenDeleteModal={() => setShowStudioDeleteModal(true)}
              onOpenExportModal={() => setIsExportOpen(true)}
              onStartRender={handleStartRender}
            />

            {/* Audio Controls & Pitch Shifter */}
            <AudioControls
              projectId={project.id}
              masterAudioUrl={project.master_audio_url}
              instrumentalUrl={project.instrumental_url}
              vocalsUrl={project.vocals_url}
              lines={project.lines}
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              onTogglePlay={audio.handleTogglePlay}
              onSeek={audio.handleSeek}
              onMixChange={handleMixChange}
              initialSemitones={activeSemitones}
              onSemitonesChange={handleSemitonesChange}
              initialGuideVolume={project.guide_volume}
              initialMuted={isMuted}
              onMuteChange={setIsMuted}
              playbackRate={audio.playbackRate}
              onPlaybackRateChange={audio.setPlaybackRate}
              audioRef={audioRef}
              onTimeUpdate={audio.handleTimeUpdate}
              onLoadedMetadata={audio.handleLoadedMetadata}
              onEnded={() => setIsPlaying(false)}
              onPlaybackError={(err) => {
                console.error('Audio playback error:', err);
                setIsPlaying(false);
              }}
              onCustomInstrumentalUploaded={(url) =>
                setProject({ ...project, instrumental_url: url })
              }
              vocalRange={project.vocal_range}
              showVisualizer={showVisualizer}
              onToggleVisualizer={handleToggleVisualizer}
              showChordBar={showChordBar}
              onToggleChordBar={handleToggleChordBar}
            />

            {/* Lyric Sweep Live Preview & Timeline Editor */}
            <LyricTimelineEditor
              lines={project.lines}
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              playbackRate={audio.playbackRate}
              audioRef={audioRef}
              onTogglePlay={audio.handleTogglePlay}
              onSeek={audio.handleSeek}
              onSaveLines={handleSaveLines}
              albumArtUrl={project.thumbnail_url}
              themeSungColor={theme.activeSungColor}
              themeUnsungColor={theme.activeUnsungColor}
              onDirtyChange={setIsLyricsDirty}
              aspectRatio={theme.aspectRatio}
              fontSizeScale={theme.fontSizeScale}
              projectId={project.id}
              trackTitle={project.title}
              trackArtist={project.artist}
              showVisualizer={showVisualizer}
              onToggleVisualizer={handleToggleVisualizer}
              analyserNode={audio.analyserNode}
              chords={project.chords}
              showChordBar={showChordBar}
              onToggleChordBar={handleToggleChordBar}
              semitones={activeSemitones}
              keyHint={project.vocal_range?.estimated_key}
              onEditChord={handleEditChord}
              syncMode={theme.syncMode}
              onSyncModeChange={theme.setSyncMode}
            />

            {/* Visual Theme & Aspect Ratio Picker */}
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
              syncMode={theme.syncMode}
              onSyncModeChange={theme.setSyncMode}
            />
          </div>
        )}
      </main>

      {/* Studio Modal Dialogs */}
      <StudioModals
        project={project}
        isExportOpen={isExportOpen}
        onCloseExport={() => setIsExportOpen(false)}
        onCancelRender={handleCancelRender}
        onStartRender={handleStartRender}
        selectedTheme={theme.effectiveTheme}
        aspectRatio={theme.aspectRatio}
        activeSemitones={activeSemitones}
        syncMode={theme.syncMode}
        onSyncModeChange={theme.setSyncMode}
        primaryColor={theme.customSungColor || undefined}
        secondaryColor={theme.customUnsungColor || undefined}
        fontSizeScale={theme.fontSizeScale}
        showAuthModal={showAuthModal}
        onAuthSuccess={handleAuthSuccess}
        onCloseAuth={() => setShowAuthModal(false)}
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

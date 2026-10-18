/**
 * Karaoke Studio Main Application Shell
 *
 * Root orchestrator coordinating intake (search/upload), background processing
 * state transitions, active studio dashboard, global keyboard shortcuts, and dialog modals.
 */

import React, { useState, useEffect } from 'react';
import { TrackSearch } from './components/TrackSearch';
import { AudioControls } from './components/AudioControls';
import { LyricTimelineEditor } from './components/LyricTimelineEditor';
import { VisualThemePicker, THEMES } from './components/VisualThemePicker';
import { StudioHeader } from './components/StudioHeader';
import { ProcessingView } from './components/ProcessingView';
import { StudioMetaHeader } from './components/StudioMetaHeader';
import { StudioModals } from './components/StudioModals';
import { LyricLine, VisualTheme } from './types';
import { apiFetch } from './api';
import { useProjectPolling } from './hooks/useProjectPolling';
import { useToast } from './hooks/useToast';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useStudioAudio } from './hooks/useStudioAudio';
import { useStudioAuth } from './hooks/useStudioAuth';

export const App: React.FC = () => {
  const { toast } = useToast();
  const { project, setProject } = useProjectPolling(null);
  const [loading, setLoading] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<VisualTheme>(THEMES[0]);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [customBgId, setCustomBgId] = useState<string>('');
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isLyricsDirty, setIsLyricsDirty] = useState(false);
  const [showStudioDeleteModal, setShowStudioDeleteModal] = useState(false);
  const [showStudioEditModal, setShowStudioEditModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);

  // Authentication & Friend Profile Hook
  const { showAuthModal, setShowAuthModal, currentUser, authToken, handleAuthSuccess } =
    useStudioAuth();

  // Audio Playback Hook
  const {
    audioRef,
    currentTime,
    duration,
    isPlaying,
    isMuted,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    setIsMuted,
    handleTimeUpdate,
    handleLoadedMetadata,
    handleTogglePlay,
    handleSeek,
    handleToggleMute,
  } = useStudioAudio(project);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('project');
    const tParam = params.get('t');
    if (projectId) {
      apiFetch(`/api/project/${projectId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.id) {
            setProject(data);
            if (tParam) {
              const seekTime = parseFloat(tParam);
              if (!isNaN(seekTime)) {
                setCurrentTime(seekTime);
              }
            }
          }
        })
        .catch((e) => console.error('Failed to load project from URL parameter', e));
    }
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
      await apiFetch(`/api/project/${project.id}/cancel-render`, { method: 'POST' });
    } catch (e) {
      console.error('Cancel render failed', e);
    }
    setProject((prev) => (prev ? { ...prev, render_status: 'idle', render_progress: 0 } : null));
    setIsExportOpen(false);
  };

  // Feature 41 & Milestone 1: Global Keyboard Shortcuts (Space, Left/Right 5s, M, ?)
  const isStudioReady = Boolean(project && project.status === 'ready');

  useKeyboardShortcuts({
    onTogglePlay: isStudioReady ? handleTogglePlay : undefined,
    onSeek: isStudioReady ? handleSeek : undefined,
    onToggleMute: isStudioReady ? handleToggleMute : undefined,
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

  // Trigger Video Render
  const handleStartRender = async () => {
    if (!project?.id) return;
    setIsExportOpen(true);

    try {
      await apiFetch(`/api/project/${project.id}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semitones: project.semitones || 0,
          guide_volume: project.guide_volume || 0,
          aspect_ratio: aspectRatio,
          custom_bg_id: customBgId || undefined,
          style_config: {
            primary_color: selectedTheme.primary_color,
            secondary_color: selectedTheme.secondary_color,
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
    setDuration(0);

    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    setProject(null);
    setShowStudioDeleteModal(false);
    toast.success('Project deleted successfully');
  };

  const handleStudioMetadataSaved = (updated: { id: string; title: string; artist: string }) => {
    setProject((prev) =>
      prev && prev.id === updated.id
        ? {
            ...prev,
            title: updated.title,
            artist: updated.artist,
          }
        : prev
    );
    setShowStudioEditModal(false);
    toast.success('Project details updated');
  };

  return (
    <div className="min-h-screen bg-[#0d0f17] text-slate-100 flex flex-col font-['Inter']">
      {/* Top Navbar */}
      <StudioHeader
        currentUser={currentUser}
        project={project}
        isLyricsDirty={isLyricsDirty}
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
        ) : project.status !== 'ready' &&
          project.status !== 'error' &&
          project.status !== 'cancelled' ? (
          <ProcessingView
            project={project}
            onCancelProcess={handleCancelProcess}
            onResetProject={() => setProject(null)}
          />
        ) : project.status === 'cancelled' || project.status === 'error' ? (
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
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              onTogglePlay={handleTogglePlay}
              onSeek={handleSeek}
              onMixChange={handleMixChange}
              initialSemitones={project.semitones}
              initialGuideVolume={project.guide_volume}
              initialMuted={isMuted}
              onMuteChange={setIsMuted}
              audioRef={audioRef}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={() => setIsPlaying(false)}
              onPlaybackError={(err) => {
                console.error('Audio playback error:', err);
                setIsPlaying(false);
              }}
              onCustomInstrumentalUploaded={(url) =>
                setProject({ ...project, instrumental_url: url })
              }
            />

            {/* Lyric Sweep Live Preview & Timeline Editor */}
            <LyricTimelineEditor
              lines={project.lines}
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              onSeek={handleSeek}
              onSaveLines={handleSaveLines}
              albumArtUrl={project.thumbnail_url}
              themeSungColor={selectedTheme.previewSung}
              themeUnsungColor={selectedTheme.previewUnsung}
              onDirtyChange={setIsLyricsDirty}
              aspectRatio={aspectRatio}
            />

            {/* Visual Theme & Aspect Ratio Picker */}
            <VisualThemePicker
              selectedTheme={selectedTheme}
              onSelectTheme={setSelectedTheme}
              aspectRatio={aspectRatio}
              onChangeAspectRatio={setAspectRatio}
              onCustomBgUploaded={(bgId) => setCustomBgId(bgId)}
              customBgId={customBgId}
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
        selectedTheme={selectedTheme}
        aspectRatio={aspectRatio}
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

export default App;

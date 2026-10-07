import React, { useState, useEffect, useRef } from 'react';
import { TrackSearch } from './components/TrackSearch';
import { AudioControls } from './components/AudioControls';
import { LyricTimelineEditor } from './components/LyricTimelineEditor';
import { VisualThemePicker, THEMES } from './components/VisualThemePicker';
import { ExportModal } from './components/ExportModal';
import { AuthModal } from './components/AuthModal';
import { ProjectState, LyricLine, VisualTheme } from './types';
import { Mic2, Film, Sparkles, AlertCircle, ArrowLeft, RefreshCw, Clock, Activity, XCircle, User } from 'lucide-react';
import { apiFetch } from './api';
import { useProjectPolling } from './hooks/useProjectPolling';

export const App: React.FC = () => {
  const { project, setProject } = useProjectPolling(null);
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<VisualTheme>(THEMES[0]);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [customBgId, setCustomBgId] = useState<string>('');
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Authentication & Friend Profile State
  const [authRequired, setAuthRequired] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [currentUser, setCurrentUser] = useState(localStorage.getItem('karaoke_user_name') || 'Friend');
  const [authToken, setAuthToken] = useState(localStorage.getItem('karaoke_auth_token') || '');

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Check server auth requirement on load
  useEffect(() => {
    apiFetch('/api/auth/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.auth_required) {
          setAuthRequired(true);
          if (!data.authenticated) {
            localStorage.removeItem('karaoke_auth_token');
            setAuthToken('');
            setShowAuthModal(true);
          }
        } else {
          setAuthRequired(false);
          setShowAuthModal(false);
        }
      })
      .catch(() => {});


    const handleUnauthorized = () => setShowAuthModal(true);
    window.addEventListener('karaoke_unauthorized', handleUnauthorized);
    return () => window.removeEventListener('karaoke_unauthorized', handleUnauthorized);
  }, []);

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
  }, []);

  const handleAuthSuccess = (username: string, token: string) => {
    setCurrentUser(username);
    setAuthToken(token);
    setShowAuthModal(false);
  };

  const formatTimer = (seconds?: number | null) => {
    if (seconds === undefined || seconds === null || seconds < 0) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const getHeartbeatText = (lastHeartbeat?: number) => {
    if (!lastHeartbeat) return 'Active';
    const diffSec = Math.max(0, Math.round((Date.now() - lastHeartbeat) / 1000));
    if (diffSec < 2) return 'Pulse just now';
    return `Pulse ${diffSec}s ago`;
  };

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


  // Handle Audio playback time updates
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleTogglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(console.error);
    }
  };

  const handleSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

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
    } catch (err: any) {
      alert(err.message || 'Error processing track');
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
      }
    } catch (err) {
      console.error('Failed to update lyrics:', err);
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
        setProject((prev) => (prev ? { ...prev, master_audio_url: data.master_audio_url, semitones, guide_volume: guideVolume } : null));
        // Reload audio element with new mix source
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
      setProject((prev) => (prev ? { ...prev, render_status: 'queued', render_progress: 10 } : null));
    } catch (err) {
      console.error('Render request failed:', err);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0f17] text-slate-100 flex flex-col font-['Inter']">
      {/* Hidden Master Audio Element */}
      {project?.master_audio_url && (
        <audio
          ref={audioRef}
          src={project.master_audio_url}
          crossOrigin="use-credentials"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={() => setIsPlaying(false)}
        />
      )}

      {/* Top Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-slate-950 shadow-md">
              <Mic2 className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-tight font-['Montserrat'] bg-gradient-to-r from-white via-slate-200 to-cyan-300 bg-clip-text text-transparent">
                YouTube Karaoke Studio
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowAuthModal(true)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-cyan-500/50 text-slate-300 text-xs font-medium transition-all flex items-center gap-1.5 shadow"
              title="Click to change your nickname or passphrase"
            >
              <User className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-semibold text-white">{currentUser}</span>
            </button>

            {project && (
              <>
                <button
                  type="button"
                  onClick={() => setProject(null)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  New Song
                </button>

                {project.status === 'ready' && (
                  <button
                    type="button"
                    onClick={handleStartRender}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs transition-all shadow-lg shadow-cyan-500/20 flex items-center gap-2"
                  >
                    <Film className="w-4 h-4" />
                    Render & Export Video
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto px-4 py-8 w-full">
        {!project ? (
          <TrackSearch
            onSelectTrack={handleSelectTrack}
            onOpenProject={(p) => setProject(p)}
            isLoading={loading}
            currentUser={currentUser}
            authToken={authToken}
          />
        ) : project.status !== 'ready' && project.status !== 'error' && project.status !== 'cancelled' ? (
          /* Processing Pipeline Progress Screen */
          <div className="max-w-xl mx-auto py-16 text-center space-y-6" role="status" aria-live="polite">
            <div className="relative w-24 h-24 mx-auto">
              <div className="w-full h-full border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin motion-reduce:animate-none"></div>
              <Sparkles className="absolute inset-0 m-auto w-8 h-8 text-cyan-400 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
            </div>

            {/* Live Heartbeat Badge */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>Engine Active • {getHeartbeatText(project.heartbeat)}</span>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-white capitalize font-['Montserrat']">
                {project.status.replace('_', ' ')}...
              </h2>
              <p className="text-xs text-slate-300 mt-2 font-mono max-w-md mx-auto bg-slate-950/60 py-2.5 px-3.5 rounded-xl border border-slate-800">
                {project.status_detail || (
                  project.status === 'downloading'
                    ? 'Fetching high-fidelity audio and cover art...'
                    : project.status === 'separating'
                    ? 'Isolating vocals and backing instrumental track with Demucs AI...'
                    : project.status === 'fetching_lyrics'
                    ? 'Retrieving synchronized lyrics from LRCLIB database...'
                    : project.status === 'aligning'
                    ? 'Running forced acoustic alignment for word-by-word timing...'
                    : project.status === 'mixing'
                    ? 'Synthesizing master stereo mix...'
                    : 'Processing audio track...'
                )}
              </p>
            </div>

            {/* Progress Bar & Timers */}
            <div className="max-w-md mx-auto space-y-2">
              <div className="w-full bg-slate-950 border border-slate-800 h-3 rounded-full overflow-hidden p-0.5 shadow-inner">
                <div
                  className="bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 h-full rounded-full transition-all duration-500 shadow-md shadow-cyan-500/30"
                  style={{ width: `${Math.max(5, project.progress)}%` }}
                ></div>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-mono">
                <span className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                  <Activity className="w-3.5 h-3.5" />
                  {project.progress}% Complete
                </span>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-500" />
                    Elapsed: {formatTimer(project.elapsed_seconds)}
                  </span>
                  <span className="text-slate-200">
                    Est. remaining: {project.eta_seconds !== undefined && project.eta_seconds !== null ? `~${formatTimer(project.eta_seconds)}` : 'Calculating...'}
                  </span>
                </div>
              </div>
            </div>

            {/* Cancel & Return to Search */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleCancelProcess}
                className="px-4 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700/80 border border-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-all inline-flex items-center gap-1.5 shadow-md"
              >
                <XCircle className="w-3.5 h-3.5 text-red-400" />
                Cancel & Return to Search
              </button>
            </div>
          </div>
        ) : project.status === 'cancelled' ? (
          /* Cancelled Screen */
          <div className="max-w-md mx-auto py-16 text-center space-y-4">
            <div className="p-3 w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 mx-auto flex items-center justify-center">
              <XCircle className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-white">Track Processing Cancelled</h2>
            <p className="text-xs text-slate-400">
              The processing job was aborted. You can search or select a new song anytime.
            </p>
            <button
              type="button"
              onClick={() => setProject(null)}
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-md shadow-cyan-500/20"
            >
              Search Another Song
            </button>
          </div>
        ) : project.status === 'error' ? (
          /* Error Screen */
          <div className="max-w-md mx-auto py-16 text-center space-y-4">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
            <h2 className="text-xl font-bold text-white">Track Processing Failed</h2>
            <p className="text-xs text-red-300 font-mono bg-red-950/40 p-4 rounded-xl border border-red-800/60">
              {project.error || 'An unexpected error occurred during processing.'}
            </p>
            <button
              type="button"
              onClick={() => setProject(null)}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold"
            >
              Try Another Track
            </button>
          </div>
        ) : (
          /* Studio Dashboard */
          <div className="space-y-8">
            {/* Song Meta Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900/60 border border-slate-800">
              <div className="flex items-center gap-4">
                {project.thumbnail_url && (
                  <img
                    src={project.thumbnail_url}
                    alt={project.title}
                    className="w-16 h-16 rounded-xl object-cover shadow-lg border border-slate-700/60"
                  />
                )}
                <div>
                  <h2 className="text-xl font-extrabold text-white font-['Montserrat']">
                    {project.title}
                  </h2>
                  <p className="text-sm text-slate-400 font-medium">
                    {project.artist} • {project.lines.length} lyric lines detected
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleStartRender}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-cyan-500/20 flex items-center gap-2"
                >
                  <Film className="w-4 h-4" />
                  Render 1080p Video
                </button>
              </div>
            </div>

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
              onCustomInstrumentalUploaded={(url) => setProject({ ...project, instrumental_url: url })}
            />

            {/* Lyric Sweep Live Preview & Timeline Editor */}
            <LyricTimelineEditor
              lines={project.lines}
              currentTime={currentTime}
              duration={duration}
              onSeek={handleSeek}
              onSaveLines={handleSaveLines}
              albumArtUrl={project.thumbnail_url}
              themeSungColor={selectedTheme.previewSung}
              themeUnsungColor={selectedTheme.previewUnsung}
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

      {/* Export & YouTube Package Modal */}
      {project && (
        <ExportModal
          project={project}
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
          onCancelRender={handleCancelRender}
        />
      )}

      {/* Shared Studio Passphrase & Friend Profile Modal */}
      <AuthModal
        isOpen={showAuthModal}
        onSuccess={handleAuthSuccess}
      />
    </div>
  );
};

export default App;

import React, { useState, useEffect, useRef } from 'react';
import { TrackSearch } from './components/TrackSearch';
import { AudioControls } from './components/AudioControls';
import { LyricTimelineEditor } from './components/LyricTimelineEditor';
import { VisualThemePicker, THEMES } from './components/VisualThemePicker';
import { ExportModal } from './components/ExportModal';
import { ProjectState, LyricLine, VisualTheme } from './types';
import { Mic2, Film, Sparkles, AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';

export const App: React.FC = () => {
  const [project, setProject] = useState<ProjectState | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<VisualTheme>(THEMES[0]);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [customBgId, setCustomBgId] = useState<string>('');
  const [isExportOpen, setIsExportOpen] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Poll project state if in an active/queued stage
  useEffect(() => {
    if (!project?.id) return;
    
    const needsPolling =
      ['queued', 'downloading', 'separating', 'fetching_lyrics', 'aligning'].includes(project.status) ||
      ['queued', 'rendering'].includes(project.render_status || '');

    if (!needsPolling) return;

    let consecutiveErrors = 0;
    const maxRetries = 5;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/project/${project.id}`);
        if (res.ok) {
          consecutiveErrors = 0;
          const data: ProjectState = await res.json();
          setProject(data);
        } else if (res.status === 404) {
          consecutiveErrors++;
          if (consecutiveErrors >= maxRetries) {
            setProject((prev) =>
              prev
                ? {
                    ...prev,
                    status: 'error',
                    error: 'Session timed out or server reloaded. Please click "Try Another Track" to re-open.',
                  }
                : null
            );
          }
        }
      } catch (err) {
        console.error('Failed to poll project status:', err);
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [project?.id, project?.status, project?.render_status]);


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
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url_or_id: urlOrId, custom_lyrics: customLyrics }),
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
      const res = await fetch(`/api/project/${project.id}/lyrics`, {
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
      const res = await fetch(`/api/project/${project.id}/mix`, {
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
      await fetch(`/api/project/${project.id}/render`, {
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

          {project && (
            <div className="flex items-center gap-3">
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
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto px-4 py-8 w-full">
        {!project ? (
          <TrackSearch onSelectTrack={handleSelectTrack} isLoading={loading} />
        ) : project.status !== 'ready' && project.status !== 'error' ? (
          /* Processing Pipeline Progress Screen */
          <div className="max-w-xl mx-auto py-20 text-center space-y-6">
            <div className="relative w-24 h-24 mx-auto">
              <div className="w-full h-full border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin"></div>
              <Sparkles className="absolute inset-0 m-auto w-8 h-8 text-cyan-400 animate-pulse" />
            </div>

            <div>
              <h2 className="text-2xl font-bold text-white capitalize font-['Montserrat']">
                {project.status.replace('_', ' ')}...
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {project.status === 'downloading' && 'Fetching high-fidelity audio and cover art...'}
                {project.status === 'separating' && 'Isolating vocals and backing instrumental track...'}
                {project.status === 'fetching_lyrics' && 'Retrieving lyrics from LRCLIB database...'}
                {project.status === 'aligning' && 'Running forced acoustic alignment for word-by-word timing...'}
              </p>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-slate-900 border border-slate-800 h-3 rounded-full overflow-hidden p-0.5">
              <div
                className="bg-gradient-to-r from-cyan-500 to-blue-600 h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${project.progress}%` }}
              ></div>
            </div>
            <p className="text-xs font-mono text-cyan-400">{project.progress}% Complete</p>
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
        />
      )}
    </div>
  );
};

export default App;

import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Volume2, Mic, Upload, Sliders, Music2 } from 'lucide-react';
import { apiFetch } from '../api';

interface AudioControlsProps {
  projectId: string;
  masterAudioUrl?: string;
  instrumentalUrl?: string;
  vocalsUrl?: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onMixChange: (semitones: number, guideVolume: number) => void;
  onCustomInstrumentalUploaded?: (url: string) => void;
}

export const AudioControls: React.FC<AudioControlsProps> = ({
  projectId,
  masterAudioUrl,
  currentTime,
  duration,
  isPlaying,
  onTogglePlay,
  onSeek,
  onMixChange,
  onCustomInstrumentalUploaded,
}) => {
  const [semitones, setSemitones] = useState(0);
  const [guideVolume, setGuideVolume] = useState(0.0);
  const [isApplyingMix, setIsApplyingMix] = useState(false);
  const [uploadingInst, setUploadingInst] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSemitoneChange = (delta: number) => {
    const nextVal = Math.max(-12, Math.min(12, semitones + delta));
    setSemitones(nextVal);
  };

  const handleApplyAudioMix = async () => {
    setIsApplyingMix(true);
    try {
      await onMixChange(semitones, guideVolume);
    } finally {
      setIsApplyingMix(false);
    }
  };

  const handleInstrumentalUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingInst(true);
    const formData = new FormData();
    formData.append('project_id', projectId);
    formData.append('file', file);

    try {
      const res = await apiFetch('/api/upload-instrumental', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      if (onCustomInstrumentalUploaded && data.instrumental_url) {
        onCustomInstrumentalUploaded(data.instrumental_url);
      }
      // Re-mix
      handleApplyAudioMix();
    } catch (err) {
      console.error('Error uploading instrumental:', err);
      alert('Could not upload instrumental file.');
    } finally {
      setUploadingInst(false);
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-2xl backdrop-blur-md">
      {/* Player Header & Main Scrub Bar */}
      <div className="flex flex-col gap-2 mb-5">
        <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
          <span>{formatTime(currentTime)}</span>
          <span className="text-slate-500">Master Mix ({semitones !== 0 ? `${semitones > 0 ? '+' : ''}${semitones} st` : 'Original Key'})</span>
          <span>{formatTime(duration)}</span>
        </div>
        
        {/* Scrubber */}
        <input
          type="range"
          min={0}
          max={duration || 100}
          step={0.1}
          value={currentTime}
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 hover:accent-cyan-300 transition-all"
        />
      </div>

      {/* Control Buttons & Sliders */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
        {/* Play/Pause & Transport */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onTogglePlay}
            className="w-12 h-12 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 flex items-center justify-center shadow-lg transition-transform active:scale-95"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-slate-950" /> : <Play className="w-5 h-5 fill-slate-950 ml-0.5" />}
          </button>
          
          <button
            type="button"
            onClick={() => onSeek(0)}
            className="p-2.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 transition-colors"
            title="Restart Track"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <div className="text-xs text-slate-400">
            <p className="font-semibold text-white">Karaoke Playback</p>
            <p className="text-[11px] text-slate-500">Sync with video timeline</p>
          </div>
        </div>

        {/* Pitch Shift Controls */}
        <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1.5 font-medium">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              Pitch Transposition
            </span>
            <span className={`font-mono font-bold ${semitones === 0 ? 'text-slate-300' : 'text-cyan-400'}`}>
              {semitones === 0 ? '0 (Original)' : `${semitones > 0 ? '+' : ''}${semitones} semitones`}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              onClick={() => handleSemitoneChange(-1)}
              className="flex-1 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white font-mono text-sm transition-colors"
            >
              -1
            </button>
            <button
              type="button"
              onClick={() => setSemitones(0)}
              className="px-2.5 py-1.5 rounded-md bg-slate-800/50 hover:bg-slate-700/50 text-slate-400 text-xs transition-colors"
              title="Reset Pitch"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => handleSemitoneChange(1)}
              className="flex-1 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-white font-mono text-sm transition-colors"
            >
              +1
            </button>
          </div>
        </div>

        {/* Guide Vocal Level & Custom Track */}
        <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1.5 font-medium">
              <Mic className="w-3.5 h-3.5 text-indigo-400" />
              Guide Vocal Level
            </span>
            <span className="font-mono text-indigo-300 font-bold">
              {Math.round(guideVolume * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.05}
            value={guideVolume}
            onChange={(e) => setGuideVolume(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-400"
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-slate-500">Muted (0%)</span>
            <span className="text-[10px] text-slate-500">Subtle (20%)</span>
            <span className="text-[10px] text-slate-500">Loud (50%)</span>
          </div>
        </div>
      </div>

      {/* Bottom Bar: Apply Mix & Custom Instrumental Upload */}
      <div className="mt-4 pt-4 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleApplyAudioMix}
            disabled={isApplyingMix}
            className="px-3.5 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 font-medium transition-all flex items-center gap-1.5 disabled:opacity-50"
          >
            {isApplyingMix ? (
              <span className="w-3 h-3 border-2 border-cyan-300 border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <Music2 className="w-3.5 h-3.5" />
            )}
            Apply Audio Mix
          </button>
          <span className="text-slate-500 text-[11px]">
            Updates pitch & vocal blend in preview player
          </span>
        </div>

        <div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleInstrumentalUpload}
            accept="audio/*"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingInst}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5 text-slate-400" />
            {uploadingInst ? 'Uploading...' : 'Replace Instrumental File'}
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useRef, useState } from 'react';
import { Palette, Upload, Monitor, Smartphone, Check } from 'lucide-react';
import { VisualTheme } from '../types';
import { apiFetch } from '../api';

export const THEMES: VisualTheme[] = [
  {
    id: 'modern_gold',
    name: 'Modern Gold',
    description: 'Crisp white transitioning into warm radiant gold',
    primary_color: '&H0000D7FF',   // BGR in ASS: FF D7 00 = Gold
    secondary_color: '&H00FFFFFF',
    previewBg: 'from-amber-950/40 to-slate-950',
    previewSung: '#fbbf24',
    previewUnsung: '#ffffff',
  },
  {
    id: 'cyber_cyan',
    name: 'Cyber Cyan',
    description: 'Electric cyan glowing wipe on ambient dark backdrop',
    primary_color: '&H00FFFF00',   // BGR in ASS: 00 FF FF = Cyan
    secondary_color: '&H00FFFFFF',
    previewBg: 'from-cyan-950/40 to-slate-950',
    previewSung: '#06b6d4',
    previewUnsung: '#ffffff',
  },
  {
    id: 'neon_pink',
    name: 'Neon Sunset',
    description: 'Vivid magenta sweep with high contrast',
    primary_color: '&H00B300FF',   // BGR in ASS: FF 00 B3 = Neon Magenta
    secondary_color: '&H00FFFFFF',
    previewBg: 'from-pink-950/40 to-slate-950',
    previewSung: '#ec4899',
    previewUnsung: '#ffffff',
  },
  {
    id: 'classic_ktv',
    name: 'Classic KTV',
    description: 'Traditional karaoke blue-to-yellow karaoke look',
    primary_color: '&H0000FFFF',   // BGR in ASS: FF FF 00 = Yellow
    secondary_color: '&H00FFFFFF',
    previewBg: 'from-blue-950/40 to-slate-950',
    previewSung: '#facc15',
    previewUnsung: '#ffffff',
  },
];

interface VisualThemePickerProps {
  selectedTheme: VisualTheme;
  onSelectTheme: (theme: VisualTheme) => void;
  aspectRatio: string;
  onChangeAspectRatio: (ratio: string) => void;
  onCustomBgUploaded: (bgId: string) => void;
  customBgId?: string;
}

export const VisualThemePicker: React.FC<VisualThemePickerProps> = ({
  selectedTheme,
  onSelectTheme,
  aspectRatio,
  onChangeAspectRatio,
  onCustomBgUploaded,
  customBgId,
}) => {
  const [uploadingBg, setUploadingBg] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingBg(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await apiFetch('/api/upload-background', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      onCustomBgUploaded(data.bg_id);
    } catch (err) {
      console.error('Background upload error:', err);
      alert('Could not upload custom background file.');
    } finally {
      setUploadingBg(false);
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-6">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Palette className="w-4 h-4 text-cyan-400" />
            Visual Themes & Video Format
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure lyrics styling and aspect ratio for YouTube upload.
          </p>
        </div>

        {/* Aspect Ratio Selector */}
        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => onChangeAspectRatio('16:9')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              aspectRatio === '16:9'
                ? 'bg-cyan-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            16:9 Widescreen
          </button>
          <button
            type="button"
            onClick={() => onChangeAspectRatio('9:16')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              aspectRatio === '9:16'
                ? 'bg-cyan-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            9:16 Shorts
          </button>
        </div>
      </div>

      {/* Theme Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {THEMES.map((t) => {
          const isSelected = selectedTheme.id === t.id;
          return (
            <div
              key={t.id}
              onClick={() => onSelectTheme(t)}
              className={`p-4 rounded-xl border cursor-pointer transition-all relative overflow-hidden bg-gradient-to-b ${t.previewBg} ${
                isSelected
                  ? 'border-cyan-400 ring-2 ring-cyan-500/20 shadow-lg shadow-cyan-500/10'
                  : 'border-slate-800/80 hover:border-slate-700'
              }`}
            >
              {isSelected && (
                <span className="absolute top-2 right-2 p-1 rounded-full bg-cyan-500 text-slate-950">
                  <Check className="w-3 h-3 stroke-[3]" />
                </span>
              )}
              <h4 className="text-sm font-bold text-white">{t.name}</h4>
              <p className="text-[11px] text-slate-400 mt-1">{t.description}</p>
              
              {/* Mini Preview bar */}
              <div className="mt-3 p-2 rounded-lg bg-slate-950/80 flex items-center justify-center font-['Montserrat'] font-extrabold text-sm">
                <span style={{ color: t.previewSung }}>Ka-ra-</span>
                <span style={{ color: t.previewUnsung }}>oke</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Custom Background Video/Image Option */}
      <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-950/40 p-3 rounded-xl border border-slate-800/80">
        <div>
          <span className="font-semibold text-white">Custom Video / Image Background: </span>
          <span className="text-slate-400">
            {customBgId ? `Active (${customBgId})` : 'Default: Dynamic animated blurred album art'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={bgInputRef}
            onChange={handleBgUpload}
            accept="image/*,video/*"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => bgInputRef.current?.click()}
            disabled={uploadingBg}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            {uploadingBg ? 'Uploading...' : 'Upload Video/Image Background'}
          </button>
          {customBgId && (
            <button
              type="button"
              onClick={() => onCustomBgUploaded('')}
              className="text-slate-500 hover:text-red-400 text-xs underline"
            >
              Reset to Album Art
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

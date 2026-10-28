/**
 * Visual Theme & Aspect Ratio Picker Component
 *
 * Configures subtitle color palettes, custom sung/unsung colors, font size scaling,
 * background presets, custom video/image backgrounds, and aspect ratio switches
 * (16:9 Landscape vs 9:16 Portrait Shorts).
 */

import React, { useRef, useState } from 'react';
import {
  Palette,
  Upload,
  Monitor,
  Smartphone,
  Check,
  Type,
  RotateCcw,
  Sparkles,
  AlignLeft,
} from 'lucide-react';
import { VisualTheme, SyncDisplayMode } from '../types';
import { THEMES } from '../theme/stagePresets';
import { apiFetch } from '../api';
import { useToast } from '../hooks/useToast';

export { THEMES };

export interface VisualThemePickerProps {
  selectedTheme: VisualTheme;
  onSelectTheme: (theme: VisualTheme) => void;
  aspectRatio: string;
  onChangeAspectRatio: (ratio: string) => void;
  onCustomBgUploaded: (bgId: string) => void;
  customBgId?: string;
  customSungColor?: string | null;
  onCustomSungColorChange?: (color: string) => void;
  customUnsungColor?: string | null;
  onCustomUnsungColorChange?: (color: string) => void;
  fontSizeScale?: number;
  onFontSizeScaleChange?: (scale: number) => void;
  onResetThemeDefaults?: () => void;
  syncMode?: SyncDisplayMode;
  onSyncModeChange?: (mode: SyncDisplayMode) => void;
  onChangeSyncMode?: (mode: SyncDisplayMode) => void;
}

export const VisualThemePicker: React.FC<VisualThemePickerProps> = ({
  selectedTheme,
  onSelectTheme,
  aspectRatio,
  onChangeAspectRatio,
  onCustomBgUploaded,
  customBgId,
  customSungColor,
  onCustomSungColorChange,
  customUnsungColor,
  onCustomUnsungColorChange,
  fontSizeScale = 1.0,
  onFontSizeScaleChange,
  onResetThemeDefaults,
  syncMode = 'word',
  onSyncModeChange,
  onChangeSyncMode,
}) => {
  const { toast } = useToast();
  const [uploadingBg, setUploadingBg] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const handleSyncModeChange = (mode: SyncDisplayMode) => {
    onSyncModeChange?.(mode);
    onChangeSyncMode?.(mode);
  };

  const activeSungColor = customSungColor || selectedTheme.previewSung;
  const activeUnsungColor = customUnsungColor || selectedTheme.previewUnsung;
  const activeScale = fontSizeScale || 1.0;

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
      const isVideo = file.type.startsWith('video/') || /\.(mp4|webm)$/i.test(file.name);
      toast.success(
        isVideo
          ? 'Custom background video uploaded successfully'
          : 'Custom background image uploaded successfully'
      );
    } catch (err) {
      console.error('Background upload error:', err);
      toast.error('Could not upload custom background file.');
    } finally {
      setUploadingBg(false);
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Palette className="w-4 h-4 text-cyan-400" />
            Visual Themes & Video Format
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure lyrics styling, sync display mode, and aspect ratio.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Sync Display Mode Selector */}
          <div
            data-testid="sync-mode-selector"
            role="group"
            aria-label="Lyric synchronization display mode"
            className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800"
          >
            <button
              type="button"
              data-testid="sync-mode-word"
              aria-label="Word Sweep Mode (progressive karaoke wipe)"
              aria-pressed={syncMode === 'word'}
              onClick={() => handleSyncModeChange('word')}
              className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                syncMode === 'word'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              Word Sweep
            </button>
            <button
              type="button"
              data-testid="sync-mode-line"
              aria-label="Line-by-Line Mode (solid line illumination)"
              aria-pressed={syncMode === 'line'}
              onClick={() => handleSyncModeChange('line')}
              className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                syncMode === 'line'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <AlignLeft className="w-3.5 h-3.5" aria-hidden="true" />
              Line-by-Line
            </button>
          </div>

          {/* Aspect Ratio Selector */}
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => onChangeAspectRatio('16:9')}
              className={`flex-1 sm:flex-initial min-h-[40px] justify-center flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
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
              className={`flex-1 sm:flex-initial min-h-[40px] justify-center flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
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
      </div>

      {/* Theme Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {THEMES.map((t) => {
          const isSelected = selectedTheme.id === t.id;
          const cardSungColor = isSelected ? activeSungColor : t.previewSung;
          const cardUnsungColor = isSelected ? activeUnsungColor : t.previewUnsung;
          const isHexBg = t.previewBg.startsWith('#');
          const isLightPreset = t.id === 'clean_paper';
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onClick={() => onSelectTheme(t)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectTheme(t);
                }
              }}
              style={isHexBg ? { backgroundColor: t.previewBg } : undefined}
              className={`p-4 rounded-xl border cursor-pointer transition-all relative overflow-hidden ${
                isHexBg ? '' : `bg-gradient-to-b ${t.previewBg}`
              } ${
                isSelected
                  ? 'border-cyan-400 ring-2 ring-cyan-500/20 shadow-lg shadow-cyan-500/10'
                  : isLightPreset
                    ? 'border-stone-300 hover:border-stone-400'
                    : 'border-slate-800/80 hover:border-slate-700'
              }`}
            >
              {isSelected && (
                <span className="absolute top-2 right-2 p-1 rounded-full bg-cyan-500 text-slate-950">
                  <Check className="w-3 h-3 stroke-[3]" />
                </span>
              )}
              <h4
                className={`text-sm font-bold ${isLightPreset ? 'text-neutral-900' : 'text-white'}`}
              >
                {t.name}
              </h4>
              <p
                className={`text-[11px] mt-1 ${isLightPreset ? 'text-neutral-700' : 'text-slate-400'}`}
              >
                {t.description}
              </p>

              {/* Mini Preview bar */}
              <div
                className={`mt-3 p-2 rounded-lg flex items-center justify-center font-extrabold text-sm ${
                  isLightPreset
                    ? 'bg-[#f4f4f0] border border-stone-400 text-neutral-900'
                    : 'bg-slate-950/80'
                }`}
                style={{ fontFamily: t.fontFamily || 'Montserrat, sans-serif' }}
              >
                <span style={{ color: cardSungColor }}>Ka-ra-</span>
                <span style={{ color: cardUnsungColor }}>oke</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Custom Theme Styling & Typography Scaling */}
      <div className="pt-2 border-t border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
              <Type className="w-4 h-4 text-cyan-400" />
              Custom Colors & Font Scaling
            </h4>
            <p className="text-xs text-slate-400">
              Personalize karaoke sung highlights, base text colors, and display scale.
            </p>
          </div>
          {onResetThemeDefaults && (
            <button
              type="button"
              data-testid="reset-theme-defaults-btn"
              onClick={onResetThemeDefaults}
              aria-label="Reset colors and font size to theme defaults"
              className="self-start sm:self-auto px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 min-h-[32px]"
            >
              <RotateCcw className="w-3 h-3" />
              Reset to Defaults
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Sung Highlight Color Picker */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
            <label
              htmlFor="sung-color-picker"
              className="text-xs font-semibold text-slate-300 flex items-center justify-between"
            >
              <span>Sung Highlight</span>
              <span className="font-mono text-[11px] text-cyan-400">{activeSungColor}</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                id="sung-color-picker"
                type="color"
                data-testid="sung-color-picker"
                aria-label="Sung highlight color"
                value={activeSungColor}
                onChange={(e) => onCustomSungColorChange?.(e.target.value)}
                className="w-9 h-9 rounded-lg cursor-pointer bg-transparent border border-slate-700 p-0.5"
              />
              <span className="text-xs text-slate-400">Word wipe color</span>
            </div>
          </div>

          {/* Unsung Text Color Picker */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
            <label
              htmlFor="unsung-color-picker"
              className="text-xs font-semibold text-slate-300 flex items-center justify-between"
            >
              <span>Unsung Text</span>
              <span className="font-mono text-[11px] text-slate-300">{activeUnsungColor}</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                id="unsung-color-picker"
                type="color"
                data-testid="unsung-color-picker"
                aria-label="Unsung text color"
                value={activeUnsungColor}
                onChange={(e) => onCustomUnsungColorChange?.(e.target.value)}
                className="w-9 h-9 rounded-lg cursor-pointer bg-transparent border border-slate-700 p-0.5"
              />
              <span className="text-xs text-slate-400">Base lyric color</span>
            </div>
          </div>

          {/* Font Size Scale Selector */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
            <span className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Font Size Scale</span>
              <span className="font-mono text-[11px] text-cyan-400">{activeScale}x</span>
            </span>
            <div className="grid grid-cols-4 gap-1">
              {[0.8, 1.0, 1.2, 1.5].map((scale) => {
                const isSelected = Math.abs(activeScale - scale) < 0.05;
                return (
                  <button
                    key={scale}
                    type="button"
                    data-testid={`font-scale-${scale}x`}
                    aria-label={`Scale ${scale}x`}
                    aria-pressed={isSelected}
                    onClick={() => onFontSizeScaleChange?.(scale)}
                    className={`min-h-[36px] py-1 text-xs font-bold rounded-lg border transition-all ${
                      isSelected
                        ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow'
                        : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-700'
                    }`}
                  >
                    {scale}x
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Custom Background Video/Image Option */}
      <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs bg-slate-950/40 p-3 rounded-xl border border-slate-800/80">
        <div>
          <span className="font-semibold text-white">Custom Video / Image Background: </span>
          <span className="text-slate-400">
            {customBgId ? `Active (${customBgId})` : 'Default: Dynamic animated blurred album art'}
          </span>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
          <input
            type="file"
            ref={bgInputRef}
            onChange={handleBgUpload}
            accept="image/*,video/*,.mp4,.webm,.jpg,.jpeg,.png,.webp"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => bgInputRef.current?.click()}
            disabled={uploadingBg}
            className="w-full sm:w-auto min-h-[40px] justify-center px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            {uploadingBg ? 'Uploading...' : 'Upload Video/Image Background'}
          </button>
          {customBgId && (
            <button
              type="button"
              onClick={() => onCustomBgUploaded('')}
              className="text-slate-500 hover:text-red-400 text-xs underline min-h-[36px] flex items-center"
            >
              Reset to Album Art
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

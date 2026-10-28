/**
 * Visual Theme & Aspect Ratio Picker Component (Stage look)
 *
 * Video format (16:9 / 9:16 Shorts), stage presets, custom sung/unsung colors, lyric
 * size and a custom image/video background. The lyric highlight mode lives in the
 * stage toolbar.
 */

import React, { useRef, useState } from 'react';
import { Palette, Upload, Monitor, Smartphone, Check, RotateCcw, ImageIcon, X } from 'lucide-react';
import { VisualTheme } from '../types';
import { THEMES, STAGE_PRESETS_IN_DISPLAY_ORDER, getStageBackground } from '../theme/stagePresets';
import { apiFetch } from '../api';
import { useToast } from '../hooks/useToast';
import { Panel } from './ui/Panel';
import { SegmentedControl } from './ui/SegmentedControl';
import { Spinner } from './ui/Spinner';
import { focusRing } from './ui/variants';
import { cn } from '../utils/cn';

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
  className?: string;
}

const FONT_SCALES = [0.8, 1.0, 1.2, 1.5] as const;

const sectionLabel = 'text-xs font-semibold uppercase tracking-[0.08em] text-theme-text-muted';

const smallButton = cn(
  'inline-flex min-h-[44px] md:min-h-[32px] items-center gap-1.5 rounded-theme-md px-2.5 text-xs font-semibold transition-colors disabled:opacity-50',
  focusRing
);

/** Strips the upload's random prefix ("ab12cd34_name.mp4" → "name.mp4"). */
function displayBackgroundName(bgId: string): string {
  return bgId.replace(/^[0-9a-f]{8}_/i, '');
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
  onResetThemeDefaults,
  onFontSizeScaleChange,
  className,
}) => {
  const { toast } = useToast();
  const [uploadingBg, setUploadingBg] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const activeSungColor = customSungColor || selectedTheme.previewSung;
  const activeUnsungColor = customUnsungColor || selectedTheme.previewUnsung;
  const activeScale = fontSizeScale || 1.0;
  const activeScaleOption =
    FONT_SCALES.find((s) => Math.abs(activeScale - s) < 0.05)?.toString() ?? '';

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
      if (bgInputRef.current) bgInputRef.current.value = '';
    }
  };

  return (
    <Panel
      title="Stage look"
      description="Preview styling and video format"
      icon={<Palette className="h-4 w-4" />}
      className={className}
      data-testid="stage-look-panel"
      actions={
        onResetThemeDefaults ? (
          <button
            type="button"
            data-testid="reset-theme-defaults-btn"
            onClick={onResetThemeDefaults}
            aria-label="Reset colors and font size to theme defaults"
            title="Reset colors and lyric size"
            className={cn(
              smallButton,
              'text-theme-text-muted hover:bg-theme-surface-subtle hover:text-theme-text'
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className={sectionLabel}>Format</span>
          <SegmentedControl
            value={aspectRatio === '9:16' ? '9:16' : '16:9'}
            onChange={onChangeAspectRatio}
            ariaLabel="Video aspect ratio"
            size="sm"
            fullWidth
            options={[
              {
                value: '16:9',
                label: '16:9 Widescreen',
                icon: <Monitor className="h-3.5 w-3.5" aria-hidden="true" />,
              },
              {
                value: '9:16',
                label: '9:16 Shorts',
                icon: <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />,
              },
            ]}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className={sectionLabel}>Preset</span>
          <div className="grid grid-cols-2 gap-2">
            {STAGE_PRESETS_IN_DISPLAY_ORDER.map((t) => {
              const isSelected = selectedTheme.id === t.id;
              const cardSungColor = isSelected ? activeSungColor : t.previewSung;
              const cardUnsungColor = isSelected ? activeUnsungColor : t.previewUnsung;
              const isLight = t.tone === 'light';
              return (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  title={t.description}
                  onClick={() => onSelectTheme(t)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectTheme(t);
                    }
                  }}
                  style={{ backgroundColor: getStageBackground(t) }}
                  className={cn(
                    'group relative flex min-h-[44px] cursor-pointer flex-col gap-2 overflow-hidden rounded-theme-lg border p-2.5 text-left transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-px',
                    focusRing,
                    isSelected
                      ? 'border-theme-accent ring-2 ring-theme-accent/40'
                      : isLight
                        ? 'border-black/10 hover:border-black/25'
                        : 'border-white/10 hover:border-white/25'
                  )}
                >
                  {isSelected && (
                    <span
                      aria-hidden="true"
                      className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-theme-accent text-theme-accent-text"
                    >
                      <Check className="h-2.5 w-2.5 stroke-[3]" />
                    </span>
                  )}
                  <span
                    className={cn(
                      'pr-5 text-xs font-semibold leading-tight',
                      isLight ? 'text-neutral-900' : 'text-white'
                    )}
                  >
                    {t.name}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'rounded-theme-sm px-2 py-1 text-center text-sm font-extrabold leading-none',
                      isLight ? 'bg-black/5' : 'bg-black/35'
                    )}
                    style={{ fontFamily: t.fontFamily || 'Montserrat, sans-serif' }}
                  >
                    <span style={{ color: cardSungColor }}>Ka-ra-</span>
                    <span style={{ color: cardUnsungColor }}>oke</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className={sectionLabel}>Colors</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              {
                id: 'sung-color-picker',
                label: 'Sung highlight',
                aria: 'Sung highlight color',
                value: activeSungColor,
                onChange: onCustomSungColorChange,
              },
              {
                id: 'unsung-color-picker',
                label: 'Unsung text',
                aria: 'Unsung text color',
                value: activeUnsungColor,
                onChange: onCustomUnsungColorChange,
              },
            ].map((c) => (
              <label
                key={c.id}
                htmlFor={c.id}
                className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-theme-md border border-theme-border-subtle px-2 py-1.5 transition-colors hover:border-theme-border"
              >
                <input
                  id={c.id}
                  type="color"
                  data-testid={c.id}
                  aria-label={c.aria}
                  value={c.value}
                  onChange={(e) => c.onChange?.(e.target.value)}
                  className="h-7 w-7 shrink-0 cursor-pointer rounded-theme-sm border border-theme-border-subtle bg-transparent p-0"
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-theme-text">
                    {c.label}
                  </span>
                  <span className="block font-mono text-[10px] uppercase text-theme-text-muted">
                    {c.value}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className={sectionLabel}>Lyric size</span>
            <span className="font-mono text-xs font-semibold tabular-nums text-theme-text">
              {activeScale}x
            </span>
          </div>
          <SegmentedControl
            value={activeScaleOption}
            onChange={(v) => onFontSizeScaleChange?.(parseFloat(v))}
            ariaLabel="Lyric font size scale"
            size="sm"
            fullWidth
            tone="neutral"
            options={FONT_SCALES.map((scale) => ({
              value: scale.toString(),
              label: `${scale}x`,
              ariaLabel: `Scale ${scale}x`,
              testId: `font-scale-${scale}x`,
            }))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className={sectionLabel}>Background</span>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-theme-md border border-theme-border-subtle px-2.5 py-2">
            <span className="flex min-w-0 items-center gap-2 text-xs text-theme-text">
              <ImageIcon
                className="h-3.5 w-3.5 shrink-0 text-theme-text-muted"
                aria-hidden="true"
              />
              <span className="truncate" title={customBgId || undefined}>
                {customBgId ? displayBackgroundName(customBgId) : 'Blurred album art'}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <input
                type="file"
                ref={bgInputRef}
                onChange={handleBgUpload}
                accept="image/*,video/*,.mp4,.webm,.jpg,.jpeg,.png,.webp"
                aria-label="Upload custom stage background image or video"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => bgInputRef.current?.click()}
                disabled={uploadingBg}
                className={cn(
                  smallButton,
                  'border border-theme-border-subtle bg-theme-surface-raised text-theme-text hover:border-theme-border'
                )}
              >
                {uploadingBg ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {uploadingBg ? 'Uploading...' : customBgId ? 'Replace' : 'Upload'}
              </button>
              {customBgId && (
                <button
                  type="button"
                  onClick={() => onCustomBgUploaded('')}
                  aria-label="Reset to Album Art"
                  title="Use the blurred album art again"
                  className={cn(
                    smallButton,
                    'min-w-[44px] justify-center text-theme-text-muted hover:bg-theme-danger/10 hover:text-theme-danger md:min-w-[32px]'
                  )}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </span>
          </div>
          <p className="text-[11px] leading-snug text-theme-text-muted">
            Image or looping video (MP4/WebM) shown behind the lyrics in the preview and export.
          </p>
        </div>
      </div>
    </Panel>
  );
};

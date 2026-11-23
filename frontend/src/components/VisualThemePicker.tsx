/**
 * Stage look panel
 *
 * The video format (16:9 / 9:16 Shorts), the look (five, each with its own type, layout and
 * motion), the colours chosen for that look, the lyric size and the background: cover art
 * (still or drifting), aurora, spectrum, plain, or an uploaded image/video. The lyric
 * highlight mode lives in the stage toolbar.
 */

import React, { useRef, useState } from 'react';
import {
  AudioLines,
  Check,
  ImageIcon,
  Monitor,
  Move,
  RotateCcw,
  Smartphone,
  Square,
  Upload,
  X,
  Waves,
} from 'lucide-react';
import { STAGE_LOOKS, type StageLook } from '../theme/stageLooks';
import { LookSample } from './stage/LookSample';
import { StageSize } from '../theme/stageSettingsStorage';
import { STAGE_BACKGROUND_OPTIONS, StageBackgroundStyle } from '../theme/stageBackgrounds';
import { apiFetch, readApiError } from '../api';
import { useToast } from '../hooks/useToast';
import { Panel } from './ui/Panel';
import { SegmentedControl } from './ui/SegmentedControl';
import { Spinner } from './ui/Spinner';
import { focusRing } from './ui/variants';
import { cn } from '../utils/cn';
import { backgroundTooLarge, isVideoFile } from '../utils/uploadLimits';

export interface VisualThemePickerProps {
  /** The look in use. */
  selectedTheme: StageLook;
  onSelectTheme: (look: StageLook) => void;
  aspectRatio: string;
  onChangeAspectRatio: (ratio: string) => void;
  onCustomBgUploaded: (bgId: string) => void;
  customBgId?: string;
  /** What the stage shows behind the lyrics; the style picker is hidden without a handler. */
  backgroundStyle?: StageBackgroundStyle;
  onBackgroundStyleChange?: (style: StageBackgroundStyle) => void;
  /** The song has cover art (without it the art styles show the stage colour). */
  hasArtwork?: boolean;
  customSungColor?: string | null;
  onCustomSungColorChange?: (color: string) => void;
  customUnsungColor?: string | null;
  onCustomUnsungColorChange?: (color: string) => void;
  fontSizeScale?: number;
  onFontSizeScaleChange?: (scale: number) => void;
  onResetThemeDefaults?: () => void;
  /** Show Singer 2 / Both color pickers (the song has duet lines). */
  showDuetColors?: boolean;
  customSinger2Color?: string | null;
  onCustomSinger2ColorChange?: (color: string) => void;
  customBothColor?: string | null;
  onCustomBothColorChange?: (color: string) => void;
  /** Desktop stage height budget; the control is hidden when no handler is given. */
  stageSize?: StageSize;
  onStageSizeChange?: (size: StageSize) => void;
  className?: string;
}

const FONT_SCALES = [0.8, 1.0, 1.2, 1.5] as const;

const STAGE_SIZE_OPTIONS: ReadonlyArray<{ value: StageSize; label: string; hint: string }> = [
  { value: 'compact', label: 'Compact', hint: 'More room for the timeline' },
  { value: 'standard', label: 'Standard', hint: 'Balanced stage and timeline' },
  { value: 'large', label: 'Large', hint: 'Bigger live preview' },
];

const sectionLabel = 'text-sm font-semibold text-theme-text';

const BACKGROUND_ICONS: Record<
  StageBackgroundStyle,
  React.ComponentType<{ className?: string }>
> = {
  artwork: ImageIcon,
  drift: Move,
  aurora: Waves,
  spectrum: AudioLines,
  color: Square,
  custom: Upload,
};

const smallButton = cn(
  'ks-display inline-flex min-h-[44px] md:min-h-[32px] items-center gap-1.5 px-3 text-[20px] transition-colors disabled:opacity-50',
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
  backgroundStyle = 'artwork',
  onBackgroundStyleChange,
  hasArtwork = true,
  customSungColor,
  onCustomSungColorChange,
  customUnsungColor,
  onCustomUnsungColorChange,
  fontSizeScale = 1.0,
  onResetThemeDefaults,
  onFontSizeScaleChange,
  showDuetColors = false,
  customSinger2Color,
  onCustomSinger2ColorChange,
  customBothColor,
  onCustomBothColorChange,
  stageSize = 'standard',
  onStageSizeChange,
  className,
}) => {
  const { toast } = useToast();
  const [uploadingBg, setUploadingBg] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const { palette } = selectedTheme;
  const activeSungColor = customSungColor || palette.sung;
  const activeUnsungColor = customUnsungColor || palette.unsung;
  const activeSinger2Color = customSinger2Color || palette.singer2;
  const activeBothColor = customBothColor || palette.both;
  // In a look that dims what was sung, a part's colour is on its words still to sing
  const dims = selectedTheme.emphasis === 'unsung';
  const activeScale = fontSizeScale || 1.0;
  const activeScaleOption =
    FONT_SCALES.find((s) => Math.abs(activeScale - s) < 0.05)?.toString() ?? '';
  const activeBackground =
    backgroundStyle === 'custom' && !customBgId ? 'artwork' : backgroundStyle;
  const activeBackgroundOption = STAGE_BACKGROUND_OPTIONS.find((o) => o.value === activeBackground);
  const backgroundOptions = [
    ...STAGE_BACKGROUND_OPTIONS.map((o) => ({
      value: o.value as StageBackgroundStyle,
      label: o.label,
      title: o.hint,
      testId: `background-style-${o.value}`,
    })),
    // The uploaded file (its name shows in the row below)
    ...(customBgId
      ? [
          {
            value: 'custom' as StageBackgroundStyle,
            label: 'Upload',
            title: 'Your uploaded image or video',
            testId: 'background-style-custom',
          },
        ]
      : []),
  ].map((o) => {
    const Icon = BACKGROUND_ICONS[o.value];
    return { ...o, icon: <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> };
  });

  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const sizeError = backgroundTooLarge(file);
    if (sizeError) {
      toast.error(sizeError);
      e.target.value = '';
      return;
    }

    setUploadingBg(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await apiFetch('/api/upload-background', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        // The server's detail says why, such as a rejected file or a disk that is almost full
        toast.error(await readApiError(res, 'Could not upload custom background file.'));
        return;
      }
      const data = await res.json();
      onCustomBgUploaded(data.bg_id);
      toast.success(
        isVideoFile(file)
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
      headingLevel={2}
      title="Stage look"
      description="How the stage and the video look"
      className={className}
      data-testid="stage-look-panel"
      actions={
        onResetThemeDefaults ? (
          <button
            type="button"
            data-testid="reset-theme-defaults-btn"
            onClick={onResetThemeDefaults}
            aria-label="Reset colors and font size to the look's own"
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

        <div className="flex flex-col gap-1">
          <span className={sectionLabel} id="stage-look-list-label">
            Look
          </span>
          <div role="group" aria-labelledby="stage-look-list-label" className="flex flex-col">
            {STAGE_LOOKS.map((look) => {
              const isSelected = selectedTheme.id === look.id;
              return (
                <button
                  key={look.id}
                  type="button"
                  aria-pressed={isSelected}
                  data-testid={`look-option-${look.id}`}
                  onClick={() => onSelectTheme(look)}
                  className={cn(
                    'flex min-h-[44px] w-full items-center gap-3 border-b border-theme-border-subtle py-2 text-left transition-colors hover:bg-theme-surface-subtle',
                    focusRing
                  )}
                >
                  <LookSample
                    look={look}
                    aspect={aspectRatio === '9:16' ? '9:16' : '16:9'}
                    sung={isSelected ? activeSungColor : undefined}
                    unsung={isSelected ? activeUnsungColor : undefined}
                    className={aspectRatio === '9:16' ? 'w-12 shrink-0' : 'w-28 shrink-0'}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={cn(
                        'ks-display text-[20px]',
                        isSelected ? 'text-theme-accent' : 'text-theme-text'
                      )}
                    >
                      {look.name}
                    </span>
                    <span className="text-[13px] text-theme-text-muted">{look.description}</span>
                  </span>
                  {isSelected && (
                    <Check
                      className="h-4 w-4 shrink-0 stroke-[3] text-theme-accent"
                      aria-hidden="true"
                    />
                  )}
                </button>
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
                label: 'Sung words',
                aria: 'Sung highlight color',
                value: activeSungColor,
                onChange: onCustomSungColorChange,
              },
              {
                id: 'unsung-color-picker',
                label: 'Words to sing',
                aria: 'Unsung text color',
                value: activeUnsungColor,
                onChange: onCustomUnsungColorChange,
              },
              ...(showDuetColors
                ? [
                    {
                      id: 'singer2-color-picker',
                      label: 'Singer 2',
                      aria: 'Singer 2 sung color',
                      value: activeSinger2Color,
                      onChange: onCustomSinger2ColorChange,
                    },
                    {
                      id: 'both-color-picker',
                      label: 'Both singers',
                      aria: 'Both singers sung color',
                      value: activeBothColor,
                      onChange: onCustomBothColorChange,
                    },
                  ]
                : []),
            ].map((c) => (
              <label
                key={c.id}
                htmlFor={c.id}
                className="flex min-h-[44px] cursor-pointer items-center gap-2 border border-theme-border-subtle px-2 py-1.5 transition-colors hover:border-theme-border"
              >
                <input
                  id={c.id}
                  type="color"
                  data-testid={c.id}
                  aria-label={c.aria}
                  value={c.value}
                  onChange={(e) => c.onChange?.(e.target.value)}
                  className="h-7 w-7 shrink-0 cursor-pointer border border-theme-border-subtle bg-transparent p-0"
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-theme-text">
                    {c.label}
                  </span>
                  <span className="block tabular-nums text-xs uppercase text-theme-text-muted">
                    {c.value}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-[13px] text-theme-text-muted" data-testid="look-colors-note">
            {dims
              ? `In ${selectedTheme.name} a part's colour shows on the words still to sing. Colours are kept for this look.`
              : 'Colours are kept for this look.'}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className={sectionLabel}>Lyric size</span>
            <span className="tabular-nums text-xs font-semibold text-theme-text">
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

        {onStageSizeChange && (
          <div className="hidden flex-col gap-2 md:flex">
            <span className={sectionLabel}>Studio preview size</span>
            <SegmentedControl<StageSize>
              value={stageSize}
              onChange={onStageSizeChange}
              ariaLabel="Studio preview size"
              size="sm"
              fullWidth
              tone="neutral"
              options={STAGE_SIZE_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
                title: o.hint,
                testId: `stage-size-${o.value}`,
              }))}
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className={sectionLabel}>Background</span>
          {onBackgroundStyleChange && (
            <>
              <SegmentedControl<StageBackgroundStyle>
                value={activeBackground}
                onChange={onBackgroundStyleChange}
                semantics="radio"
                ariaLabel="Stage background"
                size="sm"
                fullWidth
                tone="neutral"
                optionClassName="min-w-[6.5rem]"
                testId="background-style-picker"
                options={backgroundOptions}
              />
              {activeBackgroundOption?.needsArtwork && !hasArtwork && (
                <p className="text-xs leading-snug text-theme-text-muted">
                  This song has no cover art, so the stage colour shows instead.
                </p>
              )}
              {activeBackgroundOption?.moves && (
                <p className="text-xs leading-snug text-theme-text-muted">
                  Moves with the song: press play to see it. While paused, the stage shows the
                  video&apos;s frame at that moment.
                </p>
              )}
            </>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-sm text-theme-text-muted">
              <span className="truncate" title={customBgId || undefined}>
                {customBgId ? displayBackgroundName(customBgId) : 'No image or video uploaded'}
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
                  'border border-theme-border text-theme-text hover:bg-theme-text hover:text-theme-text-inverse'
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
                  aria-label="Remove uploaded background"
                  title="Remove the uploaded image or video"
                  className={cn(
                    smallButton,
                    'min-w-[44px] justify-center text-theme-text-muted hover:text-theme-danger md:min-w-[32px]'
                  )}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </span>
          </div>
          <p className="text-xs leading-snug text-theme-text-muted">
            Image or looping video (MP4/WebM) shown behind the lyrics in the preview and export.
          </p>
        </div>
      </div>
    </Panel>
  );
};

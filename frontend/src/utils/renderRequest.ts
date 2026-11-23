/**
 * What a render or a subtitle download says about the look: the look's id and only what the
 * user chose on top of it (colours, lyric size, highlight mode, background). The look's own
 * colours are never sent, so a look can change without old choices being mistaken for it.
 */
import type { SyncDisplayMode } from '../types';
import { isGeneratedStyle, type StageBackgroundStyle } from '../theme/stageBackgrounds';

export interface LookChoices {
  /** The look's id. */
  lookId: string;
  /** Colours the user picked for this look (null or undefined: the look's own). */
  sung?: string | null;
  unsung?: string | null;
  singer2?: string | null;
  both?: string | null;
  fontSizeScale?: number;
  syncMode?: SyncDisplayMode;
}

/** The `style_config` of a render request. */
export function renderStyleConfig(
  choices: LookChoices,
  background?: { style: StageBackgroundStyle; palette: [string, string, string] }
): Record<string, unknown> {
  const config: Record<string, unknown> = { theme_id: choices.lookId };
  if (choices.sung) config.primary_color = choices.sung;
  if (choices.unsung) config.secondary_color = choices.unsung;
  if (choices.singer2) config.singer2_color = choices.singer2;
  if (choices.both) config.both_color = choices.both;
  if (choices.fontSizeScale !== undefined) config.font_size_scale = choices.fontSizeScale;
  if (choices.syncMode) config.sync_mode = choices.syncMode;
  if (background) {
    // Cover art is the renderer's default, and an upload outranks every style
    if (background.style !== 'artwork' && background.style !== 'custom') {
      config.background_style = background.style;
    }
    // Aurora and spectrum are drawn in the colours in use
    if (isGeneratedStyle(background.style)) config.background_palette = background.palette;
  }
  return config;
}

/** The query of a subtitle (.ass) download, after `/export/ass?`. */
export function assExportQuery(
  choices: LookChoices,
  more: { aspectRatio: string; includeChords?: boolean; semitones?: number }
): string {
  const query = new URLSearchParams({ aspect_ratio: more.aspectRatio, theme_id: choices.lookId });
  if (choices.sung) query.set('primary_color', choices.sung);
  if (choices.unsung) query.set('secondary_color', choices.unsung);
  if (choices.fontSizeScale !== undefined)
    query.set('font_size_scale', String(choices.fontSizeScale));
  if (choices.singer2) query.set('singer2_color', choices.singer2);
  if (choices.both) query.set('both_color', choices.both);
  if (choices.syncMode) query.set('sync_mode', choices.syncMode);
  if (more.includeChords) {
    query.set('include_chords', 'true');
    query.set('semitones', String(more.semitones ?? 0));
  }
  return query.toString();
}

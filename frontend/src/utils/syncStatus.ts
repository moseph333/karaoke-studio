/**
 * Song header status: how the lyrics are timed (fidelity, confidence, auto-aligned, a running
 * re-alignment) and which quality made the stems (or the progress of re-making them).
 */

import type { ProjectState } from '../types';
import type { BadgeTone } from '../components/ui/variants';
import { PRESET_NAMES, stemsLabel } from './quality';

const isActiveJob = (status?: string) => status === 'queued' || status === 'running';

/** The sync badge: how the lyrics are timed, how well, and whether a re-alignment runs. */
export function getLyricSyncFidelity(project: ProjectState): {
  label: 'Synced Words' | 'Line Synced' | 'Plain Lyrics' | 'Re-aligning';
  tone: BadgeTone;
  tooltipText: string;
  quality: number | null;
  autoAligned: boolean;
} {
  const lines = project.lines || [];
  const job = project.sync_job;
  if (job && isActiveJob(job.status)) {
    return {
      label: 'Re-aligning',
      tone: 'accent',
      tooltipText: `Re-aligning the lyrics in the background (${Math.round(job.progress)}%); the synchronization updates when it finishes`,
      quality: null,
      autoAligned: false,
    };
  }
  const plain = (tooltipText: string) => ({
    label: 'Plain Lyrics' as const,
    tone: 'warning' as const,
    tooltipText,
    quality: null,
    autoAligned: false,
  });
  if (lines.length === 0) return plain('No synchronized timing data detected');

  const hasLineTimings = lines.some((l) => (l.start_time || 0) > 0 || (l.end_time || 0) > 0);
  if (!hasLineTimings) return plain('Lyrics have untimed lines (requires audio alignment)');

  const hasWordTimings = lines.some(
    (l) => l.words && l.words.length > 0 && l.words.some((w) => w.end_time > w.start_time)
  );
  // Pasted or plain lyrics stay is_synced=false even after the aligner has timed them
  const autoAligned =
    project.lyric_timing === 'aligned' ||
    (project.lyric_timing === undefined && project.is_synced === false);
  const report = project.sync_report;
  const mean = report?.mean_confidence;
  const quality = typeof mean === 'number' && Number.isFinite(mean) ? Math.round(mean * 100) : null;
  const review = report?.low_confidence_lines ?? 0;

  const details = [
    hasWordTimings
      ? 'High-fidelity word-level karaoke synchronization active'
      : 'Line-level timestamp synchronization active',
    autoAligned
      ? `auto-aligned from plain lyrics${report ? ` by the ${report.engine === 'ctc' ? 'neural' : 'DSP'} aligner` : ''}`
      : project.lyric_timing === 'source_word'
        ? 'word timing from the lyrics file'
        : null,
    quality !== null ? `${quality}% average confidence` : null,
    review > 0 ? `${review} ${review === 1 ? 'line needs' : 'lines need'} review` : null,
  ].filter(Boolean);

  return {
    label: hasWordTimings ? 'Synced Words' : 'Line Synced',
    tone: quality !== null && quality < 60 ? 'warning' : hasWordTimings ? 'success' : 'info',
    tooltipText: details.join(' · '),
    quality,
    autoAligned,
  };
}

/** The stems badge: which quality made the stems, or the progress of re-making them. */
export function getStemsBadge(project: ProjectState): {
  text: string;
  tooltip: string;
  active: boolean;
} {
  const job = project.separation_job;
  if (job && isActiveJob(job.status)) {
    return {
      text: `Re-making stems · ${Math.round(job.progress)}%`,
      tooltip: job.detail || 'Re-making the stems in the background',
      active: true,
    };
  }
  const preset = project.separation?.preset;
  const name = preset && preset !== 'custom' ? PRESET_NAMES[preset] : preset ? 'Custom' : 'Fast';
  const fallback = project.separation?.fallback_reason;
  return {
    text: `${name} stems`,
    tooltip: `Stems: ${stemsLabel(project.separation)}${fallback ? ` (fell back: ${fallback})` : ''}`,
    active: false,
  };
}

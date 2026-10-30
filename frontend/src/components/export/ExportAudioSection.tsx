/**
 * Export Audio Section Component
 *
 * Provides one-click downloads for isolated stems (instrumental, vocals)
 * and active master mix audio directly from the export modal.
 */

import React, { useState } from 'react';
import { Download, Music, Mic, Volume2, Loader2, AlertCircle } from 'lucide-react';
import { ProjectState } from '../../types';
import { apiFetch, readApiError } from '../../api';
import { Tooltip } from '../Tooltip';
import { useToast } from '../../hooks/useToast';
import { parseContentDispositionFilename } from '../../utils/download';
import { cn } from '../../utils/cn';
import { focusRing } from '../ui/variants';
import { EXPORT_ERROR, EXPORT_HEADING, EXPORT_SECTION } from './exportStyles';

export interface ExportAudioSectionProps {
  project: ProjectState;
}

type StemType = 'instrumental' | 'vocals' | 'master';

interface StemOption {
  id: StemType;
  label: string;
  badge: string;
  description: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}

const STEM_OPTIONS: StemOption[] = [
  {
    id: 'instrumental',
    label: 'Instrumental Stem',
    badge: 'Backing',
    description: 'Clean backing track without vocal stems',
    icon: Music,
  },
  {
    id: 'vocals',
    label: 'Vocal Stem',
    badge: 'Acapella',
    description: 'Isolated vocal performance stem',
    icon: Mic,
  },
  {
    id: 'master',
    label: 'Master Mix',
    badge: 'Active Key',
    description: 'Active mix with pitch shift and guide vocal',
    icon: Volume2,
  },
];

export const ExportAudioSection: React.FC<ExportAudioSectionProps> = ({ project }) => {
  const { toast } = useToast();
  const [downloadingStem, setDownloadingStem] = useState<StemType | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownloadStem = async (stemType: StemType) => {
    try {
      setDownloadingStem(stemType);
      setDownloadError(null);

      const url = `/api/project/${project.id}/export/audio/${stemType}`;
      const res = await apiFetch(url);

      if (!res.ok) {
        throw new Error(await readApiError(res, `Failed to export ${stemType} audio stem`));
      }

      const blob = await res.blob();
      const filename =
        parseContentDispositionFilename(res.headers.get('Content-Disposition')) ||
        `${project.artist || 'Karaoke'} - ${project.title || 'Track'} (${stemType}).wav`;

      if (
        typeof window !== 'undefined' &&
        window.URL &&
        typeof window.URL.createObjectURL === 'function'
      ) {
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast.success('Download started!');
        if (typeof window.URL.revokeObjectURL === 'function') {
          setTimeout(() => {
            window.URL.revokeObjectURL(blobUrl);
          }, 1500);
        }
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast.success('Download started!');
      }
    } catch (err: unknown) {
      console.error(`Download ${stemType} failed:`, err);
      setDownloadError(
        err instanceof Error ? err.message : `Failed to download ${stemType} audio stem`
      );
    } finally {
      setDownloadingStem(null);
    }
  };

  const isReady = project.status === 'ready';

  return (
    <section aria-labelledby="export-stems-heading" className={EXPORT_SECTION}>
      <div className="space-y-1">
        <h3 id="export-stems-heading" className={EXPORT_HEADING}>
          <Volume2 className="h-5 w-5 shrink-0 text-theme-success" aria-hidden="true" />
          Direct Audio Stem Downloads
        </h3>
        <p className="text-xs text-theme-text-muted">
          Download isolated high-fidelity stems or active master audio
        </p>
      </div>

      {downloadError && (
        <div role="alert" className={cn(EXPORT_ERROR, 'flex items-center gap-2')}>
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{downloadError}</span>
        </div>
      )}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STEM_OPTIONS.map((stem) => {
          const Icon = stem.icon;
          const isDownloading = downloadingStem === stem.id;

          return (
            <li
              key={stem.id}
              className="flex flex-col justify-between gap-3 rounded-theme-md border border-theme-border-subtle bg-theme-surface p-3.5 transition-colors hover:border-theme-border"
            >
              <div className="space-y-1">
                <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-theme-text-muted">
                  {stem.badge}
                </span>
                <span className="flex items-center gap-1.5 text-sm font-bold text-theme-text">
                  <Icon className="h-4 w-4 shrink-0 text-theme-highlight" aria-hidden="true" />
                  {stem.label}
                </span>
                <p className="text-[11px] leading-tight text-theme-text-muted">
                  {stem.description}
                </p>
              </div>

              <Tooltip content={`Download ${stem.label}`} position="top" className="w-full">
                <button
                  type="button"
                  onClick={() => handleDownloadStem(stem.id)}
                  disabled={!isReady || downloadingStem !== null}
                  aria-label={`Download ${stem.label}`}
                  className={cn(
                    'flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-theme-md border border-theme-border-subtle bg-theme-surface-raised px-3 py-2 text-xs font-semibold text-theme-text transition-colors hover:border-theme-border hover:bg-theme-surface-subtle disabled:cursor-not-allowed disabled:opacity-50',
                    focusRing
                  )}
                >
                  {isDownloading ? (
                    <>
                      <Loader2
                        className="h-3.5 w-3.5 text-theme-highlight animate-spin"
                        aria-hidden="true"
                      />
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Download className="h-3.5 w-3.5 text-theme-highlight" aria-hidden="true" />
                      Download .wav
                    </>
                  )}
                </button>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

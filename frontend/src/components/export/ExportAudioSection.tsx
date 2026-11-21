/**
 * Export Audio Section Component
 *
 * Provides one-click downloads for isolated stems (instrumental, vocals, and the parts of a
 * song whose vocals have been split: lead and backing, the male and the female voice) and
 * active master mix audio directly from the export modal.
 */

import React, { useState } from 'react';
import { Download, Loader2, AlertCircle } from 'lucide-react';
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

type StemType =
  | 'instrumental'
  | 'vocals'
  | 'master'
  | 'lead_vocals'
  | 'backing_vocals'
  | 'male_vocals'
  | 'female_vocals';

interface StemOption {
  id: StemType;
  label: string;
  description: string;
}

const STEM_OPTIONS: StemOption[] = [
  {
    id: 'instrumental',
    label: 'Instrumental Stem',
    description: 'Clean backing track without vocal stems',
  },
  {
    id: 'vocals',
    label: 'Vocal Stem',
    description: 'Isolated vocal performance stem',
  },
  {
    id: 'master',
    label: 'Master Mix',
    description: 'Active mix with pitch shift and the vocals kept in',
  },
];

/** The parts of a song whose vocals have been split into lead and backing. */
const PART_STEM_OPTIONS: StemOption[] = [
  {
    id: 'lead_vocals',
    label: 'Lead Vocal Stem',
    description: 'The lead voice without the backing vocals',
  },
  {
    id: 'backing_vocals',
    label: 'Backing Vocal Stem',
    description: 'Backing vocals and harmonies without the lead',
  },
];

/** The two voices of a song whose lead has been split into a male and a female voice. */
const VOICE_STEM_OPTIONS: StemOption[] = [
  {
    id: 'male_vocals',
    label: 'Male Voice Stem',
    description: 'The male voice on its own',
  },
  {
    id: 'female_vocals',
    label: 'Female Voice Stem',
    description: 'The female voice on its own',
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
  const stems = [
    ...STEM_OPTIONS,
    ...(project.vocal_splits?.lead_backing ? PART_STEM_OPTIONS : []),
    ...(project.vocal_splits?.male_female ? VOICE_STEM_OPTIONS : []),
  ];

  return (
    <section aria-labelledby="export-stems-heading" className={EXPORT_SECTION}>
      <div className="space-y-1">
        <h3 id="export-stems-heading" className={EXPORT_HEADING}>
          Audio
        </h3>
        <p className="text-sm text-theme-text-muted">
          The separated stems and the mix you hear now, as WAV files.
        </p>
      </div>

      {downloadError && (
        <div role="alert" className={cn(EXPORT_ERROR, 'flex items-center gap-2')}>
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{downloadError}</span>
        </div>
      )}

      <ul>
        {stems.map((stem) => {
          const isDownloading = downloadingStem === stem.id;

          return (
            <li
              key={stem.id}
              className="flex flex-col gap-x-4 gap-y-1 border-b border-theme-border-subtle py-2 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <span className="block text-sm font-semibold text-theme-text">{stem.label}</span>
                <p className="text-sm text-theme-text-muted">{stem.description}</p>
              </div>

              <Tooltip
                content={`Download ${stem.label}`}
                position="top"
                className="w-full shrink-0 sm:w-auto"
              >
                <button
                  type="button"
                  onClick={() => handleDownloadStem(stem.id)}
                  disabled={!isReady || downloadingStem !== null}
                  aria-label={`Download ${stem.label}`}
                  className={cn(
                    'ks-display flex min-h-[44px] w-full items-center justify-center gap-2 border border-theme-border px-3 text-[20px] text-theme-text transition-colors hover:bg-theme-text hover:text-theme-text-inverse disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto md:min-h-[36px]',
                    focusRing
                  )}
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" aria-hidden="true" />
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

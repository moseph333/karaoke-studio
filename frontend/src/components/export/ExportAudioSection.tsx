/**
 * Export Audio Section Component
 *
 * Provides one-click downloads for isolated stems (instrumental, vocals)
 * and active master mix audio directly from the export modal.
 */

import React, { useState } from 'react';
import { Download, Music, Mic, Volume2, Loader2, AlertCircle } from 'lucide-react';
import { ProjectState } from '../../types';
import { apiFetch } from '../../api';
import { Tooltip } from '../Tooltip';

export interface ExportAudioSectionProps {
  project: ProjectState;
}

type StemType = 'instrumental' | 'vocals' | 'master';

interface StemOption {
  id: StemType;
  label: string;
  badge: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
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
  const [downloadingStem, setDownloadingStem] = useState<StemType | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownloadStem = async (stemType: StemType) => {
    try {
      setDownloadingStem(stemType);
      setDownloadError(null);

      const url = `/api/project/${project.id}/export/audio/${stemType}`;
      const res = await apiFetch(url);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Failed to export ${stemType} audio stem`);
      }

      const blob = await res.blob();
      let filename = `${project.artist || 'Karaoke'} - ${project.title || 'Track'} (${stemType}).wav`;
      const disposition = res.headers.get('Content-Disposition');

      if (disposition) {
        const rfcMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (rfcMatch && rfcMatch[1]) {
          try {
            filename = decodeURIComponent(rfcMatch[1]);
          } catch {
            filename = rfcMatch[1];
          }
        } else {
          const stdMatch = disposition.match(/filename="?([^";]+)"?/i);
          if (stdMatch && stdMatch[1]) {
            filename = stdMatch[1];
          }
        }
      }

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
        if (typeof window.URL.revokeObjectURL === 'function') {
          window.URL.revokeObjectURL(blobUrl);
        }
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
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
    <div className="bg-slate-950/40 border border-slate-800/60 rounded-2xl p-4 sm:p-5 mb-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <Volume2 className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Direct Audio Stem Downloads</h3>
            <p className="text-xs text-slate-400">
              Download isolated high-fidelity stems or active master audio
            </p>
          </div>
        </div>
      </div>

      {downloadError && (
        <div
          role="alert"
          className="flex items-center gap-2 p-3 rounded-xl bg-red-950/40 border border-red-800/50 text-red-300 text-xs font-mono"
        >
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="flex-1">{downloadError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {STEM_OPTIONS.map((stem) => {
          const Icon = stem.icon;
          const isDownloading = downloadingStem === stem.id;

          return (
            <div
              key={stem.id}
              className="flex flex-col justify-between p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700/80 transition-all gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5 text-cyan-400" />
                    {stem.label}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                    {stem.badge}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-tight">{stem.description}</p>
              </div>

              <Tooltip content={`Download ${stem.label}`} position="top" className="w-full">
                <button
                  type="button"
                  onClick={() => handleDownloadStem(stem.id)}
                  disabled={!isReady || downloadingStem !== null}
                  aria-label={`Download ${stem.label}`}
                  className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5 text-cyan-400" />
                      Download .wav
                    </>
                  )}
                </button>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
};

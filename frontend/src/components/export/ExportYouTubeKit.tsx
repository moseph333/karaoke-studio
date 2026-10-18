/**
 * Export YouTube Kit Component
 *
 * Renders ready-to-copy metadata blocks for YouTube (title, description with chapters,
 * and SEO tags) with clipboard copy actions and visual feedback.
 */

import React, { useState } from 'react';
import { Copy, Check, Sparkles } from 'lucide-react';
import { ProjectState } from '../../types';

export interface ExportYouTubeKitProps {
  youtubePackage: NonNullable<ProjectState['youtube_package']>;
}

export const ExportYouTubeKit: React.FC<ExportYouTubeKitProps> = ({ youtubePackage: yt }) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-cyan-400" />
        <h4 className="text-sm font-bold text-white uppercase tracking-wider">
          YouTube Metadata & Upload Kit
        </h4>
      </div>

      {/* Title */}
      <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-slate-400">Video Title</span>
          <button
            type="button"
            onClick={() => copyToClipboard(yt.title, 'title')}
            className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium min-h-[36px] sm:min-h-[32px] px-2 py-1 rounded-lg hover:bg-slate-800/50 transition-colors"
          >
            {copiedField === 'title' ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copiedField === 'title' ? 'Copied!' : 'Copy Title'}
          </button>
        </div>
        <p className="text-sm font-medium text-white">{yt.title}</p>
      </div>

      {/* Description */}
      <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-slate-400">
            Description (with Chapters & Lyrics)
          </span>
          <button
            type="button"
            onClick={() => copyToClipboard(yt.description, 'description')}
            className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium min-h-[36px] sm:min-h-[32px] px-2 py-1 rounded-lg hover:bg-slate-800/50 transition-colors"
          >
            {copiedField === 'description' ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copiedField === 'description' ? 'Copied!' : 'Copy Description'}
          </button>
        </div>
        <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap break-words overflow-x-auto max-h-36 overflow-y-auto bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
          {yt.description}
        </pre>
      </div>

      {/* Tags */}
      <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-slate-400">SEO Tags (comma-separated)</span>
          <button
            type="button"
            onClick={() => copyToClipboard(yt.tags.join(', '), 'tags')}
            className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-medium min-h-[36px] sm:min-h-[32px] px-2 py-1 rounded-lg hover:bg-slate-800/50 transition-colors"
          >
            {copiedField === 'tags' ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copiedField === 'tags' ? 'Copied!' : 'Copy Tags'}
          </button>
        </div>
        <p className="text-xs text-slate-300 font-mono break-words">{yt.tags.join(', ')}</p>
      </div>
    </div>
  );
};

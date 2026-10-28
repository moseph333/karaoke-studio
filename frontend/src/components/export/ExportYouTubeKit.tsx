/**
 * Export YouTube Kit Component
 *
 * Renders ready-to-copy metadata blocks for YouTube (title, description with chapters,
 * and SEO tags) with clipboard copy actions and visual feedback.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check, Sparkles } from 'lucide-react';
import { ProjectState } from '../../types';
import { copyText } from '../../utils/clipboard';
import { cn } from '../../utils/cn';
import { focusRing } from '../ui/variants';
import { EXPORT_HEADING, EXPORT_SECTION } from './exportStyles';

export interface ExportYouTubeKitProps {
  youtubePackage: NonNullable<ProjectState['youtube_package']>;
}

type CopyField = 'title' | 'description' | 'tags';

const copyBtnCls = cn(
  'inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-theme-md px-2 py-1 text-xs font-medium text-theme-highlight transition-colors hover:bg-theme-surface-subtle hover:text-theme-text sm:min-h-[32px]',
  focusRing
);

const CopyButton: React.FC<{
  label: string;
  copied: boolean;
  failed: boolean;
  onCopy: () => void;
}> = ({ label, copied, failed, onCopy }) => (
  <button type="button" onClick={onCopy} className={copyBtnCls}>
    {copied ? (
      <Check className="h-3.5 w-3.5 text-theme-success" aria-hidden="true" />
    ) : (
      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
    )}
    {copied ? 'Copied!' : failed ? 'Copy blocked' : label}
  </button>
);

export const ExportYouTubeKit: React.FC<ExportYouTubeKitProps> = ({ youtubePackage: yt }) => {
  const [copiedField, setCopiedField] = useState<CopyField | null>(null);
  const [failedField, setFailedField] = useState<CopyField | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    []
  );

  const copyToClipboard = (text: string, field: CopyField) => {
    const started = copyText(text);
    setCopiedField(started ? field : null);
    setFailedField(started ? null : field);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      setCopiedField(null);
      setFailedField(null);
    }, 2000);
  };

  const block = (
    field: CopyField,
    heading: string,
    copyLabel: string,
    text: string,
    body: React.ReactNode
  ) => (
    <div className="rounded-theme-md border border-theme-border-subtle bg-theme-surface p-3.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-semibold text-theme-text-muted">
          {heading}
        </span>
        <CopyButton
          label={copyLabel}
          copied={copiedField === field}
          failed={failedField === field}
          onCopy={() => copyToClipboard(text, field)}
        />
      </div>
      {body}
    </div>
  );

  return (
    <section aria-labelledby="export-youtube-kit-heading" className={EXPORT_SECTION}>
      <h3 id="export-youtube-kit-heading" className={EXPORT_HEADING}>
        <Sparkles className="h-5 w-5 shrink-0 text-theme-highlight" aria-hidden="true" />
        YouTube Metadata & Upload Kit
      </h3>

      {block(
        'title',
        'Video Title',
        'Copy Title',
        yt.title,
        <p className="break-words text-sm font-medium text-theme-text">{yt.title}</p>
      )}

      {block(
        'description',
        'Description (with Chapters & Lyrics)',
        'Copy Description',
        yt.description,
        <pre className="max-h-36 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words rounded-theme-sm border border-theme-border-subtle bg-theme-bg/60 p-2.5 font-mono text-xs text-theme-text-muted">
          {yt.description}
        </pre>
      )}

      {block(
        'tags',
        'SEO Tags (comma-separated)',
        'Copy Tags',
        yt.tags.join(', '),
        <p className="break-words font-mono text-xs text-theme-text-muted">{yt.tags.join(', ')}</p>
      )}
    </section>
  );
};

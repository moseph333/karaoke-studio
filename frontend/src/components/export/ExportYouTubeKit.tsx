/**
 * Export YouTube Kit Component
 *
 * The steps from a rendered video to a YouTube upload: download and start the upload, paste
 * the title, the description (with chapters and lyrics) and the tags, each with a copy
 * button, then what to check before publishing (visibility, whether a 9:16 video becomes a
 * Short, and that YouTube may claim a song it recognises). The upload itself happens on
 * YouTube; nothing is sent from here.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check, Youtube } from 'lucide-react';
import { ProjectState } from '../../types';
import { copyText } from '../../utils/clipboard';
import { cn } from '../../utils/cn';
import { focusRing } from '../ui/variants';
import { EXPORT_HEADING, EXPORT_SECTION } from './exportStyles';

export interface ExportYouTubeKitProps {
  youtubePackage: NonNullable<ProjectState['youtube_package']>;
  /** The rendered video's format, when known: a 9:16 video may be published as a Short. */
  format?: '16:9' | '9:16';
  /** The song's length in seconds, for the Shorts limit. */
  durationSeconds?: number;
}

/** YouTube publishes square and vertical videos of up to three minutes as Shorts. */
const SHORTS_MAX_SECONDS = 180;

function shortsNote(format?: '16:9' | '9:16', durationSeconds?: number): string | null {
  if (format !== '9:16') return null;
  if (!durationSeconds || durationSeconds <= 0) {
    return 'YouTube publishes 9:16 videos of up to three minutes as Shorts.';
  }
  return durationSeconds <= SHORTS_MAX_SECONDS
    ? 'This 9:16 video is three minutes or shorter, so YouTube publishes it as a Short.'
    : 'This 9:16 video is longer than three minutes, so YouTube publishes it as a regular video, not a Short.';
}

const stepTitleCls = 'font-theme-heading text-sm font-semibold text-theme-text';
const stepHintCls = 'text-pretty text-xs leading-relaxed text-theme-text-muted';

type CopyField = 'title' | 'description' | 'tags';

const copyBtnCls = cn(
  'inline-flex min-h-[36px] shrink-0 items-center gap-1 px-2 py-1 text-xs font-medium text-theme-text transition-colors hover:bg-theme-surface-subtle hover:text-theme-text sm:min-h-[32px]',
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

export const ExportYouTubeKit: React.FC<ExportYouTubeKitProps> = ({
  youtubePackage: yt,
  format,
  durationSeconds,
}) => {
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
    <div className="border border-theme-border-subtle bg-theme-surface p-3.5">
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

  // The kit leaves chapters out when YouTube would not show them. They are the list under
  // the kit's "Timestamps:" heading; a lyric that starts with a clock time ("3:00 in the
  // morning") is not one.
  const hasChapters = /Timestamps:\n\d{1,2}:\d{2}(:\d{2})? - /.test(yt.description);
  const descriptionLabel = hasChapters
    ? 'Description (with Chapters & Lyrics)'
    : 'Description (with Lyrics)';
  const shorts = shortsNote(format, durationSeconds);

  return (
    <section aria-labelledby="export-youtube-kit-heading" className={EXPORT_SECTION}>
      <h3 id="export-youtube-kit-heading" className={EXPORT_HEADING}>
        <Youtube className="h-5 w-5 shrink-0 text-theme-danger" aria-hidden="true" />
        Upload to YouTube
      </h3>
      <p className={stepHintCls}>
        The upload happens on YouTube; nothing is sent from here. These steps give you everything to
        paste.
      </p>

      <ol className="space-y-4" data-testid="youtube-upload-steps">
        <li className="space-y-1">
          <h4 className={stepTitleCls}>1. Download the video and start an upload</h4>
          <p className={stepHintCls}>
            Use the download button above, then open YouTube Studio, choose Create, then Upload
            videos, and pick the file.
          </p>
        </li>

        <li className="space-y-1.5">
          <h4 className={stepTitleCls}>2. Paste the title</h4>
          {block(
            'title',
            'Video Title',
            'Copy Title',
            yt.title,
            <p className="break-words text-sm font-medium text-theme-text">{yt.title}</p>
          )}
        </li>

        <li className="space-y-1.5">
          <h4 className={stepTitleCls}>3. Paste the description</h4>
          <p className={stepHintCls}>
            {hasChapters
              ? 'It has the song’s details, chapter timestamps (YouTube turns them into chapters) and the lyrics.'
              : 'It has the song’s details and the lyrics. This song has too few sections for chapters: YouTube needs three of ten seconds or more.'}
          </p>
          {block(
            'description',
            descriptionLabel,
            'Copy Description',
            yt.description,
            // Scrolls when long: focusable, so keyboard users can scroll it too
            <pre
              tabIndex={0}
              role="region"
              aria-label={descriptionLabel}
              className={cn(
                'max-h-36 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words border border-theme-border-subtle bg-theme-bg/60 p-2.5 font-mono text-xs text-theme-text-muted',
                focusRing
              )}
            >
              {yt.description}
            </pre>
          )}
        </li>

        <li className="space-y-1.5">
          <h4 className={stepTitleCls}>4. Paste the tags</h4>
          <p className={stepHintCls}>
            On the upload&apos;s Details step, tags are under &ldquo;Show more&rdquo;.
          </p>
          {block(
            'tags',
            'SEO Tags (comma-separated)',
            'Copy Tags',
            yt.tags.join(', '),
            <p className="break-words font-mono text-xs text-theme-text-muted">
              {yt.tags.join(', ')}
            </p>
          )}
        </li>

        <li className="space-y-1.5">
          <h4 className={stepTitleCls}>5. Check before you publish</h4>
          <ul
            className={cn(stepHintCls, 'list-disc space-y-1 pl-4')}
            data-testid="youtube-publish-checks"
          >
            <li>
              Start with Unlisted or Private, watch the video through on YouTube, then make it
              Public.
            </li>
            {shorts && <li>{shorts}</li>}
            <li>
              YouTube may recognise the song and put a copyright claim on the video: the rights
              holder can then run ads on it or block it in some countries. Upload only songs you
              have the right to share.
            </li>
          </ul>
        </li>
      </ol>
    </section>
  );
};

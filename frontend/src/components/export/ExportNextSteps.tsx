/**
 * Export Next Steps
 *
 * The three steps from the Export dialog to a video on YouTube (render, download, upload),
 * shown before a song's first render so a new user knows what the button starts and that
 * the dialog writes the YouTube title, description and tags afterwards.
 */

import React from 'react';
import { Download, Film, Youtube } from 'lucide-react';

const STEPS: { Icon: typeof Film; title: string; text: string }[] = [
  {
    Icon: Film,
    title: 'Render',
    text: 'A few minutes for most songs. You can close this dialog meanwhile.',
  },
  {
    Icon: Download,
    title: 'Download',
    text: 'The MP4 appears here, with a preview.',
  },
  {
    Icon: Youtube,
    title: 'Upload to YouTube',
    text: 'The title, description and tags are written for you to paste.',
  },
];

export const ExportNextSteps: React.FC = () => (
  <ol
    aria-label="From here to YouTube"
    data-testid="export-next-steps"
    className="grid gap-2 sm:grid-cols-3"
  >
    {STEPS.map(({ Icon, title, text }, index) => (
      <li
        key={title}
        className="flex min-w-0 items-start gap-2.5 rounded-theme-md border border-theme-border-subtle bg-theme-surface p-3"
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-theme-highlight" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-theme-text">
            {index + 1}. {title}
          </span>
          <span className="block text-pretty text-xs text-theme-text-muted">{text}</span>
        </span>
      </li>
    ))}
  </ol>
);

/**
 * Export Next Steps
 *
 * The three steps from the Export dialog to a video on YouTube (render, download, upload),
 * shown before a song's first render so a new user knows what the button starts and that
 * the dialog writes the YouTube title, description and tags afterwards.
 */

import React from 'react';
const STEPS: { title: string; text: string }[] = [
  {
    title: 'Render',
    text: 'A few minutes for most songs. You can close this dialog meanwhile.',
  },
  {
    title: 'Download',
    text: 'The MP4 appears here, with a preview.',
  },
  {
    title: 'Upload to YouTube',
    text: 'The title, description and tags are written for you to paste.',
  },
];

export const ExportNextSteps: React.FC = () => (
  <ol
    aria-label="From here to YouTube"
    data-testid="export-next-steps"
    className="grid gap-x-8 gap-y-3 sm:grid-cols-3"
  >
    {STEPS.map(({ title, text }, index) => (
      <li key={title} className="min-w-0">
        <span className="ks-display block text-[22px] text-theme-text">
          {index + 1}. {title}
        </span>
        <span className="block text-pretty text-sm text-theme-text-muted">{text}</span>
      </li>
    ))}
  </ol>
);

/**
 * Class name composition helper.
 *
 * Combines clsx-style conditional class lists with tailwind-merge conflict resolution,
 * extended so the design system's custom utilities (`border-theme`, `font-display`,
 * `font-theme-*`) merge correctly instead of being misclassified as colors and dropped.
 */

import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'border-w': [{ border: ['theme', 'theme-thick'] }],
      'border-w-t': [{ 'border-t': ['theme', 'theme-thick'] }],
      'border-w-b': [{ 'border-b': ['theme', 'theme-thick'] }],
      'border-w-l': [{ 'border-l': ['theme', 'theme-thick'] }],
      'border-w-r': [{ 'border-r': ['theme', 'theme-thick'] }],
      'font-family': [
        { font: ['display', 'heading', 'body', 'mono', 'theme-heading', 'theme-body'] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

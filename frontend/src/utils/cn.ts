/**
 * Class name composition helper.
 *
 * Combines clsx-style conditional class lists with tailwind-merge conflict resolution,
 * extended so the design system's custom theme utilities (`border-theme`,
 * `rounded-theme-*`, `shadow-theme-*`, `font-theme-*`, `bg-gradient-*`) merge correctly
 * instead of being misclassified as colors and dropped.
 */

import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const THEME_RADII = ['theme-sm', 'theme-md', 'theme-lg', 'theme-xl', 'theme-pill'];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'border-w': [{ border: ['theme', 'theme-thick'] }],
      'border-w-t': [{ 'border-t': ['theme', 'theme-thick'] }],
      'border-w-b': [{ 'border-b': ['theme', 'theme-thick'] }],
      'border-w-l': [{ 'border-l': ['theme', 'theme-thick'] }],
      'border-w-r': [{ 'border-r': ['theme', 'theme-thick'] }],
      rounded: [{ rounded: THEME_RADII }],
      'rounded-t': [{ 'rounded-t': THEME_RADII }],
      'rounded-b': [{ 'rounded-b': THEME_RADII }],
      'rounded-l': [{ 'rounded-l': THEME_RADII }],
      'rounded-r': [{ 'rounded-r': THEME_RADII }],
      shadow: [{ shadow: ['theme-sm', 'theme-md', 'theme-lg', 'theme-glow'] }],
      'font-family': [
        { font: ['heading', 'body', 'mono', 'karaoke', 'theme-heading', 'theme-body'] },
      ],
      'bg-image': [{ bg: ['gradient-accent', 'gradient-stage'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

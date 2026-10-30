/**
 * Reduced-motion preference
 *
 * True while the viewer asks the system to reduce motion; follows changes live. Moving stage
 * backgrounds stand still for them (exported videos are unaffected).
 */

import { useMediaQuery } from './useMediaQuery';

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

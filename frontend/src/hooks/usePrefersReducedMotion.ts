/**
 * Reduced-motion preference
 *
 * True while the viewer asks the system to reduce motion; follows changes live. Moving stage
 * backgrounds stand still for them (exported videos are unaffected).
 */

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function matches(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.matchMedia?.(QUERY)?.matches);
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(matches);

  useEffect(() => {
    const media = typeof window !== 'undefined' ? window.matchMedia?.(QUERY) : undefined;
    if (!media) return;
    const update = () => setReduced(Boolean(media.matches));
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener?.(update);
    return () => media.removeListener?.(update);
  }, []);

  return reduced;
}

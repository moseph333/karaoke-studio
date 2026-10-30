/**
 * Media query hook
 *
 * Whether a CSS media query matches, following changes live (false where matchMedia is
 * unavailable).
 */

import { useEffect, useState } from 'react';

function matches(query: string): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.matchMedia?.(query)?.matches);
}

export function useMediaQuery(query: string): boolean {
  const [isMatch, setIsMatch] = useState(() => matches(query));

  useEffect(() => {
    const media = typeof window !== 'undefined' ? window.matchMedia?.(query) : undefined;
    if (!media) return;
    const update = () => setIsMatch(Boolean(media.matches));
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener?.(update);
    return () => media.removeListener?.(update);
  }, [query]);

  return isMatch;
}

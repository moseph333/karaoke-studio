/**
 * Whether an element is on screen: false while it is hidden (display: none, like the stage
 * on the phone's Timeline and Mix tabs) or scrolled out of view, so frame-rate work can stop.
 * Starts true, and stays true where IntersectionObserver is unavailable.
 */

import { useEffect, useState } from 'react';

export function useIsVisible(ref: React.RefObject<Element>): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver((entries) => {
      const latest = entries[entries.length - 1];
      if (latest) setVisible(latest.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return visible;
}

/**
 * Stable Handlers Hook
 *
 * Returns an object of functions with a fixed identity that always call the latest
 * implementation, so memoized children are not re-rendered by new closures.
 */

import { useLayoutEffect, useRef, useState } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (...args: any[]) => any;

export function useStableHandlers<T extends Record<string, AnyHandler>>(handlers: T): T {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  const [stable] = useState(() => {
    const out: Record<string, AnyHandler> = {};
    for (const key of Object.keys(handlers)) {
      out[key] = (...args: unknown[]) => latest.current[key](...args);
    }
    return out as T;
  });
  return stable;
}

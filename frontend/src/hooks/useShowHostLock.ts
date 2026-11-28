/**
 * One host screen at a time: which tab runs the show.
 *
 * The queue is kept in this browser and the stage window follows whichever host spoke last,
 * so two host tabs (a bookmark clicked twice, a restored session) would write over each
 * other's queue and take the TV from each other. The tab that runs the show holds a lock
 * (the Web Locks API, shared by the tabs of one browser and given up by the browser itself
 * when a tab closes or crashes). A tab that finds it held waits its turn and says the show
 * is open elsewhere, with a way to take it: "Run it here" takes the lock from the other
 * tab, which then waits in its turn. A tab that is waiting takes over by itself when the
 * other one closes.
 *
 * Without the API (an old browser, or a page not served over HTTPS) every tab runs the
 * show, as before.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export const SHOW_HOST_LOCK = 'karaoke-show-host';
/** A tab says the show is open elsewhere only after waiting this long for its turn: the
 *  lock of a page that is being reloaded is given up a moment after the new page asks. */
export const SHOW_HOST_WAIT_MS = 400;

/** `waiting`: asked, not answered yet. `here`: this tab runs the show. `elsewhere`: another
 *  tab does. */
export type ShowHostTurn = 'waiting' | 'here' | 'elsewhere';

export interface UseShowHostLock {
  turn: ShowHostTurn;
  /** Takes the show from the tab that has it. */
  takeOver: () => void;
}

function lockManager(): LockManager | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}

export function useShowHostLock(enabled: boolean): UseShowHostLock {
  const [turn, setTurn] = useState<ShowHostTurn>('waiting');
  const takeRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) {
      setTurn('waiting');
      return;
    }
    const locks = lockManager();
    if (!locks) {
      setTurn('here');
      return;
    }

    let gone = false;
    /** Ends the wait for a turn that has not come. */
    let waiting: AbortController | null = null;
    /** Gives the lock up, while this tab holds it. */
    let release: (() => void) | null = null;
    let notice: ReturnType<typeof setTimeout> | null = null;

    // Holding the lock is a promise that has not settled: it settles when this tab lets go
    const hold = () =>
      new Promise<void>((resolve) => {
        if (gone) {
          resolve();
          return;
        }
        if (notice) clearTimeout(notice);
        release = resolve;
        setTurn('here');
      });

    const ask = (steal: boolean) => {
      waiting?.abort();
      const controller = steal ? null : new AbortController();
      waiting = controller;
      const options: LockOptions = controller ? { signal: controller.signal } : { steal: true };
      locks.request(SHOW_HOST_LOCK, options, hold).then(
        () => {},
        () => {
          // Refused: the wait was called off (this tab is closing, or is taking the lock
          // instead), or another tab took the lock from this one
          if (gone || controller?.signal.aborted) return;
          release = null;
          setTurn('elsewhere');
          ask(false);
        }
      );
    };

    ask(false);
    notice = setTimeout(() => {
      if (!gone && !release) setTurn('elsewhere');
    }, SHOW_HOST_WAIT_MS);
    takeRef.current = () => {
      if (!gone && !release) ask(true);
    };

    return () => {
      gone = true;
      takeRef.current = () => {};
      if (notice) clearTimeout(notice);
      waiting?.abort();
      release?.();
    };
  }, [enabled]);

  const takeOver = useCallback(() => takeRef.current(), []);
  return { turn, takeOver };
}

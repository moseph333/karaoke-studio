/**
 * The Web Locks API for tests (`navigator.locks`), which jsdom does not have. Everything in a
 * test page shares it, as the tabs of one browser share the real one, so two renders of a
 * screen stand for two tabs.
 *
 * It keeps what the app relies on: one holder of a name at a time, the rest served in the
 * order they asked; a lock held until the callback's promise settles; `ifAvailable`, `steal`
 * (the holder's request is refused with an AbortError and the taker goes first) and `signal`
 * (a wait that is called off). A lock is never granted in the same turn it is asked for.
 * `dropFakeLock` stands for a holder whose tab died: the browser gives its lock up.
 */

interface Waiter {
  grant: () => void;
  refuse: (reason: unknown) => void;
}

interface Held {
  refuse: (reason: unknown) => void;
  /** Set when the lock is taken or dropped: what the holder does after no longer matters. */
  over: boolean;
}

const queues = new Map<string, Waiter[]>();
const holders = new Map<string, Held>();

const abortError = (message: string) => new DOMException(message, 'AbortError');

function next(name: string): void {
  if (holders.has(name)) return;
  queues.get(name)?.shift()?.grant();
}

/** What a request runs once it has the lock (null: `ifAvailable`, and it was not). */
type Granted = (lock: Lock | null) => unknown;

function request(
  name: string,
  optionsOrCallback: LockOptions | Granted,
  maybeCallback?: Granted
): Promise<unknown> {
  const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
  const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback!;
  const lock = { name, mode: 'exclusive' } as Lock;

  return new Promise((resolve, reject) => {
    const run = () => {
      const held: Held = { refuse: reject, over: false };
      holders.set(name, held);
      const letGo = () => {
        if (held.over) return;
        held.over = true;
        holders.delete(name);
        // Not in this turn: the next in line is served after the holder has let go
        void Promise.resolve().then(() => next(name));
      };
      Promise.resolve()
        .then(() => callback(lock))
        .then(
          (value) => {
            letGo();
            resolve(value);
          },
          (reason) => {
            letGo();
            reject(reason);
          }
        );
    };

    if (options.steal) {
      void Promise.resolve().then(() => {
        const holder = holders.get(name);
        if (holder) {
          holder.over = true;
          holders.delete(name);
          holder.refuse(abortError('The lock was taken by another request.'));
        }
        run();
      });
      return;
    }
    if (options.ifAvailable) {
      void Promise.resolve().then(() => {
        if (holders.has(name) || (queues.get(name)?.length ?? 0) > 0) {
          Promise.resolve(callback(null)).then(resolve, reject);
        } else {
          run();
        }
      });
      return;
    }

    const waiter: Waiter = { grant: run, refuse: reject };
    const queue = queues.get(name) ?? [];
    queues.set(name, queue);
    queue.push(waiter);
    options.signal?.addEventListener('abort', () => {
      const at = queue.indexOf(waiter);
      if (at < 0) return;
      queue.splice(at, 1);
      reject(abortError('The request was aborted.'));
    });
    void Promise.resolve().then(() => next(name));
  });
}

/** A holder's tab died: the browser gives its lock to the next in line. */
export function dropFakeLock(name: string): void {
  const holder = holders.get(name);
  if (!holder) return;
  holder.over = true;
  holders.delete(name);
  void Promise.resolve().then(() => next(name));
}

/** Whether somebody holds the lock of this name. */
export function fakeLockHeld(name: string): boolean {
  return holders.has(name);
}

/** Puts `navigator.locks` on the page; call `removeFakeLocks` after the test. */
export function installFakeLocks(): void {
  queues.clear();
  holders.clear();
  Object.defineProperty(window.navigator, 'locks', {
    configurable: true,
    writable: true,
    value: { request },
  });
}

export function removeFakeLocks(): void {
  queues.clear();
  holders.clear();
  delete (window.navigator as { locks?: unknown }).locks;
}

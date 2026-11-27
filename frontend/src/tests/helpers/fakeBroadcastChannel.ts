/**
 * A BroadcastChannel for tests: channels of one name in the test's page hear each other, as
 * two windows of the app would. Messages are copied (a real channel clones them) and arrive
 * at once rather than on a later task, so a test reads the result on the next line.
 * `setup.ts` installs it for every test and empties it after each.
 */

const channels = new Map<string, Set<FakeBroadcastChannel>>();

function copy<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

export class FakeBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  private closed = false;

  constructor(public readonly name: string) {
    const peers = channels.get(name) ?? new Set<FakeBroadcastChannel>();
    peers.add(this);
    channels.set(name, peers);
  }

  postMessage(data: unknown): void {
    if (this.closed) throw new DOMException('Channel is closed', 'InvalidStateError');
    for (const peer of Array.from(channels.get(this.name) ?? [])) {
      if (peer !== this && !peer.closed) peer.onmessage?.({ data: copy(data) } as MessageEvent);
    }
  }

  close(): void {
    this.closed = true;
    channels.get(this.name)?.delete(this);
  }
}

/** Forgets every open channel (between tests). */
export function resetFakeBroadcastChannels(): void {
  channels.clear();
}

/** Makes `BroadcastChannel` the fake one. */
export function installFakeBroadcastChannel(): void {
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    writable: true,
    value: FakeBroadcastChannel,
  });
}

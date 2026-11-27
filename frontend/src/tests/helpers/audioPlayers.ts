import { vi } from 'vitest';

/**
 * Collects every element the app makes with `new Audio()`: players that are never put in the
 * page (the original singer's in practice), which a test cannot find by looking. The spy is
 * undone by `vi.restoreAllMocks()`.
 */
export function captureAudioPlayers(): HTMLAudioElement[] {
  const players: HTMLAudioElement[] = [];
  const RealAudio = window.Audio;
  const spy = vi.spyOn(window, 'Audio') as unknown as {
    mockImplementation(make: (src?: string) => HTMLAudioElement): void;
  };
  spy.mockImplementation(function (src?: string) {
    const el = new RealAudio(src);
    players.push(el);
    return el;
  });
  return players;
}

/**
 * jsdom has no player: `play` and `pause` only flip `paused`, as `tests/setup.ts` sets them up.
 * `vi.restoreAllMocks()` empties those stand-ins too, so a file that restores mocks and needs
 * a player that starts calls this before each test.
 */
export function installMediaPlayback(): void {
  const flip = (paused: boolean) =>
    function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { value: paused, configurable: true, writable: true });
    };
  const play = flip(false);
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function (this: HTMLMediaElement) {
    play.call(this);
    return Promise.resolve();
  });
  vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(flip(true));
}

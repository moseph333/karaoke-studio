/**
 * After a deploy, the old build's studio chunk is gone: opening a song then reloads the page
 * once (to the new build) instead of leaving the whole app on an error screen whose "Try
 * again" cannot recover. Never twice in a row, and never without a way to tell.
 */
import { Component, Suspense, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const originalLocation = window.location;

class Catch extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? <p>Failed</p> : this.props.children;
  }
}

describe('a missing studio chunk', () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    window.sessionStorage.clear();
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.doUnmock('../../components/studio/studioBundle');
    vi.doUnmock('../../components/HelpModal');
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.restoreAllMocks();
  });

  it('reloads the page once when opening the studio cannot fetch it', async () => {
    vi.doMock('../../components/studio/studioBundle', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const { StudioWorkspace } = await import('../../deferredScreens');
    const Studio = StudioWorkspace as unknown as () => ReactNode;

    render(
      <Catch>
        <Suspense fallback={<p>Loading</p>}>
          <Studio />
        </Suspense>
      </Catch>
    );

    expect(await screen.findByText('Failed', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload for a missing help chunk, which can open over unsaved edits', async () => {
    vi.doMock('../../components/HelpModal', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    const { HelpModal } = await import('../../deferredScreens');

    render(
      <Catch>
        <Suspense fallback={null}>
          <HelpModal isOpen onClose={() => {}} />
        </Suspense>
      </Catch>
    );

    expect(await screen.findByText('Failed', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it('never reloads twice within a minute', async () => {
    const { reloadForMissingChunk } = await import('../../deferredScreens');
    expect(reloadForMissingChunk()).toBe(true);
    expect(reloadForMissingChunk()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when it cannot record the reload', async () => {
    const { reloadForMissingChunk } = await import('../../deferredScreens');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(reloadForMissingChunk()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

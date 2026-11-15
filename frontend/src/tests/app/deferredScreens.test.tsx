/**
 * The studio, help dialog and command palette are separate chunks (deferredScreens.ts): a
 * screen whose chunk is still on its way suspends, one whose chunk has arrived renders at
 * once, and a failed fetch is retried.
 */
import { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('deferred screens', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock('../../components/HelpModal');
    vi.restoreAllMocks();
  });

  const renderHelp = (HelpModal: React.ComponentType<{ isOpen: boolean; onClose: () => void }>) =>
    render(
      <Suspense fallback={<p>Loading help</p>}>
        <HelpModal isOpen onClose={() => {}} />
      </Suspense>
    );

  it('shows the fallback until the chunk arrives, then the screen', async () => {
    const { HelpModal } = await import('../../deferredScreens');

    renderHelp(HelpModal);
    expect(screen.getByText('Loading help')).toBeInTheDocument();

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('Loading help')).not.toBeInTheDocument();
  });

  it('renders at once, without a fallback, when the chunks were loaded beforehand', async () => {
    const { HelpModal, loadDeferredScreens } = await import('../../deferredScreens');
    await loadDeferredScreens();

    renderHelp(HelpModal);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('Loading help')).not.toBeInTheDocument();
  });

  it('keeps one component type for a mounted screen when the chunk arrives later', async () => {
    const { HelpModal, loadDeferredScreens } = await import('../../deferredScreens');
    const view = renderHelp(HelpModal);
    const dialog = await screen.findByRole('dialog');
    await loadDeferredScreens();

    // Re-rendering must not swap the lazy wrapper for the real component (a remount)
    view.rerender(
      <Suspense fallback={<p>Loading help</p>}>
        <HelpModal isOpen onClose={() => {}} />
      </Suspense>
    );
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('retries a chunk whose first fetch failed', async () => {
    let attempts = 0;
    vi.doMock('../../components/HelpModal', () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Failed to fetch dynamically imported module');
      return { HelpModal: () => <p>Help after retry</p> };
    });
    const { HelpModal } = await import('../../deferredScreens');

    renderHelp(HelpModal);

    expect(await screen.findByText('Help after retry', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });
});

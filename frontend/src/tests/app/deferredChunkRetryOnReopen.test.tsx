/**
 * A dialog whose chunk failed to load (the connection dropped) is not dead until the page
 * reloads: opening it again fetches the chunk again.
 */
import { Suspense, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErrorBoundary } from '../../components/ErrorBoundary';

describe('a deferred dialog whose chunk failed once', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.doUnmock('../../components/HelpModal');
    vi.restoreAllMocks();
  });

  it('loads when it is opened again after the connection is back', async () => {
    let attempts = 0;
    vi.doMock('../../components/HelpModal', () => {
      attempts += 1;
      throw new Error('Failed to fetch dynamically imported module');
    });
    const { HelpModal } = await import('../../deferredScreens');

    function Harness() {
      const [opened, setOpened] = useState(1);
      return (
        <>
          <button onClick={() => setOpened((n) => n + 1)}>open help again</button>
          <ErrorBoundary fallback={() => <p>Help failed</p>} resetKey={opened}>
            <Suspense fallback={null}>
              <HelpModal isOpen onClose={() => undefined} />
            </Suspense>
          </ErrorBoundary>
        </>
      );
    }
    render(<Harness />);
    // The first try and its one retry both fail
    await waitFor(() => expect(screen.getByText('Help failed')).toBeInTheDocument(), {
      timeout: 4000,
    });
    expect(attempts).toBe(2);

    vi.doMock('../../components/HelpModal', () => ({
      HelpModal: () => <p>Help content</p>,
    }));
    // A moment later, as a person reopening the dialog would be
    await new Promise((resolve) => setTimeout(resolve, 1100));
    fireEvent.click(screen.getByText('open help again'));

    expect(await screen.findByText('Help content')).toBeInTheDocument();
  });
});

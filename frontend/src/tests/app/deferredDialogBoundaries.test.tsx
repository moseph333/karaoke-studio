/**
 * The help dialog and the command palette open over a studio that may hold unsaved edits.
 * If their chunk cannot load (an update replaced the build), the dialog closes instead of
 * the error taking the whole studio down.
 */
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErrorBoundary } from '../../components/ErrorBoundary';

function Thrower({ fail }: { fail: boolean }) {
  if (fail) throw new Error('chunk gone');
  return <p>Dialog content</p>;
}

describe('dialog error boundaries', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.doUnmock('../../components/commandPalette/CommandPalette');
    vi.restoreAllMocks();
  });

  it('a quiet boundary shows nothing and resets when its key changes', () => {
    function Harness() {
      const [fail, setFail] = useState(true);
      const [openCount, setOpenCount] = useState(0);
      return (
        <>
          <p>Studio stays</p>
          <button onClick={() => setOpenCount((n) => n + 1)}>reopen</button>
          <button onClick={() => setFail(false)}>fix</button>
          <ErrorBoundary fallback={() => null} resetKey={openCount}>
            <Thrower fail={fail} />
          </ErrorBoundary>
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByText('Studio stays')).toBeInTheDocument();
    expect(screen.queryByText('Dialog content')).not.toBeInTheDocument();
    expect(screen.queryByText(/Karaoke Studio Error/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('fix'));
    expect(screen.queryByText('Dialog content')).not.toBeInTheDocument(); // still caught
    fireEvent.click(screen.getByText('reopen'));
    expect(screen.getByText('Dialog content')).toBeInTheDocument();
  });

  it('a palette whose chunk is missing closes and leaves the studio in place', async () => {
    let attempts = 0;
    vi.doMock('../../components/commandPalette/CommandPalette', () => {
      attempts += 1;
      throw new Error('Failed to fetch dynamically imported module');
    });
    const { CommandPaletteProvider } =
      await import('../../components/commandPalette/CommandPaletteProvider');

    render(
      <ErrorBoundary>
        <CommandPaletteProvider>
          <p>Unsaved lyric edits</p>
        </CommandPaletteProvider>
      </ErrorBoundary>
    );

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    // The first fetch and its retry both fail, then React renders the rejection
    await waitFor(() => expect(attempts).toBe(2), { timeout: 3000 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByText('Unsaved lyric edits')).toBeInTheDocument();
    expect(screen.queryByText(/Karaoke Studio Error/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

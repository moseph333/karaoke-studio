/**
 * The one-time hint shown when this browser first opens a finished song.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../hooks/useToast';
import { FIRST_SONG_HINT_KEY, useFirstSongHint } from '../../hooks/useFirstSongHint';

function Studio({ open, onShowGuide }: { open: boolean; onShowGuide: () => void }) {
  useFirstSongHint(open, onShowGuide);
  return null;
}

const renderStudio = (open: boolean, onShowGuide = vi.fn()) =>
  render(
    <ToastProvider>
      <Studio open={open} onShowGuide={onShowGuide} />
    </ToastProvider>
  );

describe('useFirstSongHint', () => {
  it('says nothing until a finished song is open', () => {
    renderStudio(false);
    expect(screen.queryByText(/Your song is ready/)).not.toBeInTheDocument();
    expect(localStorage.getItem(FIRST_SONG_HINT_KEY)).toBeNull();
  });

  it('tells a first-time visitor what to do, and offers the shortcut guide', async () => {
    const user = userEvent.setup();
    const onShowGuide = vi.fn();
    renderStudio(true, onShowGuide);

    expect(screen.getByText(/Your song is ready\. Press play \(or Space\)/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show shortcuts' }));
    expect(onShowGuide).toHaveBeenCalledTimes(1);
  });

  it('is shown once per browser', () => {
    const first = renderStudio(true);
    expect(screen.getByText(/Your song is ready/)).toBeInTheDocument();
    first.unmount();

    renderStudio(true);
    expect(screen.queryByText(/Your song is ready/)).not.toBeInTheDocument();
  });

  it('is skipped, not repeated, where storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    renderStudio(true);
    expect(screen.queryByText(/Your song is ready/)).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });
});

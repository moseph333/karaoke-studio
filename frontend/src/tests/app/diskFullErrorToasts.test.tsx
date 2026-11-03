/**
 * Routes that start new work answer 507 with an actionable detail when the server's disk is
 * almost full, and a backing-track upload whose save fails answers 507 too. Adding a song and
 * both studio uploads show that detail instead of a generic failure, and keep their own
 * message when the server sends none.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { AudioControls } from '../../components/AudioControls';
import { THEMES, VisualThemePicker } from '../../components/VisualThemePicker';
import { useTrackIntake } from '../../hooks/useTrackIntake';
import { ToastProvider } from '../../hooks/useToast';

const LOW_DISK =
  'The server is almost out of disk space (100 MB free, 1024 MB required). Delete songs you no longer need, then try again.';
const SAVE_FAILED =
  'The server could not write this change to its disk, which may be full, so it was not saved. Free up space (delete songs you no longer need), then try again.';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);

function answer(status: number, body?: unknown) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(body === undefined ? 'Insufficient Storage' : JSON.stringify(body), { status })
    );
}

function renderBackgroundPicker() {
  const onCustomBgUploaded = vi.fn();
  const { container } = render(
    <ToastProvider>
      <VisualThemePicker
        selectedTheme={THEMES[0]}
        onSelectTheme={vi.fn()}
        aspectRatio="16:9"
        onChangeAspectRatio={vi.fn()}
        onCustomBgUploaded={onCustomBgUploaded}
      />
    </ToastProvider>
  );
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(['png'], 'bg.png', { type: 'image/png' })] },
  });
  return onCustomBgUploaded;
}

function renderInstrumentalUpload() {
  const onUploaded = vi.fn();
  const { container } = render(
    <ToastProvider>
      <AudioControls
        projectId="full_song"
        onMixChange={vi.fn()}
        onCustomInstrumentalUploaded={onUploaded}
      />
    </ToastProvider>
  );
  const input = container.querySelector('input[type="file"][accept*="audio"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(['RIFF'], 'backing.wav', { type: 'audio/wav' })] },
  });
  return onUploaded;
}

describe('Disk-full answers reach the user', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adding a YouTube song on a low disk shows why it was refused', async () => {
    const fetchSpy = answer(507, { detail: LOW_DISK });
    const setProject = vi.fn();
    const { result } = renderHook(() => useTrackIntake({ currentUser: 'Ana', setProject }), {
      wrapper,
    });

    await act(() => result.current.handleSelectTrack('dQw4w9WgXcQ'));

    expect(fetchSpy).toHaveBeenCalledWith('/api/process', expect.anything());
    expect(await screen.findByText(LOW_DISK)).toBeInTheDocument();
    expect(setProject).not.toHaveBeenCalled();
  });

  it('adding a song keeps its own message when the server gives no detail', async () => {
    answer(507);
    const setProject = vi.fn();
    const { result } = renderHook(() => useTrackIntake({ currentUser: 'Ana', setProject }), {
      wrapper,
    });

    await act(() => result.current.handleSelectTrack('dQw4w9WgXcQ'));

    expect(await screen.findByText('Failed to initiate processing')).toBeInTheDocument();
  });

  it('a background upload on a low disk shows why it was refused', async () => {
    answer(507, { detail: LOW_DISK });

    const onCustomBgUploaded = renderBackgroundPicker();

    expect(await screen.findByText(LOW_DISK)).toBeInTheDocument();
    expect(onCustomBgUploaded).not.toHaveBeenCalled();
    expect(screen.queryByText(/Could not upload custom background file/)).not.toBeInTheDocument();
  });

  it('a background upload keeps its own message when the server gives no detail', async () => {
    answer(507);

    renderBackgroundPicker();

    expect(await screen.findByText('Could not upload custom background file.')).toBeInTheDocument();
  });

  it('a background upload that cannot reach the server keeps its own message', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderBackgroundPicker();

    expect(await screen.findByText('Could not upload custom background file.')).toBeInTheDocument();
  });

  it.each([
    ['refused on a low disk', LOW_DISK],
    ['whose save fails on a full disk', SAVE_FAILED],
  ])('a backing-track upload %s shows the server detail', async (_case, detail) => {
    answer(507, { detail });

    const onUploaded = renderInstrumentalUpload();

    expect(await screen.findByText(detail)).toBeInTheDocument();
    expect(onUploaded).not.toHaveBeenCalled();
    expect(screen.queryByText(/Could not upload instrumental file/)).not.toBeInTheDocument();
  });

  it('a backing-track upload keeps its own message when the server gives no detail', async () => {
    answer(507);

    renderInstrumentalUpload();

    await waitFor(() =>
      expect(screen.getByText('Could not upload instrumental file.')).toBeInTheDocument()
    );
  });
});

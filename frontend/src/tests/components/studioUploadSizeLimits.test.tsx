import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import uploadLimits from '@shared/upload_limits.json';
import * as apiModule from '../../api';
import { AudioControls } from '../../components/AudioControls';
import { VisualThemePicker } from '../../components/VisualThemePicker';
import { STAGE_LOOKS } from '../../theme/stageLooks';
import { ToastProvider } from '../../hooks/useToast';
import { backgroundTooLarge, instrumentalTooLarge } from '../../utils/uploadLimits';

const MB = 1024 * 1024;

/** A file that reports `bytes` as its size without holding that much data. */
function fileOfSize(name: string, type: string, bytes: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

describe('upload size limits shared with the server', () => {
  it('allows a file of exactly the limit and refuses one byte more', () => {
    const inst = uploadLimits.instrumental_mb * MB;
    expect(instrumentalTooLarge(fileOfSize('a.wav', 'audio/wav', inst))).toBeNull();
    expect(instrumentalTooLarge(fileOfSize('a.wav', 'audio/wav', inst + 1))).toBe(
      `Instrumental file exceeds ${uploadLimits.instrumental_mb}MB limit. Please choose a smaller file.`
    );
  });

  it('holds a background image to the image limit and a video to the video limit', () => {
    const image = uploadLimits.background_image_mb * MB;
    const video = uploadLimits.background_video_mb * MB;
    expect(backgroundTooLarge(fileOfSize('a.png', 'image/png', image))).toBeNull();
    expect(backgroundTooLarge(fileOfSize('a.png', 'image/png', image + 1))).toMatch(
      `Background image exceeds ${uploadLimits.background_image_mb}MB`
    );
    // Told apart by extension when the browser gives no type
    expect(backgroundTooLarge(fileOfSize('a.webm', '', video))).toBeNull();
    expect(backgroundTooLarge(fileOfSize('a.mp4', 'video/mp4', video + 1))).toMatch(
      `Background video exceeds ${uploadLimits.background_video_mb}MB`
    );
  });
});

describe('oversized files in the studio', () => {
  const spyOnApiFetch = () =>
    vi
      .spyOn(apiModule, 'apiFetch')
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
  let apiFetchSpy: ReturnType<typeof spyOnApiFetch>;

  beforeEach(() => {
    apiFetchSpy = spyOnApiFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses an oversized instrumental without sending it', async () => {
    render(
      <ToastProvider>
        <AudioControls projectId="p1" onMixChange={vi.fn()} />
      </ToastProvider>
    );
    const input = screen.getByLabelText('Upload custom instrumental audio file');

    fireEvent.change(input, {
      target: {
        files: [fileOfSize('big.wav', 'audio/wav', uploadLimits.instrumental_mb * MB + 1)],
      },
    });

    expect(await screen.findByText(/Instrumental file exceeds/)).toBeInTheDocument();
    expect(apiFetchSpy).not.toHaveBeenCalledWith('/api/upload-instrumental', expect.anything());
  });

  it('refuses an oversized background image without sending it', async () => {
    render(
      <ToastProvider>
        <VisualThemePicker
          selectedTheme={STAGE_LOOKS[0]}
          onSelectTheme={vi.fn()}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
        />
      </ToastProvider>
    );
    const input = screen.getByLabelText('Upload custom stage background image or video');

    fireEvent.change(input, {
      target: {
        files: [fileOfSize('big.png', 'image/png', uploadLimits.background_image_mb * MB + 1)],
      },
    });

    expect(await screen.findByText(/Background image exceeds/)).toBeInTheDocument();
    expect(apiFetchSpy).not.toHaveBeenCalledWith('/api/upload-background', expect.anything());
  });

  it('still sends a video that is over the image limit but under the video one', async () => {
    render(
      <ToastProvider>
        <VisualThemePicker
          selectedTheme={STAGE_LOOKS[0]}
          onSelectTheme={vi.fn()}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
        />
      </ToastProvider>
    );
    const input = screen.getByLabelText('Upload custom stage background image or video');

    fireEvent.change(input, {
      target: {
        files: [fileOfSize('clip.mp4', 'video/mp4', uploadLimits.background_image_mb * MB + 1)],
      },
    });

    await waitFor(() =>
      expect(apiFetchSpy).toHaveBeenCalledWith(
        '/api/upload-background',
        expect.objectContaining({ method: 'POST' })
      )
    );
  });
});

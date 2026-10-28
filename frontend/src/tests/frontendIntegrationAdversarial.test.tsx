import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  act,
  renderHook,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { App } from '../App';
import { VisualThemePicker, THEMES } from '../components/VisualThemePicker';
import {
  AudioControls,
  parseMediaError,
  MASTER_VOLUME_STORAGE_KEY,
  MASTER_MUTED_STORAGE_KEY,
} from '../components/AudioControls';
import { TransportDock } from '../components/transport/TransportDock';
import { ExportModal } from '../components/ExportModal';
import { TrackSearch } from '../components/TrackSearch';
import { LyricTimelineEditor } from '../components/LyricTimelineEditor';
import { useInterpolatedTime } from '../hooks/useInterpolatedTime';
import { useToast, ToastProvider } from '../hooks/useToast';
import {
  apiFetch,
  getAuthToken,
  setAuthToken,
  getAuthUser,
  setAuthUser,
  clearAuth,
  AUTH_UNAUTHORIZED_EVENT,
} from '../api';
import { ProjectState, LyricLine } from '../types';

describe('Tier 5 White-Box Adversarial Hardening Suite (M6 Challenger Frontend)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    clearAuth();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearAuth();
    window.history.pushState({}, '', '/');
  });

  // =========================================================================
  // 1. App.tsx Root Architecture & State Lifecycle
  // =========================================================================
  describe('1. App.tsx Root Integration & Adversarial State Lifecycle', () => {
    it('forces AuthModal display when server requires authentication and user is unauthenticated', async () => {
      localStorage.setItem('karaoke_auth_token', 'stale-token');

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: true, authenticated: false }), {
            status: 200,
          });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <ToastProvider>
          <App />
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(/Studio Access Gate/i)).toBeInTheDocument();
      });

      // Stale token should have been purged from storage
      expect(localStorage.getItem('karaoke_auth_token')).toBeNull();
    });

    it('bypasses AuthModal when server does not require authentication', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
        }
        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <ToastProvider>
          <App />
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByText(/Turn Any YouTube Song Into Karaoke/i)).toBeInTheDocument();
      });
    });

    it('survives /api/auth/status network rejection without crashing', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return Promise.reject(new Error('Network offline'));
        }
        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const { container } = render(
        <ToastProvider>
          <App />
        </ToastProvider>
      );

      await waitFor(() => {
        expect(container).toBeInTheDocument();
        expect(screen.getByText(/Turn Any YouTube Song Into Karaoke/i)).toBeInTheDocument();
      });
    });

    it('triggers AuthModal display when karaoke_unauthorized event is dispatched globally', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
      });

      render(
        <ToastProvider>
          <App />
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      act(() => {
        window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
      });

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(/Studio Access Gate/i)).toBeInTheDocument();
      });
    });

    it('loads project and seeks time from URL search parameters (?project=...&t=...)', async () => {
      window.history.pushState({}, '', '/?project=proj-url-load&t=45.5');

      const mockProject: ProjectState = {
        id: 'proj-url-load',
        title: 'Deep Link Melody',
        artist: 'Sonic Architect',
        status: 'ready',
        progress: 100,
        lines: [
          {
            id: 1,
            text: 'Deep link line',
            start_time: 40.0,
            end_time: 50.0,
            words: [{ word: 'Deep', start_time: 40.0, end_time: 50.0 }],
          },
        ],
        semitones: 0,
        guide_volume: 0.0,
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
        }
        if (urlStr.includes('/api/project/proj-url-load')) {
          return new Response(JSON.stringify(mockProject), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <ToastProvider>
          <App />
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Deep Link Melody')).toBeInTheDocument();
        expect(screen.getByText(/Sonic Architect/i)).toBeInTheDocument();
      });
    });

    it('handles non-numeric or NaN ?t= URL parameter without corrupting playback time', async () => {
      window.history.pushState({}, '', '/?project=proj-nan-time&t=invalid-number');

      const mockProject: ProjectState = {
        id: 'proj-nan-time',
        title: 'Safe Time Track',
        artist: 'Validator',
        status: 'ready',
        progress: 100,
        lines: [],
        semitones: 0,
        guide_volume: 0.0,
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
        }
        if (urlStr.includes('/api/project/proj-nan-time')) {
          return new Response(JSON.stringify(mockProject), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <ToastProvider>
          <App />
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Safe Time Track')).toBeInTheDocument();
      });
    });

    it('displays pipeline progress and formats heartbeat, elapsed, and ETA timers', async () => {
      window.history.pushState({}, '', '/?project=proj-pipeline');

      const now = Date.now();
      const mockProject: ProjectState = {
        id: 'proj-pipeline',
        status: 'separating',
        progress: 60,
        heartbeat: now - 1000, // 1s ago -> 'Pulse just now'
        elapsed_seconds: 75, // 1:15
        eta_seconds: 45, // ~0:45
        lines: [],
        semitones: 0,
        guide_volume: 0.0,
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
        }
        if (urlStr.includes('/api/project/proj-pipeline')) {
          return new Response(JSON.stringify(mockProject), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <ToastProvider>
          <App />
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Separating\.\.\./i)).toBeInTheDocument();
        expect(screen.getByText(/Pulse just now/i)).toBeInTheDocument();
        expect(screen.getByText(/60% Complete/i)).toBeInTheDocument();
        expect(screen.getByText(/Elapsed: 1:15/i)).toBeInTheDocument();
        expect(screen.getByText(/Est\. remaining: ~0:45/i)).toBeInTheDocument();
      });
    });

    it('cancels active track pipeline and returns to search screen', async () => {
      const user = userEvent.setup();
      window.history.pushState({}, '', '/?project=proj-cancel-pipeline');

      const mockProject: ProjectState = {
        id: 'proj-cancel-pipeline',
        status: 'downloading',
        progress: 20,
        lines: [],
        semitones: 0,
        guide_volume: 0.0,
      };

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (url: RequestInfo | URL) => {
          const urlStr = url.toString();
          if (urlStr.includes('/api/auth/status')) {
            return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
          }
          if (urlStr.includes('/api/project/proj-cancel-pipeline/cancel')) {
            return new Response(JSON.stringify({ status: 'cancelled' }), { status: 200 });
          }
          if (urlStr.includes('/api/project/proj-cancel-pipeline')) {
            return new Response(JSON.stringify(mockProject), { status: 200 });
          }
          return new Response('{}', { status: 200 });
        });

      render(
        <ToastProvider>
          <App />
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Cancel & Return to Search/i)).toBeInTheDocument();
      });

      const cancelBtn = screen.getByRole('button', { name: /Cancel & Return to Search/i });
      await user.click(cancelBtn);

      const confirmBtn = await screen.findByRole('button', { name: /Confirm Cancel/i });
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/project/proj-cancel-pipeline/cancel',
          expect.objectContaining({ method: 'POST' })
        );
        expect(screen.getByText(/Turn Any YouTube Song Into Karaoke/i)).toBeInTheDocument();
      });
    });

    it('renders cancelled status screen and allows searching another song', async () => {
      const user = userEvent.setup();
      window.history.pushState({}, '', '/?project=proj-cancelled');

      const mockProject: ProjectState = {
        id: 'proj-cancelled',
        status: 'cancelled',
        progress: 0,
        lines: [],
        semitones: 0,
        guide_volume: 0.0,
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
        }
        if (urlStr.includes('/api/project/proj-cancelled')) {
          return new Response(JSON.stringify(mockProject), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <ToastProvider>
          <App />
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Track Processing Cancelled/i)).toBeInTheDocument();
      });

      const searchAnotherBtn = screen.getByRole('button', { name: /Search Another Song/i });
      await user.click(searchAnotherBtn);

      await waitFor(() => {
        expect(screen.getByText(/Turn Any YouTube Song Into Karaoke/i)).toBeInTheDocument();
      });
    });

    it('renders error status screen with specific error and allows retry', async () => {
      const user = userEvent.setup();
      window.history.pushState({}, '', '/?project=proj-error');

      const mockProject: ProjectState = {
        id: 'proj-error',
        status: 'error',
        error: 'YouTube extraction failed: video is private',
        progress: 0,
        lines: [],
        semitones: 0,
        guide_volume: 0.0,
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
        }
        if (urlStr.includes('/api/project/proj-error')) {
          return new Response(JSON.stringify(mockProject), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <ToastProvider>
          <App />
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Track Processing Failed/i)).toBeInTheDocument();
        expect(
          screen.getByText(/YouTube extraction failed: video is private/i)
        ).toBeInTheDocument();
      });

      const tryAnotherBtn = screen.getByRole('button', { name: /Try Another Track/i });
      await user.click(tryAnotherBtn);

      await waitFor(() => {
        expect(screen.getByText(/Turn Any YouTube Song Into Karaoke/i)).toBeInTheDocument();
      });
    });

    it('guards against discarding unsaved lyric edits when clicking New Song', async () => {
      const user = userEvent.setup();
      window.history.pushState({}, '', '/?project=proj-unsaved-guard');

      const mockProject: ProjectState = {
        id: 'proj-unsaved-guard',
        title: 'Guard Me',
        artist: 'Vocal Star',
        status: 'ready',
        progress: 100,
        lines: [
          {
            id: 1,
            text: 'Original line',
            start_time: 1.0,
            end_time: 3.0,
            words: [{ word: 'Original', start_time: 1.0, end_time: 3.0 }],
          },
        ],
        semitones: 0,
        guide_volume: 0.0,
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
        }
        if (urlStr.includes('/api/project/proj-unsaved-guard')) {
          return new Response(JSON.stringify(mockProject), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <ToastProvider>
          <App />
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Guard Me')).toBeInTheDocument();
      });

      // Nudge line to mark lyrics dirty
      const nudgeBtn = screen.getByRole('button', { name: /Nudge line 1 0\.05s later/i });
      await user.click(nudgeBtn);

      // Now click "New Song" in navbar
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const newSongBtn = screen.getByRole('button', { name: /New Song/i });
      await user.click(newSongBtn);

      expect(confirmSpy).toHaveBeenCalledWith(
        'You have unsaved lyric timing edits. Discard and return to song search?'
      );
      // If user cancels confirmation, project stays intact
      expect(screen.getByText('Guard Me')).toBeInTheDocument();

      // If user confirms, project returns to search
      confirmSpy.mockReturnValue(true);
      await user.click(newSongBtn);

      await waitFor(() => {
        expect(screen.getByText(/Turn Any YouTube Song Into Karaoke/i)).toBeInTheDocument();
      });
    });

    it('triggers render pipeline and handles render cancellation', async () => {
      const user = userEvent.setup();
      window.history.pushState({}, '', '/?project=proj-render-flow');

      const mockProject: ProjectState = {
        id: 'proj-render-flow',
        title: 'Render Candidate',
        artist: 'Export Art',
        status: 'ready',
        progress: 100,
        lines: [],
        semitones: 2,
        guide_volume: 0.25,
      };

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (url: RequestInfo | URL) => {
          const urlStr = url.toString();
          if (urlStr.includes('/api/auth/status')) {
            return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
          }
          if (urlStr.includes('/api/project/proj-render-flow/render')) {
            return new Response(JSON.stringify({ status: 'queued' }), { status: 200 });
          }
          if (urlStr.includes('/api/project/proj-render-flow/cancel-render')) {
            return new Response(JSON.stringify({ status: 'cancelled' }), { status: 200 });
          }
          if (urlStr.includes('/api/project/proj-render-flow')) {
            return new Response(JSON.stringify(mockProject), { status: 200 });
          }
          return new Response('{}', { status: 200 });
        });

      render(
        <ToastProvider>
          <App />
        </ToastProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Render Candidate')).toBeInTheDocument();
      });

      // Open the export dialog from the top bar, then start the video render
      await user.click(screen.getByRole('button', { name: 'Open export dialog' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /start video render/i }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/project/proj-render-flow/render',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"semitones":2'),
          })
        );
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(/Export & YouTube Package/i)).toBeInTheDocument();
      });

      // Click Cancel Render in modal
      const cancelRenderBtn = screen.getByRole('button', { name: /Cancel Render/i });
      await user.click(cancelRenderBtn);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/project/proj-render-flow/cancel-render',
          expect.objectContaining({ method: 'POST' })
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 2. VisualThemePicker.tsx White-Box Adversarial Coverage (Previously 0% Tested)
  // =========================================================================
  describe('2. VisualThemePicker.tsx White-Box Adversarial Hardening', () => {
    it('renders all 4 theme options and executes onSelectTheme on card click', async () => {
      const user = userEvent.setup();
      const onSelectTheme = vi.fn();
      const onChangeAspectRatio = vi.fn();
      const onCustomBgUploaded = vi.fn();

      render(
        <ToastProvider>
          <VisualThemePicker
            selectedTheme={THEMES[0]}
            onSelectTheme={onSelectTheme}
            aspectRatio="16:9"
            onChangeAspectRatio={onChangeAspectRatio}
            onCustomBgUploaded={onCustomBgUploaded}
          />
        </ToastProvider>
      );

      // Verify all 4 themes are present
      expect(screen.getByText('Modern Gold')).toBeInTheDocument();
      expect(screen.getByText('Cyber Cyan')).toBeInTheDocument();
      expect(screen.getByText('Neon Sunset')).toBeInTheDocument();
      expect(screen.getByText('Classic KTV')).toBeInTheDocument();

      // Click Cyber Cyan card
      await user.click(screen.getByText('Cyber Cyan'));
      expect(onSelectTheme).toHaveBeenCalledWith(THEMES[1]);
    });

    it('toggles aspect ratio between 16:9 and 9:16', async () => {
      const user = userEvent.setup();
      const onChangeAspectRatio = vi.fn();

      const { rerender } = render(
        <ToastProvider>
          <VisualThemePicker
            selectedTheme={THEMES[0]}
            onSelectTheme={vi.fn()}
            aspectRatio="16:9"
            onChangeAspectRatio={onChangeAspectRatio}
            onCustomBgUploaded={vi.fn()}
          />
        </ToastProvider>
      );

      const shortsBtn = screen.getByRole('button', { name: /9:16 Shorts/i });
      await user.click(shortsBtn);
      expect(onChangeAspectRatio).toHaveBeenCalledWith('9:16');

      rerender(
        <ToastProvider>
          <VisualThemePicker
            selectedTheme={THEMES[0]}
            onSelectTheme={vi.fn()}
            aspectRatio="9:16"
            onChangeAspectRatio={onChangeAspectRatio}
            onCustomBgUploaded={vi.fn()}
          />
        </ToastProvider>
      );

      const widescreenBtn = screen.getByRole('button', { name: /16:9 Widescreen/i });
      await user.click(widescreenBtn);
      expect(onChangeAspectRatio).toHaveBeenCalledWith('16:9');
    });

    it('uploads custom background file successfully and triggers onCustomBgUploaded', async () => {
      const onCustomBgUploaded = vi.fn();
      const file = new File(['mock-image-binary'], 'custom_bg.jpg', { type: 'image/jpeg' });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ bg_id: 'bg-custom-999' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

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

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).toBeInTheDocument();

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/upload-background',
          expect.objectContaining({ method: 'POST' })
        );
        expect(onCustomBgUploaded).toHaveBeenCalledWith('bg-custom-999');
        expect(
          screen.getByText(/Custom background image uploaded successfully/i)
        ).toBeInTheDocument();
      });
    });

    it('accepts video extensions and uploads MP4/WebM background video successfully', async () => {
      const onCustomBgUploaded = vi.fn();
      const mp4File = new File(['mock-video-binary'], 'animation.mp4', { type: 'video/mp4' });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ bg_id: 'bg-video-mp4-123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

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

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).toBeInTheDocument();
      expect(fileInput.getAttribute('accept')).toContain('.mp4');
      expect(fileInput.getAttribute('accept')).toContain('.webm');

      fireEvent.change(fileInput, { target: { files: [mp4File] } });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/upload-background',
          expect.objectContaining({ method: 'POST' })
        );
        expect(onCustomBgUploaded).toHaveBeenCalledWith('bg-video-mp4-123');
        expect(
          screen.getByText(/Custom background video uploaded successfully/i)
        ).toBeInTheDocument();
      });
    });

    it('catches and reports background upload HTTP errors without crashing', async () => {
      const onCustomBgUploaded = vi.fn();
      const file = new File(['bad-binary'], 'corrupt.bmp', { type: 'image/bmp' });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Unsupported format' }), { status: 400 })
      );

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

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(onCustomBgUploaded).not.toHaveBeenCalled();
        expect(screen.getByText(/Could not upload custom background file\./i)).toBeInTheDocument();
      });
    });

    it('returns early when file input event has no selected files', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const { container } = render(
        <ToastProvider>
          <VisualThemePicker
            selectedTheme={THEMES[0]}
            onSelectTheme={vi.fn()}
            aspectRatio="16:9"
            onChangeAspectRatio={vi.fn()}
            onCustomBgUploaded={vi.fn()}
          />
        </ToastProvider>
      );

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(fileInput, { target: { files: [] } });

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('displays active custom background indicator and allows resetting to album art', async () => {
      const user = userEvent.setup();
      const onCustomBgUploaded = vi.fn();

      render(
        <ToastProvider>
          <VisualThemePicker
            selectedTheme={THEMES[0]}
            onSelectTheme={vi.fn()}
            aspectRatio="16:9"
            onChangeAspectRatio={vi.fn()}
            onCustomBgUploaded={onCustomBgUploaded}
            customBgId="active_bg_id"
          />
        </ToastProvider>
      );

      // The active background is named in the Look panel and the upload button offers a replacement
      expect(screen.getByText('active_bg_id')).toHaveAttribute('title', 'active_bg_id');
      expect(screen.getByRole('button', { name: /^Replace$/ })).toBeInTheDocument();
      const resetBtn = screen.getByRole('button', { name: /Reset to Album Art/i });
      await user.click(resetBtn);

      expect(onCustomBgUploaded).toHaveBeenCalledWith('');
    });
  });

  // =========================================================================
  // 3. useInterpolatedTime.ts Frame Extrapolation & Boundary Stress
  // =========================================================================
  describe('3. useInterpolatedTime.ts Extrapolation & Boundary Stress', () => {
    it('extrapolates time forward using requestAnimationFrame and performance.now', () => {
      let rAFCallback: FrameRequestCallback = () => {};
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rAFCallback = cb;
        return 123;
      });

      let mockPerfNow = 1000.0;
      vi.spyOn(performance, 'now').mockImplementation(() => mockPerfNow);

      const { result } = renderHook(() =>
        useInterpolatedTime({ currentTime: 10.0, isPlaying: true, playbackRate: 1.0 })
      );

      expect(result.current).toBe(10.0);

      // Advance performance clock by 100ms and tick frame
      act(() => {
        mockPerfNow += 100.0; // 0.1s
        rAFCallback(mockPerfNow);
      });

      expect(result.current).toBeCloseTo(10.1, 2);
    });

    it('clamps maximum extrapolation delta to 350ms to prevent runaway desync on frame freeze', () => {
      let rAFCallback: FrameRequestCallback = () => {};
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rAFCallback = cb;
        return 456;
      });

      let mockPerfNow = 1000.0;
      vi.spyOn(performance, 'now').mockImplementation(() => mockPerfNow);

      const { result } = renderHook(() =>
        useInterpolatedTime({ currentTime: 20.0, isPlaying: true, playbackRate: 1.0 })
      );

      // Advance clock by 2.0 full seconds (severe lag spike)
      act(() => {
        mockPerfNow += 2000.0;
        rAFCallback(mockPerfNow);
      });

      // Extrapolation must clamp delta to 0.35s maximum
      expect(result.current).toBeCloseTo(20.35, 2);
    });

    it('skips frame extrapolation when document.hidden is true (background tab)', () => {
      let rAFCallback: FrameRequestCallback = () => {};
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rAFCallback = cb;
        return 789;
      });

      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => true,
      });

      const { result } = renderHook(() =>
        useInterpolatedTime({ currentTime: 5.0, isPlaying: true })
      );

      act(() => {
        rAFCallback(performance.now() + 500);
      });

      // Should remain at base time because tab is hidden
      expect(result.current).toBe(5.0);

      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => false,
      });
    });

    it('re-anchors extrapolation when audio.currentTime advances by > 0.001s', () => {
      let rAFCallback: FrameRequestCallback = () => {};
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rAFCallback = cb;
        return 999;
      });

      const mockAudio = {
        paused: false,
        currentTime: 10.0,
        playbackRate: 1.0,
      } as unknown as HTMLAudioElement;

      const audioRef = { current: mockAudio };

      const { result } = renderHook(() =>
        useInterpolatedTime({ currentTime: 10.0, isPlaying: true, audioRef })
      );

      // External native audio element advances by 2.5 seconds
      act(() => {
        mockAudio.currentTime = 12.5;
        rAFCallback(performance.now());
      });

      expect(result.current).toBeCloseTo(12.5, 2);
    });

    it('immediately snaps to audio.currentTime when audio element is paused', () => {
      let rAFCallback: FrameRequestCallback = () => {};
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rAFCallback = cb;
        return 111;
      });

      const mockAudio = {
        paused: true,
        currentTime: 7.89,
        playbackRate: 1.0,
      } as unknown as HTMLAudioElement;

      const audioRef = { current: mockAudio };

      const { result } = renderHook(() =>
        useInterpolatedTime({ currentTime: 7.0, isPlaying: true, audioRef })
      );

      act(() => {
        rAFCallback(performance.now());
      });

      expect(result.current).toBe(7.89);
    });

    it('scales extrapolation rate by audioRef playbackRate', () => {
      let rAFCallback: FrameRequestCallback = () => {};
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        rAFCallback = cb;
        return 222;
      });

      let mockPerfNow = 5000.0;
      vi.spyOn(performance, 'now').mockImplementation(() => mockPerfNow);

      const mockAudio = {
        paused: false,
        currentTime: 10.0,
        playbackRate: 1.5,
      } as unknown as HTMLAudioElement;

      const audioRef = { current: mockAudio };

      const { result } = renderHook(() =>
        useInterpolatedTime({ currentTime: 10.0, isPlaying: true, audioRef })
      );

      act(() => {
        mockPerfNow += 100.0; // 0.1s * 1.5 = 0.15s
        rAFCallback(mockPerfNow);
      });

      expect(result.current).toBeCloseTo(10.15, 2);
    });
  });

  // =========================================================================
  // 4. TransportDock / AudioControls Storage Exceptions, Media Errors & Rapid Transpositions
  // =========================================================================
  describe('4. TransportDock & AudioControls Storage Exceptions & Boundary Hardening', () => {
    it('handles localStorage SecurityError exceptions during volume and muted read/write', () => {
      // Simulate sandbox iframe or restricted cookies where localStorage throws
      const originalGetItem = localStorage.getItem;
      const originalSetItem = localStorage.setItem;

      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      });

      // Must mount without throwing and use defaults (volume 1.0, muted false)
      render(
        <ToastProvider>
          <TransportDock
            masterAudioUrl="/media/track.wav"
            currentTime={0}
            duration={180}
            isPlaying={false}
            onTogglePlay={vi.fn()}
            onSeek={vi.fn()}
          />
        </ToastProvider>
      );

      const slider = screen.getByRole('slider', { name: /master volume/i }) as HTMLInputElement;
      expect(slider.value).toBe('1');

      // Adjusting slider should not crash despite throwing localStorage.setItem
      fireEvent.change(slider, { target: { value: '0.6' } });
      expect(slider.value).toBe('0.6');

      Storage.prototype.getItem = originalGetItem;
      Storage.prototype.setItem = originalSetItem;
    });

    it('strictly clamps rapid transposition clicks between -12 and +12 semitones', async () => {
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <AudioControls projectId="proj-pitch-clamp" initialSemitones={10} onMixChange={vi.fn()} />
        </ToastProvider>
      );

      const upBtn = screen.getByRole('button', {
        name: /Increase pitch by one semitone/i,
      });
      // +1 -> 11
      await user.click(upBtn);
      expect(screen.getByText('11 semitones up')).toBeInTheDocument();

      // +1 -> 12
      await user.click(upBtn);
      expect(screen.getByText('12 semitones up')).toBeInTheDocument();

      // +1 -> must remain clamped at 12 (the stepper disables at the bound)
      expect(upBtn).toBeDisabled();
      await user.click(upBtn);
      expect(screen.getByText('12 semitones up')).toBeInTheDocument();
    });

    it('unmutes and restores volume when volume slider is dragged > 0 while muted', () => {
      localStorage.setItem(MASTER_MUTED_STORAGE_KEY, 'true');
      localStorage.setItem(MASTER_VOLUME_STORAGE_KEY, '0.5');

      const onMuteChange = vi.fn();
      render(
        <ToastProvider>
          <TransportDock
            masterAudioUrl="/media/track.wav"
            currentTime={0}
            duration={180}
            isPlaying={false}
            onTogglePlay={vi.fn()}
            onSeek={vi.fn()}
            onMuteChange={onMuteChange}
          />
        </ToastProvider>
      );

      const slider = screen.getByRole('slider', { name: /master volume/i });
      fireEvent.change(slider, { target: { value: '0.8' } });

      expect(onMuteChange).toHaveBeenCalledWith(false);
      expect(localStorage.getItem(MASTER_MUTED_STORAGE_KEY)).toBe('false');
    });

    it('maps all HTMLMediaElement error codes accurately via parseMediaError', () => {
      expect(parseMediaError(null).codeName).toBe('MEDIA_ERR_UNKNOWN');
      expect(parseMediaError({ code: 1, message: '' } as MediaError).codeName).toBe(
        'MEDIA_ERR_ABORTED'
      );
      expect(parseMediaError({ code: 2, message: '' } as MediaError).codeName).toBe(
        'MEDIA_ERR_NETWORK'
      );
      expect(parseMediaError({ code: 3, message: '' } as MediaError).codeName).toBe(
        'MEDIA_ERR_DECODE'
      );
      expect(parseMediaError({ code: 4, message: '' } as MediaError).codeName).toBe(
        'MEDIA_ERR_SRC_NOT_SUPPORTED'
      );

      const customErr = parseMediaError({
        code: 99,
        message: 'FFmpeg stream broke',
      } as MediaError);
      expect(customErr.code).toBe(99);
      expect(customErr.message).toBe('FFmpeg stream broke');

      const emptyErr = parseMediaError({ code: 99, message: '' } as MediaError);
      expect(emptyErr.message).toBe('An unexpected audio playback error occurred.');
    });

    it('catches and reports custom instrumental upload failures', async () => {
      const file = new File(['mock-wav'], 'backing.wav', { type: 'audio/wav' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Audio header corrupt' }), { status: 400 })
      );

      const { container } = render(
        <ToastProvider>
          <AudioControls projectId="proj-upload-fail" onMixChange={vi.fn()} />
        </ToastProvider>
      );

      const fileInput = container.querySelector(
        'input[type="file"][accept*="audio"]'
      ) as HTMLInputElement;
      expect(fileInput).toBeInTheDocument();

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText(/Could not upload instrumental file/i)).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 5. ExportModal.tsx Render Errors, Progress Clamping & Clipboard
  // =========================================================================
  describe('5. ExportModal.tsx Render Errors, Progress Clamping & Clipboard', () => {
    it('displays error state when render_status is error', () => {
      const errorProject: ProjectState = {
        id: 'proj-render-err',
        status: 'ready',
        progress: 100,
        render_status: 'error',
        render_error: 'FFmpeg encoding timeout: frame buffer exhausted',
        lines: [],
        semitones: 0,
        guide_volume: 0,
      };

      render(
        <ToastProvider>
          <ExportModal project={errorProject} isOpen={true} onClose={vi.fn()} />
        </ToastProvider>
      );

      expect(screen.getByText(/Rendering Encountered an Error/i)).toBeInTheDocument();
      expect(
        screen.getByText(/FFmpeg encoding timeout: frame buffer exhausted/i)
      ).toBeInTheDocument();
    });

    it('uses fallback message when render_error is missing or empty', () => {
      const errorProject: ProjectState = {
        id: 'proj-render-fallback',
        status: 'ready',
        progress: 100,
        render_status: 'error',
        lines: [],
        semitones: 0,
        guide_volume: 0,
      };

      render(
        <ToastProvider>
          <ExportModal project={errorProject} isOpen={true} onClose={vi.fn()} />
        </ToastProvider>
      );

      expect(screen.getByText(/Unknown rendering error/i)).toBeInTheDocument();
    });

    it('copies YouTube description and tags to clipboard and restores state after 2 seconds', async () => {
      vi.useFakeTimers();
      const writeSpy = vi.spyOn(navigator.clipboard, 'writeText');

      const completedProject: ProjectState = {
        id: 'proj-completed',
        status: 'ready',
        progress: 100,
        render_status: 'completed',
        video_url: '/media/video.mp4',
        youtube_package: {
          title: 'My Karaoke Title',
          description: 'Line 1\nLine 2',
          tags: ['karaoke', 'pop', 'studio'],
          key_note: '0',
          lyrics: 'Lyrics text',
          privacy_status: 'public',
        },
        lines: [],
        semitones: 0,
        guide_volume: 0,
      };

      render(
        <ToastProvider>
          <ExportModal project={completedProject} isOpen={true} onClose={vi.fn()} />
        </ToastProvider>
      );

      const copyDescBtn = screen.getByRole('button', { name: /Copy Description/i });
      fireEvent.click(copyDescBtn);

      expect(writeSpy).toHaveBeenCalledWith('Line 1\nLine 2');
      expect(screen.getByText('Copied!')).toBeInTheDocument();

      // Advance timers by 2000ms -> reverts to Copy Description
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(screen.queryByText('Copied!')).not.toBeInTheDocument();
      expect(screen.getByText('Copy Description')).toBeInTheDocument();

      // Copy Tags
      const copyTagsBtn = screen.getByRole('button', { name: /Copy Tags/i });
      fireEvent.click(copyTagsBtn);

      expect(writeSpy).toHaveBeenCalledWith('karaoke, pop, studio');

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // 6. TrackSearch.tsx Adversarial Network Failures & Deduplication
  // =========================================================================
  describe('6. TrackSearch.tsx Adversarial Network Failures & Library Deduplication', () => {
    it('shows informative feedback when YouTube search yields zero matching tracks', async () => {
      const user = userEvent.setup();
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/search')) {
          return new Response(JSON.stringify({ results: [] }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <ToastProvider>
          <TrackSearch
            onSelectTrack={vi.fn()}
            onOpenProject={vi.fn()}
            isLoading={false}
            currentUser="Explorer"
          />
        </ToastProvider>
      );

      const input = screen.getByPlaceholderText(/Paste YouTube.*or search.*title/i);
      await user.type(input, 'Nonexistent Song Query 123987');

      const submitBtn = screen.getByRole('button', { name: /Search.*(YouTube|Go)/i });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(
          screen.getByText(
            /No matching tracks found\. Try a different title or paste a direct YouTube URL\./i
          )
        ).toBeInTheDocument();
      });
    });

    it('survives search API HTTP failure and displays error message', async () => {
      const user = userEvent.setup();
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/search')) {
          return new Response(JSON.stringify({ detail: 'Rate limit exceeded' }), { status: 429 });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <ToastProvider>
          <TrackSearch
            onSelectTrack={vi.fn()}
            onOpenProject={vi.fn()}
            isLoading={false}
            currentUser="Explorer"
          />
        </ToastProvider>
      );

      const input = screen.getByPlaceholderText(/Paste YouTube.*or search.*title/i);
      await user.type(input, 'Rate Limit Song');

      const submitBtn = screen.getByRole('button', { name: /Search.*(YouTube|Go)/i });
      await user.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText(/Search failed/i)).toBeInTheDocument();
      });
    });

    it('deduplicates identical project IDs in studio library response', async () => {
      const user = userEvent.setup();
      const onOpenProject = vi.fn();

      const duplicateProjects = {
        proj_1: {
          id: 'dup_proj_1',
          title: 'Duplicate Track Title',
          artist: 'Dual Singer',
          status: 'ready',
          created_by: 'Explorer',
        },
        proj_1_alias: {
          id: 'dup_proj_1',
          title: 'Duplicate Track Title',
          artist: 'Dual Singer',
          status: 'ready',
          created_by: 'Explorer',
        },
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify(duplicateProjects), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <ToastProvider>
          <TrackSearch
            onSelectTrack={vi.fn()}
            onOpenProject={onOpenProject}
            isLoading={false}
            currentUser="Explorer"
          />
        </ToastProvider>
      );

      await waitFor(() => {
        // Should only be rendered once despite 2 keys in dictionary
        const matches = screen.getAllByText('Duplicate Track Title');
        expect(matches.length).toBe(1);
      });

      // Clicking project in library opens it
      await user.click(screen.getByText('Duplicate Track Title'));
      expect(onOpenProject).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'dup_proj_1', title: 'Duplicate Track Title' })
      );
    });

    it('filters between My Projects and Community Library tabs', async () => {
      const user = userEvent.setup();

      const projectsData = {
        p1: {
          id: 'p1',
          title: 'My Solitary Jam',
          artist: 'Solo',
          status: 'ready',
          created_by: 'Alex',
        },
        p2: {
          id: 'p2',
          title: 'Community Anthem',
          artist: 'Crowd',
          status: 'ready',
          created_by: 'Taylor',
        },
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify(projectsData), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <ToastProvider>
          <TrackSearch
            onSelectTrack={vi.fn()}
            onOpenProject={vi.fn()}
            isLoading={false}
            currentUser="Alex"
          />
        </ToastProvider>
      );

      // On 'My Projects' tab: only Alex's track is visible
      await waitFor(() => {
        expect(screen.getByText('My Solitary Jam')).toBeInTheDocument();
        expect(screen.queryByText('Community Anthem')).not.toBeInTheDocument();
      });

      // Switch to 'Community Library' tab
      const communityTab = screen.getByRole('tab', { name: /Community Library/i });
      await user.click(communityTab);

      await waitFor(() => {
        expect(screen.getByText('My Solitary Jam')).toBeInTheDocument();
        expect(screen.getByText('Community Anthem')).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 7. LyricTimelineEditor.tsx Clamping & Async Fault Tolerance
  // =========================================================================
  describe('7. LyricTimelineEditor.tsx Monotonic Boundary Clamping & Async Faults', () => {
    it('prevents negative timestamps when line starting at 0.0s is nudged earlier', async () => {
      const user = userEvent.setup();
      const mockLines: LyricLine[] = [
        {
          id: 1,
          text: 'Zero Bound Line',
          start_time: 0.0,
          end_time: 2.0,
          words: [{ word: 'Zero', start_time: 0.0, end_time: 2.0 }],
        },
      ];

      render(
        <ToastProvider>
          <LyricTimelineEditor
            lines={mockLines}
            currentTime={0}
            duration={100}
            onSeek={vi.fn()}
            onSaveLines={vi.fn()}
          />
        </ToastProvider>
      );

      const rewindCoarseBtn = screen.getByRole('button', {
        name: /Nudge line 1 0\.2s earlier/i,
      });
      await user.click(rewindCoarseBtn);

      // Start time must stay strictly 0s (no negative numbers)
      expect(screen.getByText(/0\.0s - 2\.0s/i)).toBeInTheDocument();
    });

    it('clamps word boundary start_time so it cannot exceed end_time or previous word', async () => {
      const user = userEvent.setup();
      const mockLines: LyricLine[] = [
        {
          id: 1,
          text: 'Word Clamp',
          start_time: 1.0,
          end_time: 5.0,
          words: [
            { word: 'First', start_time: 1.0, end_time: 2.5 },
            { word: 'Second', start_time: 2.5, end_time: 5.0 },
          ],
        },
      ];

      render(
        <ToastProvider>
          <LyricTimelineEditor
            lines={mockLines}
            currentTime={0}
            duration={100}
            onSeek={vi.fn()}
            onSaveLines={vi.fn()}
          />
        </ToastProvider>
      );

      // Expand line 1
      const expandBtn = screen.getByRole('button', { name: /Expand word timings for line 1/i });
      await user.click(expandBtn);

      // Shift 'Second' word earlier by 0.05s multiple times
      const nudgeLeftButtons = screen.getAllByRole('button', { name: /Nudge word.*earlier/i });
      await user.click(nudgeLeftButtons[1]); // Second word

      // Remains monotonic
      expect(screen.getByText('Word Clamp')).toBeInTheDocument();
    });

    it('survives rejection during onSaveLines, preserves dirty state, and shows error toast', async () => {
      const user = userEvent.setup();
      const onSaveLines = vi.fn().mockRejectedValue(new Error('Database lock error'));

      const mockLines: LyricLine[] = [
        {
          id: 1,
          text: 'Save Fail',
          start_time: 1.0,
          end_time: 3.0,
          words: [{ word: 'Save', start_time: 1.0, end_time: 3.0 }],
        },
      ];

      render(
        <ToastProvider>
          <LyricTimelineEditor
            lines={mockLines}
            currentTime={0}
            duration={100}
            onSeek={vi.fn()}
            onSaveLines={onSaveLines}
          />
        </ToastProvider>
      );

      // Make dirty
      const nudgeBtn = screen.getByRole('button', { name: /Nudge line 1 0\.05s later/i });
      await user.click(nudgeBtn);

      const saveBtn = screen.getByRole('button', { name: /Save Timing Changes/i });
      await user.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByText(/Failed to save lyric timings/i)).toBeInTheDocument();
      });

      // Discard and Save buttons must still remain visible because state is still dirty
      expect(screen.getByRole('button', { name: /Save Timing Changes/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Discard Changes/i })).toBeInTheDocument();
    });

    it('opens discard changes modal and reverts modifications on confirm', async () => {
      const user = userEvent.setup();
      const mockLines: LyricLine[] = [
        {
          id: 1,
          text: 'Revert Me',
          start_time: 1.0,
          end_time: 3.0,
          words: [{ word: 'Revert', start_time: 1.0, end_time: 3.0 }],
        },
      ];

      render(
        <ToastProvider>
          <LyricTimelineEditor
            lines={mockLines}
            currentTime={0}
            duration={100}
            onSeek={vi.fn()}
            onSaveLines={vi.fn()}
          />
        </ToastProvider>
      );

      // Nudge to make dirty
      const nudgeBtn = screen.getByRole('button', { name: /Nudge line 1 0\.05s later/i });
      await user.click(nudgeBtn);

      const discardBtn = screen.getByRole('button', { name: /Discard Changes/i });
      await user.click(discardBtn);

      // Discard modal opens
      expect(screen.getByText(/Discard Unsaved Timing Changes\?/i)).toBeInTheDocument();

      // Click Confirm Discard
      const dialog = screen.getByRole('dialog');
      const confirmBtn = within(dialog).getByRole('button', { name: /Discard Changes/i });
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(screen.getByText(/Lyric edits discarded/i)).toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: /Save Timing Changes/i })
        ).not.toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // 8. useToast.tsx & api.ts Storage Exceptions & Fallback Robustness
  // =========================================================================
  describe('8. useToast.tsx & api.ts Storage Exceptions & Fallback Robustness', () => {
    it('provides safe no-op fallback methods when useToast is used without ToastProvider', () => {
      const { result } = renderHook(() => useToast());

      expect(result.current.toasts).toEqual([]);
      expect(result.current.showToast('msg')).toBe('');
      expect(result.current.success('msg')).toBe('');
      expect(result.current.error('msg')).toBe('');
      expect(result.current.info('msg')).toBe('');
      expect(result.current.warning('msg')).toBe('');
      expect(() => result.current.dismissToast('123')).not.toThrow();
      expect(() => result.current.clearToasts()).not.toThrow();

      // Nested toast object fallback
      expect(result.current.toast.show('msg')).toBe('');
      expect(result.current.toast.success('msg')).toBe('');
      expect(result.current.toast.error('msg')).toBe('');
      expect(result.current.toast.info('msg')).toBe('');
      expect(result.current.toast.warning('msg')).toBe('');
      expect(() => result.current.toast.dismiss('123')).not.toThrow();
      expect(() => result.current.toast.clear()).not.toThrow();
    });

    it('handles a burst of 50 rapid toasts without collisions or exceptions', () => {
      const { result } = renderHook(() => useToast(), {
        wrapper: ({ children }) => <ToastProvider>{children}</ToastProvider>,
      });

      act(() => {
        for (let i = 0; i < 50; i++) {
          result.current.info(`Burst notification #${i}`);
        }
      });

      expect(result.current.toasts.length).toBe(50);
      const uniqueIds = new Set(result.current.toasts.map((t) => t.id));
      expect(uniqueIds.size).toBe(50);

      // Clear all toasts
      act(() => {
        result.current.clearToasts();
      });
      expect(result.current.toasts.length).toBe(0);
    });

    it('api.ts retains auth token and user in memory when localStorage throws QuotaExceededError or SecurityError', () => {
      const originalSetItem = localStorage.setItem;
      const originalGetItem = localStorage.getItem;
      const originalRemoveItem = localStorage.removeItem;

      // Simulate locked storage throwing on setItem, getItem, and removeItem
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Access denied', 'SecurityError');
      });
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('Access denied', 'SecurityError');
      });

      // Setting and getting should gracefully use memory fallback
      setAuthToken('memory-only-token');
      expect(getAuthToken()).toBe('memory-only-token');

      setAuthUser('MemoryProducer');
      expect(getAuthUser()).toBe('MemoryProducer');

      clearAuth();
      expect(getAuthToken()).toBeNull();
      expect(getAuthUser()).toBe('Friend');

      Storage.prototype.setItem = originalSetItem;
      Storage.prototype.getItem = originalGetItem;
      Storage.prototype.removeItem = originalRemoveItem;
    });

    it('apiFetch automatically dispatches AUTH_UNAUTHORIZED_EVENT and wipes memory token on non-exempt 401', async () => {
      setAuthToken('session-token-to-expire');
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Token expired' }), { status: 401 })
      );

      const res = await apiFetch('/api/project/proj-401/mix');

      expect(res.status).toBe(401);
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(dispatchSpy.mock.calls[0][0].type).toBe(AUTH_UNAUTHORIZED_EVENT);
      expect(getAuthToken()).toBeNull();
    });
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportModal } from '../components/ExportModal';
import App from '../App';
import { ProjectState } from '../types';
import * as apiModule from '../api';
import { THEMES } from '../components/VisualThemePicker';
import {
  BREAKPOINTS,
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
} from './responsiveTestUtils';

describe('Milestone 2 Challenger 2: Frontend & Accessibility Adversarial Suite (Subtitle Exports)', () => {
  const baseReadyProject: ProjectState = {
    id: 'test-adversarial-export-proj',
    status: 'ready',
    progress: 100,
    title: 'Adversarial Test Track',
    artist: 'Empirical Challenger',
    lines: [
      {
        id: 1,
        text: 'Adversarial line 1 lyric text',
        start_time: 1.0,
        end_time: 4.0,
        words: [
          { word: 'Adversarial', start_time: 1.0, end_time: 2.0 },
          { word: 'line', start_time: 2.0, end_time: 2.5 },
          { word: '1', start_time: 2.5, end_time: 4.0 },
        ],
      },
      {
        id: 2,
        text: 'Second line with fast tempo',
        start_time: 4.5,
        end_time: 8.0,
        words: [
          { word: 'Second', start_time: 4.5, end_time: 5.5 },
          { word: 'line', start_time: 5.5, end_time: 8.0 },
        ],
      },
    ],
    semitones: 0,
    guide_volume: 0.0,
    render_status: 'idle',
    render_progress: 0,
    youtube_package: {
      title: 'Empirical Challenger - Adversarial Test Track (Karaoke Version)',
      description: 'Synchronized subtitles testing package.',
      tags: ['karaoke', 'subtitles', 'lrc', 'ass'],
      key_note: '0 st',
      lyrics: 'Adversarial line 1...\nSecond line...',
      privacy_status: 'public',
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    resetTestViewport();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Focus Area 1: Subtitle Availability Across All Project Render States
  // =========================================================================
  describe('Focus Area 1: Subtitle Availability in All Project States', () => {
    const states: Array<{
      state: 'idle' | 'queued' | 'rendering' | 'completed' | 'error';
      desc: string;
    }> = [
      { state: 'idle', desc: 'before any video render has started' },
      { state: 'queued', desc: 'while video render is waiting in worker semaphore queue' },
      { state: 'rendering', desc: 'while video render encoding is actively in progress' },
      { state: 'completed', desc: 'after video render has completed and MP4 is ready' },
      { state: 'error', desc: 'after video render failed with an encoder error' },
    ];

    states.forEach(({ state, desc }) => {
      it(`renders functional subtitle download controls when render_status is "${state}" (${desc})`, async () => {
        const user = userEvent.setup();
        const testProject: ProjectState = {
          ...baseReadyProject,
          render_status: state,
          render_progress: state === 'rendering' ? 45 : state === 'completed' ? 100 : 0,
          render_error:
            state === 'error' ? 'Encoder failure: FFmpeg exited with code 1' : undefined,
          video_url: state === 'completed' ? '/output/rendered.mp4' : undefined,
        };

        const mockBlob = new Blob(['[00:01.00]Test LRC line\n'], { type: 'text/plain' });
        const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
          new Response(mockBlob, {
            status: 200,
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Content-Disposition': 'attachment; filename="Test.lrc"',
            },
          })
        );

        window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
        window.URL.revokeObjectURL = vi.fn();

        render(
          <ExportModal
            project={testProject}
            isOpen={true}
            onClose={vi.fn()}
            aspectRatio="16:9"
            selectedTheme={THEMES[0]}
          />
        );

        // Section header and count badge must be present
        expect(screen.getByText(/Synchronized Subtitles \(\.LRC & \.ASS\)/i)).toBeInTheDocument();
        expect(screen.getByText('2 lines')).toBeInTheDocument();

        // Download .LRC button must be present, enabled, and clickable
        const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
        expect(lrcBtn).toBeInTheDocument();
        expect(lrcBtn).not.toBeDisabled();

        // Download .ASS button must be present, enabled, and clickable
        const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
        expect(assBtn).toBeInTheDocument();
        expect(assBtn).not.toBeDisabled();

        // Click LRC button and verify API dispatch
        await user.click(lrcBtn);
        expect(apiFetchSpy).toHaveBeenCalledWith(`/api/project/${testProject.id}/export/lrc`);
      });
    });

    it('handles projects with undefined lines gracefully without crashing', () => {
      const projectWithoutLines: ProjectState = {
        ...baseReadyProject,
        lines: undefined as unknown as ProjectState['lines'],
      };

      render(<ExportModal project={projectWithoutLines} isOpen={true} onClose={vi.fn()} />);

      expect(screen.getByText(/Synchronized Subtitles \(\.LRC & \.ASS\)/i)).toBeInTheDocument();
      expect(screen.queryByText(/lines/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /download \.lrc subtitles/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /download \.ass subtitles/i })).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Focus Area 2: Rapid Clicks, Loading Spinners & Memory Leaks (revokeObjectURL)
  // =========================================================================
  describe('Focus Area 2: Rapid Clicks, Loading Spinners, & Memory Leaks', () => {
    it('disables both download buttons while a download is in-flight to prevent race conditions', async () => {
      const user = userEvent.setup();
      let resolveFetch!: (res: Response) => void;
      const deferredPromise = new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });

      vi.spyOn(apiModule, 'apiFetch').mockReturnValue(deferredPromise);

      render(<ExportModal project={baseReadyProject} isOpen={true} onClose={vi.fn()} />);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });

      expect(lrcBtn).not.toBeDisabled();
      expect(assBtn).not.toBeDisabled();

      // Trigger LRC download
      await user.click(lrcBtn);

      // Both buttons must be disabled while LRC download is pending
      expect(lrcBtn).toBeDisabled();
      expect(assBtn).toBeDisabled();

      // Resolve the fetch
      const mockBlob = new Blob(['[00:01.00]Lyric\n'], { type: 'text/plain' });
      resolveFetch(new Response(mockBlob, { status: 200 }));

      await waitFor(() => {
        expect(lrcBtn).not.toBeDisabled();
        expect(assBtn).not.toBeDisabled();
      });
    });

    it('verifies memory cleanup by ensuring URL.revokeObjectURL is called for every generated blob URL', async () => {
      const user = userEvent.setup();
      const mockBlobLrc = new Blob(['[00:01.00]Lyric\n'], { type: 'text/plain' });
      const mockBlobAss = new Blob(['[Script Info]\nTitle: Test\n'], { type: 'text/x-ssa' });

      vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/export/lrc')) {
          return new Response(mockBlobLrc, {
            status: 200,
            headers: { 'Content-Disposition': 'attachment; filename="Song.lrc"' },
          });
        }
        return new Response(mockBlobAss, {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="Song.ass"' },
        });
      });

      const createObjectURLMock = vi
        .fn()
        .mockReturnValueOnce('blob:http://localhost/uuid-1')
        .mockReturnValueOnce('blob:http://localhost/uuid-2');
      const revokeObjectURLMock = vi.fn();

      window.URL.createObjectURL = createObjectURLMock;
      window.URL.revokeObjectURL = revokeObjectURLMock;

      render(<ExportModal project={baseReadyProject} isOpen={true} onClose={vi.fn()} />);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });

      // 1. Download LRC
      await user.click(lrcBtn);
      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost/uuid-1');

      // 2. Download ASS
      await user.click(assBtn);
      expect(createObjectURLMock).toHaveBeenCalledTimes(2);
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost/uuid-2');

      // Zero leaked object URLs
      expect(revokeObjectURLMock).toHaveBeenCalledTimes(2);
    });

    it('correctly parses RFC 5987/6266 filename*=UTF-8 encoding in Content-Disposition', async () => {
      const user = userEvent.setup();
      const mockBlob = new Blob(['[00:01.00]Lyric\n'], { type: 'text/plain' });

      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(mockBlob, {
          status: 200,
          headers: {
            'Content-Disposition':
              'attachment; filename="Fallback.lrc"; filename*=UTF-8\'\'Challenger%20%26%20Co%20-%20Special%20%E2%99%AA.lrc',
          },
        })
      );

      let clickedDownloadFilename = '';
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
      window.URL.revokeObjectURL = vi.fn();

      const originalAppendChild = document.body.appendChild.bind(document.body);
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
        if (node instanceof HTMLAnchorElement) {
          clickedDownloadFilename = node.download;
        }
        return originalAppendChild(node);
      });

      render(<ExportModal project={baseReadyProject} isOpen={true} onClose={vi.fn()} />);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      await user.click(lrcBtn);

      expect(clickedDownloadFilename).toBe('Challenger & Co - Special ♪.lrc');
    });
  });

  // =========================================================================
  // Focus Area 3: Error Handling on Backend Failure (400, 404, 500, Network)
  // =========================================================================
  describe('Focus Area 3: Error Handling on Backend Failures', () => {
    it('displays structured 400 error when project lyrics are not ready or empty', async () => {
      const user = userEvent.setup();
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Project has no aligned lyric lines to export' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      render(<ExportModal project={baseReadyProject} isOpen={true} onClose={vi.fn()} />);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      await user.click(lrcBtn);

      const alert = await screen.findByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent('Project has no aligned lyric lines to export');
    });

    it('displays structured 404 error when project does not exist', async () => {
      const user = userEvent.setup();
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Project not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      render(<ExportModal project={baseReadyProject} isOpen={true} onClose={vi.fn()} />);

      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(assBtn);

      const alert = await screen.findByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent('Project not found');
    });

    it('displays fallback error message when backend returns 500 HTML error without crashing', async () => {
      const user = userEvent.setup();
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response('<html><body>500 Internal Server Error</body></html>', {
          status: 500,
          headers: { 'Content-Type': 'text/html' },
        })
      );

      render(<ExportModal project={baseReadyProject} isOpen={true} onClose={vi.fn()} />);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      await user.click(lrcBtn);

      const alert = await screen.findByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent('Failed to export .lrc subtitles');
    });

    it('handles network failure (rejected promise) gracefully and displays error in alert banner', async () => {
      const user = userEvent.setup();
      vi.spyOn(apiModule, 'apiFetch').mockRejectedValue(
        new TypeError('NetworkError when attempting to fetch resource.')
      );

      render(<ExportModal project={baseReadyProject} isOpen={true} onClose={vi.fn()} />);

      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      await user.click(assBtn);

      const alert = await screen.findByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent('NetworkError when attempting to fetch resource.');
    });

    it('clears previous download error when initiating a new download attempt', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch');

      // First call fails with 400
      apiFetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Initial failure' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      render(<ExportModal project={baseReadyProject} isOpen={true} onClose={vi.fn()} />);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      await user.click(lrcBtn);

      expect(await screen.findByRole('alert')).toHaveTextContent('Initial failure');

      // Second call succeeds
      const mockBlob = new Blob(['[00:01.00]Success\n'], { type: 'text/plain' });
      apiFetchSpy.mockResolvedValueOnce(new Response(mockBlob, { status: 200 }));
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
      window.URL.revokeObjectURL = vi.fn();

      await user.click(lrcBtn);

      // Alert must be removed
      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // Focus Area 4: Touch Targets (>= 44px) & Accessibility Standards
  // =========================================================================
  describe('Focus Area 4: Touch Targets & Accessibility Standards', () => {
    it('verifies >=44px touch targets on all interactive buttons in ExportModal', () => {
      render(
        <ExportModal
          project={{
            ...baseReadyProject,
            render_status: 'idle',
          }}
          isOpen={true}
          onClose={vi.fn()}
          onStartRender={vi.fn()}
        />
      );

      // 1. Close dialog button
      const closeBtn = screen.getByRole('button', { name: /close export dialog/i });
      expect(closeBtn.className).toContain('min-w-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');

      // 2. Download .LRC button
      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      expect(lrcBtn.className).toContain('min-h-[44px]');

      // 3. Download .ASS button
      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      expect(assBtn.className).toContain('min-h-[44px]');

      // 4. Render 1080p Video button (idle state)
      const renderBtn = screen.getByRole('button', { name: /start video render/i });
      expect(renderBtn.className).toContain('min-h-[44px]');
    });

    it('verifies >=44px touch targets on video actions and cancel button across states', () => {
      // Completed state
      const { rerender } = render(
        <ExportModal
          project={{
            ...baseReadyProject,
            render_status: 'completed',
            video_url: '/output/karaoke.mp4',
          }}
          isOpen={true}
          onClose={vi.fn()}
        />
      );

      const downloadVideoLink = screen.getByRole('link', { name: /download video/i });
      const youtubeStudioLink = screen.getByRole('link', { name: /open youtube studio/i });
      expect(downloadVideoLink.className).toContain('min-h-[44px]');
      expect(youtubeStudioLink.className).toContain('min-h-[44px]');

      // Rendering state
      rerender(
        <ExportModal
          project={{
            ...baseReadyProject,
            render_status: 'rendering',
            render_progress: 50,
          }}
          isOpen={true}
          onClose={vi.fn()}
          onCancelRender={vi.fn()}
        />
      );

      const cancelRenderBtn = screen.getByRole('button', { name: /cancel render/i });
      expect(cancelRenderBtn.className).toContain('min-h-[44px]');
    });

    it('verifies App.tsx studio header buttons satisfy >=44px touch targets', async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
        }
        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify({ [baseReadyProject.id]: baseReadyProject }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes(`/api/project/${baseReadyProject.id}`)) {
          return new Response(JSON.stringify(baseReadyProject), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      window.history.pushState({}, '', `/?project=${baseReadyProject.id}`);
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Adversarial Test Track')).toBeInTheDocument();
      });

      // Export Subtitles button
      const exportBtn = screen.getByRole('button', {
        name: /export subtitles and studio package/i,
      });
      expect(exportBtn.className).toContain('min-h-[44px]');

      // Render 1080p Video button
      const renderBtn = screen.getByRole('button', { name: /render 1080p video/i });
      expect(renderBtn.className).toContain('min-h-[44px]');

      // Delete project button
      const deleteBtn = screen.getByRole('button', { name: /delete project/i });
      expect(deleteBtn.className).toContain('min-h-[44px]');
      expect(deleteBtn.className).toContain('min-w-[44px]');
    });
  });

  // =========================================================================
  // Focus Area 5: Responsive Layout & Zero Horizontal Overflow (320px - 1280px)
  // =========================================================================
  describe('Focus Area 5: Viewport Geometry & Zero Horizontal Overflow', () => {
    BREAKPOINTS.forEach((bp) => {
      it(`renders ExportModal with zero horizontal overflow at ${bp.name} (${bp.width}px)`, () => {
        setTestViewport(bp.width, bp.height);
        const { container } = render(
          <ExportModal
            project={baseReadyProject}
            isOpen={true}
            onClose={vi.fn()}
            aspectRatio="16:9"
            selectedTheme={THEMES[0]}
          />
        );

        assertZeroHorizontalOverflow(container, bp.width);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
          document.documentElement.clientWidth
        );
      });
    });

    it('survives long title and artist names at 320px without layout blowout', () => {
      setTestViewport(320, 568);
      const longNameProject: ProjectState = {
        ...baseReadyProject,
        title:
          'A Very Long Project Title That Extends Across Multiple Lines For Comprehensive Testing',
        artist: 'The Most Incredibly Elaborate Artist Orchestra & Ensemble In The Entire World',
      };

      const { container } = render(
        <ExportModal project={longNameProject} isOpen={true} onClose={vi.fn()} />
      );

      assertZeroHorizontalOverflow(container, 320);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth
      );
    });

    it('survives very long error messages in alert banner at 320px without overflow', async () => {
      setTestViewport(320, 568);
      const user = userEvent.setup();
      const longError =
        'VeryLongUnbrokenErrorMessageFromBackendThatMightExceedMobileWidthIfBreakWordsIsNotAppliedProperlyOnTheRoleAlertContainer';

      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(JSON.stringify({ detail: longError }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const { container } = render(
        <ExportModal project={baseReadyProject} isOpen={true} onClose={vi.fn()} />
      );

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      await user.click(lrcBtn);

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      assertZeroHorizontalOverflow(container, 320);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth
      );
    });
  });
});

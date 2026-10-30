import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportModal } from '../../components/ExportModal';
import { ProjectState } from '../../types';
import * as apiModule from '../../api';
import { THEMES } from '../../components/VisualThemePicker';
import {
  BREAKPOINTS,
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  assertTouchTargets,
} from '../helpers/responsiveTestUtils';

describe('Milestone 2 Iteration 2 Challenger 2: Subtitle Exports & Accessibility Adversarial Harness', () => {
  const baseProject: ProjectState = {
    id: 'adversarial-it2-proj',
    status: 'ready',
    progress: 100,
    title: 'Adversarial Subtitle Test',
    artist: 'Empirical Challenger',
    lines: [
      {
        id: 1,
        text: 'Adversarial line 1',
        start_time: 1.0,
        end_time: 3.5,
        words: [
          { word: 'Adversarial', start_time: 1.0, end_time: 2.0 },
          { word: 'line', start_time: 2.0, end_time: 2.5 },
          { word: '1', start_time: 2.5, end_time: 3.5 },
        ],
      },
    ],
    semitones: 0,
    guide_volume: 0.0,
    render_status: 'idle',
    render_progress: 0,
    youtube_package: {
      title: 'Empirical Challenger - Adversarial Subtitle Test',
      description: 'Adversarial subtitle testing kit.',
      tags: ['karaoke', 'subtitles', 'lrc', 'ass'],
      key_note: '0 st',
      lyrics: 'Adversarial line 1',
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
  // Test Suite 1: Non-Latin-1 & International Filename Extraction (RFC 6266 / 5987)
  // =========================================================================
  describe('Suite 1: Non-Latin-1 & International Filename Extraction', () => {
    const internationalScenarios = [
      {
        lang: 'Japanese (Kanji & Hiragana)',
        header:
          'attachment; filename="YOASOBI.lrc"; filename*=UTF-8\'\'YOASOBI%20-%20%E5%A4%9C%E3%81%AB%E9%A7%86%E3%81%91%E3%82%8B.lrc',
        expectedFilename: 'YOASOBI - 夜に駆ける.lrc',
        format: 'lrc' as const,
      },
      {
        lang: 'Simplified Chinese (with CJK punctuation)',
        header:
          'attachment; filename="Jay_Chou.ass"; filename*=UTF-8\'\'%E5%91%A8%E6%9D%B0%E4%BC%A6%20-%20%E6%99%B4%E5%A4%A9%EF%BC%88Live%EF%BC%89.ass',
        expectedFilename: '周杰伦 - 晴天（Live）.ass',
        format: 'ass' as const,
      },
      {
        lang: 'Traditional Chinese',
        header:
          'attachment; filename="Eason_Chan.lrc"; filename*=UTF-8\'\'%E9%99%B3%E5%A5%95%E8%BF%85%20-%20%E5%af%8c%E5%A3%AB%E5%b1%b1%e4%b8%8b.lrc',
        expectedFilename: '陳奕迅 - 富士山下.lrc',
        format: 'lrc' as const,
      },
      {
        lang: 'Korean Hangul with Emoji',
        header:
          'attachment; filename="Psy.ass"; filename*=UTF-8\'\'%EC%8B%B8%EC%9D%B4%20-%20%EA%B0%95%EB%82%A8%EC%8A%A4%ED%83%80%EC%9D%BC%20%F0%9F%95%BA.ass',
        expectedFilename: '싸이 - 강남스타일 🕺.ass',
        format: 'ass' as const,
      },
      {
        lang: 'Cyrillic (Russian)',
        header:
          'attachment; filename="Kino.lrc"; filename*=UTF-8\'\'%D0%9A%D0%B8%D0%BD%D0%BE%20-%20%D0%93%D1%80%D1%83%D0%BF%D0%BF%D0%B0%20%D0%BA%D1%80%D0%BE%D0%B2%D0%B8.lrc',
        expectedFilename: 'Кино - Группа крови.lrc',
        format: 'lrc' as const,
      },
      {
        lang: 'Heavy Emojis & Symbols',
        header:
          'attachment; filename="DJ_Robot.ass"; filename*=UTF-8\'\'DJ%20%F0%9F%A4%96%20-%20%F0%9F%94%A5%20Star%20%E2%9C%A8%20%F0%9F%8E%A4.ass',
        expectedFilename: 'DJ 🤖 - 🔥 Star ✨ 🎤.ass',
        format: 'ass' as const,
      },
      {
        lang: 'Arabic (RTL)',
        header:
          'attachment; filename="Fairouz.lrc"; filename*=UTF-8\'\'%D9%81%D9%8A%D8%B1%D9%88%D8%B2%20-%20%D8%B3%D9%87%D8%B1%20%D8%A7%D9%84%D9%84%D9%8A%D8%A7%D9%84%D9%8A.lrc',
        expectedFilename: 'فيروز - سهر الليالي.lrc',
        format: 'lrc' as const,
      },
    ];

    internationalScenarios.forEach(({ lang, header, expectedFilename, format }) => {
      it(`correctly extracts and decodes ${lang} filename from RFC 6266 header for .${format}`, async () => {
        const user = userEvent.setup();
        const mockBlob = new Blob(['sample subtitle content'], { type: 'text/plain' });

        vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
          new Response(mockBlob, {
            status: 200,
            headers: { 'Content-Disposition': header },
          })
        );

        let capturedDownloadFilename = '';
        window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-intl');
        window.URL.revokeObjectURL = vi.fn();

        const originalAppendChild = document.body.appendChild.bind(document.body);
        vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
          if (node instanceof HTMLAnchorElement) {
            capturedDownloadFilename = node.download;
          }
          return originalAppendChild(node);
        });

        render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

        const btn = screen.getByRole('button', {
          name: new RegExp(`download \\.${format} subtitles`, 'i'),
        });
        await user.click(btn);

        expect(capturedDownloadFilename).toBe(expectedFilename);
      });
    });

    it('handles inverted RFC 6266 parameter order (filename* preceding filename)', async () => {
      const user = userEvent.setup();
      const invertedHeader =
        'attachment; filename*=UTF-8\'\'Custom%20Unicode%20Track.lrc; filename="Fallback.lrc"';

      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(new Blob(['content']), {
          status: 200,
          headers: { 'Content-Disposition': invertedHeader },
        })
      );

      let capturedDownloadFilename = '';
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-inverted');
      window.URL.revokeObjectURL = vi.fn();

      const originalAppendChild = document.body.appendChild.bind(document.body);
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
        if (node instanceof HTMLAnchorElement) {
          capturedDownloadFilename = node.download;
        }
        return originalAppendChild(node);
      });

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /download \.lrc subtitles/i }));

      expect(capturedDownloadFilename).toBe('Custom Unicode Track.lrc');
    });

    it('falls back to standard filename when filename* is absent', async () => {
      const user = userEvent.setup();
      const stdHeader = 'attachment; filename="Legacy-Standard-Track.ass"';

      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(new Blob(['content']), {
          status: 200,
          headers: { 'Content-Disposition': stdHeader },
        })
      );

      let capturedDownloadFilename = '';
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-std');
      window.URL.revokeObjectURL = vi.fn();

      const originalAppendChild = document.body.appendChild.bind(document.body);
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
        if (node instanceof HTMLAnchorElement) {
          capturedDownloadFilename = node.download;
        }
        return originalAppendChild(node);
      });

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /download \.ass subtitles/i }));

      expect(capturedDownloadFilename).toBe('Legacy-Standard-Track.ass');
    });

    it('gracefully handles malformed percent-encoding in filename* without throwing URIError', async () => {
      const user = userEvent.setup();
      // %ZZ is invalid percent-encoding which would cause decodeURIComponent to throw URIError
      const malformedHeader =
        'attachment; filename="Fallback.lrc"; filename*=UTF-8\'\'Corrupted%ZZ%FFTitle.lrc';

      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(new Blob(['content']), {
          status: 200,
          headers: { 'Content-Disposition': malformedHeader },
        })
      );

      let capturedDownloadFilename = '';
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-malformed');
      window.URL.revokeObjectURL = vi.fn();

      const originalAppendChild = document.body.appendChild.bind(document.body);
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
        if (node instanceof HTMLAnchorElement) {
          capturedDownloadFilename = node.download;
        }
        return originalAppendChild(node);
      });

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /download \.lrc subtitles/i }));

      // Does not throw; falls back safely to the raw value
      expect(capturedDownloadFilename).toBe('Corrupted%ZZ%FFTitle.lrc');
    });

    it('falls back to project metadata when Content-Disposition is missing', async () => {
      const user = userEvent.setup();
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(new Blob(['content']), {
          status: 200,
          // No Content-Disposition header
        })
      );

      let capturedDownloadFilename = '';
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-nometa');
      window.URL.revokeObjectURL = vi.fn();

      const originalAppendChild = document.body.appendChild.bind(document.body);
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
        if (node instanceof HTMLAnchorElement) {
          capturedDownloadFilename = node.download;
        }
        return originalAppendChild(node);
      });

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /download \.lrc subtitles/i }));

      expect(capturedDownloadFilename).toBe('Empirical Challenger - Adversarial Subtitle Test.lrc');
    });

    it('falls back to default Karaoke - Track naming when project metadata is empty', async () => {
      const user = userEvent.setup();
      const emptyProject: ProjectState = {
        ...baseProject,
        artist: '',
        title: '',
      };

      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(new Blob(['content']), {
          status: 200,
        })
      );

      let capturedDownloadFilename = '';
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-empty');
      window.URL.revokeObjectURL = vi.fn();

      const originalAppendChild = document.body.appendChild.bind(document.body);
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
        if (node instanceof HTMLAnchorElement) {
          capturedDownloadFilename = node.download;
        }
        return originalAppendChild(node);
      });

      render(<ExportModal project={emptyProject} isOpen={true} onClose={vi.fn()} />);
      await user.click(screen.getByRole('button', { name: /download \.ass subtitles/i }));

      expect(capturedDownloadFilename).toBe('Karaoke - Track.ass');
    });
  });

  // =========================================================================
  // Test Suite 2: Rapid/Concurrent Triggers, Mutual Exclusion & Spinners
  // =========================================================================
  describe('Suite 2: Rapid/Concurrent Triggers, Mutual Exclusion & Spinners', () => {
    it('dispatches only 1 apiFetch call under rapid repeated clicks on same button', async () => {
      const user = userEvent.setup();
      let resolveFetch!: (res: Response) => void;
      const deferred = new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });

      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockReturnValue(deferred);

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });

      // Rapidly click LRC 5 times
      await user.click(lrcBtn);
      // Following clicks while disabled should not trigger additional fetches
      await user.click(lrcBtn);
      await user.click(lrcBtn);
      await user.click(lrcBtn);
      await user.click(lrcBtn);

      expect(apiFetchSpy).toHaveBeenCalledTimes(1);

      // Clean up deferred
      resolveFetch(new Response(new Blob(['content']), { status: 200 }));
      await waitFor(() => {
        expect(lrcBtn).not.toBeDisabled();
      });
    });

    it('rejects cross-format clicks while one download is in-flight', async () => {
      const user = userEvent.setup();
      let resolveFetch!: (res: Response) => void;
      const deferred = new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });

      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch').mockReturnValue(deferred);

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });

      // Click LRC
      await user.click(lrcBtn);
      expect(lrcBtn).toBeDisabled();
      expect(assBtn).toBeDisabled();

      // Attempt to click ASS while LRC is pending
      await user.click(assBtn);

      expect(apiFetchSpy).toHaveBeenCalledTimes(1);
      expect(apiFetchSpy).toHaveBeenCalledWith(`/api/project/${baseProject.id}/export/lrc`);

      resolveFetch(new Response(new Blob(['content']), { status: 200 }));
      await waitFor(() => {
        expect(assBtn).not.toBeDisabled();
      });
    });

    it('renders animated spinner on active button while keeping other button disabled', async () => {
      const user = userEvent.setup();
      let resolveFetch!: (res: Response) => void;
      const deferred = new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });

      vi.spyOn(apiModule, 'apiFetch').mockReturnValue(deferred);

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });

      // Trigger ASS download
      await user.click(assBtn);

      // Verify ASS button contains spinning loader (svg with animate-spin class)
      const spinner = assBtn.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();

      // LRC button does not have spinner but is disabled
      expect(lrcBtn.querySelector('.animate-spin')).not.toBeInTheDocument();
      expect(lrcBtn).toBeDisabled();

      resolveFetch(new Response(new Blob(['content']), { status: 200 }));
      await waitFor(() => {
        expect(assBtn.querySelector('.animate-spin')).not.toBeInTheDocument();
      });
    });

    it('re-enables both buttons even when download rejects with an unhandled exception', async () => {
      const user = userEvent.setup();
      vi.spyOn(apiModule, 'apiFetch').mockRejectedValue(new Error('Fatal network crash'));

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });

      await user.click(lrcBtn);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(lrcBtn).not.toBeDisabled();
      expect(assBtn).not.toBeDisabled();
    });
  });

  // =========================================================================
  // Test Suite 3: Memory Leak Prevention (URL.revokeObjectURL Lifecycle)
  // =========================================================================
  describe('Suite 3: Memory Leak Prevention & Blob URL Lifecycle', () => {
    it('executes 10 consecutive subtitle downloads with zero leaked object URLs', async () => {
      const user = userEvent.setup();
      vi.spyOn(apiModule, 'apiFetch').mockImplementation(async () => {
        return new Response(new Blob(['sample subtitle text'], { type: 'text/plain' }), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="test.lrc"' },
        });
      });

      const createdUrls: string[] = [];
      const revokedUrls: string[] = [];

      window.URL.createObjectURL = vi.fn().mockImplementation((_blob: Blob) => {
        const url = `blob:http://localhost/test-uuid-${createdUrls.length + 1}`;
        createdUrls.push(url);
        return url;
      });

      window.URL.revokeObjectURL = vi.fn().mockImplementation((url: string) => {
        revokedUrls.push(url);
      });

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });

      // Run 10 consecutive downloads waiting for each to complete
      for (let i = 0; i < 10; i++) {
        await user.click(lrcBtn);
        await waitFor(() => {
          expect(lrcBtn).not.toBeDisabled();
        });
      }

      expect(createdUrls).toHaveLength(10);
      expect(revokedUrls).toHaveLength(10);
      expect(revokedUrls).toEqual(createdUrls);
    });

    it('ensures temporary anchor elements are cleanly detached from document.body', async () => {
      const user = userEvent.setup();
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(new Blob(['test']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="test.ass"' },
        })
      );

      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test-anchor');
      window.URL.revokeObjectURL = vi.fn();

      const initialAnchorCount = document.body.querySelectorAll('a[download]').length;

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /download \.ass subtitles/i }));

      const postDownloadAnchorCount = document.body.querySelectorAll('a[download]').length;
      expect(postDownloadAnchorCount).toBe(initialAnchorCount);
    });

    it('operates safely when window.URL.createObjectURL is undefined', async () => {
      const user = userEvent.setup();
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(new Blob(['test']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="test.lrc"' },
        })
      );

      // Simulate environment where createObjectURL is missing
      const originalCreate = window.URL.createObjectURL;
      // @ts-expect-error simulating missing API
      delete window.URL.createObjectURL;

      let fallbackClickedHref = '';
      const originalAppend = document.body.appendChild.bind(document.body);
      vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
        if (node instanceof HTMLAnchorElement) {
          fallbackClickedHref = node.href;
        }
        return originalAppend(node);
      });

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /download \.lrc subtitles/i }));

      expect(fallbackClickedHref).toContain(`/api/project/${baseProject.id}/export/lrc`);

      // Restore
      window.URL.createObjectURL = originalCreate;
    });
  });

  // =========================================================================
  // Test Suite 4: Error Handling & Error Banners
  // =========================================================================
  describe('Suite 4: Structured Error Banners & Fault Resilience', () => {
    it('displays 400 Bad Request error detail in alert banner', async () => {
      const user = userEvent.setup();
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Project lyrics are not ready for export' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /download \.ass subtitles/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Project lyrics are not ready for export');
    });

    it('handles 502 Bad Gateway text response without JSON parse failure', async () => {
      const user = userEvent.setup();
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response('502 Bad Gateway: Upstream server unavailable', {
          status: 502,
          headers: { 'Content-Type': 'text/plain' },
        })
      );

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: /download \.lrc subtitles/i }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Failed to export .lrc subtitles');
    });

    it('clears active error banner upon initiating a retry attempt', async () => {
      const user = userEvent.setup();
      const apiFetchSpy = vi.spyOn(apiModule, 'apiFetch');

      // Attempt 1 fails
      apiFetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Temporary failure' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      render(<ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />);

      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      await user.click(lrcBtn);

      expect(await screen.findByRole('alert')).toHaveTextContent('Temporary failure');

      // Attempt 2 succeeds
      apiFetchSpy.mockResolvedValueOnce(
        new Response(new Blob(['[00:01.00]Success']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="success.lrc"' },
        })
      );
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
      window.URL.revokeObjectURL = vi.fn();

      await user.click(lrcBtn);

      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // Test Suite 5: Touch Targets (>= 44px) & WCAG Compliance
  // =========================================================================
  describe('Suite 5: Touch Targets (>= 44px) & WCAG Compliance', () => {
    it('verifies >=44px touch targets on all buttons across all lifecycle states', () => {
      // 1. Idle state
      const { rerender, container } = render(
        <ExportModal
          project={{ ...baseProject, render_status: 'idle' }}
          isOpen={true}
          onClose={vi.fn()}
          onStartRender={vi.fn()}
        />
      );

      const inspectionIdle = assertTouchTargets(container, 44);
      expect(
        inspectionIdle.failed,
        `Failed touch targets in idle state: ${JSON.stringify(inspectionIdle.failed)}`
      ).toHaveLength(0);

      // 2. Rendering state
      rerender(
        <ExportModal
          project={{ ...baseProject, render_status: 'rendering', render_progress: 50 }}
          isOpen={true}
          onClose={vi.fn()}
          onCancelRender={vi.fn()}
        />
      );

      const inspectionRendering = assertTouchTargets(container, 44);
      expect(
        inspectionRendering.failed,
        `Failed touch targets in rendering state: ${JSON.stringify(inspectionRendering.failed)}`
      ).toHaveLength(0);

      // 3. Completed state
      rerender(
        <ExportModal
          project={{
            ...baseProject,
            render_status: 'completed',
            video_url: '/output/karaoke.mp4',
            youtube_package: {
              title: 'Song',
              description: 'Desc',
              tags: ['tag'],
              key_note: '0',
              lyrics: 'Lyric',
              privacy_status: 'public',
            },
          }}
          isOpen={true}
          onClose={vi.fn()}
        />
      );

      // Verify the main action buttons and links have min-h-[44px]
      const downloadVideoLink = screen.getByRole('link', { name: /download video/i });
      const youtubeLink = screen.getByRole('link', { name: /open youtube studio/i });
      const lrcBtn = screen.getByRole('button', { name: /download \.lrc subtitles/i });
      const assBtn = screen.getByRole('button', { name: /download \.ass subtitles/i });
      const closeBtn = screen.getByRole('button', { name: /close export dialog/i });

      expect(downloadVideoLink.className).toContain('min-h-[44px]');
      expect(youtubeLink.className).toContain('min-h-[44px]');
      expect(lrcBtn.className).toContain('min-h-[44px]');
      expect(assBtn.className).toContain('min-h-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');
    });
  });

  // =========================================================================
  // Test Suite 6: Viewport Geometry & Zero Horizontal Overflow (320px - 1280px)
  // =========================================================================
  describe('Suite 6: Viewport Geometry & Zero Horizontal Overflow (320px, 375px, 768px, 1280px)', () => {
    BREAKPOINTS.forEach((bp) => {
      it(`enforces zero horizontal overflow at ${bp.name} (${bp.width}px)`, () => {
        setTestViewport(bp.width, bp.height);
        const { container } = render(
          <ExportModal
            project={baseProject}
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

    it('survives extreme non-Latin-1 titles and artists at 320px mobile viewport without overflow', () => {
      setTestViewport(320, 568);
      const extremeProject: ProjectState = {
        ...baseProject,
        title:
          '周杰伦 - 最长的电影 🎬 🎹 🎶 (2026 Remastered Deluxe Spatial Audio Edition with Extended Outro and Live Audience Vocals)',
        artist:
          'YOASOBI / 幾田りら feat. Hatsune Miku 初音ミク & Kagamine Rin 鏡音リン Orchestra & Ensemble',
      };

      const { container } = render(
        <ExportModal project={extremeProject} isOpen={true} onClose={vi.fn()} />
      );

      assertZeroHorizontalOverflow(container, 320);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth
      );
    });

    it('survives unbroken error strings in alert banner at 320px mobile viewport without overflow', async () => {
      setTestViewport(320, 568);
      const user = userEvent.setup();
      const pathologicalError =
        'Pathological_Unbroken_Backend_Error_String_That_Might_Blow_Out_Mobile_Viewports_Without_Break_Words_On_Role_Alert_Container_At_320px';

      vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
        new Response(JSON.stringify({ detail: pathologicalError }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const { container } = render(
        <ExportModal project={baseProject} isOpen={true} onClose={vi.fn()} />
      );

      await user.click(screen.getByRole('button', { name: /download \.lrc subtitles/i }));

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      assertZeroHorizontalOverflow(container, 320);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth
      );
    });
  });
});

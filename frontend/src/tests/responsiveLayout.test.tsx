import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import App from '../App';
import { TrackSearch } from '../components/TrackSearch';
import { AuthModal } from '../components/AuthModal';
import { ExportModal } from '../components/ExportModal';
import { LyricTimelineEditor } from '../components/LyricTimelineEditor';
import { AudioControls } from '../components/AudioControls';
import { VisualThemePicker, THEMES } from '../components/VisualThemePicker';
import { LyricDisplay } from '../components/LyricDisplay';
import { LyricLine, ProjectState } from '../types';
import {
  BREAKPOINTS,
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  detectHorizontalOverflow,
} from './responsiveTestUtils';

describe('Responsive Layout & Mobile Usability Test Suite (Milestone 3)', () => {
  const sampleLines: LyricLine[] = [
    {
      id: 1,
      text: 'Is this the real life? Is this just fantasy?',
      start_time: 1.0,
      end_time: 5.5,
      words: [
        { word: 'Is', start_time: 1.0, end_time: 1.4 },
        { word: 'this', start_time: 1.4, end_time: 1.8 },
        { word: 'the', start_time: 1.8, end_time: 2.1 },
        { word: 'real', start_time: 2.1, end_time: 2.8 },
        { word: 'life?', start_time: 2.8, end_time: 3.5 },
        { word: 'Is', start_time: 3.6, end_time: 3.9 },
        { word: 'this', start_time: 3.9, end_time: 4.2 },
        { word: 'just', start_time: 4.2, end_time: 4.6 },
        { word: 'fantasy?', start_time: 4.6, end_time: 5.5 },
      ],
    },
    {
      id: 2,
      text: 'Caught in a landslide, no escape from reality',
      start_time: 6.0,
      end_time: 11.2,
      words: [
        { word: 'Caught', start_time: 6.0, end_time: 6.8 },
        { word: 'in', start_time: 6.8, end_time: 7.2 },
        { word: 'a', start_time: 7.2, end_time: 7.5 },
        { word: 'landslide,', start_time: 7.5, end_time: 8.5 },
        { word: 'no', start_time: 8.8, end_time: 9.3 },
        { word: 'escape', start_time: 9.3, end_time: 10.1 },
        { word: 'from', start_time: 10.1, end_time: 10.4 },
        { word: 'reality', start_time: 10.4, end_time: 11.2 },
      ],
    },
  ];

  const readyProject: ProjectState = {
    id: 'test-project-ready',
    status: 'ready',
    progress: 100,
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    thumbnail_url: 'https://example.com/cover.jpg',
    lines: sampleLines,
    semitones: 0,
    guide_volume: 0.0,
    instrumental_url: '/audio/test-instrumental.mp3',
    vocals_url: '/audio/test-vocals.mp3',
    render_status: 'idle',
    render_progress: 0,
    heartbeat: Date.now(),
    youtube_package: {
      title: 'Queen - Bohemian Rhapsody (Official Karaoke Backing Track)',
      description: 'Synchronized high-definition karaoke backing track with on-screen lyrics.',
      tags: ['karaoke', 'queen', 'bohemian rhapsody', 'lyrics', 'backing track'],
      key_note: 'Original Key (0 st)',
      lyrics: 'Is this the real life? Is this just fantasy?\nCaught in a landslide...',
      privacy_status: 'public',
    },
  };

  const processingProject: ProjectState = {
    id: 'test-project-proc',
    status: 'separating',
    status_detail: 'Isolating vocals and backing instrumental track with Demucs AI...',
    progress: 45,
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    elapsed_seconds: 42,
    eta_seconds: 58,
    heartbeat: Date.now(),
    lines: [],
    semitones: 0,
    guide_volume: 0.0,
  };

  const errorProject: ProjectState = {
    id: 'test-project-err',
    status: 'error',
    error: 'Audio extraction failed: Video unavailable in your region.',
    progress: 10,
    title: 'Restricted Song',
    artist: 'Artist',
    lines: [],
    semitones: 0,
    guide_volume: 0.0,
  };

  const renderingProject: ProjectState = {
    ...readyProject,
    render_status: 'rendering',
    render_progress: 68,
    render_detail: 'Encoding video frames at 60fps with FFmpeg...',
    render_elapsed_seconds: 35,
    render_eta_seconds: 18,
    render_heartbeat: Date.now(),
  };

  const completedExportProject: ProjectState = {
    ...readyProject,
    render_status: 'completed',
    render_progress: 100,
    video_url: '/static/rendered_output.mp4',
  };

  const mockApiResponse = (projectData?: ProjectState | null) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/status')) {
        return new Response(JSON.stringify({ auth_required: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/api/projects')) {
        return new Response(JSON.stringify(projectData ? { [projectData.id]: projectData } : {}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/api/project/')) {
        return new Response(JSON.stringify(projectData || readyProject), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
    mockApiResponse(null);
  });

  afterEach(() => {
    cleanup();
    resetTestViewport();
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  // ---------------------------------------------------------------------------
  // 1. Detection Utility Invariant Verification
  // ---------------------------------------------------------------------------
  describe('Testing Infrastructure: detectHorizontalOverflow & assertZeroHorizontalOverflow', () => {
    it('accurately identifies elements with fixed widths exceeding viewport', () => {
      const testContainer = document.createElement('div');
      testContainer.className = 'w-[500px] bg-slate-900';
      document.body.appendChild(testContainer);

      const violations320 = detectHorizontalOverflow(testContainer, 320);
      expect(violations320.length).toBeGreaterThan(0);
      expect(violations320[0].reason).toContain('w-[500px]');

      const violations768 = detectHorizontalOverflow(testContainer, 768);
      expect(violations768.length).toBe(0);

      document.body.removeChild(testContainer);
    });

    it('accurately detects un-wrapped flex actions exceeding viewport width', () => {
      const flexContainer = document.createElement('div');
      flexContainer.className = 'flex items-center gap-4';
      const btn1 = document.createElement('button');
      btn1.textContent = 'A very long action button label one with extra text';
      const btn2 = document.createElement('button');
      btn2.textContent = 'Another long action button label two with extra text';
      flexContainer.appendChild(btn1);
      flexContainer.appendChild(btn2);
      document.body.appendChild(flexContainer);

      const violations = detectHorizontalOverflow(flexContainer, 320);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].reason).toContain('Non-wrapping flex container');

      document.body.removeChild(flexContainer);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. AuthModal Responsive Behavior & Touch Standards
  // ---------------------------------------------------------------------------
  describe('AuthModal Responsive Adaptation', () => {
    BREAKPOINTS.forEach((bp) => {
      it(`renders cleanly with zero horizontal overflow at ${bp.name} (${bp.width}x${bp.height})`, () => {
        setTestViewport(bp.width, bp.height);
        const { container } = render(
          <AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />
        );

        assertZeroHorizontalOverflow(container, bp.width);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
          document.documentElement.clientWidth
        );
      });
    });

    it('provides WCAG-compliant touch target on close button and mobile-friendly inputs', () => {
      setTestViewport(320, 568);
      render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />);

      const closeBtn = screen.getByRole('button', {
        name: /close studio authentication dialog/i,
      });
      expect(closeBtn).toBeInTheDocument();
      expect(closeBtn.className).toContain('min-w-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');

      const passwordInput = screen.getByLabelText(/studio passphrase/i);
      expect(passwordInput.className).toContain('min-h-[44px]');
      expect(passwordInput.className).toContain('text-base');

      const usernameInput = screen.getByLabelText(/your nickname/i);
      expect(usernameInput.className).toContain('min-h-[44px]');
      expect(usernameInput.className).toContain('text-base');

      const submitBtn = screen.getByRole('button', { name: /enter studio/i });
      expect(submitBtn.className).toContain('min-h-[44px]');
    });

    it('contains vertical overflow with max-h-[90vh] overflow-y-auto on small displays', () => {
      setTestViewport(320, 568);
      render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />);

      const dialog = screen.getByRole('dialog');
      const innerCard = dialog.firstElementChild as HTMLElement;
      expect(innerCard.className).toContain('max-h-[90vh]');
      expect(innerCard.className).toContain('overflow-y-auto');
      expect(innerCard.className).toContain('p-4');
      expect(innerCard.className).toContain('sm:p-6');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. ExportModal Responsive Behavior & Download Buttons Wrapping
  // ---------------------------------------------------------------------------
  describe('ExportModal Responsive Adaptation', () => {
    describe('Rendering State', () => {
      BREAKPOINTS.forEach((bp) => {
        it(`renders rendering state with zero overflow at ${bp.name} (${bp.width}px)`, () => {
          setTestViewport(bp.width, bp.height);
          const { container } = render(
            <ExportModal
              project={renderingProject}
              isOpen={true}
              onClose={vi.fn()}
              onCancelRender={vi.fn()}
            />
          );

          assertZeroHorizontalOverflow(container, bp.width);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
            document.documentElement.clientWidth
          );
        });
      });

      it('wraps progress timer indicators and provides 44px cancel button on mobile', () => {
        setTestViewport(320, 568);
        render(
          <ExportModal
            project={renderingProject}
            isOpen={true}
            onClose={vi.fn()}
            onCancelRender={vi.fn()}
          />
        );

        const cancelBtn = screen.getByRole('button', { name: /cancel render/i });
        expect(cancelBtn.className).toContain('min-h-[44px]');

        const closeBtn = screen.getByRole('button', { name: /close export dialog/i });
        expect(closeBtn.className).toContain('min-w-[44px]');
        expect(closeBtn.className).toContain('min-h-[44px]');
      });
    });

    describe('Completed State (Eliminating 98px Overflow)', () => {
      BREAKPOINTS.forEach((bp) => {
        it(`renders completed state with zero overflow at ${bp.name} (${bp.width}px)`, () => {
          setTestViewport(bp.width, bp.height);
          const { container } = render(
            <ExportModal
              project={completedExportProject}
              isOpen={true}
              onClose={vi.fn()}
              onCancelRender={vi.fn()}
            />
          );

          assertZeroHorizontalOverflow(container, bp.width);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
            document.documentElement.clientWidth
          );
        });
      });

      it('stacks download video and YouTube Studio buttons on mobile viewports', () => {
        setTestViewport(320, 568);
        render(
          <ExportModal
            project={completedExportProject}
            isOpen={true}
            onClose={vi.fn()}
            onCancelRender={vi.fn()}
          />
        );

        const downloadLink = screen.getByRole('link', { name: /download video/i });
        const ytLink = screen.getByRole('link', { name: /open youtube studio/i });

        expect(downloadLink.className).toContain('min-h-[44px]');
        expect(downloadLink.className).toContain('w-full');
        expect(ytLink.className).toContain('min-h-[44px]');
        expect(ytLink.className).toContain('w-full');

        const buttonWrapper = downloadLink.parentElement as HTMLElement;
        expect(buttonWrapper.className).toContain('flex-col');
        expect(buttonWrapper.className).toContain('sm:flex-row');
      });

      it('wraps preformatted YouTube description text and provides accessible copy buttons', () => {
        setTestViewport(320, 568);
        render(
          <ExportModal
            project={completedExportProject}
            isOpen={true}
            onClose={vi.fn()}
            onCancelRender={vi.fn()}
          />
        );

        const preElement = document.querySelector('pre');
        expect(preElement).toBeInTheDocument();
        expect(preElement?.className).toContain('whitespace-pre-wrap');
        expect(preElement?.className).toContain('break-words');
        expect(preElement?.className).toContain('overflow-x-auto');

        const copyBtns = screen.getAllByRole('button', { name: /copy/i });
        expect(copyBtns.length).toBeGreaterThanOrEqual(3);
        copyBtns.forEach((btn) => {
          expect(btn.className).toContain('min-h-[36px]');
        });
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Landing & TrackSearch View Responsive Adaptation
  // ---------------------------------------------------------------------------
  describe('TrackSearch Landing View Responsive Adaptation', () => {
    BREAKPOINTS.forEach((bp) => {
      it(`renders TrackSearch with zero overflow at ${bp.name} (${bp.width}px)`, () => {
        setTestViewport(bp.width, bp.height);
        const { container } = render(
          <TrackSearch
            onSelectTrack={vi.fn()}
            onOpenProject={vi.fn()}
            isLoading={false}
            currentUser="TestUser"
          />
        );

        assertZeroHorizontalOverflow(container, bp.width);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
          document.documentElement.clientWidth
        );
      });
    });

    it('adapts search input and submit button for mobile hit targets', () => {
      setTestViewport(320, 568);
      render(
        <TrackSearch
          onSelectTrack={vi.fn()}
          onOpenProject={vi.fn()}
          isLoading={false}
          currentUser="TestUser"
        />
      );

      const searchInput = screen.getByLabelText(/paste youtube/i);
      expect(searchInput.className).toContain('min-h-[48px]');

      const searchBtn = screen.getByRole('button', { name: /search youtube/i });
      expect(searchBtn.className).toContain('min-h-[36px]');
      expect(searchBtn.className).toContain('sm:min-h-[44px]');
    });

    it('ensures library tabs have adequate touch dimensions', () => {
      setTestViewport(375, 667);
      render(
        <TrackSearch
          onSelectTrack={vi.fn()}
          onOpenProject={vi.fn()}
          isLoading={false}
          currentUser="TestUser"
        />
      );

      const mySongsTab = screen.getByRole('tab', { name: /my songs/i });
      expect(mySongsTab.className).toContain('min-h-[36px]');
    });

    it('renders local audio upload panel with zero overflow and >=44px touch targets at 320px', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <TrackSearch
          onSelectTrack={vi.fn()}
          onOpenProject={vi.fn()}
          isLoading={false}
          currentUser="TestUser"
        />
      );

      const localToggle = screen.getByRole('button', { name: /Local Audio File/i });
      fireEvent.click(localToggle);

      assertZeroHorizontalOverflow(container, 320);

      const uploadBtn = screen.getByRole('button', {
        name: /Upload and process local audio track/i,
      });
      expect(uploadBtn.className).toContain('min-h-[44px]');

      const titleInput = screen.getByLabelText(/Track Title/i);
      expect(titleInput.className).toContain('min-h-[44px]');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. App Shell Processing & Error States
  // ---------------------------------------------------------------------------
  describe('App Shell Processing and Error States', () => {
    BREAKPOINTS.forEach((bp) => {
      it(`renders processing pipeline screen with zero overflow at ${bp.name} (${bp.width}px)`, async () => {
        setTestViewport(bp.width, bp.height);
        window.history.pushState({}, '', '/?project=test-project-proc');
        mockApiResponse(processingProject);

        const { container } = render(<App />);

        await waitFor(() => {
          expect(screen.getByText(/Separating\.\.\./i)).toBeInTheDocument();
        });

        assertZeroHorizontalOverflow(container, bp.width);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
          document.documentElement.clientWidth
        );
      });

      it(`renders error screen with zero overflow at ${bp.name} (${bp.width}px)`, async () => {
        setTestViewport(bp.width, bp.height);
        window.history.pushState({}, '', '/?project=test-project-err');
        mockApiResponse(errorProject);

        const { container } = render(<App />);

        await waitFor(() => {
          expect(screen.getByText(/Track Processing Failed/i)).toBeInTheDocument();
        });

        assertZeroHorizontalOverflow(container, bp.width);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
          document.documentElement.clientWidth
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Studio Dashboard Interactive Components
  // ---------------------------------------------------------------------------
  describe('Studio Dashboard Responsive Components', () => {
    describe('AudioControls Transport & Mixer', () => {
      BREAKPOINTS.forEach((bp) => {
        it(`renders AudioControls with zero overflow at ${bp.name} (${bp.width}px)`, () => {
          setTestViewport(bp.width, bp.height);
          const { container } = render(
            <AudioControls
              projectId="test-project-ready"
              isPlaying={false}
              currentTime={15}
              duration={180}
              onTogglePlay={vi.fn()}
              onSeek={vi.fn()}
              onMixChange={vi.fn()}
              initialSemitones={0}
              initialGuideVolume={0}
            />
          );

          assertZeroHorizontalOverflow(container, bp.width);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
            document.documentElement.clientWidth
          );
        });
      });

      it('provides >=44px touch targets on transport and pitch controls', () => {
        setTestViewport(320, 568);
        render(
          <AudioControls
            projectId="test-project-ready"
            isPlaying={false}
            currentTime={15}
            duration={180}
            onTogglePlay={vi.fn()}
            onSeek={vi.fn()}
            onMixChange={vi.fn()}
            initialSemitones={0}
            initialGuideVolume={0}
          />
        );

        const playBtn = screen.getByRole('button', { name: /start playback/i });
        expect(playBtn.className).toContain('w-12');
        expect(playBtn.className).toContain('h-12');

        const restartBtn = screen.getByRole('button', { name: /restart track from beginning/i });
        expect(restartBtn.className).toContain('min-w-[44px]');
        expect(restartBtn.className).toContain('min-h-[44px]');

        const muteBtn = screen.getByRole('button', { name: /mute audio/i });
        expect(muteBtn.className).toContain('min-w-[44px]');
        expect(muteBtn.className).toContain('min-h-[44px]');
      });
    });

    describe('LyricTimelineEditor & Nudge Controls', () => {
      BREAKPOINTS.forEach((bp) => {
        it(`renders LyricTimelineEditor with zero overflow at ${bp.name} (${bp.width}px)`, () => {
          setTestViewport(bp.width, bp.height);
          const { container } = render(
            <LyricTimelineEditor
              lines={sampleLines}
              currentTime={3.0}
              duration={180}
              onSaveLines={vi.fn()}
              onSeek={vi.fn()}
            />
          );

          assertZeroHorizontalOverflow(container, bp.width);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
            document.documentElement.clientWidth
          );
        });
      });

      it('uses 2-row line layout on mobile to prevent crushing timestamps and lyric text', () => {
        setTestViewport(320, 568);
        render(
          <LyricTimelineEditor
            lines={sampleLines}
            currentTime={3.0}
            duration={180}
            onSaveLines={vi.fn()}
            onSeek={vi.fn()}
          />
        );

        const lineHeaders = document.querySelectorAll('.flex.flex-col.sm\\:flex-row');
        expect(lineHeaders.length).toBeGreaterThanOrEqual(1);

        const nudgeButtons = screen.getAllByRole('button', { name: /nudge line/i });
        expect(nudgeButtons.length).toBeGreaterThan(0);
        nudgeButtons.forEach((btn) => {
          expect(btn.className).toContain('min-h-[40px]');
        });
      });
    });

    describe('LyricDisplay Live Stage & Theme Picker', () => {
      BREAKPOINTS.forEach((bp) => {
        it(`renders LyricDisplay and VisualThemePicker cleanly at ${bp.name} (${bp.width}px)`, () => {
          setTestViewport(bp.width, bp.height);
          const { container: displayContainer } = render(
            <LyricDisplay
              lines={sampleLines}
              currentTime={2.5}
              themeSungColor={THEMES[0].previewSung}
              themeUnsungColor={THEMES[0].previewUnsung}
              aspectRatio="16:9"
            />
          );
          assertZeroHorizontalOverflow(displayContainer, bp.width);
          cleanup();

          const { container: pickerContainer } = render(
            <VisualThemePicker
              selectedTheme={THEMES[0]}
              onSelectTheme={vi.fn()}
              aspectRatio="16:9"
              onChangeAspectRatio={vi.fn()}
              onCustomBgUploaded={vi.fn()}
            />
          );
          assertZeroHorizontalOverflow(pickerContainer, bp.width);
        });
      });

      it('supports 9:16 Shorts aspect ratio preview on mobile displays', () => {
        setTestViewport(375, 667);
        const { container } = render(
          <LyricDisplay
            lines={sampleLines}
            currentTime={2.5}
            themeSungColor={THEMES[0].previewSung}
            themeUnsungColor={THEMES[0].previewUnsung}
            aspectRatio="9:16"
          />
        );

        const stage = container.firstElementChild as HTMLElement;
        expect(stage.className).toContain('aspect-[9/16]');
        assertZeroHorizontalOverflow(container, 375);
      });
    });

    describe('Full Studio View via App Integration', () => {
      BREAKPOINTS.forEach((bp) => {
        it(`renders complete studio dashboard view with zero overflow at ${bp.name} (${bp.width}px)`, async () => {
          setTestViewport(bp.width, bp.height);
          window.history.pushState({}, '', '/?project=test-project-ready');
          mockApiResponse(readyProject);

          const { container } = render(<App />);

          await waitFor(() => {
            expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
          });

          assertZeroHorizontalOverflow(container, bp.width);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
            document.documentElement.clientWidth
          );
        });
      });
    });
  });
});

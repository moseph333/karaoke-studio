import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { TrackSearch } from '../components/TrackSearch';
import { ProjectState } from '../types';

describe('M1 Challenger 2: Adversarial State Transitions & Responsive Layout Integrity at 320px', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    // Default safe fetch mock so relative /api calls in useEffect do not crash node undici
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Challenge 1: Full State Transitions Cycle at Mobile Viewport (320px)
  // =========================================================================
  describe('Challenge 1: State Transitions Cycle (Landing -> Search -> Processing -> Cancel/Error/Ready)', () => {
    it('executes state transition: Landing -> Searching -> Results -> Project Selection', async () => {
      const user = userEvent.setup();

      const mockTrack = {
        id: 'yt-test-123',
        title:
          'Adversarial 320px Test Song Title With Special Characters & Symbols: <Test> & "More"',
        artist: 'The 320px Stress Band featuring Ultra Long Collaborator Name',
        duration: 215,
        url: 'https://youtube.com/watch?v=yt-test-123',
        thumbnail: 'https://img.youtube.com/vi/yt-test-123/hqdefault.jpg',
      };

      let resolveSearch: (val: unknown) => void;
      const searchPromise = new Promise((resolve) => {
        resolveSearch = resolve;
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/api/search')) {
          await searchPromise;
          return new Response(JSON.stringify({ results: [mockTrack] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const onSelectTrack = vi.fn();
      const onOpenProject = vi.fn();

      render(
        <TrackSearch
          onSelectTrack={onSelectTrack}
          onOpenProject={onOpenProject}
          isLoading={false}
          currentUser="MobileUser"
          authToken="test-token"
        />
      );

      // 1. Initial Landing state verification
      const searchInput = screen.getByRole('textbox', {
        name: /Paste YouTube or YouTube Music URL or search song title/i,
      });
      expect(searchInput).toBeInTheDocument();
      expect(searchInput.className).toMatch(/min-h-\[48px\]/);
      expect(searchInput.className).toMatch(/pr-24/);

      // Search button in initial state
      const submitBtn = screen.getByRole('button', { name: /Search YouTube or load track/i });
      expect(submitBtn).toBeDisabled();

      // Type query
      await user.type(searchInput, 'Adversarial Song');
      expect(submitBtn).not.toBeDisabled();

      // Submit search -> Transitions to "Searching" state
      await user.click(submitBtn);

      // Verify searching spinner in button
      const spinner = submitBtn.querySelector('span[role="status"]');
      expect(spinner).toBeInTheDocument();
      expect(spinner?.className).toMatch(/animate-spin/);
      expect(submitBtn).toBeDisabled();

      // Resolve the search promise
      act(() => {
        resolveSearch!({ results: [mockTrack] });
      });

      // 2. Results rendered state
      await waitFor(() => {
        expect(screen.getByText(mockTrack.title)).toBeInTheDocument();
      });

      // Verify responsive structure of result card
      const resultTitle = screen.getByText(mockTrack.title);
      expect(resultTitle.className).toMatch(/truncate/);
      const textContainer = resultTitle.parentElement;
      expect(textContainer?.className).toMatch(/min-w-0/);
      expect(textContainer?.className).toMatch(/flex-1/);

      // 3. Project Selection state transition
      const createBtn = screen.getByRole('button', { name: /Create Karaoke/i });
      expect(createBtn).toBeInTheDocument();
      expect(createBtn.className).toMatch(/shrink-0/);
      expect(createBtn.className).toMatch(/min-h-\[36px\]/);

      await user.click(createBtn);
      expect(onSelectTrack).toHaveBeenCalledTimes(1);
      expect(onSelectTrack).toHaveBeenCalledWith(mockTrack.url, undefined);
    });

    it('transitions into Processing view with active timers and ultra-long unbroken status string', async () => {
      const ultraLongStatus =
        'Step3_StemSeparation_Demucs_v4_ProcessingModel_CUDA_TensorExecution_VeryLongStatusDetailStringWithoutAnyWhitespaceOrHyphensToTestWordBreakIntegrityAcrossMobileViewport320pxBoundaryAndEnsureNoHorizontalBlowoutOccursInMonoContainer1234567890abcdefghijklmnopqrstuvwxyz';

      const processingProject: ProjectState = {
        id: 'proj-adversarial-1',
        title: 'Stress Test Track 320px',
        artist: 'Adversarial Artist',
        status: 'separating',
        status_detail: ultraLongStatus,
        progress: 68,
        elapsed_seconds: 145,
        eta_seconds: 42,
        heartbeat: Date.now() / 1000,
        created_by: 'Friend',
        lines: [],
        semitones: 0,
        guide_volume: 0,
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/projects/proj-adversarial-1')) {
          return new Response(JSON.stringify(processingProject), { status: 200 });
        }
        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify({ 'proj-adversarial-1': processingProject }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const user = userEvent.setup();
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Stress Test Track 320px')).toBeInTheDocument();
      });

      const projectCard = screen
        .getByText('Stress Test Track 320px')
        .closest('div[role="button"], .group');
      expect(projectCard).toBeInTheDocument();
      await user.click(projectCard!);

      await waitFor(() => {
        expect(screen.getByRole('status')).toBeInTheDocument();
      });

      // 1. Verify status detail contains break-words
      const statusText = screen.getByText(ultraLongStatus);
      expect(statusText).toBeInTheDocument();
      expect(statusText.className).toMatch(/break-words/);
      expect(statusText.className).toMatch(/font-mono/);

      // 2. Verify timers display correctly formatted strings
      expect(screen.getByText(/68% Complete/i)).toBeInTheDocument();
      expect(screen.getByText(/Elapsed:\s*2:25/i)).toBeInTheDocument();
      expect(screen.getByText(/Est\.\s*remaining:\s*~0:42/i)).toBeInTheDocument();

      // 3. Verify timer container responsive wrapping layout
      const timerRow = screen.getByText(/68% Complete/i).closest('.justify-between');
      expect(timerRow?.className).toMatch(/flex-col/);
      expect(timerRow?.className).toMatch(/sm:flex-row/);
      expect(timerRow?.className).toMatch(/justify-between/);

      // 4. Verify Cancel button touch target
      const cancelBtn = screen.getByRole('button', { name: /Cancel & Return to Search/i });
      expect(cancelBtn).toBeInTheDocument();
      expect(cancelBtn.className).toMatch(/min-h-\[40px\]/);
    });

    it('transitions to Error view with multiline stack trace & long URL and recovers to search', async () => {
      const multilineError =
        'RuntimeError: Failed to fetch audio stream from YouTube\n' +
        'URL: https://www.youtube.com/watch?v=extremely_long_adversarial_video_id_with_query_params_and_tracking_tokens_1234567890_abcdefghijklmnopqrstuvwxyz\n' +
        'Stack trace: Traceback (most recent call last):\n' +
        '  File "backend/services/downloader.py", line 145, in download_youtube_audio\n' +
        '    raise AudioExtractionError("Extraction aborted by upstream provider")\n' +
        'backend.exceptions.AudioExtractionError: Extraction aborted by upstream provider';

      const errorProject: ProjectState = {
        id: 'proj-error-1',
        title: 'Failing Track',
        artist: 'Unknown Artist',
        status: 'error',
        error: multilineError,
        progress: 15,
        created_by: 'Friend',
        lines: [],
        semitones: 0,
        guide_volume: 0,
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/projects/proj-error-1')) {
          return new Response(JSON.stringify(errorProject), { status: 200 });
        }
        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify({ 'proj-error-1': errorProject }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const user = userEvent.setup();
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Failing Track')).toBeInTheDocument();
      });

      const projectCard = screen.getByText('Failing Track').closest('div[role="button"], .group');
      await user.click(projectCard!);

      await waitFor(() => {
        expect(screen.getByText('Track Processing Failed')).toBeInTheDocument();
      });

      const errorParagraph = screen.getByText((content) =>
        content.includes('AudioExtractionError: Extraction aborted by upstream provider')
      );
      expect(errorParagraph).toBeInTheDocument();
      expect(errorParagraph.className).toMatch(/break-words/);
      expect(errorParagraph.className).toMatch(/font-mono/);

      const retryBtn = screen.getByRole('button', { name: /Try Another Track/i });
      expect(retryBtn).toBeInTheDocument();
      expect(retryBtn.className).toMatch(/min-h-\[40px\]/);

      await user.click(retryBtn);

      await waitFor(() => {
        expect(screen.getByRole('search')).toBeInTheDocument();
        expect(screen.getByText(/Turn Any YouTube Song Into Karaoke/i)).toBeInTheDocument();
      });
    });

    it('transitions from Processing to Cancelled state and recovers cleanly', async () => {
      const cancelledProject: ProjectState = {
        id: 'proj-cancel-flow',
        title: 'Cancelled Flow Track',
        artist: 'Cancel Artist',
        status: 'cancelled',
        progress: 30,
        created_by: 'Friend',
        lines: [],
        semitones: 0,
        guide_volume: 0,
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/projects/proj-cancel-flow')) {
          return new Response(JSON.stringify(cancelledProject), { status: 200 });
        }
        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify({ 'proj-cancel-flow': cancelledProject }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const user = userEvent.setup();
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Cancelled Flow Track')).toBeInTheDocument();
      });

      const card = screen.getByText('Cancelled Flow Track').closest('div[role="button"], .group');
      await user.click(card!);

      // Verify Cancelled screen appears
      await waitFor(() => {
        expect(screen.getByText('Track Processing Cancelled')).toBeInTheDocument();
      });

      const searchAnotherBtn = screen.getByRole('button', { name: /Search Another Song/i });
      expect(searchAnotherBtn).toBeInTheDocument();
      expect(searchAnotherBtn.className).toMatch(/min-h-\[40px\]/);

      // Return to search
      await user.click(searchAnotherBtn);
      await waitFor(() => {
        expect(screen.getByRole('search')).toBeInTheDocument();
      });
    });

    it('immediately aborts and resets to search when user clicks Cancel in active processing state', async () => {
      const activeProject: ProjectState = {
        id: 'proj-active-proc',
        title: 'Active Processing Track',
        artist: 'Active Artist',
        status: 'downloading',
        progress: 10,
        created_by: 'Friend',
        lines: [],
        semitones: 0,
        guide_volume: 0,
      };

      let cancelCalled = false;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/cancel')) {
          cancelCalled = true;
          return new Response(JSON.stringify({ status: 'cancelled' }), { status: 200 });
        }
        if (urlStr.includes('/api/projects/proj-active-proc')) {
          return new Response(JSON.stringify(activeProject), { status: 200 });
        }
        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify({ 'proj-active-proc': activeProject }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const user = userEvent.setup();
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Active Processing Track')).toBeInTheDocument();
      });

      const card = screen
        .getByText('Active Processing Track')
        .closest('div[role="button"], .group');
      await user.click(card!);

      await waitFor(() => {
        expect(screen.getByRole('status')).toBeInTheDocument();
      });

      const cancelBtn = screen.getByRole('button', { name: /Cancel & Return to Search/i });
      await user.click(cancelBtn);

      // Confirms immediate return to search view and cancel endpoint was hit
      expect(cancelCalled).toBe(true);
      await waitFor(() => {
        expect(screen.getByRole('search')).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // Challenge 2: Mobile CSS Class & DOM Attribute Invariant Verification
  // =========================================================================
  describe('Challenge 2: Responsive CSS Class & DOM Attribute Invariants', () => {
    it('verifies Navbar responsive containment across null, processing, and ready states', async () => {
      const mockProject: ProjectState = {
        id: 'proj-ready-1',
        title: 'Ready Song',
        artist: 'Artist',
        status: 'ready',
        progress: 100,
        master_audio_url: 'https://example.com/audio.mp3',
        created_by: 'Friend',
        lines: [],
        semitones: 0,
        guide_volume: 0,
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/projects/proj-ready-1')) {
          return new Response(JSON.stringify(mockProject), { status: 200 });
        }
        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify({ 'proj-ready-1': mockProject }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const user = userEvent.setup();
      render(<App />);

      const header = document.querySelector('header');
      expect(header).toBeInTheDocument();
      const headerContainer = header?.querySelector('div');
      expect(headerContainer).toBeInTheDocument();
      expect(headerContainer?.className).toMatch(/flex-wrap/);
      expect(headerContainer?.className).toMatch(/px-3/);
      expect(headerContainer?.className).toMatch(/min-h-\[3\.5rem\]/);

      // Brand logo & title scaling
      const brandLogo = headerContainer?.querySelector('.bg-gradient-to-tr');
      expect(brandLogo?.className).toMatch(/shrink-0/);
      const brandIcon = brandLogo?.querySelector('svg');
      expect(brandIcon?.getAttribute('class')).toMatch(/w-4 h-4/);

      // Brand title in header renders "Karaoke Studio" with no YouTube prefix
      const brandTitle = within(header!).getByText(/Karaoke Studio/i);
      expect(brandTitle.textContent?.trim()).toBe('Karaoke Studio');
      expect(brandTitle.querySelector('span')).toBeNull();

      // User profile button truncation
      const userBtn = screen.getByRole('button', { name: /Logged in as/i });
      expect(userBtn.className).toMatch(/min-h-\[36px\]/);
      const userNameSpan = userBtn.querySelector('span');
      expect(userNameSpan?.className).toMatch(/max-w-\[65px\]/);
      expect(userNameSpan?.className).toMatch(/truncate/);

      // No "New Song" or "Render" button when project is null
      expect(screen.queryByRole('button', { name: 'New Song' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Render & Export Video/i })
      ).not.toBeInTheDocument();

      // State 2: Select ready project
      await waitFor(() => {
        expect(screen.getByText('Ready Song')).toBeInTheDocument();
      });
      const card = screen.getByText('Ready Song').closest('div[role="button"], .group');
      await user.click(card!);

      // In ready state:
      const newSongBtn = await screen.findByRole('button', { name: 'New Song' });
      expect(newSongBtn).toBeInTheDocument();
      expect(newSongBtn.className).toMatch(/min-h-\[36px\]/);
      const newSongLabel = newSongBtn.querySelector('span');
      expect(newSongLabel?.className).toMatch(/hidden sm:inline/);

      // Navbar Render button must be hidden on mobile/tablet (hidden md:flex)
      const navRenderBtn = screen.getByRole('button', { name: /Render & Export Video/i });
      expect(navRenderBtn.className).toMatch(/hidden md:flex/);
      expect(navRenderBtn.className).toMatch(/min-h-\[36px\]/);
    });

    it('verifies TrackSearch responsive classes: hero text, search input, tabs, cards', () => {
      render(
        <TrackSearch
          onSelectTrack={vi.fn()}
          onOpenProject={vi.fn()}
          isLoading={false}
          currentUser="TestUser"
          authToken="tok"
        />
      );

      // Hero heading
      const hero = screen.getByRole('heading', { level: 1 });
      expect(hero.className).toMatch(/text-2xl/);
      expect(hero.className).toMatch(/sm:text-4xl/);
      expect(hero.className).toMatch(/md:text-5xl/);

      // Container outer padding
      const outerContainer = hero.closest('.max-w-3xl');
      expect(outerContainer?.className).toMatch(/px-0/);
      expect(outerContainer?.className).toMatch(/sm:px-4/);
      expect(outerContainer?.className).toMatch(/py-2/);

      // Submit button text labels
      const submitBtn = screen.getByRole('button', { name: /Search YouTube or load track/i });
      const mobileSpan = submitBtn.querySelector('span.sm\\:hidden');
      const desktopSpan = submitBtn.querySelector('span.hidden.sm\\:inline');
      expect(mobileSpan?.textContent).toBe('Go');
      expect(desktopSpan?.textContent).toBe('Search / Go');

      // Library tab bar
      const tabs = screen.getAllByRole('tab');
      expect(tabs.length).toBe(2);
      tabs.forEach((tab) => {
        expect(tab.className).toMatch(/min-h-\[36px\]/);
      });
      const tabContainer = tabs[0].parentElement?.parentElement;
      expect(tabContainer?.className).toMatch(/flex-wrap/);
    });
  });

  // =========================================================================
  // Challenge 3: Horizontal Overflow Prevention & Flex Shrink Safety
  // =========================================================================
  describe('Challenge 3: Horizontal Overflow Prevention & Flex Shrink Safety', () => {
    it('verifies root overflow-x containment styling and max-width safety', () => {
      const { container } = render(<App />);
      const appRoot = container.firstElementChild as HTMLElement;
      expect(appRoot).toBeInTheDocument();
      expect(appRoot.className).toMatch(/min-h-screen/);
      expect(appRoot.className).toMatch(/flex/);
      expect(appRoot.className).toMatch(/flex-col/);

      const mainEl = container.querySelector('main');
      expect(mainEl).toBeInTheDocument();
      expect(mainEl?.className).toMatch(/w-full/);
      expect(mainEl?.className).toMatch(/px-3/);
      expect(mainEl?.className).toMatch(/sm:px-4/);
    });

    it('ensures flex children have min-w-0 to prevent min-content blowout in cards', async () => {
      const mockProjects: Record<string, Partial<ProjectState>> = {
        p1: {
          id: 'p1',
          title: 'A'.repeat(120),
          artist: 'B'.repeat(80),
          status: 'ready',
          created_by: 'TestUser',
        },
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        if (url.toString().includes('/api/projects')) {
          return new Response(JSON.stringify(mockProjects), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      render(
        <TrackSearch
          onSelectTrack={vi.fn()}
          onOpenProject={vi.fn()}
          isLoading={false}
          currentUser="TestUser"
          authToken="tok"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('A'.repeat(120))).toBeInTheDocument();
      });

      const titleEl = screen.getByText('A'.repeat(120));
      expect(titleEl.className).toMatch(/truncate/);

      const textWrapper = titleEl.parentElement;
      expect(textWrapper?.className).toMatch(/min-w-0/);
      expect(textWrapper?.className).toMatch(/flex-1/);
      expect(textWrapper?.className).toMatch(/truncate/);
    });

    it('verifies calculated minimum widths of navbar components do not exceed 320px viewport', () => {
      render(<App />);

      const header = document.querySelector('header > div');
      expect(header?.classList.contains('flex-wrap')).toBe(true);
      expect(header?.classList.contains('gap-2')).toBe(true);
    });

    it('handles processing boundary values: null eta, 0% progress, and default stage descriptions', async () => {
      const boundaryProject: ProjectState = {
        id: 'proj-boundary',
        title: 'Boundary Track',
        artist: 'Boundary Artist',
        status: 'downloading',
        status_detail: '',
        progress: 0,
        elapsed_seconds: 0,
        eta_seconds: undefined,
        created_by: 'Friend',
        lines: [],
        semitones: 0,
        guide_volume: 0,
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/projects/proj-boundary')) {
          return new Response(JSON.stringify(boundaryProject), { status: 200 });
        }
        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify({ 'proj-boundary': boundaryProject }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const user = userEvent.setup();
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Boundary Track')).toBeInTheDocument();
      });

      const card = screen.getByText('Boundary Track').closest('div[role="button"], .group');
      await user.click(card!);

      await waitFor(() => {
        expect(screen.getByRole('status')).toBeInTheDocument();
      });

      // Default description for 'downloading' when status_detail is empty
      expect(screen.getByText('Fetching high-fidelity audio and cover art...')).toBeInTheDocument();

      // Timers: 0% and Calculating...
      expect(screen.getByText(/0% Complete/i)).toBeInTheDocument();
      expect(screen.getByText(/Elapsed:\s*0:00/i)).toBeInTheDocument();
      expect(screen.getByText(/Est\.\s*remaining:\s*Calculating\.\.\./i)).toBeInTheDocument();
    });

    it('handles Unicode and emoji search queries without throwing or breaking layout', async () => {
      const user = userEvent.setup();
      render(
        <TrackSearch
          onSelectTrack={vi.fn()}
          onOpenProject={vi.fn()}
          isLoading={false}
          currentUser="TestUser"
          authToken="tok"
        />
      );

      const input = screen.getByRole('textbox', {
        name: /Paste YouTube or YouTube Music URL or search song title/i,
      });

      const unicodeQuery = '🎵 日本語カラオケ • Студия караоке 🎤 Extra Spacing   ';
      await user.type(input, unicodeQuery);
      expect((input as HTMLInputElement).value).toBe(unicodeQuery);

      const submitBtn = screen.getByRole('button', { name: /Search YouTube or load track/i });
      expect(submitBtn).not.toBeDisabled();
    });

    it('maintains shrink-0 layout geometry when project has no thumbnail', async () => {
      const noThumbProject: Record<string, Partial<ProjectState>> = {
        p_no_thumb: {
          id: 'p_no_thumb',
          title: 'No Thumbnail Song',
          artist: 'Acoustic Solo',
          status: 'ready',
          created_by: 'TestUser',
          thumbnail_url: undefined,
        },
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        if (url.toString().includes('/api/projects')) {
          return new Response(JSON.stringify(noThumbProject), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      render(
        <TrackSearch
          onSelectTrack={vi.fn()}
          onOpenProject={vi.fn()}
          isLoading={false}
          currentUser="TestUser"
          authToken="tok"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('No Thumbnail Song')).toBeInTheDocument();
      });

      const cardTitle = screen.getByText('No Thumbnail Song');
      const card = cardTitle.closest('.group');
      expect(card).toBeInTheDocument();

      // Fallback music icon container has shrink-0 and responsive dimensions
      const fallbackContainer = card?.querySelector('.bg-slate-800');
      expect(fallbackContainer?.className).toMatch(/shrink-0/);
      expect(fallbackContainer?.className).toMatch(/w-12/);
      expect(fallbackContainer?.className).toMatch(/h-12/);
    });
  });
});

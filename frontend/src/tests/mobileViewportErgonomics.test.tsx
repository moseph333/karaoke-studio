import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { expectTouchTarget } from './helpers/responsiveTestUtils';
import { TrackSearch } from '../components/TrackSearch';
import { ProjectState } from '../types';
import { setAuthUser } from '../api';

describe('Milestone 1 Empirical Challenger Suite (Responsive Layout & Mobile Usability)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  // Helper to mock project list fetch
  const mockProjectsResponse = (projects: Record<string, unknown> = {}) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/projects')) {
        return new Response(JSON.stringify(projects), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/api/project/')) {
        const id = urlStr.split('/api/project/')[1]?.split('?')[0];
        const proj = projects[id];
        if (proj) {
          return new Response(JSON.stringify(proj), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      if (urlStr.includes('/api/auth/status')) {
        return new Response(JSON.stringify({ auth_required: false }), {
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

  describe('Focus Area 1: Viewport Geometry Stress at 320px & Long Text Truncation', () => {
    it('truncates 50-character user nicknames in the Navbar without overflowing', async () => {
      const ultraLongNickname = 'SupercalifragilisticexpialidociousUserWithExtraLongName12345';
      setAuthUser(ultraLongNickname);
      mockProjectsResponse({});

      render(<App />);

      // Find the user profile button
      const profileButton = screen.getByRole('button', {
        name: new RegExp(`Logged in as ${ultraLongNickname}`, 'i'),
      });
      expect(profileButton).toBeInTheDocument();

      // The nickname collapses to the avatar on phones and truncates from sm upwards
      const nameSpan = Array.from(profileButton.querySelectorAll('span')).find(
        (el) => el.textContent === ultraLongNickname
      );
      expect(nameSpan).toBeInTheDocument();
      expect(nameSpan?.className).toMatch(/(^|\s)hidden(\s|$)/);
      expect(nameSpan?.className).toMatch(/sm:inline/);
      expect(nameSpan?.className).toMatch(/max-w-\[\d+px\]/);
      expect(nameSpan?.className).toMatch(/truncate/);

      // Verify touch target size
      expectTouchTarget(profileButton);

      // Verify top brand: renders "Karaoke Studio" directly across all viewports
      const header = screen.getByRole('banner');
      const brandHeading = within(header).getByText(/Karaoke Studio/i);
      expect(brandHeading).toBeInTheDocument();
      expect(brandHeading.textContent?.trim()).toBe('Karaoke Studio');
      expect(brandHeading.querySelector('span')).toBeNull();
    });

    it('truncates 150-character song titles and artists in Search Results using min-w-0 flex-1', async () => {
      const longTitle =
        'This Is An Exceptionally Long Song Title Designed To Test CSS Flexbox Boundary Conditions And Truncation In Search Results Without Breaking Row Width 1234567890';
      const longArtist =
        'Extraordinary Orchestra Featuring Multiple Collaborative Vocalists And Instrumental Performers Across Global Continents';

      const mockTrack = {
        id: 'yt-long-1',
        title: longTitle,
        artist: longArtist,
        duration: 300,
        url: 'https://youtube.com/watch?v=yt-long-1',
      };

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/search')) {
          return new Response(JSON.stringify({ results: [mockTrack] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      const user = userEvent.setup();
      render(
        <TrackSearch
          onSelectTrack={vi.fn()}
          onOpenProject={vi.fn()}
          isLoading={false}
          currentUser="TestSinger"
          authToken="token-123"
        />
      );

      const input = screen.getByPlaceholderText(/Paste YouTube.*or search.*title/i);
      await user.type(input, 'Long Title Song');
      const searchButton = screen.getByRole('button', { name: /Search.*(YouTube|Go)/i });
      await user.click(searchButton);

      await waitFor(() => {
        expect(screen.getByText(longTitle)).toBeInTheDocument();
      });

      const titleHeading = screen.getByText(longTitle);
      // Verify h4 has truncate
      expect(titleHeading.className).toMatch(/truncate/);

      // Verify its immediate text container has truncate, flex-1, min-w-0
      const textContainer = titleHeading.parentElement;
      expect(textContainer?.className).toMatch(/truncate/);
      expect(textContainer?.className).toMatch(/flex-1/);
      expect(textContainer?.className).toMatch(/min-w-0/);

      // Verify the parent flex item also enforces min-w-0 flex-1
      const flexWrapper = textContainer?.parentElement;
      expect(flexWrapper?.className).toMatch(/min-w-0/);
      expect(flexWrapper?.className).toMatch(/flex-1/);

      // Verify Create button is shrink-0 to prevent button squishing
      const createButton = screen.getByRole('button', { name: /Create Karaoke/i });
      expect(createButton.className).toMatch(/shrink-0/);
      expect(createButton.className).toMatch(/min-h-\[36px\]/);
    });

    it('truncates 150-character titles in Recent Project Cards using min-w-0 flex-1', async () => {
      const longProjectTitle =
        'Massive Symphonic Masterpiece With An Outrageously Long Project Title That Extends Past Any Mobile Viewport Boundary In Recent Projects';
      const longArtist = 'The Overly Verbose Ensemble Band';

      const mockProjects: Record<string, Partial<ProjectState>> = {
        'proj-long-1': {
          id: 'proj-long-1',
          title: longProjectTitle,
          artist: longArtist,
          status: 'ready',
          created_by: 'TestSinger',
          thumbnail_url: 'https://example.com/thumb.jpg',
        },
      };

      mockProjectsResponse(mockProjects);

      render(
        <TrackSearch
          onSelectTrack={vi.fn()}
          onOpenProject={vi.fn()}
          isLoading={false}
          currentUser="TestSinger"
          authToken="token-123"
        />
      );

      await waitFor(() => {
        expect(screen.getByText(longProjectTitle)).toBeInTheDocument();
      });

      // The title is the card's keyboard-reachable open button and truncates in place
      const cardTitle = screen.getByText(longProjectTitle);
      expect(cardTitle.tagName).toBe('BUTTON');
      expect(cardTitle.className).toMatch(/truncate/);
      expect(cardTitle.className).toMatch(/max-w-full/);

      const heading = cardTitle.parentElement;
      expect(heading?.tagName).toBe('H4');
      expect(heading?.className).toMatch(/truncate/);
      expect(heading?.parentElement?.className).toMatch(/min-w-0/);

      // Album art fills a fixed square so long text never stretches the card
      const card = cardTitle.closest('.group');
      expect(card).toBeInTheDocument();
      const thumbnail = card?.querySelector('img');
      expect(thumbnail?.className).toMatch(/object-cover/);
      expect(thumbnail?.parentElement?.className).toMatch(/aspect-square/);

      // Card actions keep 44px touch targets
      expectTouchTarget(
        screen.getByRole('button', { name: `Edit metadata for ${longProjectTitle}` })
      );
      expectTouchTarget(screen.getByRole('button', { name: `Delete project ${longProjectTitle}` }));
    });

    it('prevents horizontal blowout in Processing & Error views with break-words and responsive timers', async () => {
      const unbrokenStatus = 'A'.repeat(200);

      const processingProject: ProjectState = {
        id: 'proj-proc-1',
        title: 'Processing Track',
        artist: 'Artist',
        status: 'separating',
        status_detail: unbrokenStatus,
        progress: 42,
        elapsed_seconds: 125,
        eta_seconds: 65,
        semitones: 0,
        guide_volume: 0,
        lines: [],
      };

      window.history.pushState({}, '', '?project=proj-proc-1');

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/project/proj-proc-1')) {
          return new Response(JSON.stringify(processingProject), { status: 200 });
        }
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByRole('status')).toBeInTheDocument();
      });

      // The detail sits next to the live region (only the stage heading is announced)
      const statusDetail = screen.getByText(unbrokenStatus);
      expect(statusDetail.tagName).toBe('P');
      expect(statusDetail).toBeInTheDocument();
      expect(statusDetail?.textContent).toBe(unbrokenStatus);
      expect(statusDetail?.className).toMatch(/break-words/);

      // Verify timers row has responsive wrap classes (outside the live region)
      const timersRow = screen.getByText(/% Complete/i).closest('.justify-between');
      expect(timersRow).toBeInTheDocument();
      expect(timersRow?.className).toMatch(/flex-col/);
      expect(timersRow?.className).toMatch(/sm:flex-row/);

      // Verify cancel button has min-h-[40px] touch target
      const cancelBtn = screen.getByRole('button', { name: /Cancel & Return to Search/i });
      expect(cancelBtn.className).toMatch(/min-h-\[40px\]/);
    });

    it('hides the redundant 186px Navbar Render Video button on mobile screens (<768px)', async () => {
      const readyProject: ProjectState = {
        id: 'proj-ready-1',
        title: 'Ready Song',
        artist: 'Ready Artist',
        status: 'ready',
        progress: 100,
        semitones: 0,
        guide_volume: 0,
        lines: [],
      };

      window.history.pushState({}, '', '?project=proj-ready-1');

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/project/proj-ready-1')) {
          return new Response(JSON.stringify(readyProject), { status: 200 });
        }
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 200 });
      });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /New Song/i })).toBeInTheDocument();
      });

      // A single Export entry point that stays available (icon-only) on phones
      const navbar = screen.getByRole('banner');
      const exportBtn = within(navbar).getByRole('button', { name: 'Open export dialog' });
      expectTouchTarget(exportBtn);
      expect(exportBtn.className).not.toMatch(/(^|\s)hidden(\s|$)/);
      expect(exportBtn.querySelector('span')?.className).toMatch(/hidden sm:inline/);

      // Verify "New Song" button has a responsive label and a compliant touch target
      const newSongBtn = within(navbar).getByRole('button', { name: /New Song/i });
      expectTouchTarget(newSongBtn);
      expect(newSongBtn.className).toMatch(/md:min-h-\[36px\]/);
      const newSongSpan = newSongBtn.querySelector('span');
      expect(newSongSpan?.className).toMatch(/hidden sm:inline/);
    });
  });

  describe('Focus Area 2: Search Input & Submit Button Interactions (320px & 375px)', () => {
    it('affords at least 40px clearance so typed text never scrolls behind the submit button', async () => {
      render(
        <TrackSearch
          onSelectTrack={vi.fn()}
          onOpenProject={vi.fn()}
          isLoading={false}
          currentUser="TestSinger"
          authToken="token-123"
        />
      );

      const input = screen.getByPlaceholderText(/Paste YouTube.*or search.*title/i);
      const submitButton = screen.getByRole('button', { name: /Search.*(YouTube|Go)/i });

      // Verify input padding right
      expect(input.className).toMatch(/pr-24/); // pr-24 is 6rem = 96px
      expect(input.className).toMatch(/sm:pr-32/); // sm:pr-32 is 8rem = 128px

      // Verify submit button positioning
      expect(submitButton.className).toMatch(/absolute/);
      expect(submitButton.className).toMatch(/right-1\.5/); // right-1.5 is 6px offset
      expect(submitButton.className).toMatch(/min-h-\[36px\]/);

      // Verify responsive label: "Go" on mobile, "Search / Go" on sm+
      const mobileSpan = submitButton.querySelector('.sm\\:hidden');
      expect(mobileSpan?.textContent).toBe('Go');
      const desktopSpan = submitButton.querySelector('.hidden.sm\\:inline');
      expect(desktopSpan?.textContent).toBe('Search / Go');
    });

    it('disables submit button and blocks submission on empty or whitespace-only queries', async () => {
      const user = userEvent.setup();
      const mockSelect = vi.fn();

      render(
        <TrackSearch
          onSelectTrack={mockSelect}
          onOpenProject={vi.fn()}
          isLoading={false}
          currentUser="TestSinger"
          authToken="token-123"
        />
      );

      const input = screen.getByPlaceholderText(/Paste YouTube.*or search.*title/i);
      const submitButton = screen.getByRole('button', { name: /Search.*(YouTube|Go)/i });

      // 1. Initial empty state: button is disabled
      expect(submitButton).toBeDisabled();

      // 2. Whitespace-only string: button remains disabled
      await user.type(input, '     ');
      expect(submitButton).toBeDisabled();

      // Form submission with whitespace does not trigger onSelectTrack
      fireEvent.submit(submitButton.closest('form')!);
      expect(mockSelect).not.toHaveBeenCalled();

      // 3. Valid non-empty text immediately enables the button
      await user.clear(input);
      await user.type(input, 'Adele Rolling in the Deep');
      expect(submitButton).not.toBeDisabled();
    });
  });

  describe('Focus Area 3: Library Tabs on Narrow Screens (320px)', () => {
    it('wraps library tabs cleanly and displays large counts (150+ / 500+) without clipping', async () => {
      const mockMyProjects: Record<string, Partial<ProjectState>> = {};
      for (let i = 1; i <= 150; i++) {
        mockMyProjects[`proj-my-${i}`] = {
          id: `proj-my-${i}`,
          title: `My Song #${i}`,
          created_by: 'TestSinger',
          status: 'ready',
        };
      }
      for (let i = 1; i <= 350; i++) {
        mockMyProjects[`proj-comm-${i}`] = {
          id: `proj-comm-${i}`,
          title: `Community Song #${i}`,
          created_by: 'OtherArtist',
          status: 'ready',
        };
      }

      mockProjectsResponse(mockMyProjects);

      render(
        <TrackSearch
          onSelectTrack={vi.fn()}
          onOpenProject={vi.fn()}
          isLoading={false}
          currentUser="TestSinger"
          authToken="token-123"
        />
      );

      // Verify tabs have accessible roles and correct counts
      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /My Songs \(150\)/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Library \(500\)/i })).toBeInTheDocument();
      });

      const myTab = screen.getByRole('tab', { name: /My Songs \(150\)/i });
      const commTab = screen.getByRole('tab', { name: /Library \(500\)/i });

      // Verify tab container has flex-wrap to prevent horizontal blowout
      const tablist = myTab.closest('[role="tablist"]');
      expect(tablist).toBeInTheDocument();
      expect(tablist?.className).toMatch(/flex-wrap/);
      expect(tablist?.className).toMatch(/gap-1\.5/);

      // Verify tab buttons have min-h-[36px] for touch usability
      expect(myTab.className).toMatch(/min-h-\[36px\]/);
      expect(commTab.className).toMatch(/min-h-\[36px\]/);

      // Verify tab switching works under large counts
      const user = userEvent.setup();
      await user.click(commTab);
      expect(commTab).toHaveAttribute('aria-selected', 'true');
      expect(myTab).toHaveAttribute('aria-selected', 'false');
    });
  });

  describe('Focus Area 4: Touch Hit Target & Accessibility Standards', () => {
    it('verifies touch target heights across all primary interactive controls', async () => {
      mockProjectsResponse({
        'sample-1': {
          id: 'sample-1',
          title: 'Sample Track',
          status: 'ready',
          created_by: 'TestSinger',
        },
      });

      render(
        <TrackSearch
          onSelectTrack={vi.fn()}
          onOpenProject={vi.fn()}
          isLoading={false}
          currentUser="TestSinger"
          authToken="token-123"
        />
      );

      // 1. Search input meets >= 48px height
      const input = screen.getByPlaceholderText(/Paste YouTube.*or search.*title/i);
      expect(input.className).toMatch(/min-h-\[48px\]/);

      // 2. Submit button meets >= 36px on mobile, >= 44px on sm+
      const submitButton = screen.getByRole('button', { name: /Search.*(YouTube|Go)/i });
      expect(submitButton.className).toMatch(/min-h-\[36px\]/);
      expect(submitButton.className).toMatch(/sm:min-h-\[44px\]/);

      // 3. Tab buttons meet >= 36px
      const myTab = screen.getByRole('tab', { name: /My Songs/i });
      expect(myTab.className).toMatch(/min-h-\[36px\]/);

      // 4. Refresh button meets >= 36px
      const refreshBtn = screen.getByRole('button', { name: /Refresh/i });
      expect(refreshBtn.className).toMatch(/min-h-\[36px\]/);

      // 5. Project card actions meet >= 44px
      await waitFor(() => {
        expect(screen.getByText('Sample Track')).toBeInTheDocument();
      });
      expectTouchTarget(screen.getByRole('button', { name: 'Edit metadata for Sample Track' }));
      expectTouchTarget(screen.getByRole('button', { name: 'Delete project Sample Track' }));
    });
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { TrackSearch } from '../components/TrackSearch';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { EditMetadataModal } from '../components/EditMetadataModal';
import { ProjectState } from '../types';
import {
  BREAKPOINTS,
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
} from './responsiveTestUtils';

describe('Milestone 1 Challenger 2: Adversarial Frontend Controls & Stress Harness', () => {
  const mockProject: ProjectState = {
    id: 'proj-adv-100',
    title: 'Adversarial Test Track',
    artist: 'Stress Testing Artist',
    status: 'ready',
    progress: 100,
    created_by: 'Tester',
    lines: [
      {
        id: 1,
        text: 'Initial line for testing dirty states',
        start_time: 1.0,
        end_time: 3.5,
        words: [{ word: 'Initial', start_time: 1.0, end_time: 2.0 }],
      },
    ],
    semitones: 0,
    guide_volume: 0,
    master_audio_url: '/audio/test.mp3',
    instrumental_url: '/audio/test_inst.mp3',
    vocals_url: '/audio/test_vocals.mp3',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    resetTestViewport();
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  // =========================================================================
  // Challenge 1: Event Bubbling Stress Test
  // =========================================================================
  describe('Challenge 1: Event Bubbling Stress on Project Cards', () => {
    it('never triggers onOpenProject when clicking Edit button or its nested SVG/paths', async () => {
      const user = userEvent.setup();
      const onOpenProject = vi.fn();
      const onSelectTrack = vi.fn();

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        if (url.toString().includes('/api/projects')) {
          return new Response(JSON.stringify({ [mockProject.id]: mockProject }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <TrackSearch
          onSelectTrack={onSelectTrack}
          onOpenProject={onOpenProject}
          isLoading={false}
          currentUser="Tester"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Adversarial Test Track')).toBeInTheDocument();
      });

      const editBtn = screen.getByRole('button', {
        name: /Edit metadata for Adversarial Test Track/i,
      });

      // 1. Direct button click
      await user.click(editBtn);
      expect(onOpenProject).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: /Edit Track Details/i })).toBeInTheDocument();

      // Dismiss modal
      await user.click(screen.getByRole('button', { name: /Cancel/i }));

      // 2. Click specifically on the SVG icon inside the button
      const svgIcon = editBtn.querySelector('svg');
      expect(svgIcon).toBeInTheDocument();
      if (svgIcon) {
        fireEvent.click(svgIcon);
        expect(onOpenProject).not.toHaveBeenCalled();
        expect(screen.getByRole('heading', { name: /Edit Track Details/i })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /Cancel/i }));
      }

      // 3. Click path element inside the SVG
      const pathEl = editBtn.querySelector('path');
      if (pathEl) {
        fireEvent.click(pathEl);
        expect(onOpenProject).not.toHaveBeenCalled();
        expect(screen.getByRole('heading', { name: /Edit Track Details/i })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /Cancel/i }));
      }

      expect(onOpenProject).toHaveBeenCalledTimes(0);
    });

    it('never triggers onOpenProject when clicking Delete button or its nested SVG/paths', async () => {
      const user = userEvent.setup();
      const onOpenProject = vi.fn();

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        if (url.toString().includes('/api/projects')) {
          return new Response(JSON.stringify({ [mockProject.id]: mockProject }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200 });
      });

      render(
        <TrackSearch
          onSelectTrack={vi.fn()}
          onOpenProject={onOpenProject}
          isLoading={false}
          currentUser="Tester"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Adversarial Test Track')).toBeInTheDocument();
      });

      const deleteBtn = screen.getByRole('button', {
        name: /Delete project Adversarial Test Track/i,
      });

      // 1. Direct button click
      await user.click(deleteBtn);
      expect(onOpenProject).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: /Delete Project\?/i })).toBeInTheDocument();

      // Dismiss modal
      await user.click(screen.getByRole('button', { name: /Cancel/i }));

      // 2. Click specifically on SVG icon
      const svgIcon = deleteBtn.querySelector('svg');
      expect(svgIcon).toBeInTheDocument();
      if (svgIcon) {
        fireEvent.click(svgIcon);
        expect(onOpenProject).not.toHaveBeenCalled();
        expect(screen.getByRole('heading', { name: /Delete Project\?/i })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /Cancel/i }));
      }

      expect(onOpenProject).toHaveBeenCalledTimes(0);
    });
  });

  // =========================================================================
  // Challenge 2: Rapid Clicking & Race Conditions
  // =========================================================================
  describe('Challenge 2: Rapid Clicking & Multiple Submission Prevention', () => {
    it('prevents multiple simultaneous DELETE requests when Delete button is clicked rapidly', async () => {
      let resolveDeletePromise: (val: unknown) => void;
      const deletePromise = new Promise((resolve) => {
        resolveDeletePromise = resolve;
      });

      let deleteCallCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = url.toString();
          const method = init?.method || 'GET';
          if (urlStr.includes('/api/project/proj-adv-100') && method === 'DELETE') {
            deleteCallCount++;
            await deletePromise;
            return new Response(JSON.stringify({ status: 'deleted', project_id: 'proj-adv-100' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response('{}', { status: 200 });
        }
      );

      const onDeleted = vi.fn();
      const onClose = vi.fn();

      render(
        <DeleteConfirmModal
          isOpen={true}
          projectId="proj-adv-100"
          projectTitle="Adversarial Track"
          onClose={onClose}
          onDeleted={onDeleted}
        />
      );

      const confirmBtn = screen.getByRole('button', { name: /^Delete Project$/i });

      // First click triggers loading state
      fireEvent.click(confirmBtn);

      // Rapidly fire multiple clicks while in flight
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn);

      // Verify button is disabled during in-flight deletion
      expect(confirmBtn).toBeDisabled();
      expect(screen.getByText('Deleting...')).toBeInTheDocument();

      // Resolve in-flight request
      await act(async () => {
        resolveDeletePromise!({});
      });

      await waitFor(() => {
        expect(onDeleted).toHaveBeenCalledWith('proj-adv-100');
        expect(onClose).toHaveBeenCalled();
      });

      // Assert only 1 delete API call was ever dispatched despite multiple rapid clicks
      expect(deleteCallCount).toBe(1);
    });

    it('prevents multiple simultaneous PATCH requests when Save Changes is clicked rapidly', async () => {
      let resolvePatchPromise: (val: unknown) => void;
      const patchPromise = new Promise((resolve) => {
        resolvePatchPromise = resolve;
      });

      let patchCallCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = url.toString();
          const method = init?.method || 'GET';
          if (urlStr.includes('/api/project/proj-adv-100') && method === 'PATCH') {
            patchCallCount++;
            await patchPromise;
            return new Response(
              JSON.stringify({
                id: 'proj-adv-100',
                title: 'Updated Title',
                artist: 'Updated Artist',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          return new Response('{}', { status: 200 });
        }
      );

      const onSaved = vi.fn();
      const onClose = vi.fn();

      render(
        <EditMetadataModal
          isOpen={true}
          project={{
            id: 'proj-adv-100',
            title: 'Initial Title',
            artist: 'Initial Artist',
          }}
          onClose={onClose}
          onSaved={onSaved}
        />
      );

      const saveBtn = screen.getByRole('button', { name: /Save Changes/i });

      // First click
      fireEvent.click(saveBtn);

      // Rapidly fire subsequent clicks
      fireEvent.click(saveBtn);
      fireEvent.click(saveBtn);
      fireEvent.click(saveBtn);

      // Verify button is disabled and in loading state
      expect(saveBtn).toBeDisabled();
      expect(screen.getByText('Saving...')).toBeInTheDocument();

      // Resolve in-flight request
      await act(async () => {
        resolvePatchPromise!({});
      });

      await waitFor(() => {
        expect(onSaved).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });

      // Assert only 1 patch API call was ever dispatched
      expect(patchCallCount).toBe(1);
    });
  });

  // =========================================================================
  // Challenge 3: Dirty Lyrics Bypass on Studio Deletion
  // =========================================================================
  describe('Challenge 3: Dirty Lyrics Bypass on Studio Deletion', () => {
    it('bypasses window.confirm and cleanly resets studio when project is deleted with dirty lyrics', async () => {
      window.history.pushState({}, '', '/?project=proj-adv-100');
      const confirmSpy = vi.spyOn(window, 'confirm');

      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = url.toString();
          const method = init?.method || 'GET';

          if (urlStr.includes('/api/auth/status')) {
            return new Response(JSON.stringify({ auth_required: false, authenticated: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          if (urlStr.includes('/api/project/proj-adv-100') && method === 'GET') {
            return new Response(JSON.stringify(mockProject), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          if (urlStr.includes('/api/project/proj-adv-100') && method === 'DELETE') {
            return new Response(JSON.stringify({ status: 'deleted', project_id: 'proj-adv-100' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          if (urlStr.includes('/api/projects')) {
            return new Response(JSON.stringify({}), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          return new Response('{}', { status: 200 });
        }
      );

      const user = userEvent.setup();
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Adversarial Test Track')).toBeInTheDocument();
      });

      // 1. Trigger dirty state in LyricTimelineEditor by nudging a timing line
      const nudgeButtons = screen.getAllByRole('button', { name: /nudge line/i });
      expect(nudgeButtons.length).toBeGreaterThan(0);
      await user.click(nudgeButtons[0]);

      // Dirty state is now active (Save Timing Changes and Discard Changes buttons appear)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Discard Changes/i })).toBeInTheDocument();
      });

      // Verify that if user clicks navbar "New Song", window.confirm WOULD be triggered
      const newSongBtn = screen.getByRole('button', { name: /New Song/i });
      confirmSpy.mockReturnValueOnce(false); // User cancels navigation prompt
      await user.click(newSongBtn);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Adversarial Test Track')).toBeInTheDocument(); // Still in studio

      confirmSpy.mockClear();

      // 2. Now trigger deletion from Studio Header
      const deleteBtn = screen.getByRole('button', { name: /Delete project/i });
      await user.click(deleteBtn);

      // Delete confirmation modal appears
      expect(screen.getByRole('heading', { name: /Delete Project\?/i })).toBeInTheDocument();

      const confirmDeleteBtn = screen.getByRole('button', { name: /^Delete Project$/i });
      await user.click(confirmDeleteBtn);

      // Verify that window.confirm was NOT called during deletion!
      expect(confirmSpy).not.toHaveBeenCalled();

      // Verify that studio cleanly reset and returned to search view
      await waitFor(() => {
        expect(screen.queryByText('Adversarial Test Track')).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText(/Paste YouTube.*or search.*title/i)).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // Challenge 4: Keyboard Accessibility & Focus Trapping
  // =========================================================================
  describe('Challenge 4: Focus Trapping & Keyboard Dismissal', () => {
    it('traps focus and dismisses on Escape for DeleteConfirmModal', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(
        <div>
          <button id="trigger-btn">Open Modal</button>
          <DeleteConfirmModal
            isOpen={true}
            projectId="proj-adv-100"
            projectTitle="Adversarial Track"
            onClose={onClose}
            onDeleted={vi.fn()}
          />
        </div>
      );

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();

      const closeBtn = screen.getByRole('button', {
        name: /Close delete confirmation dialog/i,
      });
      const cancelBtn = screen.getByRole('button', { name: /^Cancel$/i });
      const deleteBtn = screen.getByRole('button', { name: /^Delete Project$/i });

      // Initial focus is on cancel button
      await waitFor(() => {
        expect(document.activeElement).toBe(cancelBtn);
      });

      // Press Tab -> advances to Delete Project button
      await user.tab();
      expect(document.activeElement).toBe(deleteBtn);

      // Press Tab -> advances to Close button (X)
      await user.tab();
      expect(document.activeElement).toBe(closeBtn);

      // Press Tab -> wraps around back to Cancel button
      await user.tab();
      expect(document.activeElement).toBe(cancelBtn);

      // Press Shift+Tab -> wraps in reverse back to Close button
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(closeBtn);

      // Press Escape -> dismisses modal
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('traps focus, focuses title input initially, and dismisses on Escape for EditMetadataModal', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(
        <EditMetadataModal
          isOpen={true}
          project={{
            id: 'proj-adv-100',
            title: 'Initial Title',
            artist: 'Initial Artist',
          }}
          onClose={onClose}
          onSaved={vi.fn()}
        />
      );

      const titleInput = screen.getByLabelText(/Track Title/i);
      const artistInput = screen.getByLabelText(/Artist Name/i);
      const cancelBtn = screen.getByRole('button', { name: /^Cancel$/i });
      const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
      const closeBtn = screen.getByRole('button', { name: /Close edit metadata dialog/i });

      // Initial focus on Track Title input
      await waitFor(() => {
        expect(document.activeElement).toBe(titleInput);
      });

      // Tab sequence: title -> artist -> cancel -> save -> close -> title
      await user.tab();
      expect(document.activeElement).toBe(artistInput);

      await user.tab();
      expect(document.activeElement).toBe(cancelBtn);

      await user.tab();
      expect(document.activeElement).toBe(saveBtn);

      await user.tab();
      expect(document.activeElement).toBe(closeBtn);

      // Wrap-around back to first focusable
      await user.tab();
      expect(document.activeElement).toBe(titleInput);

      // Shift+Tab reverse wrap-around back to closeBtn
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(closeBtn);

      // Escape key dismisses
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Challenge 5: Touch Targets >= 44px and Multi-Viewport Layout Integrity
  // =========================================================================
  describe('Challenge 5: Mobile Touch Targets & Zero Horizontal Overflow (320px, 375px, 768px, 1280px)', () => {
    it('verifies all interactive buttons in DeleteConfirmModal have min-h-[44px] and min-w-[44px]', () => {
      render(
        <DeleteConfirmModal
          isOpen={true}
          projectId="proj-adv-100"
          projectTitle="Adversarial Track"
          onClose={vi.fn()}
          onDeleted={vi.fn()}
        />
      );

      const closeBtn = screen.getByRole('button', {
        name: /Close delete confirmation dialog/i,
      });
      const cancelBtn = screen.getByRole('button', { name: /^Cancel$/i });
      const deleteBtn = screen.getByRole('button', { name: /^Delete Project$/i });

      expect(closeBtn.className).toContain('min-h-[44px]');
      expect(closeBtn.className).toContain('min-w-[44px]');

      expect(cancelBtn.className).toContain('min-h-[44px]');
      expect(cancelBtn.className).toContain('min-w-[44px]');

      expect(deleteBtn.className).toContain('min-h-[44px]');
      expect(deleteBtn.className).toContain('min-w-[44px]');
    });

    it('verifies all interactive controls in EditMetadataModal have min-h-[44px] and min-w-[44px]', () => {
      render(
        <EditMetadataModal
          isOpen={true}
          project={{
            id: 'proj-adv-100',
            title: 'Adversarial Track',
            artist: 'Stress Artist',
          }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );

      const titleInput = screen.getByLabelText(/Track Title/i);
      const artistInput = screen.getByLabelText(/Artist Name/i);
      const closeBtn = screen.getByRole('button', {
        name: /Close edit metadata dialog/i,
      });
      const cancelBtn = screen.getByRole('button', { name: /^Cancel$/i });
      const saveBtn = screen.getByRole('button', { name: /Save Changes/i });

      expect(titleInput.className).toContain('min-h-[44px]');
      expect(artistInput.className).toContain('min-h-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');
      expect(closeBtn.className).toContain('min-w-[44px]');
      expect(cancelBtn.className).toContain('min-h-[44px]');
      expect(cancelBtn.className).toContain('min-w-[44px]');
      expect(saveBtn.className).toContain('min-h-[44px]');
      expect(saveBtn.className).toContain('min-w-[44px]');
    });

    BREAKPOINTS.forEach((bp) => {
      it(`guarantees zero horizontal overflow at ${bp.name} (${bp.width}px) across DeleteConfirmModal`, () => {
        setTestViewport(bp.width, bp.height);
        const { container } = render(
          <DeleteConfirmModal
            isOpen={true}
            projectId="proj-adv-100"
            projectTitle="Adversarial Track With Ultra Long Name That Should Not Break Layout"
            projectArtist="Very Long Artist Name Testing Overflow"
            onClose={vi.fn()}
            onDeleted={vi.fn()}
          />
        );

        assertZeroHorizontalOverflow(container, bp.width);
      });

      it(`guarantees zero horizontal overflow at ${bp.name} (${bp.width}px) across EditMetadataModal`, () => {
        setTestViewport(bp.width, bp.height);
        const { container } = render(
          <EditMetadataModal
            isOpen={true}
            project={{
              id: 'proj-adv-100',
              title: 'Adversarial Track With Ultra Long Name That Should Not Break Layout',
              artist: 'Very Long Artist Name Testing Overflow',
            }}
            onClose={vi.fn()}
            onSaved={vi.fn()}
          />
        );

        assertZeroHorizontalOverflow(container, bp.width);
      });

      it(`guarantees zero horizontal overflow at ${bp.name} (${bp.width}px) across TrackSearch project cards`, async () => {
        setTestViewport(bp.width, bp.height);
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
          if (url.toString().includes('/api/projects')) {
            return new Response(JSON.stringify({ [mockProject.id]: mockProject }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response('{}', { status: 200 });
        });

        const { container } = render(
          <TrackSearch
            onSelectTrack={vi.fn()}
            onOpenProject={vi.fn()}
            isLoading={false}
            currentUser="Tester"
          />
        );

        await waitFor(() => {
          expect(screen.getByText('Adversarial Test Track')).toBeInTheDocument();
        });

        assertZeroHorizontalOverflow(container, bp.width);
      });

      it(`guarantees zero horizontal overflow at ${bp.name} (${bp.width}px) across Studio Header controls`, async () => {
        setTestViewport(bp.width, bp.height);
        window.history.pushState({}, '', '/?project=proj-adv-100');

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
          const urlStr = url.toString();
          if (urlStr.includes('/api/auth/status')) {
            return new Response(JSON.stringify({ auth_required: false, authenticated: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (urlStr.includes('/api/project/proj-adv-100')) {
            return new Response(JSON.stringify(mockProject), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (urlStr.includes('/api/projects')) {
            return new Response(JSON.stringify({}), { status: 200 });
          }
          return new Response('{}', { status: 200 });
        });

        const { container } = render(<App />);

        await waitFor(() => {
          expect(screen.getByText('Adversarial Test Track')).toBeInTheDocument();
        });

        assertZeroHorizontalOverflow(container, bp.width);
      });
    });
  });
});

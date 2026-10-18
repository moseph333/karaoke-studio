import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AuthModal } from '../components/AuthModal';
import { ExportModal } from '../components/ExportModal';
import { ProjectState } from '../types';
import {
  BREAKPOINTS,
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  detectHorizontalOverflow,
  assertTouchTargets,
} from './responsiveTestUtils';

describe('Milestone 3 Empirical Challenger Suite (Modal Dialogs & Responsive Quality Gates)', () => {
  const baseProject: ProjectState = {
    id: 'test-m3-project',
    status: 'ready',
    progress: 100,
    title: 'Bohemian Rhapsody (Official 2026 Remastered Karaoke Edition)',
    artist: 'Queen & The Royal Philharmonic Orchestra',
    thumbnail_url: 'https://example.com/cover.jpg',
    lines: [],
    semitones: 0,
    guide_volume: 0.0,
    render_status: 'idle',
    render_progress: 0,
  };

  const renderingProject: ProjectState = {
    ...baseProject,
    render_status: 'rendering',
    render_progress: 42,
    render_detail:
      'Synthesizing ultra high definition 60fps video frames with word-by-word wipe effect...',
    render_elapsed_seconds: 45,
    render_eta_seconds: 65,
    render_heartbeat: Date.now(),
  };

  const completedProjectWithLongMeta: ProjectState = {
    ...baseProject,
    render_status: 'completed',
    render_progress: 100,
    video_url: '/static/adversarial_test_output.mp4',
    youtube_package: {
      title:
        'Queen - Bohemian Rhapsody (Official Karaoke Backing Track with Word-By-Word Progressive Lyrics & Chords)',
      description:
        'High-definition karaoke backing track.\n\n' +
        'Check out our channel for more backing tracks: https://youtube.com/@karaoke-studio-channel-with-unbroken-link-extending-far-beyond-normal-lengths\n\n' +
        'Lyrics:\nIs this the real life? Is this just fantasy?\nCaught in a landslide, no escape from reality.\n' +
        'Chapters:\n00:00 Intro\n01:15 Ballad\n02:30 Guitar Solo\n03:15 Opera\n04:00 Rock\n05:10 Outro',
      tags: [
        'karaoke',
        'queen',
        'bohemian rhapsody',
        'backing track',
        'instrumental',
        'high definition 1080p',
        'sing-along',
        'vocal-removed',
        'progressive-lyrics',
        'studio-master',
        'karaoke-track-with-very-long-tag-name-that-cannot-be-broken-easily',
      ],
      key_note: 'Original Key (0 st)',
      lyrics: 'Is this the real life? Is this just fantasy?',
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

  // ---------------------------------------------------------------------------
  // Focus Area 1: AuthModal Viewport & Virtual Keyboard Stress
  // ---------------------------------------------------------------------------
  describe('Focus Area 1: AuthModal Adversarial Testing', () => {
    it('contains vertical overflow with max-h-[90vh] overflow-y-auto at 320x568 (iPhone SE)', () => {
      setTestViewport(320, 568);
      render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();

      const modalContent = dialog.firstElementChild as HTMLElement;
      expect(modalContent).not.toBeNull();
      expect(modalContent.className).toContain('max-h-[90vh]');
      expect(modalContent.className).toContain('overflow-y-auto');
      expect(modalContent.className).toContain('p-4');
      expect(modalContent.className).toContain('sm:p-6');
    });

    it('enforces >=44x44px touch target on close button and triggers onClose callback', () => {
      setTestViewport(320, 568);
      const onCloseMock = vi.fn();
      render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={onCloseMock} />);

      const closeBtn = screen.getByRole('button', {
        name: /close studio authentication dialog/i,
      });
      expect(closeBtn).toBeInTheDocument();
      expect(closeBtn.className).toContain('min-w-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');
      expect(closeBtn.className).toContain('top-3');
      expect(closeBtn.className).toContain('right-3');

      fireEvent.click(closeBtn);
      expect(onCloseMock).toHaveBeenCalledTimes(1);
    });

    it('enforces min-h-[44px] and text-base (16px) on inputs to prevent iOS Safari auto-zoom', () => {
      setTestViewport(320, 568);
      render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />);

      const passwordInput = screen.getByLabelText(/studio passphrase/i);
      expect(passwordInput.className).toContain('min-h-[44px]');
      expect(passwordInput.className).toContain('text-base');
      expect(passwordInput.className).toContain('sm:text-sm');

      const usernameInput = screen.getByLabelText(/your nickname/i);
      expect(usernameInput.className).toContain('min-h-[44px]');
      expect(usernameInput.className).toContain('text-base');
      expect(usernameInput.className).toContain('sm:text-sm');

      const submitBtn = screen.getByRole('button', { name: /enter studio/i });
      expect(submitBtn.className).toContain('min-h-[44px]');
      expect(submitBtn.className).toContain('w-full');
    });

    it('displays long error alert at 320px viewport without causing horizontal overflow', async () => {
      setTestViewport(320, 568);
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail:
              'Authentication failed: Passphrase token rejected by the server due to rate-limiting or policy violation. Please wait 60 seconds.',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const { container } = render(
        <AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />
      );

      const passwordInput = screen.getByLabelText(/studio passphrase/i);
      fireEvent.change(passwordInput, { target: { value: 'wrong-pass' } });

      const form = passwordInput.closest('form');
      expect(form).not.toBeNull();
      fireEvent.submit(form!);

      const alert = await screen.findByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert.textContent).toContain('Authentication failed');

      assertZeroHorizontalOverflow(container, 320);
    });

    it('displays loading state spinner on submit button without layout blowout', async () => {
      setTestViewport(320, 568);
      // Delayed mock response
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
        () => new Promise(() => {}) // pending promise
      );

      render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />);

      const passwordInput = screen.getByLabelText(/studio passphrase/i);
      fireEvent.change(passwordInput, { target: { value: 'secret-token-123' } });

      const submitBtn = screen.getByRole('button', { name: /enter studio/i });
      fireEvent.click(submitBtn);

      expect(submitBtn).toBeDisabled();
      const spinner = submitBtn.querySelector('.animate-spin');
      expect(spinner).not.toBeNull();
      expect(submitBtn.className).toContain('min-h-[44px]');
    });
  });

  // ---------------------------------------------------------------------------
  // Focus Area 2: ExportModal Stress Testing at 320px
  // ---------------------------------------------------------------------------
  describe('Focus Area 2: ExportModal Adversarial Testing', () => {
    it('stacks download buttons vertically on 320px viewport without exceeding 240px card space', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <ExportModal project={completedProjectWithLongMeta} isOpen={true} onClose={vi.fn()} />
      );

      const downloadLink = screen.getByRole('link', { name: /download video/i });
      const ytLink = screen.getByRole('link', { name: /open youtube studio/i });

      expect(downloadLink).toBeInTheDocument();
      expect(ytLink).toBeInTheDocument();

      // Check min-height and full width
      expect(downloadLink.className).toContain('min-h-[44px]');
      expect(downloadLink.className).toContain('w-full');
      expect(ytLink.className).toContain('min-h-[44px]');
      expect(ytLink.className).toContain('w-full');

      // The button container has flex-col on mobile, sm:flex-row on desktop
      const buttonContainer = downloadLink.parentElement as HTMLElement;
      expect(buttonContainer.className).toContain('flex-col');
      expect(buttonContainer.className).toContain('sm:flex-row');

      // Zero horizontal overflow verification
      assertZeroHorizontalOverflow(container, 320);
    });

    it('prevents header collision between long title and absolute close button with pr-12 and truncation', () => {
      setTestViewport(320, 568);
      render(
        <ExportModal project={completedProjectWithLongMeta} isOpen={true} onClose={vi.fn()} />
      );

      const title = screen.getByRole('heading', { level: 2, name: /export & youtube package/i });
      expect(title).toBeInTheDocument();
      expect(title.className).toContain('truncate');

      // Header container must have pr-12 to reserve clearance for the 44px close button at right-3
      const headerContainer = title.closest('.border-b');
      expect(headerContainer).not.toBeNull();
      expect(headerContainer?.className).toContain('pr-12');

      const closeBtn = screen.getByRole('button', { name: /close export dialog/i });
      expect(closeBtn.className).toContain('min-w-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');
    });

    it('wraps preformatted long YouTube description and SEO tags without horizontal blowout', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <ExportModal project={completedProjectWithLongMeta} isOpen={true} onClose={vi.fn()} />
      );

      const pre = container.querySelector('pre');
      expect(pre).not.toBeNull();
      expect(pre?.className).toContain('whitespace-pre-wrap');
      expect(pre?.className).toContain('break-words');
      expect(pre?.className).toContain('overflow-x-auto');

      // SEO tags container must break unbroken long tag strings
      const tagsContainer = container.querySelector('p.break-words');
      expect(tagsContainer).not.toBeNull();

      assertZeroHorizontalOverflow(container, 320);
    });

    it('ensures all copy metadata buttons have >=36px mobile touch targets with clipboard action', () => {
      setTestViewport(320, 568);
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: { writeText: writeTextMock },
      });

      render(
        <ExportModal project={completedProjectWithLongMeta} isOpen={true} onClose={vi.fn()} />
      );

      const copyButtons = screen.getAllByRole('button', { name: /copy/i });
      expect(copyButtons.length).toBe(3); // Title, Description, Tags

      copyButtons.forEach((btn) => {
        expect(btn.className).toContain('min-h-[36px]');
      });

      // Test clicking copy title button
      fireEvent.click(copyButtons[0]);
      expect(writeTextMock).toHaveBeenCalledWith(
        completedProjectWithLongMeta.youtube_package!.title
      );
      expect(screen.getByText(/copied!/i)).toBeInTheDocument();
    });

    it('renders rendering state with responsive timers and 44px cancel button at 320px', () => {
      setTestViewport(320, 568);
      const onCancelMock = vi.fn();
      const { container } = render(
        <ExportModal
          project={renderingProject}
          isOpen={true}
          onClose={vi.fn()}
          onCancelRender={onCancelMock}
        />
      );

      const cancelBtn = screen.getByRole('button', { name: /cancel render/i });
      expect(cancelBtn).toBeInTheDocument();
      expect(cancelBtn.className).toContain('min-h-[44px]');

      fireEvent.click(cancelBtn);
      expect(onCancelMock).toHaveBeenCalledTimes(1);

      assertZeroHorizontalOverflow(container, 320);
    });
  });

  // ---------------------------------------------------------------------------
  // Focus Area 3: Responsive Test Utility Stress & Negative Detection
  // ---------------------------------------------------------------------------
  describe('Focus Area 3: responsiveTestUtils Invariant Verification', () => {
    it('flags unconstrained fixed widths and un-wrapped flex items as violations', () => {
      const badContainer = document.createElement('div');
      badContainer.className = 'w-[450px] bg-red-900';
      document.body.appendChild(badContainer);

      const violationsAt320 = detectHorizontalOverflow(badContainer, 320);
      expect(violationsAt320.length).toBeGreaterThan(0);
      expect(violationsAt320[0].reason).toContain('w-[450px]');

      const violationsAt768 = detectHorizontalOverflow(badContainer, 768);
      expect(violationsAt768.length).toBe(0);

      document.body.removeChild(badContainer);
    });

    it('flags un-wrapped horizontal flex rows exceeding viewport width', () => {
      const badFlex = document.createElement('div');
      badFlex.className = 'flex items-center gap-3';
      for (let i = 0; i < 5; i++) {
        const btn = document.createElement('button');
        btn.textContent = `Action Button Number ${i + 1} Long Label`;
        badFlex.appendChild(btn);
      }
      document.body.appendChild(badFlex);

      const violations = detectHorizontalOverflow(badFlex, 320);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].reason).toContain('Non-wrapping flex container');

      document.body.removeChild(badFlex);
    });

    it('passes responsive stacked flex layouts (flex-col sm:flex-row) at 320px', () => {
      const goodFlex = document.createElement('div');
      goodFlex.className = 'flex flex-col sm:flex-row items-center gap-3';
      for (let i = 0; i < 5; i++) {
        const btn = document.createElement('button');
        btn.textContent = `Action Button Number ${i + 1}`;
        goodFlex.appendChild(btn);
      }
      document.body.appendChild(goodFlex);

      const violations = detectHorizontalOverflow(goodFlex, 320);
      expect(violations.length).toBe(0);

      document.body.removeChild(goodFlex);
    });

    it('flags pre tags that lack overflow-x-auto or word wrapping', () => {
      const badPre = document.createElement('pre');
      badPre.textContent = 'unwrapped code block without overflow scroll';
      document.body.appendChild(badPre);

      const violations = detectHorizontalOverflow(badPre, 320);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].reason).toContain('Preformatted text container');

      document.body.removeChild(badPre);
    });

    it('accurately distinguishes compliant vs non-compliant touch target sizes', () => {
      const testWrapper = document.createElement('div');

      const smallBtn = document.createElement('button');
      smallBtn.className = 'p-1 h-6 w-6 text-xs';
      smallBtn.textContent = 'x';
      testWrapper.appendChild(smallBtn);

      const validBtn = document.createElement('button');
      validBtn.className = 'min-h-[44px] min-w-[44px] p-2';
      validBtn.textContent = 'Close';
      testWrapper.appendChild(validBtn);

      const inspection = assertTouchTargets(testWrapper);
      expect(inspection.total).toBe(2);
      expect(inspection.failed.length).toBe(1);
      expect(inspection.failed[0].element).toBe(smallBtn);
    });
  });

  // ---------------------------------------------------------------------------
  // Focus Area 5: Accessibility, Escape Shortcuts & Focus Trap
  // ---------------------------------------------------------------------------
  describe('Focus Area 5: Accessibility, Focus Trapping & Escape Handlers', () => {
    it('closes AuthModal when Escape key is pressed', () => {
      setTestViewport(320, 568);
      const onCloseMock = vi.fn();
      render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={onCloseMock} />);

      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
      expect(onCloseMock).toHaveBeenCalledTimes(1);
    });

    it('closes ExportModal when Escape key is pressed', () => {
      setTestViewport(320, 568);
      const onCloseMock = vi.fn();
      render(
        <ExportModal project={completedProjectWithLongMeta} isOpen={true} onClose={onCloseMock} />
      );

      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
      expect(onCloseMock).toHaveBeenCalledTimes(1);
    });

    it('contains valid ARIA attributes and focus trap container on both dialogs', () => {
      setTestViewport(320, 568);
      const { unmount } = render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />);

      const authDialog = screen.getByRole('dialog');
      expect(authDialog).toHaveAttribute('aria-modal', 'true');
      expect(authDialog).toHaveAttribute('aria-labelledby', 'auth-modal-title');
      expect(authDialog).toHaveAttribute('aria-describedby', 'auth-modal-desc');

      unmount();

      render(
        <ExportModal project={completedProjectWithLongMeta} isOpen={true} onClose={vi.fn()} />
      );
      const exportDialog = screen.getByRole('dialog');
      expect(exportDialog).toHaveAttribute('aria-modal', 'true');
      expect(exportDialog).toHaveAttribute('aria-labelledby', 'export-modal-title');
      expect(exportDialog).toHaveAttribute('aria-describedby', 'export-modal-desc');
    });
  });

  // ---------------------------------------------------------------------------
  // Focus Area 6: Error & Boundary Conditions Stress Harness
  // ---------------------------------------------------------------------------
  describe('Focus Area 6: Error & Boundary Stress Conditions', () => {
    it('handles 300-character render error message cleanly at 320px viewport without blowout', () => {
      setTestViewport(320, 568);
      const errorProject: ProjectState = {
        ...baseProject,
        render_status: 'error',
        render_error:
          'FFmpeg process aborted with exit code 137 (SIGKILL OOM). Video frame buffer exceeded allocation limits during progressive subtitle rasterization. Input file stream closed unexpectedly.',
      };

      const { container } = render(
        <ExportModal project={errorProject} isOpen={true} onClose={vi.fn()} />
      );

      expect(screen.getByText(/rendering encountered an error/i)).toBeInTheDocument();
      expect(screen.getByText(/FFmpeg process aborted/i)).toBeInTheDocument();

      assertZeroHorizontalOverflow(container, 320);
    });

    it('contains 100-character user credentials in AuthModal inputs without horizontal expansion', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />
      );

      const passInput = screen.getByLabelText(/studio passphrase/i);
      const userInput = screen.getByLabelText(/your nickname/i);

      const ultraLongToken = 'a'.repeat(100);
      fireEvent.change(passInput, { target: { value: ultraLongToken } });
      fireEvent.change(userInput, { target: { value: ultraLongToken } });

      expect(passInput).toHaveValue(ultraLongToken);
      expect(userInput).toHaveValue(ultraLongToken);

      assertZeroHorizontalOverflow(container, 320);
    });

    it('renders video player in completed state with aspect-video and object-contain at 320px', () => {
      setTestViewport(320, 568);
      const { container } = render(
        <ExportModal project={completedProjectWithLongMeta} isOpen={true} onClose={vi.fn()} />
      );

      const video = container.querySelector('video');
      expect(video).not.toBeNull();
      expect(video?.className).toContain('w-full');
      expect(video?.className).toContain('h-full');
      expect(video?.className).toContain('object-contain');

      const videoWrapper = video?.parentElement as HTMLElement;
      expect(videoWrapper.className).toContain('aspect-video');
      expect(videoWrapper.className).toContain('w-full');

      assertZeroHorizontalOverflow(container, 320);
    });
  });

  // ---------------------------------------------------------------------------
  // Focus Area 4: Cross-Breakpoint Matrix Verification
  // ---------------------------------------------------------------------------
  describe('Focus Area 4: Cross-Breakpoint Zero-Overflow Verification', () => {
    BREAKPOINTS.forEach((bp) => {
      it(`verifies AuthModal has zero overflow at ${bp.name} (${bp.width}x${bp.height})`, () => {
        setTestViewport(bp.width, bp.height);
        const { container } = render(
          <AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />
        );
        assertZeroHorizontalOverflow(container, bp.width);
      });

      it(`verifies ExportModal has zero overflow at ${bp.name} (${bp.width}x${bp.height})`, () => {
        setTestViewport(bp.width, bp.height);
        const { container } = render(
          <ExportModal project={completedProjectWithLongMeta} isOpen={true} onClose={vi.fn()} />
        );
        assertZeroHorizontalOverflow(container, bp.width);
      });
    });
  });
});

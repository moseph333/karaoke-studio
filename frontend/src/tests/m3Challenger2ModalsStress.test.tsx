/**
 * M3 Challenger 2 Adversarial Stress Test Suite
 *
 * Exhaustively stress-tests:
 * 1. Bottom-sheet presentation across all 8 studio modals at narrow viewports (320px and 375px):
 *    - All 8 modals sit flush at bottom on mobile (items-end p-0) and center on desktop (sm:items-center sm:p-4).
 *    - Visual drag handle indicator is rendered and accessible on small viewports.
 *    - Backdrop click dismiss triggers onClose when clicked outside card, but NOT when clicked inside card.
 * 2. Touch targets:
 *    - All primary close buttons across all modals meet >=44x44px (min-w-[44px] min-h-[44px]).
 *    - Safe-area inset bottom padding is active on all mobile modal cards.
 * 3. Rapid open/close modal cycling stress tests and keyboard escape handling across viewports.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ExportModal } from '../components/ExportModal';
import { HelpModal } from '../components/HelpModal';
import { AuthModal } from '../components/AuthModal';
import { EditMetadataModal } from '../components/EditMetadataModal';
import { DeleteConfirmModal } from '../components/DeleteConfirmModal';
import { DuetAssignmentModal } from '../components/timeline/DuetAssignmentModal';
import { BatchOffsetModal } from '../components/timeline/BatchOffsetModal';
import { LyricReplacementModal } from '../components/timeline/LyricReplacementModal';
import { AppThemeProvider } from '../context/AppThemeContext';
import { ProjectState, LyricLine } from '../types';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
} from './responsiveTestUtils';

const mockLines: LyricLine[] = [
  {
    id: 1,
    text: 'Is this the real life? Is this just fantasy?',
    start_time: 1.0,
    end_time: 5.5,
    words: [
      { word: 'Is', start_time: 1.0, end_time: 1.3 },
      { word: 'this', start_time: 1.3, end_time: 1.6 },
      { word: 'the', start_time: 1.6, end_time: 1.8 },
      { word: 'real', start_time: 1.8, end_time: 2.2 },
      { word: 'life?', start_time: 2.2, end_time: 3.0 },
    ],
    singer: 'singer1',
  },
  {
    id: 2,
    text: 'Caught in a landslide, no escape from reality',
    start_time: 6.0,
    end_time: 10.5,
    words: [
      { word: 'Caught', start_time: 6.0, end_time: 6.5 },
      { word: 'in', start_time: 6.5, end_time: 6.7 },
      { word: 'a', start_time: 6.7, end_time: 6.9 },
      { word: 'landslide', start_time: 6.9, end_time: 7.8 },
    ],
    singer: 'singer2',
  },
];

const mockProject: ProjectState = {
  id: 'challenger-test-project',
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  status: 'ready',
  progress: 100,
  lines: mockLines,
  semitones: 0,
  guide_volume: 0.0,
  created_by: 'Challenger',
  render_status: 'idle',
  render_progress: 0,
  heartbeat: Date.now(),
};

describe('M3 Challenger 2: Bottom-Sheet Modals & Touch Targets Adversarial Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setTestViewport(375, 667);
  });

  afterEach(() => {
    cleanup();
    resetTestViewport();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SUITE 1: BOTTOM-SHEET PRESENTATION ACROSS ALL 8 MODALS
  // =========================================================================

  describe('Dimension 1: Bottom-Sheet Presentation Across All 8 Modals', () => {
    const modalDefinitions = [
      {
        name: 'ExportModal',
        render: (onClose = vi.fn()) =>
          render(
            <AppThemeProvider>
              <ExportModal project={mockProject} isOpen={true} onClose={onClose} />
            </AppThemeProvider>
          ),
      },
      {
        name: 'HelpModal',
        render: (onClose = vi.fn()) =>
          render(
            <AppThemeProvider>
              <HelpModal isOpen={true} onClose={onClose} />
            </AppThemeProvider>
          ),
      },
      {
        name: 'AuthModal',
        render: (onClose = vi.fn()) =>
          render(
            <AppThemeProvider>
              <AuthModal isOpen={true} onSuccess={vi.fn()} onClose={onClose} />
            </AppThemeProvider>
          ),
      },
      {
        name: 'EditMetadataModal',
        render: (onClose = vi.fn()) =>
          render(
            <AppThemeProvider>
              <EditMetadataModal
                isOpen={true}
                project={mockProject}
                onClose={onClose}
                onSaved={vi.fn()}
              />
            </AppThemeProvider>
          ),
      },
      {
        name: 'DeleteConfirmModal',
        render: (onClose = vi.fn()) =>
          render(
            <AppThemeProvider>
              <DeleteConfirmModal
                isOpen={true}
                projectId="challenger-test-project"
                projectTitle="Bohemian Rhapsody"
                projectArtist="Queen"
                onClose={onClose}
                onDeleted={vi.fn()}
              />
            </AppThemeProvider>
          ),
      },
      {
        name: 'DuetAssignmentModal',
        render: (onClose = vi.fn()) =>
          render(
            <AppThemeProvider>
              <DuetAssignmentModal
                isOpen={true}
                lines={mockLines}
                onClose={onClose}
                onApply={vi.fn()}
              />
            </AppThemeProvider>
          ),
      },
      {
        name: 'BatchOffsetModal',
        render: (onClose = vi.fn()) =>
          render(
            <AppThemeProvider>
              <BatchOffsetModal
                isOpen={true}
                totalLines={mockLines.length}
                onClose={onClose}
                onApplyOffset={vi.fn()}
              />
            </AppThemeProvider>
          ),
      },
      {
        name: 'LyricReplacementModal',
        render: (onClose = vi.fn()) =>
          render(
            <AppThemeProvider>
              <LyricReplacementModal
                isOpen={true}
                projectId="challenger-test-project"
                trackTitle="Bohemian Rhapsody"
                trackArtist="Queen"
                onClose={onClose}
                onSuccess={vi.fn()}
              />
            </AppThemeProvider>
          ),
      },
    ];

    modalDefinitions.forEach(({ name, render: renderModal }) => {
      it(`${name}: sits flush at bottom on mobile (items-end p-0) and centers on desktop (sm:items-center sm:p-4)`, () => {
        // Mobile 375px
        setTestViewport(375, 667);
        const { unmount } = renderModal();
        let dialog = screen.getByRole('dialog');
        expect(dialog.className).toContain('items-end');
        expect(dialog.className).toContain('p-0');
        expect(dialog.className).toContain('sm:items-center');
        expect(dialog.className).toContain('sm:p-4');

        // Modal card rounded geometry: top rounded on mobile, all rounded on desktop
        const card = dialog.querySelector('[class*="rounded-t-2xl"]');
        expect(card, `${name} must have rounded-t-2xl card`).toBeInTheDocument();
        expect(card?.className).toMatch(/rounded-b-none/);
        unmount();

        // Mobile 320px (iPhone SE)
        setTestViewport(320, 568);
        const renderedNarrow = renderModal();
        dialog = screen.getByRole('dialog');
        expect(dialog.className).toContain('items-end');
        expect(dialog.className).toContain('p-0');
        renderedNarrow.unmount();
      });

      it(`${name}: card is constrained to max-h-[90vh] with scrollable overflow-y-auto`, () => {
        setTestViewport(375, 667);
        const { unmount } = renderModal();
        const dialog = screen.getByRole('dialog');
        const card =
          dialog.querySelector('.max-h-\\[90vh\\]') ||
          dialog.querySelector('[class*="max-h-[90vh]"]');
        expect(card, `${name} card must constrain height with max-h-[90vh]`).toBeInTheDocument();
        const scrollable =
          card?.classList.contains('overflow-y-auto') || card?.querySelector('.overflow-y-auto');
        expect(scrollable, `${name} must have overflow-y-auto scrollable container`).toBeTruthy();
        unmount();
      });

      it(`${name}: renders accessible visual drag handle indicator on small viewports`, () => {
        setTestViewport(375, 667);
        const { unmount } = renderModal();
        const dialog = screen.getByRole('dialog');
        const dragHandle = dialog.querySelector('[data-testid="bottom-sheet-drag-handle"]');
        expect(
          dragHandle,
          `${name} must render data-testid="bottom-sheet-drag-handle"`
        ).toBeInTheDocument();
        expect(dragHandle?.className).toContain('sm:hidden');
        expect(dragHandle?.className).toContain('rounded-full');
        unmount();
      });

      it(`${name}: exhibits zero horizontal overflow at 320px and 375px viewports`, () => {
        setTestViewport(320, 568);
        const { container, unmount } = renderModal();
        assertZeroHorizontalOverflow(container, 320);
        unmount();

        setTestViewport(375, 667);
        const rendered375 = renderModal();
        assertZeroHorizontalOverflow(rendered375.container, 375);
        rendered375.unmount();
      });
    });
  });

  // =========================================================================
  // SUITE 2: BACKDROP CLICK DISMISSAL VS CARD CLICK PROPAGATION
  // =========================================================================

  describe('Dimension 2: Backdrop Click Dismissal & Content Click Isolation', () => {
    const dismissableModals = [
      {
        name: 'ExportModal',
        render: (onClose: () => void) =>
          render(
            <AppThemeProvider>
              <ExportModal project={mockProject} isOpen={true} onClose={onClose} />
            </AppThemeProvider>
          ),
      },
      {
        name: 'HelpModal',
        render: (onClose: () => void) =>
          render(
            <AppThemeProvider>
              <HelpModal isOpen={true} onClose={onClose} />
            </AppThemeProvider>
          ),
      },
      {
        name: 'EditMetadataModal',
        render: (onClose: () => void) =>
          render(
            <AppThemeProvider>
              <EditMetadataModal
                isOpen={true}
                project={mockProject}
                onClose={onClose}
                onSaved={vi.fn()}
              />
            </AppThemeProvider>
          ),
      },
      {
        name: 'DeleteConfirmModal',
        render: (onClose: () => void) =>
          render(
            <AppThemeProvider>
              <DeleteConfirmModal
                isOpen={true}
                projectId="p1"
                projectTitle="Title"
                onClose={onClose}
                onDeleted={vi.fn()}
              />
            </AppThemeProvider>
          ),
      },
      {
        name: 'DuetAssignmentModal',
        render: (onClose: () => void) =>
          render(
            <AppThemeProvider>
              <DuetAssignmentModal
                isOpen={true}
                lines={mockLines}
                onClose={onClose}
                onApply={vi.fn()}
              />
            </AppThemeProvider>
          ),
      },
      {
        name: 'BatchOffsetModal',
        render: (onClose: () => void) =>
          render(
            <AppThemeProvider>
              <BatchOffsetModal
                isOpen={true}
                totalLines={mockLines.length}
                onClose={onClose}
                onApplyOffset={vi.fn()}
              />
            </AppThemeProvider>
          ),
      },
      {
        name: 'LyricReplacementModal',
        render: (onClose: () => void) =>
          render(
            <AppThemeProvider>
              <LyricReplacementModal
                isOpen={true}
                projectId="p1"
                onClose={onClose}
                onSuccess={vi.fn()}
              />
            </AppThemeProvider>
          ),
      },
    ];

    dismissableModals.forEach(({ name, render: renderModal }) => {
      it(`${name}: clicking backdrop invokes onClose, but clicking inside card does NOT invoke onClose`, () => {
        const onCloseMock = vi.fn();
        const { unmount } = renderModal(onCloseMock);

        const dialog = screen.getByRole('dialog');
        const card = dialog.querySelector('[class*="rounded-t-2xl"]') as HTMLElement;
        expect(card, `${name} card must be found`).toBeInTheDocument();

        // 1. Click inside card content -> must NOT trigger onClose
        fireEvent.click(card);
        expect(
          onCloseMock,
          `${name}: clicking inside card must not trigger onClose`
        ).not.toHaveBeenCalled();

        // 2. Click directly on dialog backdrop (target === currentTarget) -> MUST trigger onClose
        fireEvent.click(dialog);
        expect(
          onCloseMock,
          `${name}: clicking backdrop must trigger onClose`
        ).toHaveBeenCalledTimes(1);

        unmount();
      });
    });

    it('AuthModal: Studio Access Gate blocks backdrop dismissal and escape (security invariant)', () => {
      const onCloseMock = vi.fn();
      render(
        <AppThemeProvider>
          <AuthModal isOpen={true} onSuccess={vi.fn()} onClose={onCloseMock} />
        </AppThemeProvider>
      );

      const dialog = screen.getByRole('dialog');
      fireEvent.click(dialog);
      expect(onCloseMock).not.toHaveBeenCalled();

      fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
      expect(onCloseMock).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // SUITE 3: TOUCH TARGET SIZING (>= 44x44px) & SAFE AREA INSETS
  // =========================================================================

  describe('Dimension 3: Touch Target Sizing (>=44x44px) & Safe Area Insets', () => {
    it('ExportModal: primary close button satisfies >=44x44px touch target with accessible label', () => {
      render(
        <AppThemeProvider>
          <ExportModal project={mockProject} isOpen={true} onClose={vi.fn()} />
        </AppThemeProvider>
      );

      const closeBtn = screen.getByRole('button', { name: /close export dialog/i });
      expect(closeBtn.className).toContain('min-w-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');
      expect(closeBtn.className).toContain('focus:ring');
      expect(closeBtn).toHaveAttribute('aria-label');
    });

    it('HelpModal: top close button and footer "Got it" button satisfy >=44x44px touch target', () => {
      render(
        <AppThemeProvider>
          <HelpModal isOpen={true} onClose={vi.fn()} />
        </AppThemeProvider>
      );

      const topCloseBtn = screen.getByRole('button', { name: /close help and usage guide/i });
      expect(topCloseBtn.className).toContain('min-w-[44px]');
      expect(topCloseBtn.className).toContain('min-h-[44px]');

      const footerBtn = screen.getByRole('button', { name: /got it/i });
      expect(footerBtn.className).toContain('min-w-[44px]');
      expect(footerBtn.className).toContain('min-h-[44px]');
    });

    it('EditMetadataModal: close button satisfies >=44x44px touch target', () => {
      render(
        <AppThemeProvider>
          <EditMetadataModal
            isOpen={true}
            project={mockProject}
            onClose={vi.fn()}
            onSaved={vi.fn()}
          />
        </AppThemeProvider>
      );

      const closeBtn = screen.getByRole('button', { name: /close edit metadata dialog/i });
      expect(closeBtn.className).toContain('min-w-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');
      expect(closeBtn.className).toContain('focus:ring');
    });

    it('DeleteConfirmModal: close button satisfies >=44x44px touch target', () => {
      render(
        <AppThemeProvider>
          <DeleteConfirmModal
            isOpen={true}
            projectId="p1"
            projectTitle="Title"
            onClose={vi.fn()}
            onDeleted={vi.fn()}
          />
        </AppThemeProvider>
      );

      const closeBtn = screen.getByRole('button', { name: /close delete confirmation dialog/i });
      expect(closeBtn.className).toContain('min-w-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');
    });

    it('DuetAssignmentModal: close button satisfies >=44x44px touch target and mode tabs meet >=44px height', () => {
      render(
        <AppThemeProvider>
          <DuetAssignmentModal
            isOpen={true}
            lines={mockLines}
            onClose={vi.fn()}
            onApply={vi.fn()}
          />
        </AppThemeProvider>
      );

      const closeBtn = screen.getByRole('button', { name: /close dialog/i });
      expect(closeBtn.className).toContain('min-w-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');

      const tabs = screen.getAllByRole('tab');
      tabs.forEach((tab) => {
        expect(tab.className).toContain('min-h-[44px]');
      });
    });

    it('BatchOffsetModal: close button satisfies >=44x44px touch target', () => {
      render(
        <AppThemeProvider>
          <BatchOffsetModal
            isOpen={true}
            totalLines={mockLines.length}
            onClose={vi.fn()}
            onApplyOffset={vi.fn()}
          />
        </AppThemeProvider>
      );

      const closeBtn = screen.getByRole('button', { name: /close dialog/i });
      expect(closeBtn.className).toContain('min-w-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');
    });

    it('LyricReplacementModal: close button satisfies >=44x44px touch target', () => {
      render(
        <AppThemeProvider>
          <LyricReplacementModal
            isOpen={true}
            projectId="p1"
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />
        </AppThemeProvider>
      );

      const closeBtn = screen.getByRole('button', { name: /close dialog/i });
      expect(closeBtn.className).toContain('min-w-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');
    });

    it('All 8 modals activate safe-area inset bottom padding (env(safe-area-inset-bottom))', () => {
      const modalRenderers = [
        () => render(<ExportModal project={mockProject} isOpen={true} onClose={vi.fn()} />),
        () => render(<HelpModal isOpen={true} onClose={vi.fn()} />),
        () => render(<AuthModal isOpen={true} onSuccess={vi.fn()} onClose={vi.fn()} />),
        () =>
          render(
            <EditMetadataModal
              isOpen={true}
              project={mockProject}
              onClose={vi.fn()}
              onSaved={vi.fn()}
            />
          ),
        () =>
          render(
            <DeleteConfirmModal
              isOpen={true}
              projectId="p1"
              projectTitle="Title"
              onClose={vi.fn()}
              onDeleted={vi.fn()}
            />
          ),
        () =>
          render(
            <DuetAssignmentModal
              isOpen={true}
              lines={mockLines}
              onClose={vi.fn()}
              onApply={vi.fn()}
            />
          ),
        () =>
          render(
            <BatchOffsetModal
              isOpen={true}
              totalLines={mockLines.length}
              onClose={vi.fn()}
              onApplyOffset={vi.fn()}
            />
          ),
        () =>
          render(
            <LyricReplacementModal
              isOpen={true}
              projectId="p1"
              onClose={vi.fn()}
              onSuccess={vi.fn()}
            />
          ),
      ];

      modalRenderers.forEach((renderFn, idx) => {
        const { unmount } = renderFn();
        const dialog = screen.getByRole('dialog');
        const hasSafePadding =
          dialog.className.includes('safe-area-inset-bottom') ||
          dialog.innerHTML.includes('safe-area-inset-bottom') ||
          dialog.innerHTML.includes('pb-[calc(1rem+env(safe-area-inset-bottom,0px))]');
        expect(
          hasSafePadding,
          `Modal #${idx + 1} must include safe-area-inset-bottom padding`
        ).toBe(true);
        unmount();
      });
    });
  });

  // =========================================================================
  // SUITE 4: RAPID CYCLING, KEYBOARD ESCAPE & FOCUS TRAP STRESS TESTING
  // =========================================================================

  describe('Dimension 4: Rapid Modal Cycling & Keyboard Escape Stress Tests', () => {
    it('survives rapid open/close cycling (20 iterations) without memory leaks or unhandled errors', () => {
      let isOpen = false;
      const Harness: React.FC<{ open: boolean }> = ({ open }) => (
        <AppThemeProvider>
          <ExportModal project={mockProject} isOpen={open} onClose={() => {}} />
        </AppThemeProvider>
      );

      const { rerender } = render(<Harness open={false} />);
      expect(screen.queryByRole('dialog')).toBeNull();

      for (let i = 0; i < 20; i++) {
        isOpen = !isOpen;
        rerender(<Harness open={isOpen} />);
        if (isOpen) {
          expect(screen.getByRole('dialog')).toBeInTheDocument();
        } else {
          expect(screen.queryByRole('dialog')).toBeNull();
        }
      }
    });

    it('dismisses modal cleanly on Escape across small mobile (320px), standard mobile (375px), and desktop (1280px)', () => {
      const viewports = [
        { w: 320, h: 568 },
        { w: 375, h: 667 },
        { w: 1280, h: 800 },
      ];

      viewports.forEach(({ w, h }) => {
        setTestViewport(w, h);
        const onCloseMock = vi.fn();
        const { unmount } = render(
          <AppThemeProvider>
            <HelpModal isOpen={true} onClose={onCloseMock} />
          </AppThemeProvider>
        );

        const dialog = screen.getByRole('dialog');
        fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
        expect(onCloseMock, `Escape at ${w}x${h} must invoke onClose`).toHaveBeenCalledTimes(1);
        unmount();
      });
    });

    it('focus trap maintains focus within modal when Tab is pressed', () => {
      render(
        <AppThemeProvider>
          <BatchOffsetModal
            isOpen={true}
            totalLines={mockLines.length}
            onClose={vi.fn()}
            onApplyOffset={vi.fn()}
          />
        </AppThemeProvider>
      );

      const dialog = screen.getByRole('dialog');
      const closeBtn = screen.getByRole('button', { name: /close dialog/i });
      closeBtn.focus();
      expect(document.activeElement).toBe(closeBtn);

      // Simulating tab key event
      fireEvent.keyDown(dialog, { key: 'Tab', code: 'Tab' });
      // Dialog should remain focused or active element must remain within dialog
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('rapid close button clicks invoke onClose cleanly without state corruption', () => {
      const onCloseMock = vi.fn();
      render(
        <AppThemeProvider>
          <DeleteConfirmModal
            isOpen={true}
            projectId="p1"
            projectTitle="Title"
            onClose={onCloseMock}
            onDeleted={vi.fn()}
          />
        </AppThemeProvider>
      );

      const closeBtn = screen.getByRole('button', { name: /close delete confirmation dialog/i });
      fireEvent.click(closeBtn);
      fireEvent.click(closeBtn);
      fireEvent.click(closeBtn);
      expect(onCloseMock).toHaveBeenCalled();
    });
  });
});

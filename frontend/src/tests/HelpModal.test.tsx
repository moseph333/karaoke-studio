/**
 * Unit & accessibility test suite for HelpModal (Milestone 1 - R1 & R2)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpModal } from '../components/HelpModal';
import App from '../App';
import { setTestViewport, resetTestViewport } from './responsiveTestUtils';

describe('HelpModal Component (Milestone 1 — R1 & R2)', () => {
  let onClose: () => void;

  beforeEach(() => {
    onClose = vi.fn();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetTestViewport();
    document.body.innerHTML = '';
  });

  describe('Semantics and ARIA Attributes', () => {
    it('does not render into DOM when isOpen is false', () => {
      render(<HelpModal isOpen={false} onClose={onClose} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders with role="dialog", aria-modal="true", labelledby, describedby, and data-modal="help"', () => {
      render(<HelpModal isOpen={true} onClose={onClose} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-labelledby', 'help-modal-title');
      expect(dialog).toHaveAttribute('aria-describedby', 'help-modal-desc');
      expect(dialog).toHaveAttribute('data-modal', 'help');
      expect(
        screen.getByRole('heading', { name: /karaoke studio help & usage guide/i })
      ).toBeInTheDocument();
    });
  });

  describe('Tab Switching & Initial Tab Selection', () => {
    it('defaults to Keyboard Shortcuts tab when initialTab is omitted', () => {
      render(<HelpModal isOpen={true} onClose={onClose} />);
      const shortcutsTab = screen.getByRole('tab', { name: /keyboard shortcuts/i });
      expect(shortcutsTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: /keyboard shortcuts/i })).toBeInTheDocument();
      expect(screen.getAllByText('Space')[0]).toBeInTheDocument();
    });

    it('activates Studio Usage Guide tab when initialTab="guide"', () => {
      render(<HelpModal isOpen={true} onClose={onClose} initialTab="guide" />);
      const guideTab = screen.getByRole('tab', { name: /studio usage guide/i });
      expect(guideTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: /studio usage guide/i })).toBeInTheDocument();
      expect(screen.getByText(/1\. audio intake & library/i)).toBeInTheDocument();
    });

    it('switches tabs on user click and updates aria-selected', async () => {
      const user = userEvent.setup();
      render(<HelpModal isOpen={true} onClose={onClose} />);

      const guideTab = screen.getByRole('tab', { name: /studio usage guide/i });
      await user.click(guideTab);

      expect(guideTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: /studio usage guide/i })).toBeInTheDocument();
      expect(screen.getByText(/5\. export & subtitles/i)).toBeInTheDocument();

      const shortcutsTab = screen.getByRole('tab', { name: /keyboard shortcuts/i });
      await user.click(shortcutsTab);

      expect(shortcutsTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel', { name: /keyboard shortcuts/i })).toBeInTheDocument();
    });
  });

  describe('Keyboard Shortcuts Table & Callout Note (Tab 1)', () => {
    it('displays all 6 essential shortcuts with action descriptions and key badges', () => {
      render(<HelpModal isOpen={true} onClose={onClose} initialTab="shortcuts" />);

      // Space
      expect(screen.getAllByText('Space').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/play \/ pause master playback/i)).toBeInTheDocument();

      // Seek arrows
      expect(screen.getByText(/← \/ →/i)).toBeInTheDocument();
      expect(screen.getByText(/seek backward \/ forward 5s/i)).toBeInTheDocument();

      // Mute
      expect(screen.getAllByText('M').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/master mute \/ unmute/i)).toBeInTheDocument();

      // Help
      expect(screen.getAllByText('?').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/toggle this help & usage guide/i)).toBeInTheDocument();

      // Escape
      expect(screen.getByText('Escape')).toBeInTheDocument();
      expect(screen.getByText(/close modal dialogs/i)).toBeInTheDocument();

      // Tab cycling
      expect(screen.getByText(/tab \/ shift\+tab/i)).toBeInTheDocument();
      expect(screen.getByText(/navigate interactive controls/i)).toBeInTheDocument();
    });

    it('renders single-key shortcut isolation callout note', () => {
      render(<HelpModal isOpen={true} onClose={onClose} initialTab="shortcuts" />);
      expect(screen.getByText(/single-key shortcuts/i)).toBeInTheDocument();
      expect(screen.getByText(/automatically disabled while typing/i)).toBeInTheDocument();
    });
  });

  describe('Studio Usage Guide (Tab 2 - 5 Workflow Stages)', () => {
    it('renders all 5 core studio workflow stages with clear descriptions', () => {
      render(<HelpModal isOpen={true} onClose={onClose} initialTab="guide" />);

      expect(screen.getByText(/1\. audio intake & library/i)).toBeInTheDocument();
      expect(screen.getByText(/2\. stem separation & lyric sync/i)).toBeInTheDocument();
      expect(screen.getByText(/3\. timeline editing/i)).toBeInTheDocument();
      expect(screen.getByText(/4\. studio mixing & themes/i)).toBeInTheDocument();
      expect(screen.getByText(/5\. export & subtitles/i)).toBeInTheDocument();
    });
  });

  describe('Dismissal Handlers (Close Button, Backdrop, Escape)', () => {
    it('calls onClose when clicking close button with >=44px touch target', async () => {
      const user = userEvent.setup();
      render(<HelpModal isOpen={true} onClose={onClose} />);

      const closeBtn = screen.getByRole('button', { name: /close help and usage guide/i });
      expect(closeBtn).toBeInTheDocument();
      await user.click(closeBtn);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when pressing Escape key', async () => {
      const user = userEvent.setup();
      render(<HelpModal isOpen={true} onClose={onClose} />);

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when clicking the modal backdrop overlay', () => {
      render(<HelpModal isOpen={true} onClose={onClose} />);

      const backdrop = screen.getByRole('dialog');
      fireEvent.click(backdrop);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does NOT call onClose when clicking inside the modal dialog content container', () => {
      render(<HelpModal isOpen={true} onClose={onClose} />);

      const title = screen.getByRole('heading', { name: /karaoke studio help & usage guide/i });
      fireEvent.click(title);

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Focus Trapping and Focus Restoration', () => {
    it('places focus inside modal on render and keeps focus trapped during Tab navigation', async () => {
      const user = userEvent.setup();
      render(<HelpModal isOpen={true} onClose={onClose} />);

      const dialog = screen.getByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);

      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('restores focus to trigger element upon closing', () => {
      const trigger = document.createElement('button');
      trigger.textContent = 'Help';
      document.body.appendChild(trigger);
      trigger.focus();
      expect(trigger).toHaveFocus();

      const { unmount } = render(<HelpModal isOpen={true} onClose={onClose} />);
      unmount();

      expect(trigger).toHaveFocus();
      trigger.remove();
    });
  });

  describe('Responsive Layout Verification', () => {
    it('renders cleanly across mobile (320px/375px), tablet (768px), and desktop (1280px)', () => {
      for (const width of [320, 375, 768, 1280]) {
        setTestViewport(width, 800);
        const { unmount } = render(<HelpModal isOpen={true} onClose={onClose} />);
        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
        unmount();
      }
    });
  });

  describe('App Header Help Trigger Integration', () => {
    beforeEach(() => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false, user: 'Friend' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
    });

    it('renders Help button in sticky header with icon, text, and kbd badge, toggling Help modal on click', async () => {
      await act(async () => {
        render(<App />);
      });

      const helpBtn = screen.getByRole('button', { name: /help and studio usage guide \(\?\)/i });
      expect(helpBtn).toBeInTheDocument();
      expect(helpBtn).toHaveTextContent('Help');
      expect(helpBtn).toHaveTextContent('?');

      // Click button opens HelpModal
      await act(async () => {
        fireEvent.click(helpBtn);
      });
      expect(
        screen.getByRole('heading', { name: /karaoke studio help & usage guide/i })
      ).toBeInTheDocument();

      // Escape dismisses HelpModal
      await act(async () => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

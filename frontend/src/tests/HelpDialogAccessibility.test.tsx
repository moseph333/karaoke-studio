/**
 * HelpDialogAccessibility.test.tsx
 *
 * Empirical verification suite for HelpModal accessibility, focus restoration,
 * focus trapping, touch targets, and application view coverage across:
 * 1. Library view (!project)
 * 2. Processing pipeline view (project.status !== 'ready')
 * 3. Studio workspace (project.status === 'ready')
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpModal } from '../components/HelpModal';
import App from '../App';

describe('HelpDialogAccessibility — Empirical Verification Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default fetch mocks for App routing & status
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/status')) {
        return new Response(JSON.stringify({ auth_required: false, user: 'Tester' }), {
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

  afterEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
  });

  // =========================================================================
  // 1. Application View Coverage: Header Help Button
  // =========================================================================
  describe('Application View Coverage for Header Help Button', () => {
    it('renders and works in Library View (!project)', async () => {
      await act(async () => {
        render(<App />);
      });

      // Confirm library view is rendered (TrackSearch presence)
      expect(
        screen.getByRole('heading', { name: /turn any youtube song into karaoke/i })
      ).toBeInTheDocument();

      // Verify Header Help button
      const helpButton = screen.getByRole('button', {
        name: /help and studio usage guide \(\?\)/i,
      });
      expect(helpButton).toBeInTheDocument();
      expect(helpButton).toHaveTextContent('Help');
      expect(helpButton).toHaveTextContent('?');

      // Click to open HelpModal
      await act(async () => {
        fireEvent.click(helpButton);
      });

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: /karaoke studio help & usage guide/i })
      ).toBeInTheDocument();

      // Click again to toggle closed
      await act(async () => {
        fireEvent.click(helpButton);
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders and works in Processing Pipeline Screen (project.status === "separating")', async () => {
      // Mock project API returning a project in 'separating' state
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false, user: 'Tester' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/api/project/proc-123')) {
          return new Response(
            JSON.stringify({
              id: 'proc-123',
              title: 'Processing Song',
              artist: 'Test Artist',
              status: 'separating',
              status_detail: 'Isolating vocals with Demucs AI...',
              progress: 45,
              elapsed_seconds: 20,
              eta_seconds: 25,
              heartbeat: Date.now(),
              lines: [],
              semitones: 0,
              guide_volume: 0,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      });

      window.history.replaceState({}, '', '/?project=proc-123');

      await act(async () => {
        render(<App />);
      });

      // Confirm processing screen is active
      expect(screen.getByText(/separating\.\.\./i)).toBeInTheDocument();
      expect(screen.getByText(/45% complete/i)).toBeInTheDocument();

      // Verify Header Help button exists in processing view
      const helpButton = screen.getByRole('button', {
        name: /help and studio usage guide \(\?\)/i,
      });
      expect(helpButton).toBeInTheDocument();

      // Click to open HelpModal
      await act(async () => {
        fireEvent.click(helpButton);
      });

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: /karaoke studio help & usage guide/i })
      ).toBeInTheDocument();

      // Close modal via Escape and verify processing view remains intact
      await act(async () => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByText(/separating\.\.\./i)).toBeInTheDocument();
    });

    it('renders and works in Studio Workspace (project.status === "ready")', async () => {
      // Mock project API returning a ready project with lyric lines
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false, user: 'Tester' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/api/project/ready-123')) {
          return new Response(
            JSON.stringify({
              id: 'ready-123',
              title: 'Studio Song',
              artist: 'Karaoke Star',
              status: 'ready',
              progress: 100,
              lines: [
                {
                  id: '1',
                  text: 'Ready to sing along',
                  start_time: 1.0,
                  end_time: 4.0,
                  words: [
                    { word: 'Ready', start_time: 1.0, end_time: 1.8 },
                    { word: 'to', start_time: 1.9, end_time: 2.2 },
                    { word: 'sing', start_time: 2.3, end_time: 3.0 },
                    { word: 'along', start_time: 3.1, end_time: 4.0 },
                  ],
                },
              ],
              semitones: 0,
              guide_volume: 0,
              master_audio_url: '/audio/ready.mp3',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      });

      window.history.replaceState({}, '', '/?project=ready-123');

      await act(async () => {
        render(<App />);
      });

      // Confirm Studio Workspace view is active
      expect(screen.getByText('Studio Song')).toBeInTheDocument();

      // Verify Header Help button
      const helpButton = screen.getByRole('button', {
        name: /help and studio usage guide \(\?\)/i,
      });
      expect(helpButton).toBeInTheDocument();

      // Click to open HelpModal
      await act(async () => {
        fireEvent.click(helpButton);
      });

      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Dismiss via close button
      const closeBtn = screen.getByRole('button', { name: /close help and usage guide/i });
      await act(async () => {
        fireEvent.click(closeBtn);
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByText('Studio Song')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 2. Focus Restoration Harness
  // =========================================================================
  describe('Focus Restoration Across Dismissal Mechanisms', () => {
    // Harness component to test trigger focus restoration
    const FocusTestHarness: React.FC<{
      dismissMechanism: 'escape' | 'close-btn' | 'backdrop' | 'footer-btn' | 'toggle';
    }> = ({ dismissMechanism }) => {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <div>
          <button type="button" id="test-trigger-btn" onClick={() => setIsOpen((prev) => !prev)}>
            Launch Help
          </button>
          <button type="button" id="sibling-btn">
            Other Control
          </button>
          <HelpModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
          {isOpen && dismissMechanism === 'toggle' && (
            <button type="button" id="external-toggle-btn" onClick={() => setIsOpen(false)}>
              External Close
            </button>
          )}
        </div>
      );
    };

    it('restores focus to trigger element when closed via Escape key', async () => {
      render(<FocusTestHarness dismissMechanism="escape" />);

      const triggerBtn = screen.getByRole('button', { name: 'Launch Help' });
      triggerBtn.focus();
      expect(document.activeElement).toBe(triggerBtn);

      // Open modal
      fireEvent.click(triggerBtn);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Close via Escape
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Focus must be restored to triggerBtn
      expect(document.activeElement).toBe(triggerBtn);
    });

    it('restores focus to trigger element when closed via Close button', async () => {
      render(<FocusTestHarness dismissMechanism="close-btn" />);

      const triggerBtn = screen.getByRole('button', { name: 'Launch Help' });
      triggerBtn.focus();
      expect(document.activeElement).toBe(triggerBtn);

      fireEvent.click(triggerBtn);
      const closeBtn = screen.getByRole('button', { name: /close help and usage guide/i });
      expect(closeBtn).toBeInTheDocument();

      fireEvent.click(closeBtn);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Focus must be restored to triggerBtn
      expect(document.activeElement).toBe(triggerBtn);
    });

    it('restores focus to trigger element when closed via Backdrop click', async () => {
      render(<FocusTestHarness dismissMechanism="backdrop" />);

      const triggerBtn = screen.getByRole('button', { name: 'Launch Help' });
      triggerBtn.focus();
      expect(document.activeElement).toBe(triggerBtn);

      fireEvent.click(triggerBtn);
      const backdrop = screen.getByRole('dialog');
      expect(backdrop).toBeInTheDocument();

      // Click outer backdrop
      fireEvent.click(backdrop);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Focus must be restored to triggerBtn
      expect(document.activeElement).toBe(triggerBtn);
    });

    it('restores focus to trigger element when closed via Footer button', async () => {
      render(<FocusTestHarness dismissMechanism="footer-btn" />);

      const triggerBtn = screen.getByRole('button', { name: 'Launch Help' });
      triggerBtn.focus();
      expect(document.activeElement).toBe(triggerBtn);

      fireEvent.click(triggerBtn);
      const footerBtn = screen.getByRole('button', { name: /got it, close/i });
      expect(footerBtn).toBeInTheDocument();

      fireEvent.click(footerBtn);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Focus must be restored to triggerBtn
      expect(document.activeElement).toBe(triggerBtn);
    });

    it('restores focus to preceding element when opened from a studio control', async () => {
      // Simulate user focusing an arbitrary studio control before modal opens
      const studioControl = document.createElement('button');
      studioControl.id = 'studio-seek-btn';
      studioControl.textContent = 'Seek +5s';
      document.body.appendChild(studioControl);
      studioControl.focus();
      expect(document.activeElement).toBe(studioControl);

      const onClose = vi.fn();
      const { rerender } = render(<HelpModal isOpen={true} onClose={onClose} />);

      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Trigger Escape to close
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();

      // Re-render with isOpen={false}
      rerender(<HelpModal isOpen={false} onClose={onClose} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Verify focus returned to the studio control
      expect(document.activeElement).toBe(studioControl);
      studioControl.remove();
    });

    it('handles disconnected trigger element gracefully on close without crashing', () => {
      const ephemeralTrigger = document.createElement('button');
      ephemeralTrigger.textContent = 'Temp Trigger';
      document.body.appendChild(ephemeralTrigger);
      ephemeralTrigger.focus();

      const onClose = vi.fn();
      const { rerender } = render(<HelpModal isOpen={true} onClose={onClose} />);

      // Remove the trigger from DOM while modal is open
      ephemeralTrigger.remove();
      expect(ephemeralTrigger.isConnected).toBe(false);

      // Close modal - should not throw error
      expect(() => {
        rerender(<HelpModal isOpen={false} onClose={onClose} />);
      }).not.toThrow();
    });
  });

  // =========================================================================
  // 3. Focus Trapping & Tab Cycling
  // =========================================================================
  describe('Focus Trapping (Tab / Shift+Tab Wrapping)', () => {
    it('places focus on the first focusable element (Close button) on mount', () => {
      render(<HelpModal isOpen={true} onClose={vi.fn()} />);

      const closeBtn = screen.getByRole('button', { name: /close help and usage guide/i });
      expect(document.activeElement).toBe(closeBtn);
    });

    it('wraps focus from last element (Footer button) to first element (Close button) on Tab', () => {
      render(<HelpModal isOpen={true} onClose={vi.fn()} />);

      const closeBtn = screen.getByRole('button', { name: /close help and usage guide/i });
      const footerBtn = screen.getByRole('button', { name: /got it, close/i });

      // Focus last element
      footerBtn.focus();
      expect(document.activeElement).toBe(footerBtn);

      // Press Tab
      fireEvent.keyDown(window, { key: 'Tab' });

      // Focus wraps to first element
      expect(document.activeElement).toBe(closeBtn);
    });

    it('wraps focus from first element (Close button) to last element (Footer button) on Shift+Tab', () => {
      render(<HelpModal isOpen={true} onClose={vi.fn()} />);

      const closeBtn = screen.getByRole('button', { name: /close help and usage guide/i });
      const footerBtn = screen.getByRole('button', { name: /got it, close/i });

      // Focus first element
      closeBtn.focus();
      expect(document.activeElement).toBe(closeBtn);

      // Press Shift+Tab
      fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });

      // Focus wraps to last element
      expect(document.activeElement).toBe(footerBtn);
    });

    it('brings focus into modal when Tab is pressed while focus is outside container', () => {
      render(<HelpModal isOpen={true} onClose={vi.fn()} />);

      const closeBtn = screen.getByRole('button', { name: /close help and usage guide/i });
      const footerBtn = screen.getByRole('button', { name: /got it, close/i });

      // Force focus outside container (e.g. document.body)
      document.body.focus();

      // Tab -> first element
      fireEvent.keyDown(window, { key: 'Tab' });
      expect(document.activeElement).toBe(closeBtn);

      // Force focus outside again
      document.body.focus();

      // Shift+Tab -> last element
      fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(footerBtn);
    });

    it('includes all primary interactive controls in tab sequence', () => {
      render(<HelpModal isOpen={true} onClose={vi.fn()} initialTab="shortcuts" />);

      const closeBtn = screen.getByRole('button', { name: /close help and usage guide/i });
      const shortcutsTab = screen.getByRole('tab', { name: /keyboard shortcuts/i });
      const guideTab = screen.getByRole('tab', { name: /studio usage guide/i });
      const tabpanel = screen.getByRole('tabpanel', { name: /keyboard shortcuts/i });
      const footerBtn = screen.getByRole('button', { name: /got it, close/i });

      expect(closeBtn.tabIndex).not.toBe(-1);
      expect(shortcutsTab.tabIndex).not.toBe(-1);
      expect(guideTab.tabIndex).not.toBe(-1);
      expect(tabpanel.tabIndex).toBe(0);
      expect(footerBtn.tabIndex).not.toBe(-1);
    });
  });

  // =========================================================================
  // 4. Tab Switching & ARIA Mechanics
  // =========================================================================
  describe('Tab Switching and ARIA Attribute Integrity', () => {
    it('maintains proper ARIA tablist/tab/tabpanel roles and relationships', async () => {
      const user = userEvent.setup();
      render(<HelpModal isOpen={true} onClose={vi.fn()} />);

      const tablist = screen.getByRole('tablist', { name: /help topics/i });
      expect(tablist).toBeInTheDocument();

      const shortcutsTab = screen.getByRole('tab', { name: /keyboard shortcuts/i });
      const guideTab = screen.getByRole('tab', { name: /studio usage guide/i });

      // 1. Initial State: Shortcuts tab selected
      expect(shortcutsTab).toHaveAttribute('aria-selected', 'true');
      expect(shortcutsTab).toHaveAttribute('aria-controls', 'tabpanel-shortcuts');
      expect(guideTab).toHaveAttribute('aria-selected', 'false');
      expect(guideTab).toHaveAttribute('aria-controls', 'tabpanel-guide');

      const shortcutsPanel = screen.getByRole('tabpanel', { name: /keyboard shortcuts/i });
      expect(shortcutsPanel).toHaveAttribute('id', 'tabpanel-shortcuts');
      expect(shortcutsPanel).toHaveAttribute('aria-labelledby', 'tab-shortcuts');
      expect(
        screen.queryByRole('tabpanel', { name: /studio usage guide/i })
      ).not.toBeInTheDocument();

      // 2. Switch to Guide tab
      await user.click(guideTab);

      expect(shortcutsTab).toHaveAttribute('aria-selected', 'false');
      expect(guideTab).toHaveAttribute('aria-selected', 'true');

      const guidePanel = screen.getByRole('tabpanel', { name: /studio usage guide/i });
      expect(guidePanel).toHaveAttribute('id', 'tabpanel-guide');
      expect(guidePanel).toHaveAttribute('aria-labelledby', 'tab-guide');
      expect(
        screen.queryByRole('tabpanel', { name: /keyboard shortcuts/i })
      ).not.toBeInTheDocument();

      // Check all 5 stages in guide panel
      expect(screen.getByText(/1\. audio intake & library/i)).toBeInTheDocument();
      expect(screen.getByText(/2\. stem separation & lyric sync/i)).toBeInTheDocument();
      expect(screen.getByText(/3\. timeline editing/i)).toBeInTheDocument();
      expect(screen.getByText(/4\. studio mixing & themes/i)).toBeInTheDocument();
      expect(screen.getByText(/5\. export & subtitles/i)).toBeInTheDocument();

      // 3. Switch back to Shortcuts tab
      await user.click(shortcutsTab);

      expect(shortcutsTab).toHaveAttribute('aria-selected', 'true');
      expect(guideTab).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByRole('tabpanel', { name: /keyboard shortcuts/i })).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 5. Touch Targets (>=44px)
  // =========================================================================
  describe('Touch Targets (>= 44px Standards)', () => {
    it('verifies close button provides >=44px touch target via CSS classes', () => {
      render(<HelpModal isOpen={true} onClose={vi.fn()} />);

      const closeBtn = screen.getByRole('button', { name: /close help and usage guide/i });
      expect(closeBtn.className).toContain('min-w-[44px]');
      expect(closeBtn.className).toContain('min-h-[44px]');
    });

    it('verifies tab buttons provide >=44px touch height and sufficient touch width', () => {
      render(<HelpModal isOpen={true} onClose={vi.fn()} />);

      const shortcutsTab = screen.getByRole('tab', { name: /keyboard shortcuts/i });
      const guideTab = screen.getByRole('tab', { name: /studio usage guide/i });

      // Check min-h-[44px]
      expect(shortcutsTab.className).toContain('min-h-[44px]');
      expect(guideTab.className).toContain('min-h-[44px]');

      // Check horizontal padding for touch ergonomics (px-3 sm:px-4)
      expect(shortcutsTab.className).toContain('px-3');
      expect(guideTab.className).toContain('px-3');
    });

    it('verifies footer dismissal button provides >=44px touch target', () => {
      render(<HelpModal isOpen={true} onClose={vi.fn()} />);

      const footerBtn = screen.getByRole('button', { name: /got it, close/i });
      expect(footerBtn.className).toContain('min-h-[44px]');
      expect(footerBtn.className).toContain('min-w-[44px]');
    });
  });

  // =========================================================================
  // 6. Keyboard Shortcut Integration & Transport Silencing
  // =========================================================================
  describe('Hotkey Integration (?) & Transport Silencing Stress Tests', () => {
    it('opens HelpModal on pressing "?" outside text inputs in Library View', async () => {
      await act(async () => {
        render(<App />);
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Press '?' on window
      await act(async () => {
        fireEvent.keyDown(window, { key: '?' });
      });

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: /karaoke studio help & usage guide/i })
      ).toBeInTheDocument();
    });

    it('does NOT open HelpModal when pressing "?" inside an input or textarea', async () => {
      await act(async () => {
        render(<App />);
      });

      const searchInput = screen.getByRole('textbox', {
        name: /paste youtube or youtube music url/i,
      });
      expect(searchInput).toBeInTheDocument();
      searchInput.focus();
      expect(document.activeElement).toBe(searchInput);

      // Press '?' while focused inside input
      await act(async () => {
        fireEvent.keyDown(searchInput, { key: '?' });
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('toggles HelpModal closed when pressing "?" while HelpModal is open', async () => {
      await act(async () => {
        render(<App />);
      });

      // Open HelpModal
      await act(async () => {
        fireEvent.keyDown(window, { key: '?' });
      });
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Press '?' again to toggle close
      await act(async () => {
        fireEvent.keyDown(window, { key: '?' });
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('silences Space, ArrowLeft, ArrowRight, and M while HelpModal is open', async () => {
      // Mock studio ready project
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false, user: 'Tester' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('/api/project/ready-silence')) {
          return new Response(
            JSON.stringify({
              id: 'ready-silence',
              title: 'Silence Test Song',
              artist: 'Tester',
              status: 'ready',
              progress: 100,
              lines: [{ id: '1', text: 'Test Line', start_time: 1.0, end_time: 4.0, words: [] }],
              semitones: 0,
              guide_volume: 0,
              master_audio_url: '/audio/test.mp3',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      });

      window.history.replaceState({}, '', '/?project=ready-silence');

      await act(async () => {
        render(<App />);
      });

      // Open HelpModal via button
      const helpButton = screen.getByRole('button', {
        name: /help and studio usage guide \(\?\)/i,
      });
      await act(async () => {
        fireEvent.click(helpButton);
      });
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Verify audio methods are not triggered by transport hotkeys
      const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play');
      const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause');

      await act(async () => {
        fireEvent.keyDown(window, { code: 'Space', key: ' ' });
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        fireEvent.keyDown(window, { key: 'm' });
        fireEvent.keyDown(window, { key: 'M' });
      });

      expect(playSpy).not.toHaveBeenCalled();
      expect(pauseSpy).not.toHaveBeenCalled();
    });
  });
});

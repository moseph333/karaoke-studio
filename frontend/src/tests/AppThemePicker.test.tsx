/**
 * AppThemePicker.test.tsx
 *
 * Comprehensive unit and accessibility verification suite for AppThemePicker:
 * 1. Initial render & WAI-ARIA attributes (aria-haspopup, aria-expanded, aria-label, swatches)
 * 2. Opening & closing via mouse interaction & click-outside
 * 3. Theme selection via mouse with DOM data-theme & localStorage persistence
 * 4. Keyboard accessibility: Enter/Space/ArrowDown/ArrowUp to open
 * 5. Keyboard navigation: ArrowDown, ArrowUp, Home, End & aria-activedescendant
 * 6. Keyboard selection: Enter & Space selecting highlighted theme and restoring focus
 * 7. Keyboard dismissal: Escape closing without changing selection and restoring focus
 * 8. Tab dismissal preserving default focus progression
 * 9. StudioHeader integration without breaking Help or Profile actions
 * 10. Fallback resilience outside <AppThemeProvider>
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppThemePicker } from '../components/AppThemePicker';
import { StudioHeader } from '../components/StudioHeader';
import { AppThemeProvider } from '../context/AppThemeContext';
import { APP_THEMES, APP_THEME_LIST, DEFAULT_APP_THEME_ID } from '../theme/appThemes';

describe('AppThemePicker (Accessible Application Theme Picker)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.cssText = '';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const renderWithProvider = (ui: React.ReactElement, initialTheme = DEFAULT_APP_THEME_ID) => {
    return render(<AppThemeProvider initialThemeId={initialTheme}>{ui}</AppThemeProvider>);
  };

  // =========================================================================
  // 1. Initial Render & ARIA Structure
  // =========================================================================
  describe('1. Initial Render & ARIA Structure', () => {
    it('renders trigger button with proper ARIA attributes and current theme info', () => {
      renderWithProvider(<AppThemePicker />);

      const trigger = screen.getByRole('button', { name: /select theme/i });
      expect(trigger).toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).toHaveAttribute('aria-controls');

      // Displays current theme name ("Punk Rock DIY")
      expect(trigger).toHaveTextContent(APP_THEMES.punk_diy.name);

      // Listbox is closed initially
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 2. Mouse Interaction: Open, Close, Click Outside
  // =========================================================================
  describe('2. Mouse Interaction: Open, Close, and Dismissal', () => {
    it('opens listbox on trigger click and displays all 4 themes with checkmark on active', () => {
      renderWithProvider(<AppThemePicker />);

      const trigger = screen.getByRole('button', { name: /select theme/i });
      fireEvent.click(trigger);

      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const listbox = screen.getByRole('listbox', { name: /available application themes/i });
      expect(listbox).toBeInTheDocument();

      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(4);

      // Verify each theme option details
      APP_THEME_LIST.forEach((theme, idx) => {
        const opt = options[idx];
        expect(opt).toHaveAttribute('data-theme-id', theme.id);
        expect(opt).toHaveTextContent(theme.name);
        expect(opt).toHaveTextContent(theme.tagline);
        if (theme.id === 'punk_diy') {
          expect(opt).toHaveAttribute('aria-selected', 'true');
        } else {
          expect(opt).toHaveAttribute('aria-selected', 'false');
        }
      });
    });

    it('toggles listbox closed when trigger is clicked again', () => {
      renderWithProvider(<AppThemePicker />);

      const trigger = screen.getByRole('button', { name: /select theme/i });
      fireEvent.click(trigger);
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      fireEvent.click(trigger);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('closes listbox when clicking outside the component container', () => {
      renderWithProvider(
        <div>
          <button data-testid="outside-button">Outside</button>
          <AppThemePicker />
        </div>
      );

      const trigger = screen.getByRole('button', { name: /select theme/i });
      fireEvent.click(trigger);
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      const outsideBtn = screen.getByTestId('outside-button');
      fireEvent.mouseDown(outsideBtn);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  // =========================================================================
  // 3. Selection via Mouse Click
  // =========================================================================
  describe('3. Selection via Mouse Click', () => {
    it('selects new theme, updates DOM data-theme and localStorage, and closes dropdown', () => {
      renderWithProvider(<AppThemePicker />);

      const trigger = screen.getByRole('button', { name: /select theme/i });
      fireEvent.click(trigger);

      // Select 'tape_studio_70s' ("Reel-to-Reel '74")
      const tapeOption = screen.getByRole('option', { name: /reel-to-reel '74/i });
      fireEvent.click(tapeOption);

      // Dropdown closed
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      // Trigger updated
      expect(trigger).toHaveTextContent(APP_THEMES.tape_studio_70s.name);

      // DOM synced
      expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');

      // LocalStorage persisted
      expect(localStorage.getItem('karaoke_app_theme')).toBe('tape_studio_70s');
    });
  });

  // =========================================================================
  // 4. Keyboard Navigation: Opening (Enter, Space, ArrowDown, ArrowUp)
  // =========================================================================
  describe('4. Keyboard Navigation: Opening', () => {
    it('opens listbox when pressing Enter on focused trigger', () => {
      renderWithProvider(<AppThemePicker />);
      const trigger = screen.getByRole('button', { name: /select theme/i });

      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    it('opens listbox when pressing Space on focused trigger', () => {
      renderWithProvider(<AppThemePicker />);
      const trigger = screen.getByRole('button', { name: /select theme/i });

      trigger.focus();
      fireEvent.keyDown(trigger, { key: ' ' });
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    it('opens listbox when pressing ArrowDown on focused trigger', () => {
      renderWithProvider(<AppThemePicker />);
      const trigger = screen.getByRole('button', { name: /select theme/i });

      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    it('opens listbox when pressing ArrowUp on focused trigger', () => {
      renderWithProvider(<AppThemePicker />);
      const trigger = screen.getByRole('button', { name: /select theme/i });

      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'ArrowUp' });
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });
  });

  // =========================================================================
  // 5. Keyboard Navigation: ArrowDown, ArrowUp, Home, End & Active Descendant
  // =========================================================================
  describe('5. Keyboard Navigation: Traversing Options', () => {
    it('navigates through options with ArrowDown and ArrowUp updating aria-activedescendant', () => {
      renderWithProvider(<AppThemePicker />);
      const trigger = screen.getByRole('button', { name: /select theme/i });

      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // Opens, highlighted = 0 (punk_diy)
      expect(trigger).toHaveAttribute('aria-activedescendant', 'theme-option-punk_diy');

      fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // highlighted = 1 (tape_studio_70s)
      expect(trigger).toHaveAttribute('aria-activedescendant', 'theme-option-tape_studio_70s');

      fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // highlighted = 2 (dive_bar_crt)
      expect(trigger).toHaveAttribute('aria-activedescendant', 'theme-option-dive_bar_crt');

      fireEvent.keyDown(trigger, { key: 'ArrowUp' }); // highlighted = 1 (tape_studio_70s)
      expect(trigger).toHaveAttribute('aria-activedescendant', 'theme-option-tape_studio_70s');
    });

    it('jumps to end with End key and jumps to beginning with Home key', () => {
      renderWithProvider(<AppThemePicker />);
      const trigger = screen.getByRole('button', { name: /select theme/i });

      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'Enter' }); // Opens at 0

      fireEvent.keyDown(trigger, { key: 'End' });
      expect(trigger).toHaveAttribute('aria-activedescendant', 'theme-option-clean_paper');

      fireEvent.keyDown(trigger, { key: 'Home' });
      expect(trigger).toHaveAttribute('aria-activedescendant', 'theme-option-punk_diy');
    });
  });

  // =========================================================================
  // 6. Keyboard Selection: Enter & Space
  // =========================================================================
  describe('6. Keyboard Selection: Enter & Space', () => {
    it('selects option with Enter, updates theme, closes listbox and returns focus', () => {
      renderWithProvider(<AppThemePicker />);
      const trigger = screen.getByRole('button', { name: /select theme/i });

      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'Enter' }); // Opens

      fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // Move to tape_studio_70s
      fireEvent.keyDown(trigger, { key: 'Enter' }); // Select

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(document.documentElement.getAttribute('data-theme')).toBe('tape_studio_70s');
      expect(trigger).toHaveTextContent(APP_THEMES.tape_studio_70s.name);
      expect(document.activeElement).toBe(trigger);
    });

    it('selects option with Space, updates theme, closes listbox and returns focus', () => {
      renderWithProvider(<AppThemePicker />);
      const trigger = screen.getByRole('button', { name: /select theme/i });

      trigger.focus();
      fireEvent.keyDown(trigger, { key: ' ' }); // Opens

      fireEvent.keyDown(trigger, { key: 'End' }); // Move to clean_paper
      fireEvent.keyDown(trigger, { key: ' ' }); // Select

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(document.documentElement.getAttribute('data-theme')).toBe('clean_paper');
      expect(trigger).toHaveTextContent(APP_THEMES.clean_paper.name);
      expect(document.activeElement).toBe(trigger);
    });
  });

  // =========================================================================
  // 7. Keyboard Dismissal: Escape & Tab
  // =========================================================================
  describe('7. Keyboard Dismissal: Escape & Tab', () => {
    it('closes listbox on Escape without modifying theme selection and restores focus', () => {
      renderWithProvider(<AppThemePicker />);
      const trigger = screen.getByRole('button', { name: /select theme/i });

      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // Highlight tape
      fireEvent.keyDown(trigger, { key: 'Escape' }); // Dismiss

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_APP_THEME_ID);
      expect(document.activeElement).toBe(trigger);
    });

    it('closes listbox on Tab key press allowing normal tab progression', () => {
      renderWithProvider(<AppThemePicker />);
      const trigger = screen.getByRole('button', { name: /select theme/i });

      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'Enter' });
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      fireEvent.keyDown(trigger, { key: 'Tab' });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 8. StudioHeader Integration & Backward Compatibility
  // =========================================================================
  describe('8. StudioHeader Integration', () => {
    it('mounts inside StudioHeader cleanly alongside Help and Profile actions', () => {
      renderWithProvider(
        <StudioHeader
          currentUser="TestSinger"
          project={null}
          isLyricsDirty={false}
          onOpenHelp={vi.fn()}
          onOpenAuth={vi.fn()}
          onNewSong={vi.fn()}
          onStartRender={vi.fn()}
        />
      );

      // Verify theme picker is present
      expect(screen.getByRole('button', { name: /select theme/i })).toBeInTheDocument();

      // Verify existing actions are present and uncompromised
      expect(
        screen.getByRole('button', { name: /help and studio usage guide/i })
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /logged in as testsinger/i })).toBeInTheDocument();
    });

    it('functions safely without throwing when mounted outside AppThemeProvider', () => {
      // Direct render outside provider tests the useAppTheme resilient fallback
      expect(() => {
        render(<AppThemePicker />);
      }).not.toThrow();

      const trigger = screen.getByRole('button', { name: /select theme/i });
      expect(trigger).toBeInTheDocument();
      expect(trigger).toHaveTextContent(APP_THEMES.punk_diy.name);
    });
  });
});

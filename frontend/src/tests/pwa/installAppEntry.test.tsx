/**
 * Where installing is offered: an "Install app" header button on the library screen, the
 * iOS Add to Home Screen sheet, and a command palette entry.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StudioHeader } from '../../components/StudioHeader';
import { InstallAppDialog } from '../../components/InstallAppDialog';
import { AppThemeProvider } from '../../context/AppThemeContext';
import { ProjectState } from '../../types';
import { setTestViewport, resetTestViewport } from '../helpers/responsiveTestUtils';

const project = {
  id: 'p1',
  status: 'ready',
  progress: 100,
  title: 'Song',
  artist: 'Artist',
  lines: [],
  semitones: 0,
  guide_volume: 0,
} as unknown as ProjectState;

function renderHeader(props: Partial<React.ComponentProps<typeof StudioHeader>> = {}) {
  return render(
    <AppThemeProvider>
      <StudioHeader
        currentUser="Friend"
        project={null}
        isLyricsDirty={false}
        onOpenHelp={vi.fn()}
        onOpenAuth={vi.fn()}
        onNewSong={vi.fn()}
        {...props}
      />
    </AppThemeProvider>
  );
}

describe('install entry points', () => {
  afterEach(() => {
    cleanup();
    resetTestViewport();
  });

  it('shows a 44 px Install app button on the library screen when installing is possible', () => {
    setTestViewport(375, 667);
    const onInstallApp = vi.fn();
    renderHeader({ onInstallApp });
    const button = screen.getByRole('button', { name: 'Install app' });
    expect(button.className).toContain('min-h-[44px]');
    expect(button.className).toContain('min-w-[44px]');
    fireEvent.click(button);
    expect(onInstallApp).toHaveBeenCalledTimes(1);
  });

  it('leaves the button out when installing is not possible, and inside a song', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
    cleanup();
    renderHeader({ onInstallApp: vi.fn(), project });
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull();
  });

  it('clears the status bar and notch in the installed app', () => {
    const { container } = renderHeader();
    expect(container.querySelector('header')?.className).toContain(
      'pt-[env(safe-area-inset-top,0px)]'
    );
  });

  it('walks through Share, Add to Home Screen and Add on iOS', () => {
    const onClose = vi.fn();
    const onHideButton = vi.fn();
    render(<InstallAppDialog isOpen onClose={onClose} onHideButton={onHideButton} />);
    const dialog = screen.getByRole('dialog', { name: 'Install Karaoke Studio' });
    const steps = dialog.querySelectorAll('ol > li');
    expect(steps).toHaveLength(3);
    expect(steps[0].textContent).toContain('Share');
    expect(steps[1].textContent).toContain('Add to Home Screen');
    expect(steps[2].textContent).toContain('Add');

    fireEvent.click(screen.getByRole('button', { name: "Don't show the install button" }));
    expect(onHideButton).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('drops the hide option once the button is already hidden', () => {
    render(<InstallAppDialog isOpen onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: "Don't show the install button" })).toBeNull();
    expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy();
  });
});

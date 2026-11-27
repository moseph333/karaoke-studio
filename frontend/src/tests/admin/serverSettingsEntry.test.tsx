/**
 * The ways into the Server settings page: the command palette, Help's footer and the link
 * `/?admin=1`. The studio offers them only where the server has an admin passphrase, and
 * never as a button in the header, where every singer would see it.
 */
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { loadDeferredScreens } from '../../deferredScreens';
import { resetCapabilitiesCache } from '../../hooks/useCapabilities';
import { AdminServer, mockAdminServer } from '../helpers/serverSettingsFixtures';

let server: AdminServer;

async function openHome(address = '/') {
  window.history.pushState({}, '', address);
  render(<App />);
  await screen.findByRole('heading', { level: 1 });
}

const settingsDialog = () => screen.findByRole('dialog', { name: 'Server settings' });

beforeAll(() => loadDeferredScreens());

beforeEach(() => {
  localStorage.clear();
  resetCapabilitiesCache();
  server = mockAdminServer();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/');
});

describe('on a server with an admin passphrase', () => {
  it('opens from the command palette, locked', async () => {
    const user = userEvent.setup();
    await openHome();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await user.type(await screen.findByRole('combobox', { name: /search commands/i }), 'admin');
    await user.click(await screen.findByRole('option', { name: /Server settings/ }));

    const dialog = await settingsDialog();
    expect(await within(dialog).findByLabelText('Admin passphrase')).toBeInTheDocument();
  });

  it('opens from Help, which steps aside for it', async () => {
    const user = userEvent.setup();
    await openHome();
    fireEvent.keyDown(window, { key: '?' });
    await user.click(await screen.findByRole('button', { name: 'Server settings' }));

    expect(await settingsDialog()).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'What you can do' })).toBeNull();
  });

  it('opens from the link, which then loses its parameter', async () => {
    await openHome('/?admin=1');

    expect(await settingsDialog()).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('closes back to the screen it was opened over', async () => {
    const user = userEvent.setup();
    await openHome('/?admin=1');
    const dialog = await settingsDialog();

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Server settings' })).toBeNull()
    );
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('has no button in the header', async () => {
    await openHome();

    expect(within(screen.getByRole('banner')).queryByText(/settings/i)).toBeNull();
  });
});

describe('on a server without one', () => {
  beforeEach(() => {
    server.enabled = false;
  });

  it('is not offered in the command palette', async () => {
    const user = userEvent.setup();
    await openHome();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await user.type(await screen.findByRole('combobox', { name: /search commands/i }), 'admin');

    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Server settings/ })).toBeNull()
    );
  });

  it('is not offered in Help', async () => {
    await openHome();
    fireEvent.keyDown(window, { key: '?' });
    await screen.findByRole('tab', { name: 'What you can do' });

    expect(screen.queryByRole('button', { name: 'Server settings' })).toBeNull();
  });

  it('says why when the link is opened anyway', async () => {
    await openHome('/?admin=1');

    const dialog = await settingsDialog();
    expect(await within(dialog).findByText(/has no admin passphrase/)).toBeInTheDocument();
  });
});

/**
 * The Server settings page: locked until the admin passphrase is given, then every setting
 * with a switch, a choice or a number, saved together and applied at once.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AUTH_TOKEN_KEY } from '../../api';
import { ServerSettingsDialog } from '../../components/admin/ServerSettingsDialog';
import { resetCapabilitiesCache, useCapabilities } from '../../hooks/useCapabilities';
import { ToastProvider } from '../../hooks/useToast';
import { ADMIN_TOKEN_KEY } from '../../utils/adminSession';
import { assertZeroHorizontalOverflow, setTestViewport } from '../helpers/responsiveTestUtils';
import {
  ADMIN_PASSPHRASE,
  ADMIN_TOKEN,
  AdminServer,
  mockAdminServer,
} from '../helpers/serverSettingsFixtures';

let server: AdminServer;

function open() {
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <ServerSettingsDialog isOpen onClose={onClose} />
    </ToastProvider>
  );
  return onClose;
}

/** The page, already unlocked in this browser. */
async function openUnlocked() {
  localStorage.setItem(ADMIN_TOKEN_KEY, ADMIN_TOKEN);
  const onClose = open();
  await screen.findByRole('heading', { name: 'Song loops' });
  return onClose;
}

const row = (id: string) => within(screen.getByTestId(`setting-row-${id}`));
const saveButton = () => screen.getByRole('button', { name: 'Save changes' });

beforeEach(() => {
  resetCapabilitiesCache();
  server = mockAdminServer();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('opening the page', () => {
  it('asks for the admin passphrase first, with the field focused', async () => {
    open();

    const field = await screen.findByLabelText('Admin passphrase');
    expect(field).toHaveAttribute('type', 'password');
    await waitFor(() => expect(field).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Song loops' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('unlocks with the passphrase and remembers it in this browser', async () => {
    const user = userEvent.setup();
    open();

    await user.type(await screen.findByLabelText('Admin passphrase'), ADMIN_PASSPHRASE);
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByRole('heading', { name: 'Song loops' })).toBeInTheDocument();
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBe(ADMIN_TOKEN);
    expect(screen.queryByLabelText('Admin passphrase')).toBeNull();
  });

  it('says so for a wrong passphrase, without signing the studio out', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'studio-session');
    const user = userEvent.setup();
    open();

    await user.type(await screen.findByLabelText('Admin passphrase'), 'a guess');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByText('Incorrect admin passphrase')).toBeInTheDocument();
    expect(screen.getByLabelText('Admin passphrase')).toBeInvalid();
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('studio-session');
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it('opens straight to the settings in a browser that was unlocked before', async () => {
    await openUnlocked();

    expect(screen.queryByLabelText('Admin passphrase')).toBeNull();
    for (const title of ['Song loops', 'Stem quality', 'Export and cloud', 'Limits and search']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  it('asks again when the remembered unlock has run out', async () => {
    localStorage.setItem(ADMIN_TOKEN_KEY, 'an.old.token');
    open();

    expect(await screen.findByLabelText('Admin passphrase')).toBeInTheDocument();
  });

  it('explains a server that has no admin passphrase', async () => {
    server.enabled = false;
    open();

    expect(await screen.findByText(/has no admin passphrase/)).toBeInTheDocument();
    expect(screen.getByText('ADMIN_PASSWORD')).toBeInTheDocument();
    expect(screen.queryByLabelText('Admin passphrase')).toBeNull();
  });

  it('offers to try again when the server cannot be asked', async () => {
    server.spy.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    open();

    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Admin passphrase')).toBeInTheDocument();
  });
});

describe('the settings', () => {
  it('show each one as the server has it', async () => {
    await openUnlocked();

    expect(screen.getByRole('switch', { name: 'Make song loops' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Video models offered: Best' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Video models offered: Fast' })).toBeChecked();
    expect(
      within(screen.getByRole('radiogroup', { name: 'Default video model' })).getByRole('radio', {
        name: 'Best',
      })
    ).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: 'Longest song, in minutes' })).toHaveValue(60);
    expect(saveButton()).toBeDisabled();
    // Nothing was changed here, so nothing is labelled
    expect(screen.queryByText(/Changed here/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reset / })).toBeNull();
  });

  it('give every control a name of its own', async () => {
    await openUnlocked();

    const dialog = screen.getByRole('dialog');
    const names = ['switch', 'radio', 'spinbutton', 'button'].flatMap((role) =>
      within(dialog)
        .getAllByRole(role)
        .map((el) => `${role}: ${el.getAttribute('aria-label') ?? el.textContent}`)
    );
    const switches = within(dialog).getAllByRole('switch');
    const switchNames = switches.map(
      (el) => document.getElementById(el.getAttribute('aria-labelledby') ?? '')?.textContent
    );
    expect(new Set(switchNames).size).toBe(switchNames.length);
    expect(names.length).toBeGreaterThan(20);
  });

  it('turn the heavy video model off and make the light one the default', async () => {
    const user = userEvent.setup();
    await openUnlocked();

    await user.click(screen.getByRole('switch', { name: 'Video models offered: Best' }));

    // The default follows, and the last model left cannot be switched off
    const defaults = screen.getByRole('radiogroup', { name: 'Default video model' });
    expect(within(defaults).getAllByRole('radio')).toHaveLength(1);
    expect(within(defaults).getByRole('radio', { name: 'Fast' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Video models offered: Fast' })).toBeDisabled();
    expect(screen.getByText('2 changes not saved yet')).toBeInTheDocument();

    await user.click(saveButton());

    await waitFor(() =>
      expect(server.saves).toEqual([
        { 'song_loop.models': ['ltx'], 'song_loop.default_model': 'ltx' },
      ])
    );
    expect(await screen.findByText('Server settings saved')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    expect(row('song_loop.models').getByText(/Changed here/)).toHaveTextContent(
      'The server’s own setting is Best, Fast.'.replace('’', "'")
    );
  });

  it('keep Fast stems on, whatever else is switched off', async () => {
    const user = userEvent.setup();
    await openUnlocked();

    expect(screen.getByRole('switch', { name: 'Presets offered: Fast' })).toBeDisabled();
    await user.click(screen.getByRole('switch', { name: 'Presets offered: Best' }));

    const defaults = screen.getByRole('radiogroup', { name: 'Default for new songs' });
    expect(
      within(defaults)
        .getAllByRole('radio')
        .map((radio) => radio.textContent)
    ).toEqual(['Fast', 'Balanced']);
    expect(within(defaults).getByRole('radio', { name: 'Fast' })).toBeChecked();
  });

  it('take whole minutes and say so for anything else', async () => {
    const user = userEvent.setup();
    await openUnlocked();
    const minutes = screen.getByRole('spinbutton', { name: 'Longest song, in minutes' });

    await user.clear(minutes);
    expect(row('limits.song_minutes').getByRole('alert')).toHaveTextContent(
      'Enter a whole number from 0 to 600.'
    );
    await user.type(minutes, '15');
    expect(row('limits.song_minutes').queryByRole('alert')).toBeNull();
    await user.click(saveButton());

    await waitFor(() => expect(server.saves).toEqual([{ 'limits.song_minutes': 15 }]));
  });

  it('drop a change that is undone before saving', async () => {
    const user = userEvent.setup();
    await openUnlocked();
    const warmUp = screen.getByRole('switch', { name: 'Start a cloud machine when Export opens' });

    await user.click(warmUp);
    expect(screen.getByText('1 change not saved yet')).toBeInTheDocument();
    await user.click(warmUp);

    expect(screen.queryByText(/not saved yet/)).toBeNull();
    expect(saveButton()).toBeDisabled();
  });

  it('say when a cloud setting is on but the cloud cannot be asked', async () => {
    server.state.cloud = { ready: false, reason: 'Modal credentials are missing' };
    await openUnlocked();

    expect(
      row('render.cloud').getByText(/cannot be asked from this server: Modal credentials/)
    ).toBeInTheDocument();
    // A warm-up is no cloud switch of its own
    expect(row('render.prewarm').queryByText(/cannot be asked/)).toBeNull();
  });
});

describe('handing a setting back to the server', () => {
  beforeEach(() => {
    server.state.settings['limits.song_minutes'] = { value: 15, default: 60, overridden: true };
  });

  it('labels only the setting that was changed here, with what it would go back to', async () => {
    await openUnlocked();

    expect(screen.getAllByText(/Changed here/)).toHaveLength(1);
    expect(row('limits.song_minutes').getByText(/Changed here/)).toHaveTextContent(
      "The server's own setting is 60."
    );
  });

  it('resets it on save', async () => {
    const user = userEvent.setup();
    await openUnlocked();

    await user.click(screen.getByRole('button', { name: 'Reset Longest song, in minutes' }));

    expect(screen.getByRole('spinbutton', { name: 'Longest song, in minutes' })).toHaveValue(60);
    expect(
      row('limits.song_minutes').getByText(/Goes back to the server's own setting/)
    ).toBeInTheDocument();
    await user.click(saveButton());

    await waitFor(() => expect(server.saves).toEqual([{ 'limits.song_minutes': null }]));
    await waitFor(() => expect(screen.queryByText(/Changed here/)).toBeNull());
  });
});

describe('saving', () => {
  it('shows what the server refused and keeps the changes to fix', async () => {
    server.failNextSave = { status: 400, detail: 'Song search: choose among Deezer.' };
    const user = userEvent.setup();
    await openUnlocked();

    await user.click(screen.getByRole('switch', { name: 'Song search: Deezer' }));
    await user.click(saveButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Song search: choose among Deezer.');
    expect(screen.getByText('1 change not saved yet')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it('asks for the passphrase again when the unlock ran out meanwhile', async () => {
    server.failNextSave = { status: 403, detail: 'Enter the admin passphrase' };
    const user = userEvent.setup();
    await openUnlocked();

    await user.click(screen.getByRole('switch', { name: 'Make song loops' }));
    await user.click(saveButton());

    expect(await screen.findByLabelText('Admin passphrase')).toBeInTheDocument();
    expect(screen.getByText(/Enter the admin passphrase again/)).toBeInTheDocument();
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it('tells the studio’s pickers to ask the server again what it offers', async () => {
    const user = userEvent.setup();
    const pickers = renderHook(() => useCapabilities());
    await waitFor(() => expect(pickers.result.current?.separation.presets).toHaveLength(3));
    await openUnlocked();

    await user.click(screen.getByRole('switch', { name: 'Presets offered: Best' }));
    await user.click(saveButton());

    await waitFor(() =>
      expect(pickers.result.current?.separation.presets.map((preset) => preset.id)).toEqual([
        'fast',
        'balanced',
      ])
    );
    expect(server.capabilityRequests).toBe(2);
  });

  it('starts from the server’s settings when the page is opened again', async () => {
    const user = userEvent.setup();
    localStorage.setItem(ADMIN_TOKEN_KEY, ADMIN_TOKEN);
    const page = (isOpen: boolean) => (
      <ToastProvider>
        <ServerSettingsDialog isOpen={isOpen} onClose={vi.fn()} />
      </ToastProvider>
    );
    const { rerender } = render(page(true));
    await user.click(await screen.findByRole('switch', { name: 'Make song loops' }));
    expect(screen.getByText('1 change not saved yet')).toBeInTheDocument();

    rerender(page(false));
    rerender(page(true));

    expect(await screen.findByRole('switch', { name: 'Make song loops' })).toBeChecked();
    expect(screen.queryByText(/not saved yet/)).toBeNull();
  });
});

describe('on a phone', () => {
  it('fits the screen, with every control big enough to tap', async () => {
    setTestViewport(375);
    await openUnlocked();
    const dialog = screen.getByRole('dialog');

    assertZeroHorizontalOverflow(dialog, 375);
    for (const control of within(dialog).getAllByRole('switch')) {
      expect(control.className).toMatch(/min-w-\[44px\]/);
      expect(control.parentElement?.className).toMatch(/min-h-\[44px\]/);
    }
    for (const button of within(dialog).getAllByRole('button')) {
      expect(button.className).toMatch(/min-h-\[44px\]|h-11|w-11|p-3/);
    }
  });
});

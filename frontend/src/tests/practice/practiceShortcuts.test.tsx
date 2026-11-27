/**
 * Practice's keys and palette commands: P turns practice on and off, L repeats the part being
 * sung. Both are single letters, so they keep out of text fields, stay off behind a dialog and
 * obey the switch that turns letter shortcuts off.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { loadDeferredScreens } from '../../deferredScreens';
import { setCharacterShortcutsEnabled } from '../../utils/shortcutPrefs';
import { PRACTICE_SONG, mockPracticeFetch } from '../helpers/practiceFixtures';

beforeAll(() => loadDeferredScreens());

async function openSong() {
  window.history.pushState({}, '', `/?project=${PRACTICE_SONG.id}`);
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: PRACTICE_SONG.title });
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.body, { key, ...init });
const panel = () => screen.queryByTestId('practice-panel');
const repeatSwitch = () => screen.getByRole('switch', { name: 'Repeat this part' });

describe('practice keys', () => {
  beforeEach(() => {
    localStorage.clear();
    mockPracticeFetch();
  });

  afterEach(() => {
    setCharacterShortcutsEnabled(true);
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('P turns practice on and off', async () => {
    await openSong();
    press('p');
    expect(panel()).toBeInTheDocument();
    press('P');
    expect(panel()).toBeNull();
  });

  it('L repeats the part being sung, in practice only', async () => {
    await openSong();
    press('l');
    expect(panel()).toBeNull();

    press('p');
    expect(repeatSwitch()).toHaveAttribute('aria-checked', 'false');
    press('l');
    expect(repeatSwitch()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('waveform-range')).toBeInTheDocument();
    press('l');
    expect(repeatSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('waveform-range')).toBeNull();
  });

  it('ignores a held key and keys pressed with Ctrl, Alt or ⌘', async () => {
    await openSong();
    press('p', { repeat: true });
    press('p', { ctrlKey: true });
    press('p', { metaKey: true });
    press('p', { altKey: true });
    expect(panel()).toBeNull();
  });

  it('leaves the letters to a text field', async () => {
    await openSong();
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    fireEvent.keyDown(field, { key: 'p' });
    expect(panel()).toBeNull();
    field.remove();
  });

  it('stays off behind a dialog', async () => {
    await openSong();
    press('?');
    await screen.findByRole('dialog');
    press('p');
    expect(panel()).toBeNull();
  });

  it('stays off when letter shortcuts are turned off', async () => {
    setCharacterShortcutsEnabled(false);
    await openSong();
    press('p');
    expect(panel()).toBeNull();
  });

  it('is listed in Help with the other shortcuts', async () => {
    await openSong();
    press('?');
    const help = await screen.findByRole('dialog');
    expect(help).toHaveTextContent('Practice on or off');
    expect(help).toHaveTextContent('Repeat this part');
    expect(help).toHaveTextContent('M, V, C, F, T, R, P, L, [, ] and ?');
  });
});

describe('practice in the command palette', () => {
  beforeEach(() => {
    localStorage.clear();
    mockPracticeFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  const openPalette = async () => {
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    return screen.findByRole('combobox', { name: /search commands/i });
  };

  it('turns practice on, then offers to repeat the part and to leave', async () => {
    await openSong();
    let search = await openPalette();
    fireEvent.change(search, { target: { value: 'practice this' } });
    fireEvent.click(await screen.findByRole('option', { name: /Practice this song/ }));
    // The palette runs a command once it has closed
    await waitFor(() => expect(panel()).toBeInTheDocument());

    search = await openPalette();
    fireEvent.change(search, { target: { value: 'repeat this' } });
    fireEvent.click(await screen.findByRole('option', { name: /Repeat this part/ }));
    await waitFor(() => expect(repeatSwitch()).toHaveAttribute('aria-checked', 'true'));

    search = await openPalette();
    fireEvent.change(search, { target: { value: 'leave practice' } });
    fireEvent.click(await screen.findByRole('option', { name: /Leave practice/ }));
    await waitFor(() => expect(panel()).toBeNull());
  });
});

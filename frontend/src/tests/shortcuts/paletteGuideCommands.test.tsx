/**
 * The guide in the command palette: "Show me around" starts the tour, "What you can do"
 * opens Help's list, and typing a feature's name lists "Show me: …" entries that point at
 * its control. Features are only listed for a query, so the palette's own list stays short.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { loadDeferredScreens } from '../../deferredScreens';
import { featureById } from '../../utils/features';
import { GUIDE_SONG, mockGuideFetch } from '../helpers/guideFixtures';

type User = ReturnType<typeof userEvent.setup>;

async function openStudio() {
  window.history.pushState({}, '', `/?project=${GUIDE_SONG.id}`);
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: GUIDE_SONG.title });
}

async function openPalette(user: User, query?: string) {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  const box = await screen.findByRole('combobox', { name: /search commands/i });
  if (query) await user.type(box, query);
  return box;
}

beforeAll(() => loadDeferredScreens());

beforeEach(() => {
  localStorage.clear();
  mockGuideFetch();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/');
});

describe('the guide in the command palette', () => {
  it('starts the studio tour', async () => {
    const user = userEvent.setup();
    await openStudio();
    await openPalette(user, 'tour');
    await user.click(await screen.findByRole('option', { name: /Show me around/ }));

    const tour = await screen.findByRole('dialog', { name: 'Your song' });
    expect(tour).toHaveTextContent('1 of ');
    expect(screen.queryByRole('combobox', { name: /search commands/i })).toBeNull();
  });

  it('opens Help on what you can do', async () => {
    const user = userEvent.setup();
    await openStudio();
    await openPalette(user, 'what you can');
    await user.click(await screen.findByRole('option', { name: /What you can do/ }));

    expect(await screen.findByRole('tab', { name: 'What you can do' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('lists no feature until something is typed', async () => {
    const user = userEvent.setup();
    await openStudio();
    await openPalette(user);
    expect((await screen.findAllByRole('option')).length).toBeGreaterThan(5);
    expect(screen.queryByRole('option', { name: /^Show me: / })).toBeNull();
  });

  it('finds a feature by what it is for and points at its control', async () => {
    const user = userEvent.setup();
    await openStudio();
    const speed = featureById('speed')!;
    await openPalette(user, 'slow');
    await user.click(
      await screen.findByRole('option', { name: new RegExp(`Show me: ${speed.title}`) })
    );

    const note = await screen.findByRole('group', { name: speed.title });
    expect(note).toHaveTextContent(speed.how);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('leaves out a feature whose control this song does not have', async () => {
    const user = userEvent.setup();
    await openStudio();
    await openPalette(user, 'lines');
    // The duet tool is there; the review filter is not, since no line needs review
    await screen.findByRole('option', { name: /Show me: Give the lines to two singers/ });
    expect(screen.queryByRole('option', { name: /See only the lines to check/ })).toBeNull();
  });

  it('offers the home screen’s features on the home screen, and the studio’s only there', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { level: 1 });
    await openPalette(user, 'lyrics');

    await screen.findByRole('option', { name: /Show me: Bring your own lyrics/ });
    expect(screen.queryByRole('option', { name: /Get other lyrics/ })).toBeNull();
  });
});

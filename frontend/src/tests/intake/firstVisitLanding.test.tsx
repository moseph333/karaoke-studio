/**
 * What a first-time visitor (no songs of their own) sees on the home screen: the three
 * "how it works" steps, and a library that opens on the songs that exist. Returning visitors
 * get neither.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrackSearch } from '../../components/TrackSearch';

type Entry = { id: string; title: string; status: string; created_by: string; summary: true };

const entry = (id: string, created_by: string): Entry => ({
  id,
  title: `Song ${id}`,
  status: 'ready',
  created_by,
  summary: true,
});

function serveLibrary(entries: Entry[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const body = Object.fromEntries(entries.map((e) => [e.id, e]));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

const renderHome = () =>
  render(<TrackSearch onSelectTrack={vi.fn()} isLoading={false} currentUser="Alex" />);

const selectedTab = () => screen.getByRole('tab', { selected: true });

describe('first visit to the home screen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('asks the server for card-sized entries, not whole songs', async () => {
    const fetchMock = serveLibrary([]);
    renderHome();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/projects?scope=all&summary=1');
  });

  it('explains how it works in three steps while the visitor has no songs', async () => {
    serveLibrary([]);
    renderHome();

    const steps = within(screen.getByRole('region', { name: 'How it works' })).getAllByRole(
      'listitem'
    );
    expect(steps.map((li) => within(li).getByRole('heading').textContent)).toEqual([
      '1.Pick a song',
      '2.The studio does the work',
      '3.Sing it or share it',
    ]);
    // Still there once the (empty) library has loaded
    await screen.findByText('No songs yet');
    expect(screen.getByRole('region', { name: 'How it works' })).toBeInTheDocument();
  });

  it('opens the library on the songs that exist when none are the visitor’s own', async () => {
    serveLibrary([entry('a', 'Sam'), entry('b', 'Sam')]);
    renderHome();

    await screen.findByText('Song a');
    expect(selectedTab()).toHaveAccessibleName('Community Library (2)');
    expect(screen.getByRole('region', { name: 'How it works' })).toBeInTheDocument();
  });

  it('keeps the tab the visitor picks', async () => {
    const user = userEvent.setup();
    serveLibrary([entry('a', 'Sam')]);
    renderHome();
    await screen.findByText('Song a');

    await user.click(screen.getByRole('tab', { name: 'My Songs (0)' }));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await screen.findByText('No songs yet');
    expect(selectedTab()).toHaveAccessibleName('My Songs (0)');
  });

  it('remembers a visitor with songs and drops the steps from their next visit on', async () => {
    serveLibrary([entry('mine', 'Alex'), entry('other', 'Sam')]);
    const first = renderHome();

    await screen.findByText('Song mine');
    expect(selectedTab()).toHaveAccessibleName('My Songs (1)');
    // This browser did not know yet: the page keeps its sections instead of jumping
    expect(screen.getByRole('region', { name: 'How it works' })).toBeInTheDocument();
    expect(localStorage.getItem('karaoke_has_songs')).toBe('1');

    // Next visit: no steps, even before the library answers
    first.unmount();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    renderHome();
    expect(screen.queryByRole('region', { name: 'How it works' })).not.toBeInTheDocument();
    // The headline is still the page's heading, in its compact size
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(
      'Turn any song into karaoke'
    );
  });

  it('brings the steps back on the visit after every song was deleted', async () => {
    localStorage.setItem('karaoke_has_songs', '1');
    serveLibrary([]);
    const first = renderHome();

    await screen.findByText('No songs yet');
    expect(screen.queryByRole('region', { name: 'How it works' })).not.toBeInTheDocument();
    expect(localStorage.getItem('karaoke_has_songs')).toBeNull();

    first.unmount();
    renderHome();
    expect(screen.getByRole('region', { name: 'How it works' })).toBeInTheDocument();
  });
});

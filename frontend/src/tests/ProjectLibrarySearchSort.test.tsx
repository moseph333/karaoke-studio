/**
 * ProjectLibrarySearchSort.test.tsx
 *
 * Automated test suite verifying client-side search, status filtering, and sorting
 * in ProjectLibrary across My Songs and Community Library tabs, ensuring touch targets,
 * zero network round-trips, and graceful empty states.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectLibrary } from '../components/track-search/ProjectLibrary';
import { ProjectState } from '../types';

describe('ProjectLibrary Search, Filter, and Sort (R5)', () => {
  const mockProjects: Record<string, ProjectState> = {
    p1: {
      id: 'proj-1',
      title: 'Hotel California',
      artist: 'Eagles',
      status: 'ready',
      progress: 100,
      lines: [],
      semitones: 0,
      guide_volume: 0,
      created_by: 'Alice',
      created_at: 1700000100,
      thumbnail_url: 'https://example.com/p1.jpg',
    },
    p2: {
      id: 'proj-2',
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      status: 'ready',
      progress: 100,
      lines: [],
      semitones: 0,
      guide_volume: 0,
      created_by: 'Bob',
      created_at: 1700000200,
      thumbnail_url: 'https://example.com/p2.jpg',
    },
    p3: {
      id: 'proj-3',
      title: 'Imagine',
      artist: 'John Lennon',
      status: 'aligning',
      progress: 50,
      lines: [],
      semitones: 0,
      guide_volume: 0,
      created_by: 'Alice',
      created_at: 1700000300,
    },
    p4: {
      id: 'proj-4',
      title: 'Yesterday',
      artist: 'The Beatles',
      status: 'error',
      progress: 0,
      lines: [],
      semitones: 0,
      guide_volume: 0,
      created_by: 'Charlie',
      created_at: 1700000400,
    },
  };

  let fetchCount = 0;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      fetchCount++;
      const urlStr = url.toString();
      if (urlStr.includes('/api/projects')) {
        return new Response(JSON.stringify(mockProjects), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    });
  });

  const renderComponent = (currentUser = 'Alice') => {
    return render(
      <ProjectLibrary currentUser={currentUser} authToken="test-token" onOpenProject={vi.fn()} />
    );
  };

  it('renders search input, status filter, and sort selector with proper accessibility attributes', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /My Songs \(2\)/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Library \(4\)/i })).toBeInTheDocument();
    });

    const searchInput = screen.getByLabelText('Search project library');
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute(
      'placeholder',
      'Search library by title, artist, or creator...'
    );

    const statusSelect = screen.getByLabelText('Filter projects by status');
    expect(statusSelect).toBeInTheDocument();
    expect(statusSelect).toHaveValue('all');

    const sortSelect = screen.getByLabelText('Sort projects');
    expect(sortSelect).toBeInTheDocument();
    expect(sortSelect).toHaveValue('recent');
  });

  it('filters projects by song title without extra network requests', async () => {
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Hotel California')).toBeInTheDocument();
      expect(screen.getByText('Imagine')).toBeInTheDocument();
    });

    const initialFetchCount = fetchCount;

    const searchInput = screen.getByLabelText('Search project library');
    await user.type(searchInput, 'hotel');

    expect(screen.getByText('Hotel California')).toBeInTheDocument();
    expect(screen.queryByText('Imagine')).not.toBeInTheDocument();

    // Verify zero network round-trips occurred while typing
    expect(fetchCount).toBe(initialFetchCount);
  });

  it('filters projects by artist name and creator name in Community Library', async () => {
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Library \(4\)/i })).toBeInTheDocument();
    });

    // Switch to Community Library tab
    const commTab = screen.getByRole('tab', { name: /Library \(4\)/i });
    await user.click(commTab);

    expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();

    const searchInput = screen.getByLabelText('Search project library');

    // Filter by artist name
    await user.clear(searchInput);
    await user.type(searchInput, 'queen');
    expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
    expect(screen.queryByText('Yesterday')).not.toBeInTheDocument();
    expect(screen.queryByText('Hotel California')).not.toBeInTheDocument();

    // Filter by creator name
    await user.clear(searchInput);
    await user.type(searchInput, 'charlie');
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
    expect(screen.queryByText('Bohemian Rhapsody')).not.toBeInTheDocument();
  });

  it('clears search input via clear button', async () => {
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Hotel California')).toBeInTheDocument();
    });

    const searchInput = screen.getByLabelText('Search project library');
    await user.type(searchInput, 'hotel');
    expect(screen.queryByText('Imagine')).not.toBeInTheDocument();

    const clearBtn = screen.getByLabelText('Clear search query');
    await user.click(clearBtn);

    expect(searchInput).toHaveValue('');
    expect(screen.getByText('Hotel California')).toBeInTheDocument();
    expect(screen.getByText('Imagine')).toBeInTheDocument();
  });

  it('filters projects by status ("ready" vs "in_progress_error")', async () => {
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Library \(4\)/i })).toBeInTheDocument();
    });

    // Switch to Community Library
    await user.click(screen.getByRole('tab', { name: /Library \(4\)/i }));

    const statusSelect = screen.getByLabelText('Filter projects by status');

    // Filter by Ready
    await user.selectOptions(statusSelect, 'ready');
    expect(screen.getByText('Hotel California')).toBeInTheDocument();
    expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
    expect(screen.queryByText('Imagine')).not.toBeInTheDocument();
    expect(screen.queryByText('Yesterday')).not.toBeInTheDocument();

    // Filter by In Progress / Error
    await user.selectOptions(statusSelect, 'in_progress_error');
    expect(screen.getByText('Imagine')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
    expect(screen.queryByText('Hotel California')).not.toBeInTheDocument();
    expect(screen.queryByText('Bohemian Rhapsody')).not.toBeInTheDocument();

    // Reset to All Statuses
    await user.selectOptions(statusSelect, 'all');
    expect(screen.getByText('Hotel California')).toBeInTheDocument();
    expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
    expect(screen.getByText('Imagine')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  it('sorts projects deterministically by Recent, Title (A–Z), and Artist (A–Z)', async () => {
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Library \(4\)/i })).toBeInTheDocument();
    });

    // Switch to Community Library to sort all 4 projects
    await user.click(screen.getByRole('tab', { name: /Library \(4\)/i }));

    const sortSelect = screen.getByLabelText('Sort projects');

    // Default: Recent (newest first based on created_at: p4=400, p3=300, p2=200, p1=100)
    let titles = screen.getAllByRole('heading', { level: 4 }).map((el) => el.textContent);
    expect(titles).toEqual(['Yesterday', 'Imagine', 'Bohemian Rhapsody', 'Hotel California']);

    // Sort by Title (A–Z)
    await user.selectOptions(sortSelect, 'title_asc');
    titles = screen.getAllByRole('heading', { level: 4 }).map((el) => el.textContent);
    expect(titles).toEqual(['Bohemian Rhapsody', 'Hotel California', 'Imagine', 'Yesterday']);

    // Sort by Artist (A–Z): Eagles, John Lennon, Queen, The Beatles
    await user.selectOptions(sortSelect, 'artist_asc');
    titles = screen.getAllByRole('heading', { level: 4 }).map((el) => el.textContent);
    expect(titles).toEqual(['Hotel California', 'Imagine', 'Bohemian Rhapsody', 'Yesterday']);
  });

  it('maintains tab counts while filtering and displays empty state with Clear Filters button', async () => {
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /My Songs \(2\)/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Library \(4\)/i })).toBeInTheDocument();
    });

    const searchInput = screen.getByLabelText('Search project library');
    await user.type(searchInput, 'Nonexistent Song');

    // Tab counts remain total counts
    expect(screen.getByRole('tab', { name: /My Songs \(2\)/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Library \(4\)/i })).toBeInTheDocument();

    // Empty search state
    expect(
      screen.getByText('No matching songs found for your search or filter.')
    ).toBeInTheDocument();

    // Click Clear Filters in empty state
    const clearFiltersBtn = screen.getByRole('button', {
      name: /Clear filters and restore tracks/i,
    });
    await user.click(clearFiltersBtn);

    expect(searchInput).toHaveValue('');
    expect(screen.getByText('Hotel California')).toBeInTheDocument();
    expect(screen.getByText('Imagine')).toBeInTheDocument();
  });

  it('verifies touch target heights across toolbar controls and card actions', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Hotel California')).toBeInTheDocument();
    });

    // Toolbar controls >= 36px
    const myTab = screen.getByRole('tab', { name: /My Songs/i });
    expect(myTab.className).toMatch(/min-h-\[36px\]/);

    const searchInput = screen.getByLabelText('Search project library');
    expect(searchInput.className).toMatch(/min-h-\[36px\]/);

    const statusSelect = screen.getByLabelText('Filter projects by status');
    expect(statusSelect.className).toMatch(/min-h-\[36px\]/);

    const sortSelect = screen.getByLabelText('Sort projects');
    expect(sortSelect.className).toMatch(/min-h-\[36px\]/);

    // Card edit and delete buttons >= 44px
    const editButtons = screen.getAllByRole('button', { name: /^Edit metadata for/i });
    const deleteButtons = screen.getAllByRole('button', { name: /^Delete project/i });

    expect(editButtons.length).toBeGreaterThan(0);
    expect(deleteButtons.length).toBeGreaterThan(0);

    editButtons.forEach((btn) => {
      expect(btn.className).toMatch(/min-h-\[44px\]/);
      expect(btn.className).toMatch(/min-w-\[44px\]/);
    });

    deleteButtons.forEach((btn) => {
      expect(btn.className).toMatch(/min-h-\[44px\]/);
      expect(btn.className).toMatch(/min-w-\[44px\]/);
    });
  });
});

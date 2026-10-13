import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrackSearch } from '../components/TrackSearch';

describe('TrackSearch', () => {
  const defaultProps = {
    onSelectTrack: vi.fn(),
    onOpenProject: vi.fn(),
    isLoading: false,
    currentUser: 'TestSinger',
    authToken: 'token-123',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/projects')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
  });

  it('renders search input and placeholder', async () => {
    render(<TrackSearch {...defaultProps} />);

    expect(screen.getByPlaceholderText(/Paste YouTube.*or search.*title/i)).toBeInTheDocument();
  });

  it('directly triggers onSelectTrack when submitting a YouTube URL', async () => {
    const user = userEvent.setup();
    const onSelectTrack = vi.fn();
    render(<TrackSearch {...defaultProps} onSelectTrack={onSelectTrack} />);

    const input = screen.getByPlaceholderText(/Paste YouTube.*or search.*title/i);
    await user.type(input, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    const searchBtn = screen.getByRole('button', { name: /Search.*(YouTube|Go)/i });
    await user.click(searchBtn);

    expect(onSelectTrack).toHaveBeenCalledWith(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      undefined
    );
  });

  it('fetches and displays search results when searching with song title', async () => {
    const user = userEvent.setup();
    const searchResults = [
      {
        id: 'yt-1',
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
        duration: 355,
        url: 'https://youtube.com/watch?v=yt-1',
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/search')) {
        return new Response(JSON.stringify({ results: searchResults }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(<TrackSearch {...defaultProps} />);

    const input = screen.getByPlaceholderText(/Paste YouTube.*or search.*title/i);
    await user.type(input, 'Bohemian Rhapsody');

    const searchButton = screen.getByRole('button', { name: /Search.*(YouTube|Go)/i });
    await user.click(searchButton);

    await waitFor(() => {
      expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
      expect(screen.getByText(/Queen/i)).toBeInTheDocument();
    });
  });

  it('expands custom lyrics drawer when clicking custom lyrics toggle', async () => {
    const user = userEvent.setup();
    render(<TrackSearch {...defaultProps} />);

    const lyricsToggle = screen.getByRole('button', { name: /Provide custom lyrics text/i });
    await user.click(lyricsToggle);

    expect(screen.getByPlaceholderText(/Paste line-by-line lyrics here/i)).toBeInTheDocument();
  });
});

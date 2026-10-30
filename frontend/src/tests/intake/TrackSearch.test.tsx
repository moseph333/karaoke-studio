import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrackSearch } from '../../components/TrackSearch';

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

    const lyricsToggle = screen.getByRole('button', { name: /Advanced options/i });
    await user.click(lyricsToggle);

    expect(screen.getByPlaceholderText(/Paste line-by-line lyrics here/i)).toBeInTheDocument();
  });

  it('switches to Local Audio File mode and shows file dropzone and metadata inputs', async () => {
    const user = userEvent.setup();
    render(<TrackSearch {...defaultProps} />);

    const localToggle = screen.getByRole('button', { name: /Local Audio File/i });
    await user.click(localToggle);

    expect(screen.getByText(/Click to select audio/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/e\.g\. Bohemian Rhapsody/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/e\.g\. Queen/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Upload and process local audio track/i })
    ).toBeInTheDocument();
  });

  it('handles audio file selection and auto-populates title from filename', async () => {
    const user = userEvent.setup();
    render(<TrackSearch {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /Local Audio File/i }));

    const file = new File(['fake-audio-bytes'], 'hotel_california.mp3', { type: 'audio/mpeg' });
    const fileInput = screen.getByLabelText(/Choose local audio file/i);

    await user.upload(fileInput, file);

    expect(screen.getByText('hotel_california.mp3')).toBeInTheDocument();
    const titleInput = screen.getByLabelText(/Track Title/i) as HTMLInputElement;
    expect(titleInput.value).toBe('hotel california');
  });

  it('submits local audio upload with metadata and custom lyrics calling onUploadTrack', async () => {
    const user = userEvent.setup();
    const onUploadTrack = vi.fn().mockResolvedValue(undefined);
    render(<TrackSearch {...defaultProps} onUploadTrack={onUploadTrack} />);

    await user.click(screen.getByRole('button', { name: /Local Audio File/i }));

    // Expand custom lyrics
    await user.click(screen.getByRole('button', { name: /Advanced options/i }));
    fireEvent.change(screen.getByLabelText(/Custom plain lyrics text/i), {
      target: { value: '[00:01.00] First lyric' },
    });

    const file = new File(['wav-data'], 'my_song.wav', { type: 'audio/wav' });
    await user.upload(screen.getByLabelText(/Choose local audio file/i), file);

    const titleInput = screen.getByLabelText(/Track Title/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Custom Title');

    const artistInput = screen.getByLabelText(/Artist Name/i);
    await user.type(artistInput, 'Custom Singer');

    const uploadBtn = screen.getByRole('button', { name: /Upload and process local audio track/i });
    await user.click(uploadBtn);

    expect(onUploadTrack).toHaveBeenCalledTimes(1);
    expect(onUploadTrack).toHaveBeenCalledWith({
      file,
      title: 'Custom Title',
      artist: 'Custom Singer',
      customLyrics: '[00:01.00] First lyric',
      createdBy: 'TestSinger',
    });
  });

  it('displays error message when local audio upload fails', async () => {
    const user = userEvent.setup();
    const onUploadTrack = vi
      .fn()
      .mockRejectedValue(new Error('File exceeds maximum permitted size of 100MB'));
    render(<TrackSearch {...defaultProps} onUploadTrack={onUploadTrack} />);

    await user.click(screen.getByRole('button', { name: /Local Audio File/i }));

    const file = new File(['huge-data'], 'huge.wav', { type: 'audio/wav' });
    await user.upload(screen.getByLabelText(/Choose local audio file/i), file);

    const uploadBtn = screen.getByRole('button', { name: /Upload and process local audio track/i });
    await user.click(uploadBtn);

    await waitFor(() => {
      expect(screen.getByText(/File exceeds maximum permitted size of 100MB/i)).toBeInTheDocument();
    });
  });

  it('clears selected file when clicking remove button', async () => {
    const user = userEvent.setup();
    render(<TrackSearch {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: /Local Audio File/i }));

    const file = new File(['data'], 'remove_me.wav', { type: 'audio/wav' });
    await user.upload(screen.getByLabelText(/Choose local audio file/i), file);
    expect(screen.getByText('remove_me.wav')).toBeInTheDocument();

    const removeBtn = screen.getByRole('button', { name: /Remove selected audio file/i });
    await user.click(removeBtn);

    expect(screen.queryByText('remove_me.wav')).not.toBeInTheDocument();
    expect(screen.getByText(/Click to select audio/i)).toBeInTheDocument();
  });

  describe('Project Library Controls & Lifecycle (Milestone 1)', () => {
    const libraryProject = {
      id: 'proj-lib-1',
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      status: 'ready',
      created_by: 'TestSinger',
      thumbnail_url: 'https://example.com/thumb.jpg',
      lines: [],
    };

    beforeEach(() => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          const urlStr = url.toString();
          const method = init?.method || 'GET';

          if (urlStr.includes('/api/projects')) {
            return new Response(JSON.stringify({ [libraryProject.id]: libraryProject }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          if (urlStr.includes('/api/project/proj-lib-1') && method === 'DELETE') {
            return new Response(JSON.stringify({ status: 'deleted', project_id: 'proj-lib-1' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          if (urlStr.includes('/api/project/proj-lib-1') && method === 'PATCH') {
            const body = JSON.parse(init?.body as string);
            return new Response(
              JSON.stringify({
                ...libraryProject,
                title: body.title,
                artist: body.artist,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }

          return new Response('{}', { status: 200 });
        }
      );
    });

    it('renders Edit and Delete action buttons meeting >= 44px touch target standards', async () => {
      render(<TrackSearch {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
      });

      const editBtn = screen.getByRole('button', { name: /Edit metadata for Bohemian Rhapsody/i });
      const deleteBtn = screen.getByRole('button', { name: /Delete project Bohemian Rhapsody/i });

      expect(editBtn).toBeInTheDocument();
      expect(deleteBtn).toBeInTheDocument();

      expect(editBtn.className).toContain('min-h-[44px]');
      expect(editBtn.className).toContain('min-w-[44px]');
      expect(deleteBtn.className).toContain('min-h-[44px]');
      expect(deleteBtn.className).toContain('min-w-[44px]');
    });

    it('isolates clicks so Edit and Delete do not trigger card onOpenProject', async () => {
      const user = userEvent.setup();
      const onOpenProject = vi.fn();
      render(<TrackSearch {...defaultProps} onOpenProject={onOpenProject} />);

      await waitFor(() => {
        expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
      });

      const editBtn = screen.getByRole('button', { name: /Edit metadata for Bohemian Rhapsody/i });
      await user.click(editBtn);

      expect(onOpenProject).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: /Edit Track Details/i })).toBeInTheDocument();

      // Close modal
      await user.click(screen.getByRole('button', { name: /Cancel/i }));

      const deleteBtn = screen.getByRole('button', { name: /Delete project Bohemian Rhapsody/i });
      await user.click(deleteBtn);

      expect(onOpenProject).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: /Delete Project\?/i })).toBeInTheDocument();
    });

    it('executes delete flow and removes project card from library', async () => {
      const user = userEvent.setup();
      render(<TrackSearch {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
      });

      const deleteBtn = screen.getByRole('button', { name: /Delete project Bohemian Rhapsody/i });
      await user.click(deleteBtn);

      expect(screen.getByRole('heading', { name: /Delete Project\?/i })).toBeInTheDocument();

      const confirmBtn = screen.getByRole('button', { name: /^Delete Project$/i });
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(screen.queryByText('Bohemian Rhapsody')).not.toBeInTheDocument();
      });
    });

    it('executes metadata edit flow and updates project title and artist on card', async () => {
      const user = userEvent.setup();
      render(<TrackSearch {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Bohemian Rhapsody')).toBeInTheDocument();
      });

      const editBtn = screen.getByRole('button', { name: /Edit metadata for Bohemian Rhapsody/i });
      await user.click(editBtn);

      const titleInput = screen.getByLabelText(/Track Title/i);
      const artistInput = screen.getByLabelText(/Artist Name/i);

      await user.clear(titleInput);
      await user.type(titleInput, 'Somebody to Love');
      await user.clear(artistInput);
      await user.type(artistInput, 'Queen Official');

      const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
      await user.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByText('Somebody to Love')).toBeInTheDocument();
        expect(screen.getByText('Queen Official')).toBeInTheDocument();
      });
    });
  });
});

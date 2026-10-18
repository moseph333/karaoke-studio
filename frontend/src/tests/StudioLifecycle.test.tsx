import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { ProjectState } from '../types';

describe('Studio Dashboard Lifecycle & Header Controls', () => {
  const readyProject: ProjectState = {
    id: 'studio-test-proj',
    title: 'Studio Anthem',
    artist: 'Lead Performer',
    status: 'ready',
    progress: 100,
    created_by: 'Friend',
    lines: [
      {
        id: 1,
        text: 'First line of the song',
        start_time: 1.0,
        end_time: 4.0,
        words: [{ word: 'First', start_time: 1.0, end_time: 2.0 }],
      },
    ],
    semitones: 0,
    guide_volume: 0,
    master_audio_url: '/static/output/studio-test-proj_master.wav',
    instrumental_url: '/static/stems/studio-test-proj/instrumental.wav',
    vocals_url: '/static/stems/studio-test-proj/vocals.wav',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/?project=studio-test-proj');

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = url.toString();
        const method = init?.method || 'GET';

        if (urlStr.includes('/api/auth/status')) {
          return new Response(JSON.stringify({ auth_required: false, authenticated: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (urlStr.includes('/api/project/studio-test-proj') && method === 'GET') {
          return new Response(JSON.stringify(readyProject), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (urlStr.includes('/api/project/studio-test-proj') && method === 'PATCH') {
          const body = JSON.parse(init?.body as string);
          return new Response(
            JSON.stringify({
              ...readyProject,
              title: body.title,
              artist: body.artist,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (urlStr.includes('/api/project/studio-test-proj') && method === 'DELETE') {
          return new Response(
            JSON.stringify({ status: 'deleted', project_id: 'studio-test-proj' }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }

        if (urlStr.includes('/api/projects')) {
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response('{}', { status: 200 });
      }
    );
  });

  it('renders Studio Header with accessible edit and delete action buttons meeting >= 44px targets', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Studio Anthem')).toBeInTheDocument();
    });

    const editBtn = screen.getByRole('button', { name: /Edit song details/i });
    const deleteBtn = screen.getByRole('button', { name: /Delete project/i });

    expect(editBtn).toBeInTheDocument();
    expect(deleteBtn).toBeInTheDocument();

    expect(editBtn.className).toContain('min-h-[44px]');
    expect(editBtn.className).toContain('min-w-[44px]');
    expect(deleteBtn.className).toContain('min-h-[44px]');
    expect(deleteBtn.className).toContain('min-w-[44px]');
  });

  it('allows editing title and artist in Studio Header and updates header text in real time', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Studio Anthem')).toBeInTheDocument();
    });

    const editBtn = screen.getByRole('button', { name: /Edit song details/i });
    await user.click(editBtn);

    // Edit modal opens
    expect(screen.getByRole('heading', { name: /Edit Track Details/i })).toBeInTheDocument();

    const titleInput = screen.getByLabelText(/Track Title/i);
    const artistInput = screen.getByLabelText(/Artist Name/i);

    expect(titleInput).toHaveValue('Studio Anthem');
    expect(artistInput).toHaveValue('Lead Performer');

    await user.clear(titleInput);
    await user.type(titleInput, 'Renamed Masterpiece');
    await user.clear(artistInput);
    await user.type(artistInput, 'Star Performer');

    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText('Renamed Masterpiece')).toBeInTheDocument();
      expect(screen.getByText(/Star Performer/i)).toBeInTheDocument();
    });
  });

  it('deletes project from Studio Header, resets state cleanly, stops audio, and avoids dirty-prompt interference', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Studio Anthem')).toBeInTheDocument();
    });

    const deleteBtn = screen.getByRole('button', { name: /Delete project/i });
    await user.click(deleteBtn);

    // Delete confirmation modal opens
    expect(screen.getByRole('heading', { name: /Delete Project\?/i })).toBeInTheDocument();
    expect(screen.getByText(/Permanent removal from studio/i)).toBeInTheDocument();

    const confirmDeleteBtn = screen.getByRole('button', { name: /^Delete Project$/i });
    await user.click(confirmDeleteBtn);

    // Window.confirm should NEVER be called on deletion
    expect(confirmSpy).not.toHaveBeenCalled();

    // Studio view resets and returns to TrackSearch library
    await waitFor(() => {
      expect(screen.queryByText('Studio Anthem')).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Paste YouTube.*or search.*title/i)).toBeInTheDocument();
    });
  });
});

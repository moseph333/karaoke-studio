/**
 * "Try again" on a failed song starts it again as it was added: under the name of the
 * person who added it and at the quality it was asked for, not this browser's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { ToastProvider } from '../../hooks/useToast';

const failedSong = {
  id: 'dQw4w9WgXcQ',
  track_id: 'dQw4w9WgXcQ',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'Neon Skyline',
  status: 'error',
  error: 'Read timed out.',
  created_by: 'Sam',
  separation_quality: 'best',
  lines: [],
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

describe('trying a failed song again', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/?project=dQw4w9WgXcQ');
  });

  it("sends the song's own owner and quality", async () => {
    const started: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.includes('/api/process')) {
          started.push(JSON.parse(String(init?.body)));
          return json({ project_id: 'dQw4w9WgXcQ' });
        }
        if (url.includes('/api/projects')) return json({});
        if (url.includes('/api/project/dQw4w9WgXcQ')) return json(failedSong);
        return json({});
      }
    );
    render(
      <ToastProvider>
        <App />
      </ToastProvider>
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(started).toHaveLength(1));
    expect(started[0]).toMatchObject({
      url_or_id: failedSong.url,
      created_by: 'Sam',
      separation_quality: 'best',
    });
  });
});

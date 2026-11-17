/**
 * A song that failed or was cancelled: the failure in plain words, the raw error kept under
 * "Technical details", and starting the song again.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { ProcessingView } from '../../components/ProcessingView';
import type { ProjectState } from '../../types';
import { explainProcessingError, isUploadedSong, retryInput } from '../../utils/processingErrors';
import { json, mockStudioFetch } from '../helpers/qualityFixtures';

const failed = (extra: Partial<ProjectState> = {}): ProjectState => ({
  id: 'dQw4w9WgXcQ',
  track_id: 'dQw4w9WgXcQ',
  title: 'Failing Song',
  artist: 'Nobody',
  status: 'error',
  progress: 20,
  lines: [],
  semitones: 0,
  guide_volume: 0,
  error: 'ERROR: [youtube] dQw4w9WgXcQ: Video unavailable. This video is private',
  ...extra,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('explainProcessingError', () => {
  it.each([
    ['Interrupted by a server restart', /server restarted/],
    ['ERROR: [youtube] abc: Video unavailable. This video is private', /is private/],
    ['ERROR: [youtube] abc: Sign in to confirm your age', /sign-in/],
    ['ERROR: [youtube] abc: Sign in to confirm you’re not a bot', /sign-in/],
    ['Could not download audio: the video is unavailable in your region.', /blocked in the region/],
    [
      'ERROR: Video unavailable. The uploader has not made this video available in your country',
      /blocked in the region/,
    ],
    ['ERROR: [youtube] abc: Video unavailable', /no longer available/],
    [
      'Failed to download audio from SoundCloud: ERROR: [soundcloud] x: Unable to download JSON metadata: HTTP Error 404: Not Found',
      /no longer available at that link/,
    ],
    [
      'Failed to download audio from SoundCloud: This track is not available in your country',
      /blocked in the region/,
    ],
    [
      'That Internet Archive link holds 23 recordings. Open the one you want and paste its link.',
      /several recordings/,
    ],
    [
      'Could not find “Internal Calm” by Afterhour Chillout on YouTube. Search for it by name and pick an upload, or add the audio as a local file.',
      /No YouTube upload of this song matched/,
    ],
    ['Spotify has no song at that link.', /did not say which song/],
    [
      "Could not read the song's title and artist from TIDAL. Search for the song by name instead.",
      /did not say which song/,
    ],
    [
      'YouTube search failed: ERROR: query "Rick Astley" page 1: Unable to download API page: HTTP Error 403',
      /did not get through/,
    ],
    [
      'Failed to download audio from Vimeo: ERROR: [vimeo] 76979871: The web client only works when logged-in. Use --cookies',
      /sign-in or a password/,
    ],
    [
      'Failed to download audio from Vimeo: ERROR: [vimeo] 1: This video is protected by a password, use the --video-password option',
      /sign-in or a password/,
    ],
    ['[Errno 28] No space left on device', /disk space/],
    ['No separation engine can run: fast: demucs is not installed', /Separating the vocals/],
    ['Stem separation failed: worker exited with code -9', /Separating the vocals/],
    ['Demucs failed (exit 1)', /Separating the vocals/],
    ['HTTP Error 503: Service Unavailable', /did not get through/],
    ['Read timed out.', /did not get through/],
    ['Expected extracted audio file not found or empty: downloads/abc.wav', /could not be read/],
    ['KeyError: 7', /Something went wrong/],
    ['', /Something went wrong/],
  ])('reads %j', (error, summary) => {
    const explanation = explainProcessingError(error);
    expect(explanation.summary).toMatch(summary);
    expect(explanation.advice.length).toBeGreaterThan(10);
  });

  it('answers a missing error like an unknown one', () => {
    expect(explainProcessingError(undefined)).toEqual(explainProcessingError('???'));
    expect(explainProcessingError(null).summary).toMatch(/Something went wrong/);
  });

  it('starts a linked song again from its link, else its YouTube video id', () => {
    const soundcloud = 'https://soundcloud.com/forss/flickermood';
    expect(
      retryInput({ id: 'soundcloud-1a2b', track_id: 'soundcloud-1a2b', url: soundcloud })
    ).toBe(soundcloud);
    expect(retryInput({ id: 'dQw4w9WgXcQ', track_id: 'dQw4w9WgXcQ' })).toBe('dQw4w9WgXcQ');
    expect(retryInput({ id: 'dQw4w9WgXcQ' })).toBe('dQw4w9WgXcQ');
  });

  it('tells uploads from YouTube songs by their id', () => {
    expect(isUploadedSong({ id: 'local_1a2b3c4d' })).toBe(true);
    expect(isUploadedSong({ id: 'dQw4w9WgXcQ' })).toBe(false);
  });
});

describe('the failed screen', () => {
  it('says what happened and what to try, with the raw error under Technical details', () => {
    render(
      <ProcessingView
        project={failed()}
        onCancelProcess={vi.fn()}
        onResetProject={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    const reason = screen.getByRole('alert');
    expect(reason).toHaveTextContent('This video is private, so the server cannot download it.');
    expect(reason).toHaveTextContent(/Pick another upload of the song/);
    expect(reason).not.toHaveTextContent('ERROR: [youtube]');

    const details = screen.getByText('Technical details').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(within(details as HTMLElement).getByText(/ERROR: \[youtube\] dQw4w9WgXcQ/)).toHaveClass(
      'font-mono',
      'break-words'
    );
  });

  it('starts the song again from Try again, and shows that it is starting', async () => {
    const onRetry = vi.fn();
    const props = { project: failed(), onCancelProcess: vi.fn(), onResetProject: vi.fn() };
    const { rerender } = render(<ProcessingView {...props} onRetry={onRetry} />);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<ProcessingView {...props} onRetry={onRetry} isRetrying />);
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
  });

  it('asks for an uploaded file again instead of offering a retry', () => {
    render(
      <ProcessingView
        project={failed({ id: 'local_1a2b3c4d', track_id: undefined, error: 'Read timed out.' })}
        onCancelProcess={vi.fn()}
        onResetProject={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByText(/choose New Song and upload it again/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Song' })).toBeInTheDocument();
  });
});

describe('the cancelled screen', () => {
  it('offers to start the song again', async () => {
    const onRetry = vi.fn();
    render(
      <ProcessingView
        project={failed({ status: 'cancelled', error: undefined })}
        onCancelProcess={vi.fn()}
        onResetProject={vi.fn()}
        onRetry={onRetry}
      />
    );
    expect(screen.getByText(/stopped before the song was finished/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('in the app', () => {
  let processBodies: unknown[];

  beforeEach(() => {
    processBodies = [];
    window.history.pushState({}, '', '/?project=dQw4w9WgXcQ');
    mockStudioFetch((url, init) => {
      if (url.includes('/api/auth/status')) {
        return json({ auth_required: false, authenticated: true });
      }
      if (url.includes('/api/process')) {
        processBodies.push(JSON.parse(String(init?.body)));
        return json({ project_id: 'dQw4w9WgXcQ', status: 'queued' });
      }
      if (url.includes('/api/project/dQw4w9WgXcQ')) {
        // After the retry the server reports the song as running again
        return json(
          processBodies.length > 0
            ? failed({ status: 'downloading', progress: 8, error: undefined })
            : failed()
        );
      }
      return undefined;
    });
  });

  it('sends the same video to be processed again and returns to the progress screen', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(processBodies).toHaveLength(1));
    expect(processBodies[0]).toMatchObject({ url_or_id: 'dQw4w9WgXcQ' });
    await waitFor(() => expect(screen.queryByText('Track Processing Failed')).toBeNull());
    expect(screen.getByRole('button', { name: /Cancel & Return to Search/ })).toBeInTheDocument();
  });
});

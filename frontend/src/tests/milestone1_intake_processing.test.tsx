import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderHook } from '@testing-library/react';
import {
  LocalAudioUploader,
  validateAudioFile,
  parseAudioFilename,
} from '../components/track-search/LocalAudioUploader';
import { TrackSearch } from '../components/TrackSearch';
import {
  ProcessingView,
  getActivePipelineStage,
  PIPELINE_STAGES,
} from '../components/ProcessingView';
import { useProjectPolling } from '../hooks/useProjectPolling';
import { ProjectState } from '../types';

describe('Milestone 1: UX-1 Client-Side Audio Validation & Smart Filename Parsing', () => {
  it('validateAudioFile detects empty files, oversized files, and unsupported formats', () => {
    // 0-byte file
    const emptyFile = new File([], 'empty.mp3', { type: 'audio/mpeg' });
    expect(validateAudioFile(emptyFile)).toBe('Selected file is empty (0 bytes).');

    // 101MB file (> 100MB)
    const oversizedFile = new File(['x'], 'large.wav', { type: 'audio/wav' });
    Object.defineProperty(oversizedFile, 'size', { value: 101 * 1024 * 1024 });
    expect(validateAudioFile(oversizedFile)).toBe(
      'Audio file exceeds 100MB limit. Please choose a smaller file.'
    );

    // Unsupported format (.pdf)
    const pdfFile = new File(['pdf-bytes'], 'document.pdf', { type: 'application/pdf' });
    expect(validateAudioFile(pdfFile)).toBe(
      'Unsupported audio format. Supported formats: WAV, MP3, FLAC, M4A, OGG, AAC.'
    );

    // Unsupported video container (.mp4)
    const mp4File = new File(['mp4-bytes'], 'video.mp4', { type: 'video/mp4' });
    expect(validateAudioFile(mp4File)).toBe(
      'Unsupported audio format. Supported formats: WAV, MP3, FLAC, M4A, OGG, AAC.'
    );

    // Supported formats
    const validMp3 = new File(['mp3-data'], 'song.mp3', { type: 'audio/mpeg' });
    const validWav = new File(['wav-data'], 'song.WAV', { type: 'audio/wav' });
    const validFlac = new File(['flac-data'], 'song.flac', { type: 'audio/flac' });
    const validOpus = new File(['opus-data'], 'song.opus', { type: 'audio/ogg' });

    expect(validateAudioFile(validMp3)).toBeNull();
    expect(validateAudioFile(validWav)).toBeNull();
    expect(validateAudioFile(validFlac)).toBeNull();
    expect(validateAudioFile(validOpus)).toBeNull();
  });

  it('parseAudioFilename correctly extracts artist and title and preserves single hyphens inside titles', () => {
    // Hyphen delimiter
    const r1 = parseAudioFilename('Queen - Bohemian Rhapsody.mp3');
    expect(r1.artist).toBe('Queen');
    expect(r1.title).toBe('Bohemian Rhapsody');

    // En-dash delimiter
    const r2 = parseAudioFilename('The Beatles – Hey Jude.flac');
    expect(r2.artist).toBe('The Beatles');
    expect(r2.title).toBe('Hey Jude');

    // Em-dash delimiter
    const r3 = parseAudioFilename('Led Zeppelin — Stairway to Heaven.wav');
    expect(r3.artist).toBe('Led Zeppelin');
    expect(r3.title).toBe('Stairway to Heaven');

    // Title with hyphen inside (not converted to triple spaces)
    const r4 = parseAudioFilename('Take-Off.mp3');
    expect(r4.artist).toBeUndefined();
    expect(r4.title).toBe('Take-Off');

    // Artist - Title with hyphens inside title
    const r5 = parseAudioFilename('Artist Name - Multi-Part Song-Title.mp3');
    expect(r5.artist).toBe('Artist Name');
    expect(r5.title).toBe('Multi-Part Song-Title');

    // Multiple underscores cleaned to single space
    const r6 = parseAudioFilename('Queen___-_Bohemian__Rhapsody.mp3');
    expect(r6.artist).toBe('Queen');
    expect(r6.title).toBe('Bohemian Rhapsody');
  });

  it('LocalAudioUploader shows error on oversized file upload and resets selection', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    render(
      <LocalAudioUploader
        isLoading={false}
        customLyrics=""
        onError={onError}
      />
    );

    const oversized = new File(['content'], 'huge_track.wav', { type: 'audio/wav' });
    Object.defineProperty(oversized, 'size', { value: 120 * 1024 * 1024 });

    const input = screen.getByLabelText(/Choose local audio file/i);
    await user.upload(input, oversized);

    expect(onError).toHaveBeenCalledWith(
      'Audio file exceeds 100MB limit. Please choose a smaller file.'
    );
    expect(screen.queryByText('huge_track.wav')).not.toBeInTheDocument();
  });

  it('LocalAudioUploader shows error on empty 0-byte file', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    render(
      <LocalAudioUploader
        isLoading={false}
        customLyrics=""
        onError={onError}
      />
    );

    const empty = new File([], 'empty.mp3', { type: 'audio/mpeg' });
    const input = screen.getByLabelText(/Choose local audio file/i);
    await user.upload(input, empty);

    expect(onError).toHaveBeenCalledWith('Selected file is empty (0 bytes).');
    expect(screen.queryByText('empty.mp3')).not.toBeInTheDocument();
  });

  it('LocalAudioUploader shows error on unsupported file type', async () => {
    const onError = vi.fn();
    render(
      <LocalAudioUploader
        isLoading={false}
        customLyrics=""
        onError={onError}
      />
    );

    const badFile = new File(['binary'], 'notes.txt', { type: 'text/plain' });
    const input = screen.getByLabelText(/Choose local audio file/i);
    fireEvent.change(input, { target: { files: [badFile] } });

    expect(onError).toHaveBeenCalledWith(
      'Unsupported audio format. Supported formats: WAV, MP3, FLAC, M4A, OGG, AAC.'
    );

    // Also test dropzone rejection
    onError.mockClear();
    const dropzone = screen.getByText(/Click to select audio/i).closest('div');
    const badVideo = new File(['video'], 'video.mp4', { type: 'video/mp4' });
    fireEvent.drop(dropzone!, {
      dataTransfer: { files: [badVideo] },
    });
    expect(onError).toHaveBeenCalledWith(
      'Unsupported audio format. Supported formats: WAV, MP3, FLAC, M4A, OGG, AAC.'
    );
  });

  it('LocalAudioUploader auto-fills both Artist and Title on smart filename pattern', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    render(
      <LocalAudioUploader
        isLoading={false}
        customLyrics=""
        onError={onError}
      />
    );

    const file = new File(['audio'], 'Pink Floyd - Comfortably Numb.mp3', { type: 'audio/mpeg' });
    const input = screen.getByLabelText(/Choose local audio file/i);
    await user.upload(input, file);

    const titleInput = screen.getByLabelText(/Track Title/i) as HTMLInputElement;
    const artistInput = screen.getByLabelText(/Artist Name/i) as HTMLInputElement;

    expect(titleInput.value).toBe('Comfortably Numb');
    expect(artistInput.value).toBe('Pink Floyd');
    expect(onError).toHaveBeenCalledWith(null);
  });

  it('LocalAudioUploader handles dropzone drag-and-drop validation and parsing', () => {
    const onError = vi.fn();
    render(
      <LocalAudioUploader
        isLoading={false}
        customLyrics=""
        onError={onError}
      />
    );

    const dropzone = screen.getByText(/Click to select audio/i).closest('div');
    expect(dropzone).toBeInTheDocument();

    const validFile = new File(['data'], 'Queen - Radio Ga Ga.flac', { type: 'audio/flac' });
    fireEvent.drop(dropzone!, {
      dataTransfer: {
        files: [validFile],
      },
    });

    expect(screen.getByText('Queen - Radio Ga Ga.flac')).toBeInTheDocument();
    const titleInput = screen.getByLabelText(/Track Title/i) as HTMLInputElement;
    const artistInput = screen.getByLabelText(/Artist Name/i) as HTMLInputElement;
    expect(titleInput.value).toBe('Radio Ga Ga');
    expect(artistInput.value).toBe('Queen');
  });
});

describe('Milestone 1: UX-1 Search & URL Ergonomics (TrackSearch)', () => {
  const defaultProps = {
    onSelectTrack: vi.fn(),
    onOpenProject: vi.fn(),
    isLoading: false,
    currentUser: 'TestUser',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });
  });

  it('renders clear button (X) when search query is non-empty and clicking it clears input and error', async () => {
    const user = userEvent.setup();
    render(<TrackSearch {...defaultProps} />);

    const input = screen.getByPlaceholderText(/Paste YouTube.*or search.*title/i);
    expect(screen.queryByLabelText(/Clear search query/i)).not.toBeInTheDocument();

    await user.type(input, 'David Bowie');
    const clearBtn = screen.getByLabelText(/Clear search query/i);
    expect(clearBtn).toBeInTheDocument();

    await user.click(clearBtn);
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.queryByLabelText(/Clear search query/i)).not.toBeInTheDocument();
  });

  it('detects non-YouTube URLs and displays clear guidance message without calling /api/search', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<TrackSearch {...defaultProps} />);

    const input = screen.getByPlaceholderText(/Paste YouTube.*or search.*title/i);
    await user.type(input, 'https://soundcloud.com/artist/great-song');

    const searchBtn = screen.getByRole('button', { name: /Search.*(YouTube|Go)/i });
    await user.click(searchBtn);

    expect(
      screen.getByText(
        'Direct URL import currently supports YouTube and YouTube Music links. For other platforms, please download the audio file and use the Local Audio File tab.'
      )
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/search'),
      expect.anything()
    );

    // Clear and test Spotify URL
    await user.clear(input);
    await user.type(input, 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
    await user.click(searchBtn);

    expect(
      screen.getByText(
        'Direct URL import currently supports YouTube and YouTube Music links. For other platforms, please download the audio file and use the Local Audio File tab.'
      )
    ).toBeInTheDocument();
  });

  it('renders Clear Results button when search results are visible and clicking it dismisses results', async () => {
    const user = userEvent.setup();
    const searchResults = [
      {
        id: 'yt-99',
        title: 'Starman',
        artist: 'David Bowie',
        duration: 250,
        url: 'https://youtube.com/watch?v=yt-99',
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      if (url.toString().includes('/api/search')) {
        return new Response(JSON.stringify({ results: searchResults }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(<TrackSearch {...defaultProps} />);

    const input = screen.getByPlaceholderText(/Paste YouTube.*or search.*title/i);
    await user.type(input, 'Starman');

    const searchBtn = screen.getByRole('button', { name: /Search.*(YouTube|Go)/i });
    await user.click(searchBtn);

    await waitFor(() => {
      expect(screen.getByText('Starman')).toBeInTheDocument();
    });

    const clearResultsBtn = screen.getByRole('button', { name: /Clear search results/i });
    expect(clearResultsBtn).toBeInTheDocument();

    await user.click(clearResultsBtn);
    expect(screen.queryByText('Starman')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clear search results/i })).not.toBeInTheDocument();
  });
});

describe('Milestone 1: UX-2 5-Stage Stepper, Heartbeat Warning & Theme Consistency (ProcessingView)', () => {
  const baseProject: ProjectState = {
    id: 'proc-proj-1',
    status: 'downloading',
    progress: 15,
    lines: [],
    semitones: 0,
    guide_volume: 0,
    heartbeat: Date.now(),
  };

  it('getActivePipelineStage maps statuses and details correctly to 5 stages', () => {
    expect(getActivePipelineStage('queued')).toBe(0);
    expect(getActivePipelineStage('downloading')).toBe(0);
    expect(getActivePipelineStage('separating')).toBe(1);
    expect(
      getActivePipelineStage('separating', 'Analyzing vocal range and key...')
    ).toBe(2);
    expect(
      getActivePipelineStage('separating', 'Detecting musical chord progression...')
    ).toBe(2);
    expect(getActivePipelineStage('fetching_lyrics')).toBe(3);
    expect(getActivePipelineStage('aligning')).toBe(3);
    expect(getActivePipelineStage('mixing')).toBe(4);
  });

  it('renders all 5 stages in visual stepper with correct active, completed, and upcoming states', () => {
    // Stage 3 active: vocal range & chords
    const projectStage3: ProjectState = {
      ...baseProject,
      status: 'separating',
      status_detail: 'Analyzing vocal range and musical key...',
      progress: 70,
    };

    render(
      <ProcessingView
        project={projectStage3}
        onCancelProcess={vi.fn()}
        onResetProject={vi.fn()}
      />
    );

    // Check all 5 stage labels are present
    PIPELINE_STAGES.forEach((stage) => {
      expect(screen.getByText(stage.label)).toBeInTheDocument();
    });

    // Stages 1 and 2 completed
    expect(
      screen.getByLabelText(`Completed: ${PIPELINE_STAGES[0].label}`)
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(`Completed: ${PIPELINE_STAGES[1].label}`)
    ).toBeInTheDocument();

    // Stage 3 active
    expect(
      screen.getByLabelText(`Active: ${PIPELINE_STAGES[2].label}`)
    ).toBeInTheDocument();

    // Stages 4 and 5 upcoming (numbered 4 and 5)
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('displays amber warning when heartbeat is stalled (>15s)', () => {
    const stalledProject: ProjectState = {
      ...baseProject,
      heartbeat: Date.now() - 20000, // 20s old
    };

    render(
      <ProcessingView
        project={stalledProject}
        onCancelProcess={vi.fn()}
        onResetProject={vi.fn()}
      />
    );

    expect(
      screen.getByText('Engine slow / waiting for background worker')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Engine Active/i)).not.toBeInTheDocument();
  });

  it('displays emerald active badge when heartbeat is fresh (<15s)', () => {
    const freshProject: ProjectState = {
      ...baseProject,
      heartbeat: Date.now() - 1000,
    };

    render(
      <ProcessingView
        project={freshProject}
        onCancelProcess={vi.fn()}
        onResetProject={vi.fn()}
      />
    );

    expect(screen.getByText(/Engine Active/i)).toBeInTheDocument();
    expect(
      screen.queryByText('Engine slow / waiting for background worker')
    ).not.toBeInTheDocument();
  });

  it('enforces 2-step confirmation on cancellation to prevent accidental termination', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ProcessingView
        project={baseProject}
        onCancelProcess={onCancel}
        onResetProject={vi.fn()}
      />
    );

    const cancelBtn = screen.getByRole('button', { name: /Cancel & Return to Search/i });
    await user.click(cancelBtn);

    // Initial click does NOT trigger onCancel
    expect(onCancel).not.toHaveBeenCalled();

    // Confirmation dialog appears
    expect(
      screen.getByText('Cancel separation? In-progress work will be lost.')
    ).toBeInTheDocument();
    const keepProcessingBtn = screen.getByRole('button', { name: /Keep Processing/i });
    const confirmCancelBtn = screen.getByRole('button', { name: /Confirm Cancel/i });
    expect(confirmCancelBtn).toBeInTheDocument();

    // Click Keep Processing -> dismisses dialog
    await user.click(keepProcessingBtn);
    expect(onCancel).not.toHaveBeenCalled();
    expect(
      screen.queryByText('Cancel separation? In-progress work will be lost.')
    ).not.toBeInTheDocument();

    // Click cancel again and confirm
    await user.click(screen.getByRole('button', { name: /Cancel & Return to Search/i }));
    await user.click(screen.getByRole('button', { name: /Confirm Cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders network reconnecting banner when status_detail indicates reconnecting and allows retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const reconnectingProject: ProjectState = {
      ...baseProject,
      status_detail: 'Network connection interrupted. Reconnecting to server...',
    };

    render(
      <ProcessingView
        project={reconnectingProject}
        onCancelProcess={vi.fn()}
        onResetProject={vi.fn()}
        onRetryPolling={onRetry}
      />
    );

    const alertBanner = screen.getByRole('alert');
    expect(alertBanner).toBeInTheDocument();
    expect(within(alertBanner).getByText(/Network connection interrupted/i)).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    await user.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('Milestone 1: UX-2 Polling Disconnect Handling (useProjectPolling)', () => {
  const separatingProject: ProjectState = {
    id: 'poll-proj-test',
    status: 'separating',
    progress: 40,
    lines: [],
    semitones: 0,
    guide_volume: 0,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('detects 3 consecutive network failures and surfaces isReconnecting=true', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network offline'));

    const { result } = renderHook(() => useProjectPolling(separatingProject));

    expect(result.current.isReconnecting).toBe(false);
    expect(result.current.consecutiveErrors).toBe(0);

    // Fail poll 1
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.consecutiveErrors).toBe(1);
    expect(result.current.isReconnecting).toBe(false);

    // Fail poll 2
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.consecutiveErrors).toBe(2);
    expect(result.current.isReconnecting).toBe(false);

    // Fail poll 3 -> triggers reconnecting
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.consecutiveErrors).toBe(3);
    expect(result.current.isReconnecting).toBe(true);
    expect(result.current.project?.status_detail).toContain('Reconnecting to server');
  });

  it('manual retryPolling resets error count and triggers immediate poll', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network drop'));

    const { result } = renderHook(() => useProjectPolling(separatingProject));

    // 3 failed polls
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(result.current.isReconnecting).toBe(true);

    // Now mock recovery
    const recoveredProject: ProjectState = {
      ...separatingProject,
      progress: 60,
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(recoveredProject), { status: 200 })
    );

    await act(async () => {
      result.current.retryPolling();
    });

    expect(result.current.isReconnecting).toBe(false);
    expect(result.current.consecutiveErrors).toBe(0);
    expect(result.current.project?.progress).toBe(60);
  });
});

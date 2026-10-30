/**
 * Empirical Adversarial Test Suite — Challenger 1 (Milestones 1 & 2: UX-1, UX-2, UX-3, UX-4)
 *
 * Verifies boundaries, edge cases, failure recoveries, and stress invariants:
 * 1. UX-1: LocalAudioUploader boundary tests (0-byte, 100MB boundary, 100MB+1B, uppercase extensions,
 *          multiple hyphens / unicode filenames, non-YouTube URL guidance vs YouTube URLs).
 * 2. UX-2: ProcessingView stepper transitions (unknown status fallback, heartbeat boundary at exactly 15s vs 16s,
 *          cancel confirmation dialog click behavior, polling disconnect after 3 network errors with Retry).
 * 3. UX-3: LRCLIB candidate search & Live Paste Syntax Inspector (query formatting, plain vs synced LRC syntax detection
 *          with edge timestamps [00:00.00], [99:59.999], multi-digit ms, duration format edge cases, empty candidate guard).
 * 4. UX-4: Token preservation during typo edits (token count match vs mismatch fallback, adjacent word boundary clamping
 *          where start >= end, playhead snapping with boundary clamp).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderHook, act } from '@testing-library/react';

// UX-1 Components
import {
  LocalAudioUploader,
  validateAudioFile,
  parseAudioFilename,
  MAX_AUDIO_SIZE,
} from '../../components/track-search/LocalAudioUploader';
import { TrackSearch } from '../../components/TrackSearch';

// UX-2 Components
import { ProcessingView, getActivePipelineStage } from '../../components/ProcessingView';
import { useProjectPolling } from '../../hooks/useProjectPolling';

// UX-3 Components
import { LyricReplacementModal } from '../../components/timeline/LyricReplacementModal';

// UX-4 Components
import { ExpandedWordEditor } from '../../components/timeline/ExpandedWordEditor';
import { useLyricEditorState } from '../../hooks/useLyricEditorState';

// Types
import { ProjectState, LyricLine } from '../../types';

// Mock API Fetch
const mockApiFetch = vi.fn();
vi.mock('../../api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// Mock Toast
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe('CHALLENGER 1: UX-1 Boundary Tests (LocalAudioUploader & TrackSearch)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('File Size Boundaries', () => {
    it('rejects 0-byte file (boundary: size === 0)', () => {
      const file0 = new File([], 'zero.mp3', { type: 'audio/mpeg' });
      expect(file0.size).toBe(0);
      expect(validateAudioFile(file0)).toBe('Selected file is empty (0 bytes).');
    });

    it('accepts exactly 100MB file (boundary: size === 104,857,600 bytes)', () => {
      const exact100MB = new File(['content'], 'boundary.wav', { type: 'audio/wav' });
      Object.defineProperty(exact100MB, 'size', { value: 100 * 1024 * 1024 });
      expect(exact100MB.size).toBe(MAX_AUDIO_SIZE);
      expect(validateAudioFile(exact100MB)).toBeNull();
    });

    it('rejects 100MB + 1 Byte file (boundary: size === 104,857,601 bytes)', () => {
      const plusOneByte = new File(['content'], 'too_large.flac', { type: 'audio/flac' });
      Object.defineProperty(plusOneByte, 'size', { value: 100 * 1024 * 1024 + 1 });
      expect(plusOneByte.size).toBe(MAX_AUDIO_SIZE + 1);
      expect(validateAudioFile(plusOneByte)).toBe(
        'Audio file exceeds 100MB limit. Please choose a smaller file.'
      );
    });

    it('LocalAudioUploader UI drops file and fires error on 100MB + 1B', async () => {
      const onError = vi.fn();
      render(<LocalAudioUploader isLoading={false} customLyrics="" onError={onError} />);

      const oversized = new File(['x'], 'exceeds_by_1b.mp3', { type: 'audio/mpeg' });
      Object.defineProperty(oversized, 'size', { value: 104857601 });

      const input = screen.getByLabelText(/Choose local audio file/i);
      fireEvent.change(input, { target: { files: [oversized] } });

      expect(onError).toHaveBeenCalledWith(
        'Audio file exceeds 100MB limit. Please choose a smaller file.'
      );
      expect(screen.queryByText('exceeds_by_1b.mp3')).not.toBeInTheDocument();
    });
  });

  describe('Audio Extension Case-Insensitivity & Edge Cases', () => {
    it('accepts uppercase audio extensions (.MP3, .FLAC, .WAV, .M4A, .OGG, .AAC, .OPUS)', () => {
      const extensions = ['MP3', 'FLAC', 'WAV', 'M4A', 'OGG', 'AAC', 'OPUS', 'FlAc', 'mP3'];
      for (const ext of extensions) {
        const file = new File(['audio-payload'], `test_track.${ext}`, {
          type: 'audio/octet-stream',
        });
        expect(validateAudioFile(file)).toBeNull();
      }
    });

    it('rejects files without extension, or double extensions like .tar.gz or non-audio .mp4', () => {
      const invalidFiles = [
        new File(['bytes'], 'audiofile_no_extension', { type: 'audio/mpeg' }),
        new File(['bytes'], 'archive.tar.gz', { type: 'application/gzip' }),
        new File(['bytes'], 'video.mp4', { type: 'video/mp4' }),
        new File(['bytes'], 'lyrics.txt', { type: 'text/plain' }),
        new File(['bytes'], '.hidden_file', { type: 'audio/wav' }),
      ];

      for (const file of invalidFiles) {
        expect(validateAudioFile(file)).toBe(
          'Unsupported audio format. Supported formats: WAV, MP3, FLAC, M4A, OGG, OPUS, AAC.'
        );
      }
    });

    it('handles files with multiple dots where the last extension is valid audio', () => {
      const multiDot = new File(['audio'], 'artist.name.track.title.2026.flac', {
        type: 'audio/flac',
      });
      expect(validateAudioFile(multiDot)).toBeNull();
    });
  });

  describe('Filename Parsing: Multiple Hyphens & Unicode', () => {
    it('parses artist and title when title contains multiple hyphens', () => {
      const res = parseAudioFilename('Pink Floyd - Another-Brick-In-The-Wall-Part-2.mp3');
      expect(res.artist).toBe('Pink Floyd');
      expect(res.title).toBe('Another-Brick-In-The-Wall-Part-2');
    });

    it('parses when artist and title both contain hyphens', () => {
      const res = parseAudioFilename('B-52s - Rock-Lobster.flac');
      expect(res.artist).toBe('B-52s');
      expect(res.title).toBe('Rock-Lobster');
    });

    it('preserves single titles with multiple internal hyphens and no artist delimiter', () => {
      const res = parseAudioFilename('Self-Titled-Track-No-Artist.wav');
      expect(res.artist).toBeUndefined();
      expect(res.title).toBe('Self-Titled-Track-No-Artist');
    });

    it('correctly handles Unicode artist and title with various dashes (hyphen, en-dash, em-dash)', () => {
      // Japanese Kanji / Hiragana
      const jp = parseAudioFilename('LiSA - 炎.flac');
      expect(jp.artist).toBe('LiSA');
      expect(jp.title).toBe('炎');

      // Icelandic / Accents with En-dash (–)
      const icelandic = parseAudioFilename('Ásgeir – Dýrð í dauðaþögn.wav');
      expect(icelandic.artist).toBe('Ásgeir');
      expect(icelandic.title).toBe('Dýrð í dauðaþögn');

      // Russian Cyrillic with Em-dash (—)
      const cyrillic = parseAudioFilename('Кино — Звезда по имени Солнце.ogg');
      expect(cyrillic.artist).toBe('Кино');
      expect(cyrillic.title).toBe('Звезда по имени Солнце');

      // Chinese characters
      const zh = parseAudioFilename('周杰伦 - 青花瓷.m4a');
      expect(zh.artist).toBe('周杰伦');
      expect(zh.title).toBe('青花瓷');
    });

    it('handles extreme whitespace and underscore combinations', () => {
      const ugly = parseAudioFilename('___David__Bowie___-____Heroes____.mp3');
      expect(ugly.artist).toBe('David Bowie');
      expect(ugly.title).toBe('Heroes');
    });
  });

  describe('TrackSearch: Invalid URLs vs YouTube URLs', () => {
    it('accepts YouTube URLs and triggers onSelectTrack immediately', async () => {
      const user = userEvent.setup();
      const onSelectTrack = vi.fn();

      render(<TrackSearch onSelectTrack={onSelectTrack} isLoading={false} />);

      const input = screen.getByLabelText(/Paste YouTube or YouTube Music URL/i);
      const submitBtn = screen.getByRole('button', { name: /Search YouTube or load track/i });

      // YouTube standard watch URL
      await user.clear(input);
      await user.type(input, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      await user.click(submitBtn);
      expect(onSelectTrack).toHaveBeenCalledWith(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        undefined
      );

      // YouTube short URL
      onSelectTrack.mockClear();
      await user.clear(input);
      await user.type(input, 'https://youtu.be/dQw4w9WgXcQ');
      await user.click(submitBtn);
      expect(onSelectTrack).toHaveBeenCalledWith('https://youtu.be/dQw4w9WgXcQ', undefined);

      // YouTube Music URL
      onSelectTrack.mockClear();
      await user.clear(input);
      await user.type(input, 'https://music.youtube.com/watch?v=abc123xyz');
      await user.click(submitBtn);
      expect(onSelectTrack).toHaveBeenCalledWith(
        'https://music.youtube.com/watch?v=abc123xyz',
        undefined
      );
    });

    it('intercepts non-YouTube URLs and surfaces exact guidance error', async () => {
      const user = userEvent.setup();
      const onSelectTrack = vi.fn();

      render(<TrackSearch onSelectTrack={onSelectTrack} isLoading={false} />);

      const input = screen.getByLabelText(/Paste YouTube or YouTube Music URL/i);
      const submitBtn = screen.getByRole('button', { name: /Search YouTube or load track/i });

      const forbiddenUrls = [
        'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
        'https://soundcloud.com/artist/great-song',
        'https://vimeo.com/987654321',
        'https://bandcamp.com/track/heavy-metal',
        'https://music.apple.com/us/album/song/12345',
        'http://example.com/audio.mp3',
        'www.deezer.com/track/123456',
      ];

      for (const badUrl of forbiddenUrls) {
        await user.clear(input);
        await user.type(input, badUrl);
        await user.click(submitBtn);

        expect(onSelectTrack).not.toHaveBeenCalled();
        expect(
          screen.getByText(
            'Direct URL import currently supports YouTube and YouTube Music links. For other platforms, please download the audio file and use the Local Audio File tab.'
          )
        ).toBeInTheDocument();
      }
    });
  });
});

describe('CHALLENGER 1: UX-2 ProcessingView Stepper, Heartbeat & Disconnect Recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Stepper Transitions & Unknown Status Fallback', () => {
    it('maps all standard statuses to correct stages 0 through 4', () => {
      expect(getActivePipelineStage('queued')).toBe(0);
      expect(getActivePipelineStage('downloading')).toBe(0);
      expect(getActivePipelineStage('separating')).toBe(1);
      expect(getActivePipelineStage('separating', 'Detecting vocal chords...')).toBe(2);
      expect(getActivePipelineStage('separating', 'Computing vocal pitch range...')).toBe(2);
      expect(getActivePipelineStage('fetching_lyrics')).toBe(3);
      expect(getActivePipelineStage('aligning')).toBe(3);
      expect(getActivePipelineStage('mixing')).toBe(4);
    });

    it('safely falls back to Stage 0 for unknown or unexpected status strings without crashing', () => {
      expect(getActivePipelineStage('unknown_pipeline_state')).toBe(0);
      expect(getActivePipelineStage('pending_worker_dispatch')).toBe(0);
      expect(getActivePipelineStage(undefined, undefined)).toBe(0);
      expect(getActivePipelineStage('', '')).toBe(0);
    });

    it('renders ProcessingView with unknown status string gracefully (single-underscore replace behavior)', () => {
      const mockProject: ProjectState = {
        id: 'proj-unknown-1',
        status: 'custom_status_xyz' as unknown as ProjectState['status'],
        status_detail: 'Custom status detail message',
        progress: 42,
        lines: [],
        semitones: 0,
        guide_volume: 0,
      };

      render(
        <ProcessingView project={mockProject} onCancelProcess={vi.fn()} onResetProject={vi.fn()} />
      );

      // Note: ProcessingView uses (status || 'queued').replace('_', ' ') which replaces only the first underscore!
      // 'custom_status_xyz' becomes 'custom status_xyz...'
      expect(screen.getByText('custom status_xyz...')).toBeInTheDocument();
      expect(screen.getByText('Custom status detail message')).toBeInTheDocument();
      expect(screen.getByText('42% Complete')).toBeInTheDocument();
    });
  });

  describe('Heartbeat Boundary at 15s vs 16s', () => {
    it('heartbeat <= 15s is healthy (green ping indicator)', () => {
      const now = 1700000000000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      // Exactly 15,000ms old: not > 15000, so NOT stalled
      const healthyProject: ProjectState = {
        id: 'proj-hb-1',
        status: 'separating',
        progress: 25,
        heartbeat: now - 15000,
        lines: [],
        semitones: 0,
        guide_volume: 0,
      };

      render(
        <ProcessingView
          project={healthyProject}
          onCancelProcess={vi.fn()}
          onResetProject={vi.fn()}
        />
      );

      expect(screen.getByText(/Engine Active • Pulse 15s ago/i)).toBeInTheDocument();
      expect(
        screen.queryByText(/Engine slow \/ waiting for background worker/i)
      ).not.toBeInTheDocument();

      vi.restoreAllMocks();
    });

    it('heartbeat > 15s (e.g. 15.001s or 16s) triggers stalled amber alert', () => {
      const now = 1700000000000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      // 16,000ms old: strictly > 15000, so IS stalled
      const stalledProject: ProjectState = {
        id: 'proj-hb-2',
        status: 'separating',
        progress: 30,
        heartbeat: now - 16000,
        lines: [],
        semitones: 0,
        guide_volume: 0,
      };

      render(
        <ProcessingView
          project={stalledProject}
          onCancelProcess={vi.fn()}
          onResetProject={vi.fn()}
        />
      );

      expect(screen.getByText(/Engine slow \/ waiting for background worker/i)).toBeInTheDocument();
      expect(screen.queryByText(/Engine Active/i)).not.toBeInTheDocument();

      vi.restoreAllMocks();
    });
  });

  describe('Cancel Confirmation Dialog Click Behavior', () => {
    it('Cancel button opens confirmation; "Keep Processing" dismisses without aborting; "Confirm Cancel" aborts', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      const onReset = vi.fn();

      const project: ProjectState = {
        id: 'proj-cancel-1',
        status: 'separating',
        progress: 50,
        lines: [],
        semitones: 0,
        guide_volume: 0,
      };

      render(
        <ProcessingView project={project} onCancelProcess={onCancel} onResetProject={onReset} />
      );

      // Initially shows single Cancel button
      const initialCancelBtn = screen.getByRole('button', { name: /Cancel & Return to Search/i });
      await user.click(initialCancelBtn);

      // Alert dialog is displayed
      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toBeInTheDocument();
      expect(
        screen.getByText(/Cancel separation\? In-progress work will be lost\./i)
      ).toBeInTheDocument();

      // Click "Keep Processing"
      const keepBtn = screen.getByRole('button', { name: /Keep Processing/i });
      await user.click(keepBtn);

      // Dialog dismissed, onCancel NOT called, initial button restored
      expect(onCancel).not.toHaveBeenCalled();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Cancel & Return to Search/i })
      ).toBeInTheDocument();

      // Open dialog again and click "Confirm Cancel"
      await user.click(screen.getByRole('button', { name: /Cancel & Return to Search/i }));
      const confirmBtn = screen.getByRole('button', { name: /Confirm Cancel/i });
      await user.click(confirmBtn);

      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('Polling Disconnect After 3 Network Errors', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('triggers isReconnecting and updates status_detail after >= 3 consecutive polling errors', async () => {
      // Mock apiFetch failing with network errors
      mockApiFetch.mockRejectedValue(new Error('Network connection failed'));

      const initialProject: ProjectState = {
        id: 'proj-poll-1',
        status: 'separating',
        progress: 20,
        lines: [],
        semitones: 0,
        guide_volume: 0,
      };

      const { result } = renderHook(() => useProjectPolling(initialProject));

      expect(result.current.isReconnecting).toBe(false);
      expect(result.current.consecutiveErrors).toBe(0);

      // Advance 1 second -> Error 1
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.consecutiveErrors).toBe(1);
      expect(result.current.isReconnecting).toBe(false);

      // Advance 1 second -> Error 2
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.consecutiveErrors).toBe(2);
      expect(result.current.isReconnecting).toBe(false);

      // Advance 1 second -> Error 3 (Threshold met!)
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.consecutiveErrors).toBe(3);
      expect(result.current.isReconnecting).toBe(true);
      expect(result.current.project?.status_detail).toBe(
        'Network connection interrupted. Reconnecting to server...'
      );

      // Now verify retryPolling recovers state when network succeeds
      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...initialProject,
          progress: 50,
          status_detail: 'Resumed separation',
        }),
      });

      await act(async () => {
        result.current.retryPolling();
      });

      expect(result.current.consecutiveErrors).toBe(0);
      expect(result.current.isReconnecting).toBe(false);
      expect(result.current.project?.progress).toBe(50);
    });
  });
});

describe('CHALLENGER 1: UX-3 LRCLIB Candidate Search & Live Paste Syntax Inspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Live Paste Syntax Detection Edge Cases', () => {
    it('detects standard LRC timestamps [00:12.34]', async () => {
      render(
        <LyricReplacementModal
          isOpen={true}
          onClose={vi.fn()}
          projectId="proj-lrc-1"
          onSuccess={vi.fn()}
        />
      );

      const textarea = screen.getByLabelText(/Lyric Text or LRC Timestamps/i);
      fireEvent.change(textarea, { target: { value: '[00:12.34] Hello World' } });

      const inspector = screen.getByTestId('paste-syntax-inspector');
      expect(inspector).toHaveTextContent('✓ Synced LRC (1 lines detected)');
      expect(inspector).toHaveTextContent('All lines contain valid LRC timestamps');
    });

    it('detects the timestamps the server accepts ([00:00.00], [99:59.999], [00:12.4], [1:23]) and classifies 4-digit fractions as Plain Text', async () => {
      render(
        <LyricReplacementModal
          isOpen={true}
          onClose={vi.fn()}
          projectId="proj-lrc-2"
          onSuccess={vi.fn()}
        />
      );

      const textarea = screen.getByLabelText(/Lyric Text or LRC Timestamps/i);

      // 0-start boundary and 99-minute boundary with 3-digit ms
      const boundaryText = '[00:00.00] First onset\n[99:59.999] Final echo';
      fireEvent.change(textarea, { target: { value: boundaryText } });

      expect(screen.getByText(/✓ Synced LRC \(2 lines detected\)/i)).toBeInTheDocument();

      // The server's LRC test (\[\d{1,4}:\d{2}(?:\.\d{1,3})?\]) rejects 4-digit fractions, so
      // the inspector calls them Plain Text too
      fireEvent.change(textarea, { target: { value: '[01:23.4567] High precision timestamp' } });
      expect(
        screen.getByText(/ℹ Plain Text \(1 lines, will require alignment\)/i)
      ).toBeInTheDocument();

      // One fractional digit and whole seconds are synced lyrics to the server, and so here
      fireEvent.change(textarea, { target: { value: '[00:12.4] Single digit fraction' } });
      expect(screen.getByText(/✓ Synced LRC \(1 lines detected\)/i)).toBeInTheDocument();
      fireEvent.change(textarea, { target: { value: '[1:23] Whole seconds' } });
      expect(screen.getByText(/✓ Synced LRC \(1 lines detected\)/i)).toBeInTheDocument();
    });

    it('identifies bracketed chords or non-timestamp text as Plain Text', async () => {
      render(
        <LyricReplacementModal
          isOpen={true}
          onClose={vi.fn()}
          projectId="proj-lrc-3"
          onSuccess={vi.fn()}
        />
      );

      const textarea = screen.getByLabelText(/Lyric Text or LRC Timestamps/i);

      // Bracketed chords look like [Am] [C] [G]
      fireEvent.change(textarea, {
        target: { value: '[Am] I heard that you were [C] settled down\n[G] That you found a girl' },
      });

      expect(
        screen.getByText(/ℹ Plain Text \(2 lines, will require alignment\)/i)
      ).toBeInTheDocument();

      // Colon-separated timestamps without dot: [01:23:45]
      fireEvent.change(textarea, { target: { value: '[01:23:45] Track title' } });
      expect(
        screen.getByText(/ℹ Plain Text \(1 lines, will require alignment\)/i)
      ).toBeInTheDocument();
    });

    it('differentiates mixed input (some lines with LRC, some plain)', async () => {
      render(
        <LyricReplacementModal
          isOpen={true}
          onClose={vi.fn()}
          projectId="proj-lrc-4"
          onSuccess={vi.fn()}
        />
      );

      const textarea = screen.getByLabelText(/Lyric Text or LRC Timestamps/i);
      fireEvent.change(textarea, {
        target: {
          value:
            '[00:10.00] First timed line\nSecond line without timing\n[00:20.00] Third timed line',
        },
      });

      const inspector = screen.getByTestId('paste-syntax-inspector');
      expect(inspector).toHaveTextContent('✓ Synced LRC (3 lines detected)');
      expect(inspector).toHaveTextContent('2 of 3 lines contain LRC timestamps');
    });
  });

  describe('Candidate Search Formatting & Empty Lyrics Guard', () => {
    it('formats candidate durations accurately across 0, seconds, minutes, and NaN/undefined', async () => {
      const candidates = [
        {
          id: 1,
          track_name: 'Short Song',
          artist_name: 'Artist',
          duration: 45, // 0:45
          synced_lyrics: '[00:01.00] Short',
        },
        {
          id: 2,
          track_name: 'Exact Minute',
          artist_name: 'Artist',
          duration: 120, // 2:00
          synced_lyrics: '[00:01.00] Two minutes',
        },
        {
          id: 3,
          track_name: 'Corrupted Duration',
          artist_name: 'Artist',
          duration: -10, // should format to 0:00
          plain_lyrics: 'Plain lyrics',
        },
      ];

      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => candidates,
      });

      const user = userEvent.setup();
      render(
        <LyricReplacementModal
          isOpen={true}
          onClose={vi.fn()}
          projectId="proj-cand-1"
          trackTitle="Short Song"
          trackArtist="Artist"
          onSuccess={vi.fn()}
        />
      );

      await user.click(screen.getByRole('button', { name: /Re-query LRCLIB/i }));
      await user.click(screen.getByRole('button', { name: /Search Candidates/i }));

      await waitFor(() => {
        expect(screen.getByText('0:45', { exact: false })).toBeInTheDocument();
        expect(screen.getByText('2:00', { exact: false })).toBeInTheDocument();
        expect(screen.getByText('0:00', { exact: false })).toBeInTheDocument();
      });
    });

    it('prevents applying candidates with empty plain and synced lyrics', async () => {
      const emptyCand = [
        {
          id: 999,
          track_name: 'Empty Candidate Song',
          artist_name: 'Ghost Artist',
          album_name: 'Phantom Album',
          duration: 180,
          instrumental: false,
          plain_lyrics: '',
          synced_lyrics: '   ', // whitespace only
        },
      ];

      mockApiFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => emptyCand,
      });

      const user = userEvent.setup();
      render(
        <LyricReplacementModal
          isOpen={true}
          onClose={vi.fn()}
          projectId="proj-empty-cand"
          trackTitle="Target Song"
          trackArtist="Target Artist"
          onSuccess={vi.fn()}
        />
      );

      await user.click(screen.getByRole('button', { name: /Re-query LRCLIB/i }));
      await user.click(screen.getByRole('button', { name: /Search Candidates/i }));

      // Wait for candidate card to render
      await waitFor(() => {
        expect(screen.getByTestId('lyric-candidate-0')).toBeInTheDocument();
      });

      // Attempt to apply the empty candidate
      const applyBtn = screen.getByRole('button', {
        name: /Apply candidate Empty Candidate Song/i,
      });
      await user.click(applyBtn);

      // Realign API should NOT be called
      expect(mockApiFetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/realign-lyrics'),
        expect.anything()
      );
      expect(screen.getByText('Selected candidate has empty lyrics.')).toBeInTheDocument();
    });
  });
});

describe('CHALLENGER 1: UX-4 Token Preservation During Typo Edits & Boundary Clamping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Token Preservation on Typo Edits vs Count Mismatch Fallback', () => {
    it('preserves exact word start and end boundaries when token count matches', () => {
      const initialLines: LyricLine[] = [
        {
          id: 1,
          text: 'Is ths the reel life',
          start_time: 1.0,
          end_time: 3.5,
          words: [
            { word: 'Is', start_time: 1.0, end_time: 1.4 },
            { word: 'ths', start_time: 1.4, end_time: 2.0 },
            { word: 'the', start_time: 2.0, end_time: 2.3 },
            { word: 'reel', start_time: 2.3, end_time: 2.9 },
            { word: 'life', start_time: 2.9, end_time: 3.5 },
          ],
        },
      ];

      const { result } = renderHook(() =>
        useLyricEditorState({
          lines: initialLines,
          currentTime: 0,
          duration: 60,
          onSaveLines: vi.fn(),
        })
      );

      // Commit typo fix with EXACT same token count (5 words): "Is this the real life"
      act(() => {
        result.current.handleCommitEditing(1, 'Is this the real life');
      });

      const updated = result.current.editableLines[0];
      expect(updated.text).toBe('Is this the real life');
      expect(updated.words.length).toBe(5);

      // Verify words are updated, but timings are 100% preserved
      expect(updated.words[0]).toEqual({ word: 'Is', start_time: 1.0, end_time: 1.4 });
      expect(updated.words[1]).toEqual({ word: 'this', start_time: 1.4, end_time: 2.0 });
      expect(updated.words[2]).toEqual({ word: 'the', start_time: 2.0, end_time: 2.3 });
      expect(updated.words[3]).toEqual({ word: 'real', start_time: 2.3, end_time: 2.9 });
      expect(updated.words[4]).toEqual({ word: 'life', start_time: 2.9, end_time: 3.5 });
    });

    it('falls back to recalculateWordTimings when token count changes (e.g. word added or removed)', () => {
      const initialLines: LyricLine[] = [
        {
          id: 1,
          text: 'One two three',
          start_time: 2.0,
          end_time: 5.0,
          words: [
            { word: 'One', start_time: 2.0, end_time: 3.0 },
            { word: 'two', start_time: 3.0, end_time: 4.0 },
            { word: 'three', start_time: 4.0, end_time: 5.0 },
          ],
        },
      ];

      const { result } = renderHook(() =>
        useLyricEditorState({
          lines: initialLines,
          currentTime: 0,
          duration: 60,
          onSaveLines: vi.fn(),
        })
      );

      // Add a word: 3 words -> 4 words ("One and two three")
      act(() => {
        result.current.handleCommitEditing(1, 'One and two three');
      });

      const updated = result.current.editableLines[0];
      expect(updated.text).toBe('One and two three');
      expect(updated.words.length).toBe(4);
      expect(updated.words.map((w) => w.word)).toEqual(['One', 'and', 'two', 'three']);

      // Timings span [2.0, 5.0] monotonically
      expect(updated.words[0].start_time).toBe(2.0);
      expect(updated.words[3].end_time).toBe(5.0);
      for (let i = 0; i < updated.words.length; i++) {
        expect(updated.words[i].start_time).toBeLessThan(updated.words[i].end_time);
        if (i > 0) {
          expect(updated.words[i].start_time).toBeGreaterThanOrEqual(updated.words[i - 1].end_time);
        }
      }
    });
  });

  describe('Adjacent Word Boundary Clamping (start >= end invariants)', () => {
    it('clamps word start_time between previous word end_time and current word end_time', () => {
      const initialLines: LyricLine[] = [
        {
          id: 1,
          text: 'First second third',
          start_time: 1.0,
          end_time: 4.0,
          words: [
            { word: 'First', start_time: 1.0, end_time: 2.0 },
            { word: 'second', start_time: 2.0, end_time: 3.0 },
            { word: 'third', start_time: 3.0, end_time: 4.0 },
          ],
        },
      ];

      const { result } = renderHook(() =>
        useLyricEditorState({
          lines: initialLines,
          currentTime: 0,
          duration: 60,
          onSaveLines: vi.fn(),
        })
      );

      // 1. Attempt to drag 'second' start_time earlier than 'First' end_time (2.0) -> must clamp to 2.0
      act(() => {
        result.current.updateWordTiming(1, 1, 'start_time', 0.5);
      });
      expect(result.current.editableLines[0].words[1].start_time).toBe(2.0);

      // 2. Attempt to drag 'second' start_time past its own end_time (3.0) -> must clamp to 3.0
      act(() => {
        result.current.updateWordTiming(1, 1, 'start_time', 3.8);
      });
      expect(result.current.editableLines[0].words[1].start_time).toBe(3.0);
    });

    it('clamps word end_time between current word start_time and next word start_time', () => {
      const initialLines: LyricLine[] = [
        {
          id: 1,
          text: 'First second third',
          start_time: 1.0,
          end_time: 4.0,
          words: [
            { word: 'First', start_time: 1.0, end_time: 2.0 },
            { word: 'second', start_time: 2.0, end_time: 3.0 },
            { word: 'third', start_time: 3.0, end_time: 4.0 },
          ],
        },
      ];

      const { result } = renderHook(() =>
        useLyricEditorState({
          lines: initialLines,
          currentTime: 0,
          duration: 60,
          onSaveLines: vi.fn(),
        })
      );

      // 1. Attempt to drag 'second' end_time earlier than its own start_time (2.0) -> must clamp to 2.0
      act(() => {
        result.current.updateWordTiming(1, 1, 'end_time', 1.2);
      });
      expect(result.current.editableLines[0].words[1].end_time).toBe(2.0);

      // 2. Attempt to drag 'second' end_time past 'third' start_time (3.0) -> must clamp to 3.0
      act(() => {
        result.current.updateWordTiming(1, 1, 'end_time', 3.9);
      });
      expect(result.current.editableLines[0].words[1].end_time).toBe(3.0);
    });
  });

  describe('Playhead Snapping With Boundary Clamping in ExpandedWordEditor', () => {
    it('snaps start and end to playhead within valid boundaries and clamps outside them', async () => {
      const user = userEvent.setup();
      const onUpdateWordTiming = vi.fn();

      const testLine: LyricLine = {
        id: 10,
        text: 'Alpha Beta Gamma',
        start_time: 2.0,
        end_time: 5.0,
        words: [
          { word: 'Alpha', start_time: 2.0, end_time: 3.0 },
          { word: 'Beta', start_time: 3.0, end_time: 4.0 },
          { word: 'Gamma', start_time: 4.0, end_time: 5.0 },
        ],
      };

      // Playhead at 3.45s (inside Beta [3.0, 4.0])
      const { rerender } = render(
        <ExpandedWordEditor
          line={testLine}
          activeWordLoc={null}
          currentTime={3.45}
          onWordClick={vi.fn()}
          onNudgeWord={vi.fn()}
          onNudgeWordBoundary={vi.fn()}
          onUpdateWordTiming={onUpdateWordTiming}
        />
      );

      // Snap Beta start to playhead (3.45s is between Alpha end 3.0 and Beta end 4.0)
      const snapBetaStart = screen.getByLabelText('Snap start of word Beta to playhead');
      await user.click(snapBetaStart);
      expect(onUpdateWordTiming).toHaveBeenCalledWith(10, 1, 'start_time', 3.45);

      onUpdateWordTiming.mockClear();

      // Now set playhead to 1.5s (before Alpha end 3.0) and snap Beta start
      rerender(
        <ExpandedWordEditor
          line={testLine}
          activeWordLoc={null}
          currentTime={1.5}
          onWordClick={vi.fn()}
          onNudgeWord={vi.fn()}
          onNudgeWordBoundary={vi.fn()}
          onUpdateWordTiming={onUpdateWordTiming}
        />
      );

      await user.click(snapBetaStart);
      // Clamped to Alpha end_time (3.0)
      expect(onUpdateWordTiming).toHaveBeenCalledWith(10, 1, 'start_time', 3.0);

      onUpdateWordTiming.mockClear();

      // Now set playhead to 5.5s (after Gamma start 4.0) and snap Beta end
      rerender(
        <ExpandedWordEditor
          line={testLine}
          activeWordLoc={null}
          currentTime={5.5}
          onWordClick={vi.fn()}
          onNudgeWord={vi.fn()}
          onNudgeWordBoundary={vi.fn()}
          onUpdateWordTiming={onUpdateWordTiming}
        />
      );

      const snapBetaEnd = screen.getByLabelText('Snap end of word Beta to playhead');
      await user.click(snapBetaEnd);
      // Clamped to Gamma start_time (4.0)
      expect(onUpdateWordTiming).toHaveBeenCalledWith(10, 1, 'end_time', 4.0);
    });
  });
});

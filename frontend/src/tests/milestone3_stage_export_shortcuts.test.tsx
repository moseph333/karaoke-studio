import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';
import { LyricDisplay } from '../components/LyricDisplay';
import { PitchTranspositionControl } from '../components/audio/PitchTranspositionControl';
import { StudioHeader } from '../components/StudioHeader';
import { ExportModal } from '../components/ExportModal';
import { ExportSubtitleSection } from '../components/export/ExportSubtitleSection';
import { ExportAudioSection } from '../components/export/ExportAudioSection';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { LyricLine, ProjectState, VisualTheme } from '../types';
import * as apiModule from '../api';

const sampleLines: LyricLine[] = [
  {
    id: 1,
    text: 'First line of the song',
    start_time: 4.0,
    end_time: 7.0,
    words: [
      { word: 'First', start_time: 4.0, end_time: 4.8 },
      { word: 'line', start_time: 4.9, end_time: 5.5 },
      { word: 'of', start_time: 5.6, end_time: 6.0 },
      { word: 'the', start_time: 6.1, end_time: 6.4 },
      { word: 'song', start_time: 6.5, end_time: 7.0 },
    ],
  },
  {
    id: 2,
    text: 'Second line follows next',
    start_time: 10.0,
    end_time: 14.0,
    words: [
      { word: 'Second', start_time: 10.0, end_time: 10.8 },
      { word: 'line', start_time: 10.9, end_time: 11.8 },
      { word: 'follows', start_time: 11.9, end_time: 12.8 },
      { word: 'next', start_time: 12.9, end_time: 14.0 },
    ],
  },
  {
    id: 3,
    text: 'Third line reaches finale',
    start_time: 18.0,
    end_time: 22.0,
    words: [
      { word: 'Third', start_time: 18.0, end_time: 18.8 },
      { word: 'line', start_time: 18.9, end_time: 19.8 },
      { word: 'reaches', start_time: 19.9, end_time: 20.8 },
      { word: 'finale', start_time: 20.9, end_time: 22.0 },
    ],
  },
];

const mockProject: ProjectState = {
  id: 'proj_m3_test',
  title: 'Electric Dreams',
  artist: 'Studio 77',
  status: 'ready',
  progress: 100,
  lines: sampleLines,
  semitones: 0,
  guide_volume: 0.2,
  render_status: 'idle',
  render_progress: 0,
};

const customTheme: VisualTheme = {
  id: 'punk_diy',
  name: 'Punk / DIY Zine',
  description: 'Underground zine cutouts and neon punk energy',
  previewBg: '#121212',
  previewSung: '#ff2a5f',
  previewUnsung: '#f5f5f5',
  primary_color: '#ff2a5f',
  secondary_color: '#f5f5f5',
  fontFamily: 'Courier New, monospace',
};

describe('Milestone 3 — UX-5: TV Stage Mode Controls, Theme Integration & Pitch Feedback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('LyricDisplay TV Stage Floating Controls', () => {
    it('renders floating pitch steppers and volume controls in fullscreen TV mode', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={5.0}
          duration={60}
          isPlaying={true}
          semitones={0}
          volume={0.8}
        />
      );

      // Enter fullscreen TV stage mode
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      const controls = screen.getByTestId('stage-floating-controls');
      expect(controls).toBeInTheDocument();

      // Pitch steppers exist
      expect(screen.getByTestId('stage-pitch-down')).toBeInTheDocument();
      expect(screen.getByTestId('stage-pitch-display')).toHaveTextContent('0 st');
      expect(screen.getByTestId('stage-pitch-up')).toBeInTheDocument();

      // Volume controls exist
      expect(screen.getByTestId('stage-volume-btn')).toBeInTheDocument();
      expect(screen.getByTestId('stage-volume-slider')).toBeInTheDocument();
      expect(screen.getByTestId('stage-volume-slider')).toHaveValue('0.8');
    });

    it('transposes pitch directly in stage mode via -1 and +1 steppers', () => {
      const onSemitonesChange = vi.fn();
      const onPitchStep = vi.fn();

      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={5.0}
          duration={60}
          semitones={1}
          onSemitonesChange={onSemitonesChange}
          onPitchStep={onPitchStep}
        />
      );

      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      expect(screen.getByTestId('stage-pitch-display')).toHaveTextContent('+1 st');

      // Click +1 stepper
      fireEvent.click(screen.getByTestId('stage-pitch-up'));
      expect(onPitchStep).toHaveBeenCalledWith(1);
      expect(onSemitonesChange).toHaveBeenCalledWith(2);

      // Click -1 stepper
      fireEvent.click(screen.getByTestId('stage-pitch-down'));
      expect(onPitchStep).toHaveBeenCalledWith(-1);
    });

    it('adjusts volume and toggles mute directly in stage mode', () => {
      const onVolumeChange = vi.fn();
      const onToggleMute = vi.fn();

      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={5.0}
          duration={60}
          volume={0.7}
          isMuted={false}
          onVolumeChange={onVolumeChange}
          onToggleMute={onToggleMute}
        />
      );

      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      // Adjust slider
      const slider = screen.getByTestId('stage-volume-slider');
      fireEvent.change(slider, { target: { value: '0.4' } });
      expect(onVolumeChange).toHaveBeenCalledWith(0.4);

      // Click mute button
      const muteBtn = screen.getByTestId('stage-volume-btn');
      fireEvent.click(muteBtn);
      expect(onToggleMute).toHaveBeenCalledTimes(1);
    });

    it('applies semantic theme token classes and dynamic previewBg to stage container', () => {
      render(<LyricDisplay lines={sampleLines} currentTime={5.0} selectedTheme={customTheme} />);

      const stage = screen.getByTestId('lyric-display-stage');
      // Should include theme token classes
      expect(stage.className).toContain('bg-theme-bg');
      expect(stage.className).toContain('text-theme-text');
      expect(stage.className).toContain('font-theme-body');
      expect(stage.className).toContain('font-theme-heading');
      // Should apply custom background style
      expect(stage.style.backgroundColor).toBe('rgb(18, 18, 18)');
    });

    it('renders dedicated non-colliding countdown badge above active lyric line with explicit count', () => {
      // First line starts at 4.0s, so at 2.5s, countdown is 2 seconds
      render(<LyricDisplay lines={sampleLines} currentTime={2.5} />);

      const cue = screen.getByTestId('countdown-cue');
      expect(cue).toBeInTheDocument();
      // Verifies numeric count display and non-colliding badge structure
      expect(cue).toHaveTextContent('2');
      expect(cue).toHaveAttribute('aria-label', expect.stringContaining('Starting in 2 seconds'));

      // Check bullet dot indicator elements are present inside cue
      expect(cue.textContent).toContain('●');
    });
  });

  describe('PitchTranspositionControl Visual Feedback', () => {
    it('displays "Pending Mix / Click Apply" amber badge when semitones !== 0', () => {
      const { rerender } = render(
        <PitchTranspositionControl
          semitones={0}
          onSemitoneChange={vi.fn()}
          onResetPitch={vi.fn()}
        />
      );

      // At 0 semitones (original key), pending badge is not rendered
      expect(screen.queryByTestId('pitch-pending-mix-badge')).not.toBeInTheDocument();
      expect(screen.queryByText(/Pending Mix \/ Click Apply/i)).not.toBeInTheDocument();

      // Shift to +2 semitones without applying mix
      rerender(
        <PitchTranspositionControl
          semitones={2}
          onSemitoneChange={vi.fn()}
          onResetPitch={vi.fn()}
        />
      );

      const badge = screen.getByTestId('pitch-pending-mix-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Pending Mix / Click Apply');
      expect(badge.className).toContain('bg-amber-500/20');
      expect(badge.className).toContain('text-amber-300');
    });

    it('respects explicit isMixPending prop when provided', () => {
      render(
        <PitchTranspositionControl
          semitones={3}
          isMixPending={false}
          onSemitoneChange={vi.fn()}
          onResetPitch={vi.fn()}
        />
      );

      // When isMixPending is explicitly false, badge should not display
      expect(screen.queryByTestId('pitch-pending-mix-badge')).not.toBeInTheDocument();
    });
  });
});

describe('Milestone 3 — UX-6: Export Progress, Safe Downloads, Gutter Fix & Precision Shortcuts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('StudioHeader Background Render Progress', () => {
    it('displays persistent compact progress badge when project is rendering and modal is closed', () => {
      const renderingProject: ProjectState = {
        ...mockProject,
        render_status: 'rendering',
        render_progress: 42,
      };

      const onOpenExportModal = vi.fn();

      render(
        <StudioHeader
          currentUser="KaraokeHost"
          project={renderingProject}
          isLyricsDirty={false}
          onOpenHelp={vi.fn()}
          onOpenAuth={vi.fn()}
          onNewSong={vi.fn()}
          onStartRender={vi.fn()}
          isExportModalOpen={false}
          onOpenExportModal={onOpenExportModal}
        />
      );

      const progressBadge = screen.getByTestId('header-render-progress');
      expect(progressBadge).toBeInTheDocument();
      expect(progressBadge).toHaveTextContent('Rendering Video: 42%');

      // Re-open / View button works
      const reopenBtn = screen.getByTestId('header-reopen-export-modal');
      expect(reopenBtn).toHaveTextContent('View');
      fireEvent.click(reopenBtn);
      expect(onOpenExportModal).toHaveBeenCalledTimes(1);
    });

    it('hides progress badge when export modal is open or when status is idle', () => {
      const renderingProject: ProjectState = {
        ...mockProject,
        render_status: 'rendering',
        render_progress: 60,
      };

      // Case 1: Modal is open
      const { rerender } = render(
        <StudioHeader
          currentUser="KaraokeHost"
          project={renderingProject}
          isLyricsDirty={false}
          onOpenHelp={vi.fn()}
          onOpenAuth={vi.fn()}
          onNewSong={vi.fn()}
          onStartRender={vi.fn()}
          isExportModalOpen={true}
        />
      );
      expect(screen.queryByTestId('header-render-progress')).not.toBeInTheDocument();

      // Case 2: Status is idle
      rerender(
        <StudioHeader
          currentUser="KaraokeHost"
          project={{ ...mockProject, render_status: 'idle' }}
          isLyricsDirty={false}
          onOpenHelp={vi.fn()}
          onOpenAuth={vi.fn()}
          onNewSong={vi.fn()}
          onStartRender={vi.fn()}
          isExportModalOpen={false}
        />
      );
      expect(screen.queryByTestId('header-render-progress')).not.toBeInTheDocument();
    });
  });

  describe('Safe Async Blob Revocation & Toast Feedback', () => {
    let originalCreateObjectURL: typeof window.URL.createObjectURL;
    let originalRevokeObjectURL: typeof window.URL.revokeObjectURL;

    let clickSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.useFakeTimers();
      clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      originalCreateObjectURL = window.URL.createObjectURL;
      originalRevokeObjectURL = window.URL.revokeObjectURL;
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/test-uuid');
      window.URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
      clickSpy.mockRestore();
      window.URL.createObjectURL = originalCreateObjectURL;
      window.URL.revokeObjectURL = originalRevokeObjectURL;
      vi.useRealTimers();
    });

    it('delays URL.revokeObjectURL by 1500ms in ExportSubtitleSection', async () => {
      const mockBlob = new Blob(['1\n00:00:01,000 --> 00:00:04,000\nHello'], {
        type: 'text/plain',
      });
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValueOnce({
        ok: true,
        blob: async () => mockBlob,
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="lyrics.ass"',
        }),
      } as unknown as Response);

      render(<ExportSubtitleSection project={mockProject} />);

      const assButton = screen.getByRole('button', { name: /Download \.ASS/i });
      fireEvent.click(assButton);

      await act(async () => {
        await Promise.resolve();
      });

      // Synchronously, revokeObjectURL should NOT have been called yet
      expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();

      // Advance by 1499ms: still not revoked
      act(() => {
        vi.advanceTimersByTime(1499);
      });
      expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();

      // Advance past 1500ms: safely revoked
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/test-uuid');
    });

    it('delays URL.revokeObjectURL by 1500ms in ExportAudioSection', async () => {
      const mockBlob = new Blob(['audio-data'], { type: 'audio/wav' });
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValueOnce({
        ok: true,
        blob: async () => mockBlob,
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="instrumental.wav"',
        }),
      } as unknown as Response);

      render(<ExportAudioSection project={mockProject} />);

      const instButton = screen.getByRole('button', { name: /Download Instrumental/i });
      fireEvent.click(instButton);

      await act(async () => {
        await Promise.resolve();
      });

      expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/test-uuid');
    });

    it('delays URL.revokeObjectURL by 1500ms on chord sheet download in ExportModal', async () => {
      const mockBlob = new Blob(['Chords Sheet'], { type: 'text/markdown' });
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValueOnce({
        ok: true,
        blob: async () => mockBlob,
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="chords.md"',
        }),
      } as unknown as Response);

      render(<ExportModal project={mockProject} isOpen={true} onClose={vi.fn()} />);

      const chordDownloadBtn = screen.getByTestId('download-chord-sheet-btn');
      fireEvent.click(chordDownloadBtn);

      await act(async () => {
        await Promise.resolve();
      });

      expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/test-uuid');
    });
  });

  describe('Precision Seeking & Navigation Shortcuts', () => {
    it('executes 1s fine seeking on Shift + ArrowLeft and Shift + ArrowRight', () => {
      const onSeek = vi.fn();

      renderHook(() =>
        useKeyboardShortcuts({
          onSeek,
          currentTime: 10.0,
          duration: 100.0,
          precisionSeeking: true,
          seekStep: 5,
          fineSeekStep: 1,
        })
      );

      // Shift + ArrowLeft: seeks 1s backward (10.0 - 1 = 9.0)
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true })
      );
      expect(onSeek).toHaveBeenLastCalledWith(9.0);

      // Shift + ArrowRight: seeks 1s forward (10.0 + 1 = 11.0)
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })
      );
      expect(onSeek).toHaveBeenLastCalledWith(11.0);
    });

    it('executes 15s coarse seeking on Alt + ArrowLeft and Alt + ArrowRight', () => {
      const onSeek = vi.fn();

      renderHook(() =>
        useKeyboardShortcuts({
          onSeek,
          currentTime: 25.0,
          duration: 100.0,
          coarseSeekStep: 15,
        })
      );

      // Alt + ArrowLeft: seeks 15s backward (25.0 - 15 = 10.0)
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true })
      );
      expect(onSeek).toHaveBeenLastCalledWith(10.0);

      // Alt + ArrowRight: seeks 15s forward (25.0 + 15 = 40.0)
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true })
      );
      expect(onSeek).toHaveBeenLastCalledWith(40.0);
    });

    it('executes standard 5s seeking when neither Shift nor Alt is pressed', () => {
      const onSeek = vi.fn();

      renderHook(() =>
        useKeyboardShortcuts({
          onSeek,
          currentTime: 20.0,
          duration: 100.0,
          seekStep: 5,
        })
      );

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      expect(onSeek).toHaveBeenLastCalledWith(15.0);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(onSeek).toHaveBeenLastCalledWith(25.0);
    });

    it('jumps to previous and next lyric lines on [ and ] keys', () => {
      const onSeek = vi.fn();

      // At 11.0s, playhead is in line 1 (starts at 10.0s)
      renderHook(() =>
        useKeyboardShortcuts({
          onSeek,
          currentTime: 11.0,
          duration: 60.0,
          lines: sampleLines,
        })
      );

      // '[' jumps to line 0 start (4.0s)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }));
      expect(onSeek).toHaveBeenLastCalledWith(4.0);

      // ']' jumps to line 2 start (18.0s)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
      expect(onSeek).toHaveBeenLastCalledWith(18.0);
    });

    it('replays active lyric line from start time on R key', () => {
      const onSeek = vi.fn();

      // At 12.5s, playhead is in line 1 (10.0s - 14.0s)
      renderHook(() =>
        useKeyboardShortcuts({
          onSeek,
          currentTime: 12.5,
          duration: 60.0,
          lines: sampleLines,
        })
      );

      // Press 'r' to replay active line
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      expect(onSeek).toHaveBeenCalledWith(10.0);

      // Press 'R' (uppercase)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', bubbles: true }));
      expect(onSeek).toHaveBeenCalledWith(10.0);
    });

    it('isolates precision shortcuts when focused inside an input or textarea', () => {
      const onSeek = vi.fn();

      render(
        <div>
          <input data-testid="test-input" type="text" />
          <textarea data-testid="test-textarea" />
        </div>
      );

      renderHook(() =>
        useKeyboardShortcuts({
          onSeek,
          currentTime: 12.5,
          duration: 60.0,
          lines: sampleLines,
          precisionSeeking: true,
        })
      );

      const input = screen.getByTestId('test-input');
      input.focus();

      // Keystrokes in input must not trigger seek
      fireEvent.keyDown(input, { key: 'ArrowLeft', shiftKey: true });
      fireEvent.keyDown(input, { key: 'ArrowRight', altKey: true });
      fireEvent.keyDown(input, { key: '[' });
      fireEvent.keyDown(input, { key: ']' });
      fireEvent.keyDown(input, { key: 'r' });

      expect(onSeek).not.toHaveBeenCalled();
    });
  });
});

/**
 * Empirical Adversarial Test Harness — Challenger 2
 * Milestone 3: UX-5 & UX-6 (Stage Mode, Export & Shortcuts)
 *
 * Exhaustive boundary, stress, and failure-mode testing:
 * 1. UX-5 TV Stage floating controls:
 *    - Pitch clamping bounds [-12, +12]
 *    - Volume clamping bounds [0, 1] & auto-unmute when slider moved > 0
 *    - Theme previewBg fallback & viewport container classes
 *    - Countdown cue boundary when t < 0 and during extended instrumental gap
 * 2. UX-5 Pitch transposition unapplied mix indicator:
 *    - Matrix of semitones === 0 vs !== 0
 *    - appliedSemitones matching vs differing
 *    - isMixPending explicit override
 * 3. UX-6 StudioHeader persistent render progress:
 *    - State transitions: rendering, queued, idle, completed, error
 *    - Modal open vs closed visibility
 *    - Progress percentage bounds (0%, 100%, rounding, undefined, null)
 *    - Reopen modal launcher fallback
 * 4. UX-6 Export safe blob revocation:
 *    - Delayed revocation timing (0ms -> 1499ms -> 1500ms)
 *    - Non-premature revocation verification across subtitle, stem, and chord sheet downloads
 *    - Multiple consecutive downloads
 * 5. UX-6 Precision seeking shortcuts:
 *    - Shift+Arrow 1s, Alt+Arrow 15s
 *    - Clamping at t=0 and t=duration
 *    - Line jumps '[' and ']' at boundary line 0 and line N-1
 *    - 'R' / 'r' active line replay and fallback
 *    - Suppression inside <input>, <textarea>, [contenteditable], [role="textbox"], and open modals
 */

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
    text: 'Intro lyric line',
    start_time: 10.0, // 10s intro gap (>= 4.0s threshold)
    end_time: 14.0,
    words: [
      { word: 'Intro', start_time: 10.0, end_time: 11.5 },
      { word: 'lyric', start_time: 11.6, end_time: 12.8 },
      { word: 'line', start_time: 12.9, end_time: 14.0 },
    ],
  },
  {
    id: 2,
    text: 'Middle lyric line after solo',
    start_time: 25.0, // 11s inter-line gap [14.0, 25.0]
    end_time: 30.0,
    words: [
      { word: 'Middle', start_time: 25.0, end_time: 26.5 },
      { word: 'lyric', start_time: 26.6, end_time: 28.0 },
      { word: 'line', start_time: 28.1, end_time: 29.0 },
      { word: 'after', start_time: 29.1, end_time: 29.5 },
      { word: 'solo', start_time: 29.6, end_time: 30.0 },
    ],
  },
  {
    id: 3,
    text: 'Final crescendo',
    start_time: 32.0,
    end_time: 36.0,
    words: [
      { word: 'Final', start_time: 32.0, end_time: 33.5 },
      { word: 'crescendo', start_time: 33.6, end_time: 36.0 },
    ],
  },
];

const mockProject: ProjectState = {
  id: 'challenger2_proj',
  title: 'Neon Nights',
  artist: 'The Adversaries',
  status: 'ready',
  progress: 100,
  lines: sampleLines,
  semitones: 0,
  guide_volume: 0.5,
  render_status: 'idle',
  render_progress: 0,
};

describe('Adversarial Stress Suite — UX-5: TV Stage Floating Controls & Pitch Transposition', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. TV Stage Pitch Clamping [-12, +12]', () => {
    it('strictly clamps pitch down stepping at -12 semitones and prevents underflow', () => {
      const onSemitonesChange = vi.fn();
      const onPitchStep = vi.fn();

      const { rerender } = render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={12.0}
          duration={60}
          semitones={-11}
          onSemitonesChange={onSemitonesChange}
          onPitchStep={onPitchStep}
        />
      );

      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));
      expect(screen.getByTestId('stage-pitch-display')).toHaveTextContent('-11 st');

      const pitchDownBtn = screen.getByTestId('stage-pitch-down');

      // First step: -11 -> -12
      fireEvent.click(pitchDownBtn);
      expect(onSemitonesChange).toHaveBeenLastCalledWith(-12);
      expect(onPitchStep).toHaveBeenLastCalledWith(-1);

      // Re-render at boundary -12 using rerender instead of mounting second instance
      rerender(
        <LyricDisplay
          lines={sampleLines}
          currentTime={12.0}
          duration={60}
          semitones={-12}
          onSemitonesChange={onSemitonesChange}
          onPitchStep={onPitchStep}
        />
      );

      expect(screen.getByTestId('stage-pitch-display')).toHaveTextContent('-12 st');

      // Adversarial clicks beyond -12: must not decrease to -13 or below
      fireEvent.click(screen.getByTestId('stage-pitch-down'));
      expect(onSemitonesChange).toHaveBeenLastCalledWith(-12);

      fireEvent.click(screen.getByTestId('stage-pitch-down'));
      expect(onSemitonesChange).toHaveBeenLastCalledWith(-12);
    });

    it('strictly clamps pitch up stepping at +12 semitones and prevents overflow', () => {
      const onSemitonesChange = vi.fn();
      const onPitchStep = vi.fn();

      const { rerender } = render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={12.0}
          duration={60}
          semitones={11}
          onSemitonesChange={onSemitonesChange}
          onPitchStep={onPitchStep}
        />
      );

      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));
      expect(screen.getByTestId('stage-pitch-display')).toHaveTextContent('+11 st');

      const pitchUpBtn = screen.getByTestId('stage-pitch-up');

      // First step: +11 -> +12
      fireEvent.click(pitchUpBtn);
      expect(onSemitonesChange).toHaveBeenLastCalledWith(12);
      expect(onPitchStep).toHaveBeenLastCalledWith(1);

      // Re-render at boundary +12
      rerender(
        <LyricDisplay
          lines={sampleLines}
          currentTime={12.0}
          duration={60}
          semitones={12}
          onSemitonesChange={onSemitonesChange}
          onPitchStep={onPitchStep}
        />
      );

      expect(screen.getByTestId('stage-pitch-display')).toHaveTextContent('+12 st');

      // Adversarial clicks beyond +12: must not increase to +13 or above
      fireEvent.click(screen.getByTestId('stage-pitch-up'));
      expect(onSemitonesChange).toHaveBeenLastCalledWith(12);

      fireEvent.click(screen.getByTestId('stage-pitch-up'));
      expect(onSemitonesChange).toHaveBeenLastCalledWith(12);
    });
  });

  describe('2. TV Stage Volume Clamping & Mute Synchronization', () => {
    it('automatically unmutes audio when volume slider is dragged > 0 while muted', () => {
      const onVolumeChange = vi.fn();
      const onToggleMute = vi.fn();
      const fakeAudio = {
        volume: 0,
        muted: true,
      } as unknown as HTMLAudioElement;
      const audioRef = { current: fakeAudio };

      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={12.0}
          duration={60}
          volume={0.8}
          isMuted={true}
          audioRef={audioRef}
          onVolumeChange={onVolumeChange}
          onToggleMute={onToggleMute}
        />
      );

      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      const volumeSlider = screen.getByTestId('stage-volume-slider') as HTMLInputElement;
      // When muted, slider value reflects 0 visually
      expect(volumeSlider.value).toBe('0');

      // User drags volume to 0.65
      fireEvent.change(volumeSlider, { target: { value: '0.65' } });

      expect(onVolumeChange).toHaveBeenCalledWith(0.65);
      expect(fakeAudio.volume).toBe(0.65);
      expect(fakeAudio.muted).toBe(false);
    });

    it('toggles master mute back and forth in uncontrolled mode and syncs with audioRef', () => {
      const onToggleMute = vi.fn();
      const fakeAudio = {
        volume: 0.75,
        muted: false,
      } as unknown as HTMLAudioElement;
      const audioRef = { current: fakeAudio };

      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={12.0}
          duration={60}
          volume={0.75}
          audioRef={audioRef}
          onToggleMute={onToggleMute}
        />
      );

      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      const volumeBtn = screen.getByTestId('stage-volume-btn');
      expect(volumeBtn).toHaveAttribute('aria-label', 'Mute master audio');

      // Click to mute
      fireEvent.click(volumeBtn);
      expect(onToggleMute).toHaveBeenCalledTimes(1);
      expect(fakeAudio.muted).toBe(true);

      // Click to unmute
      fireEvent.click(volumeBtn);
      expect(onToggleMute).toHaveBeenCalledTimes(2);
      expect(fakeAudio.muted).toBe(false);
    });
  });

  describe('3. TV Stage Theme previewBg Fallback & Container Styling', () => {
    it('applies previewBg when present and falls back gracefully when undefined or empty', () => {
      // Case 1: Custom theme with previewBg
      const customTheme: VisualTheme = {
        id: 'cyberpunk_acid',
        name: 'Acid Cyber',
        description: 'Neon green on black',
        previewBg: '#051105',
        previewSung: '#00ff66',
        previewUnsung: '#888888',
        primary_color: '#00ff66',
        secondary_color: '#888888',
        fontFamily: 'monospace',
      };

      const { rerender } = render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={12.0}
          selectedTheme={customTheme}
        />
      );

      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveStyle({ backgroundColor: '#051105' });
      expect(stage.className).toContain('bg-theme-bg');
      expect(stage.className).toContain('text-theme-text');

      // Case 2: selectedTheme without previewBg (empty string)
      rerender(
        <LyricDisplay
          lines={sampleLines}
          currentTime={12.0}
          selectedTheme={{ ...customTheme, previewBg: '' }}
        />
      );

      expect(stage.style.backgroundColor).toBe('');

      // Case 3: selectedTheme undefined
      rerender(
        <LyricDisplay
          lines={sampleLines}
          currentTime={12.0}
          selectedTheme={undefined}
        />
      );

      expect(stage.style.backgroundColor).toBe('');
    });
  });

  describe('4. Countdown Cue Boundary (Negative Time & Extended Gap)', () => {
    it('does NOT render countdown cue when currentTime is negative', () => {
      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={-3.5} // Negative lead-in
          duration={60}
        />
      );

      // When currentTime < 0, neither countdown-cue nor gap-countdown-indicator should crash
      expect(screen.queryByTestId('countdown-cue')).not.toBeInTheDocument();
      expect(screen.queryByTestId('gap-countdown-indicator')).not.toBeInTheDocument();
    });

    it('renders gap-countdown-indicator during extended gap (>3s from vocals) and transitions to countdown-cue during lead-in (<=3s)', () => {
      // Intro gap is [0, 10.0s].
      // At t = 2.0s: 8 seconds remaining before next vocal -> gap-countdown-indicator visible, countdown-cue hidden
      const { rerender } = render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={2.0}
          duration={60}
        />
      );

      expect(screen.getByTestId('gap-countdown-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('gap-countdown-time')).toHaveTextContent('Next vocals in 8s');
      expect(screen.queryByTestId('countdown-cue')).not.toBeInTheDocument();

      // At t = 8.5s: 1.5 seconds remaining before vocals at 10.0s -> countdown-cue visible with count 2
      rerender(
        <LyricDisplay
          lines={sampleLines}
          currentTime={8.5}
          duration={60}
        />
      );

      expect(screen.getByTestId('countdown-cue')).toBeInTheDocument();
      expect(screen.getByTestId('countdown-cue')).toHaveTextContent('2');

      // At t = 11.0s: inside active lyric line 1 [10.0, 14.0] -> countdown-cue hidden, active line visible
      rerender(
        <LyricDisplay
          lines={sampleLines}
          currentTime={11.0}
          duration={60}
        />
      );

      expect(screen.queryByTestId('countdown-cue')).not.toBeInTheDocument();
      expect(screen.getByTestId('active-lyrics-line')).toBeInTheDocument();
    });
  });

  describe('5. UX-5 Pitch Transposition Unapplied Mix Indicator Boundary Matrix', () => {
    it('correctly handles all boundary states of (semitones, appliedSemitones, isMixPending)', () => {
      const onSemitoneChange = vi.fn();
      const onResetPitch = vi.fn();

      // Matrix Test 1: semitones === 0, appliedSemitones === undefined -> NO badge
      const { rerender } = render(
        <PitchTranspositionControl
          semitones={0}
          onSemitoneChange={onSemitoneChange}
          onResetPitch={onResetPitch}
        />
      );
      expect(screen.queryByTestId('pitch-pending-mix-badge')).not.toBeInTheDocument();

      // Matrix Test 2: semitones === 2, appliedSemitones === undefined -> BADGE visible
      rerender(
        <PitchTranspositionControl
          semitones={2}
          onSemitoneChange={onSemitoneChange}
          onResetPitch={onResetPitch}
        />
      );
      expect(screen.getByTestId('pitch-pending-mix-badge')).toBeInTheDocument();
      expect(screen.getByTestId('pitch-pending-mix-badge')).toHaveTextContent(
        'Pending Mix / Click Apply'
      );

      // Matrix Test 3: semitones === 2, appliedSemitones === 2 -> NO badge (applied matches!)
      rerender(
        <PitchTranspositionControl
          semitones={2}
          appliedSemitones={2}
          onSemitoneChange={onSemitoneChange}
          onResetPitch={onResetPitch}
        />
      );
      expect(screen.queryByTestId('pitch-pending-mix-badge')).not.toBeInTheDocument();

      // Matrix Test 4: semitones === 0, appliedSemitones === 2 -> BADGE visible (reverting to 0 needs apply!)
      rerender(
        <PitchTranspositionControl
          semitones={0}
          appliedSemitones={2}
          onSemitoneChange={onSemitoneChange}
          onResetPitch={onResetPitch}
        />
      );
      expect(screen.getByTestId('pitch-pending-mix-badge')).toBeInTheDocument();

      // Matrix Test 5: semitones === -3, appliedSemitones === 1 -> BADGE visible
      rerender(
        <PitchTranspositionControl
          semitones={-3}
          appliedSemitones={1}
          onSemitoneChange={onSemitoneChange}
          onResetPitch={onResetPitch}
        />
      );
      expect(screen.getByTestId('pitch-pending-mix-badge')).toBeInTheDocument();

      // Matrix Test 6: semitones === 3, isMixPending === false explicitly -> NO badge
      rerender(
        <PitchTranspositionControl
          semitones={3}
          isMixPending={false}
          onSemitoneChange={onSemitoneChange}
          onResetPitch={onResetPitch}
        />
      );
      expect(screen.queryByTestId('pitch-pending-mix-badge')).not.toBeInTheDocument();

      // Matrix Test 7: semitones === 0, isMixPending === true explicitly -> BADGE visible
      rerender(
        <PitchTranspositionControl
          semitones={0}
          isMixPending={true}
          onSemitoneChange={onSemitoneChange}
          onResetPitch={onResetPitch}
        />
      );
      expect(screen.getByTestId('pitch-pending-mix-badge')).toBeInTheDocument();
    });
  });
});

describe('Adversarial Stress Suite — UX-6: StudioHeader Persistent Render Progress & Safe Downloads', () => {
  describe('1. StudioHeader Render Status Transitions & Reopen Modal', () => {
    it('exhaustively verifies badge visibility across all render_status states and modal open/close states', () => {
      const onOpenExportModal = vi.fn();
      const onStartRender = vi.fn();

      // State: rendering, modal closed -> VISIBLE
      const { rerender } = render(
        <StudioHeader
          currentUser="HostSinger"
          project={{ ...mockProject, render_status: 'rendering', render_progress: 37.4 }}
          isLyricsDirty={false}
          onOpenHelp={vi.fn()}
          onOpenAuth={vi.fn()}
          onNewSong={vi.fn()}
          onStartRender={onStartRender}
          onOpenExportModal={onOpenExportModal}
          isExportModalOpen={false}
        />
      );

      const progressBadge = screen.getByTestId('header-render-progress');
      expect(progressBadge).toBeInTheDocument();
      expect(progressBadge).toHaveTextContent('Rendering Video: 37%');

      // Click "View" button -> calls onOpenExportModal
      fireEvent.click(screen.getByTestId('header-reopen-export-modal'));
      expect(onOpenExportModal).toHaveBeenCalledTimes(1);

      // State: queued, modal closed -> VISIBLE
      rerender(
        <StudioHeader
          currentUser="HostSinger"
          project={{ ...mockProject, render_status: 'queued', render_progress: 0 }}
          isLyricsDirty={false}
          onOpenHelp={vi.fn()}
          onOpenAuth={vi.fn()}
          onNewSong={vi.fn()}
          onStartRender={onStartRender}
          onOpenExportModal={onOpenExportModal}
          isExportModalOpen={false}
        />
      );
      expect(screen.getByTestId('header-render-progress')).toBeInTheDocument();
      expect(screen.getByTestId('header-render-progress')).toHaveTextContent('Rendering Video: 0%');

      // State: rendering, modal OPEN -> HIDDEN
      rerender(
        <StudioHeader
          currentUser="HostSinger"
          project={{ ...mockProject, render_status: 'rendering', render_progress: 50 }}
          isLyricsDirty={false}
          onOpenHelp={vi.fn()}
          onOpenAuth={vi.fn()}
          onNewSong={vi.fn()}
          onStartRender={onStartRender}
          onOpenExportModal={onOpenExportModal}
          isExportModalOpen={true}
        />
      );
      expect(screen.queryByTestId('header-render-progress')).not.toBeInTheDocument();

      // State: idle -> HIDDEN
      rerender(
        <StudioHeader
          currentUser="HostSinger"
          project={{ ...mockProject, render_status: 'idle' }}
          isLyricsDirty={false}
          onOpenHelp={vi.fn()}
          onOpenAuth={vi.fn()}
          onNewSong={vi.fn()}
          onStartRender={onStartRender}
          onOpenExportModal={onOpenExportModal}
          isExportModalOpen={false}
        />
      );
      expect(screen.queryByTestId('header-render-progress')).not.toBeInTheDocument();

      // State: completed -> HIDDEN
      rerender(
        <StudioHeader
          currentUser="HostSinger"
          project={{ ...mockProject, render_status: 'completed', render_progress: 100 }}
          isLyricsDirty={false}
          onOpenHelp={vi.fn()}
          onOpenAuth={vi.fn()}
          onNewSong={vi.fn()}
          onStartRender={onStartRender}
          onOpenExportModal={onOpenExportModal}
          isExportModalOpen={false}
        />
      );
      expect(screen.queryByTestId('header-render-progress')).not.toBeInTheDocument();

      // State: error -> HIDDEN
      rerender(
        <StudioHeader
          currentUser="HostSinger"
          project={{ ...mockProject, render_status: 'error' }}
          isLyricsDirty={false}
          onOpenHelp={vi.fn()}
          onOpenAuth={vi.fn()}
          onNewSong={vi.fn()}
          onStartRender={onStartRender}
          onOpenExportModal={onOpenExportModal}
          isExportModalOpen={false}
        />
      );
      expect(screen.queryByTestId('header-render-progress')).not.toBeInTheDocument();
    });

    it('falls back to onStartRender when onOpenExportModal is not provided', () => {
      const onStartRender = vi.fn();

      render(
        <StudioHeader
          currentUser="HostSinger"
          project={{ ...mockProject, render_status: 'rendering', render_progress: 42 }}
          isLyricsDirty={false}
          onOpenHelp={vi.fn()}
          onOpenAuth={vi.fn()}
          onNewSong={vi.fn()}
          onStartRender={onStartRender}
          isExportModalOpen={false}
        />
      );

      fireEvent.click(screen.getByTestId('header-reopen-export-modal'));
      expect(onStartRender).toHaveBeenCalledTimes(1);
    });

    it('gracefully handles boundary percentages (0%, 99.6%, 100%, undefined)', () => {
      const { rerender } = render(
        <StudioHeader
          currentUser="HostSinger"
          project={{ ...mockProject, render_status: 'rendering', render_progress: 99.6 }}
          isLyricsDirty={false}
          onOpenHelp={vi.fn()}
          onOpenAuth={vi.fn()}
          onNewSong={vi.fn()}
          onStartRender={vi.fn()}
        />
      );
      expect(screen.getByTestId('header-render-progress')).toHaveTextContent('Rendering Video: 100%');

      rerender(
        <StudioHeader
          currentUser="HostSinger"
          project={{ ...mockProject, render_status: 'rendering', render_progress: undefined }}
          isLyricsDirty={false}
          onOpenHelp={vi.fn()}
          onOpenAuth={vi.fn()}
          onNewSong={vi.fn()}
          onStartRender={vi.fn()}
        />
      );
      expect(screen.getByTestId('header-render-progress')).toHaveTextContent('Rendering Video: 0%');
    });
  });

  describe('2. Safe Export Blob Revocation Timing (Non-Premature Revocation)', () => {
    let originalCreateObjectURL: typeof window.URL.createObjectURL;
    let originalRevokeObjectURL: typeof window.URL.revokeObjectURL;
    let clickSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.useFakeTimers();
      clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      originalCreateObjectURL = window.URL.createObjectURL;
      originalRevokeObjectURL = window.URL.revokeObjectURL;
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/safe-test-uuid');
      window.URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
      clickSpy.mockRestore();
      window.URL.createObjectURL = originalCreateObjectURL;
      window.URL.revokeObjectURL = originalRevokeObjectURL;
      vi.useRealTimers();
    });

    it('guarantees blob is NOT revoked prematurely during immediate download click in ExportModal', async () => {
      const mockBlob = new Blob(['Chord Sheet Content'], { type: 'text/markdown' });
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValueOnce({
        ok: true,
        blob: async () => mockBlob,
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="chords.md"',
        }),
      } as unknown as Response);

      render(
        <ExportModal
          project={mockProject}
          isOpen={true}
          onClose={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTestId('download-chord-sheet-btn'));

      await act(async () => {
        await Promise.resolve();
      });

      // Crucial empirical check: at t = 0ms, anchor was clicked, but blob is NOT revoked
      expect(clickSpy).toHaveBeenCalled();
      expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();

      // At t = 1000ms: still NOT revoked
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();

      // At t = 1499ms: still NOT revoked
      act(() => {
        vi.advanceTimersByTime(499);
      });
      expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();

      // At t = 1500ms: cleanly and safely revoked
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/safe-test-uuid');
    });

    it('guarantees delayed revocation for subtitle downloads in ExportSubtitleSection', async () => {
      const mockBlob = new Blob(['1\n00:00:01,000 --> 00:00:04,000\nHello'], {
        type: 'text/plain',
      });
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValueOnce({
        ok: true,
        blob: async () => mockBlob,
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="lyrics.lrc"',
        }),
      } as unknown as Response);

      render(<ExportSubtitleSection project={mockProject} />);

      const lrcBtn = screen.getByRole('button', { name: /Download \.lrc subtitles/i });
      fireEvent.click(lrcBtn);

      await act(async () => {
        await Promise.resolve();
      });

      // Synchronously: not revoked
      expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();

      // At 1499ms: still not revoked
      act(() => {
        vi.advanceTimersByTime(1499);
      });
      expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();

      // At 1500ms: revoked
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/safe-test-uuid');
    });

    it('guarantees delayed revocation across multiple sequential stem downloads in ExportAudioSection', async () => {
      let callCount = 0;
      window.URL.createObjectURL = vi.fn().mockImplementation(() => {
        callCount++;
        return `blob:http://localhost/stem-${callCount}`;
      });

      const mockBlob1 = new Blob(['vocals'], { type: 'audio/wav' });
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValueOnce({
        ok: true,
        blob: async () => mockBlob1,
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="vocals.wav"',
        }),
      } as unknown as Response);

      render(<ExportAudioSection project={mockProject} />);

      const vocalsBtn = screen.getByRole('button', { name: /Download Vocal Stem/i });
      fireEvent.click(vocalsBtn);

      await act(async () => {
        await Promise.resolve();
      });

      // Stem 1 triggered at t = 0
      expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();

      // Advance by 500ms
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(window.URL.revokeObjectURL).not.toHaveBeenCalled();

      // Now trigger Stem 2 (instrumental) at t = 500ms
      const mockBlob2 = new Blob(['instrumental'], { type: 'audio/wav' });
      vi.spyOn(apiModule, 'apiFetch').mockResolvedValueOnce({
        ok: true,
        blob: async () => mockBlob2,
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="instrumental.wav"',
        }),
      } as unknown as Response);

      const instBtn = screen.getByRole('button', { name: /Download Instrumental Stem/i });
      fireEvent.click(instBtn);

      await act(async () => {
        await Promise.resolve();
      });

      // Advance 1000ms (total t = 1500ms from Stem 1): Stem 1 should be revoked, Stem 2 NOT revoked yet!
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/stem-1');
      expect(window.URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:http://localhost/stem-2');

      // Advance remaining 500ms (total t = 2000ms): Stem 2 is safely revoked!
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/stem-2');
    });
  });
});

describe('Adversarial Stress Suite — UX-6: Precision Seeking Shortcuts & Input/Modal Suppression', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Precision Seeking & Clamping Boundaries [0, duration]', () => {
    it('clamps fine and coarse seeking strictly at t = 0 (no negative playhead)', () => {
      const onSeek = vi.fn();

      renderHook(() =>
        useKeyboardShortcuts({
          onSeek,
          currentTime: 0.5,
          duration: 100.0,
          precisionSeeking: true,
        })
      );

      // Fine seeking backward from 0.5 with 1s step -> clamps to 0
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true })
      );
      expect(onSeek).toHaveBeenLastCalledWith(0);

      // Coarse seeking backward from 0.5 with 15s step -> clamps to 0
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true })
      );
      expect(onSeek).toHaveBeenLastCalledWith(0);
    });

    it('clamps fine and coarse seeking strictly at t = duration (no overshoot past duration)', () => {
      const onSeek = vi.fn();

      renderHook(() =>
        useKeyboardShortcuts({
          onSeek,
          currentTime: 99.2,
          duration: 100.0,
          precisionSeeking: true,
        })
      );

      // Fine seeking forward from 99.2 with 1s step -> clamps to 100.0
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })
      );
      expect(onSeek).toHaveBeenLastCalledWith(100.0);

      // Coarse seeking forward from 99.2 with 15s step -> clamps to 100.0
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true })
      );
      expect(onSeek).toHaveBeenLastCalledWith(100.0);
    });
  });

  describe('2. Line Jump Boundaries at Line 0 and Line N-1', () => {
    it('clamps [ jump at line 0 to line 0 start without index underflow', () => {
      const onSeek = vi.fn();

      // At t = 11.0s, playhead is in line 0 (starts at 10.0s)
      renderHook(() =>
        useKeyboardShortcuts({
          onSeek,
          currentTime: 11.0,
          duration: 60.0,
          lines: sampleLines,
        })
      );

      // Press '[' when already at first line
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }));
      expect(onSeek).toHaveBeenLastCalledWith(10.0); // line 0 start time
    });

    it('clamps ] jump at line N-1 to last line start without index overflow', () => {
      const onSeek = vi.fn();

      // At t = 34.0s, playhead is in line 2 (last line, starts at 32.0s)
      renderHook(() =>
        useKeyboardShortcuts({
          onSeek,
          currentTime: 34.0,
          duration: 60.0,
          lines: sampleLines,
        })
      );

      // Press ']' when already at last line
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
      expect(onSeek).toHaveBeenLastCalledWith(32.0); // line 2 start time
    });

    it('invokes custom onPrevLine and onNextLine callbacks when provided', () => {
      const onPrevLine = vi.fn();
      const onNextLine = vi.fn();

      renderHook(() =>
        useKeyboardShortcuts({
          onPrevLine,
          onNextLine,
          currentTime: 26.0,
          duration: 60.0,
          lines: sampleLines,
        })
      );

      window.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }));
      expect(onPrevLine).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
      expect(onNextLine).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. Replay Key R Boundary & Inter-Line Behavior', () => {
    it('replays active line start when between lines in an instrumental interlude', () => {
      const onSeek = vi.fn();

      // Line 1 is [10.0, 14.0], Line 2 is [25.0, 30.0].
      // Playhead is in the gap at 18.0s.
      renderHook(() =>
        useKeyboardShortcuts({
          onSeek,
          currentTime: 18.0,
          duration: 60.0,
          lines: sampleLines,
        })
      );

      // 'R' in the gap returns to start of preceding line 1 (10.0s)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', bubbles: true }));
      expect(onSeek).toHaveBeenLastCalledWith(10.0);
    });

    it('invokes custom onReplayLine callback when provided', () => {
      const onReplayLine = vi.fn();

      renderHook(() =>
        useKeyboardShortcuts({
          onReplayLine,
          currentTime: 26.0,
          duration: 60.0,
          lines: sampleLines,
        })
      );

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      expect(onReplayLine).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. Strict Suppression Matrix (Inputs, Modals, System Keys)', () => {
    it('suppresses precision shortcuts when focused on contenteditable or role="textbox"', () => {
      const onSeek = vi.fn();
      const onTogglePlay = vi.fn();

      render(
        <div>
          <div data-testid="editable-div" contentEditable="true" tabIndex={0}>
            Edit text here
          </div>
          <div data-testid="role-textbox" role="textbox" tabIndex={0}>
            ARIA textbox
          </div>
        </div>
      );

      renderHook(() =>
        useKeyboardShortcuts({
          onSeek,
          onTogglePlay,
          currentTime: 20.0,
          duration: 60.0,
          lines: sampleLines,
          precisionSeeking: true,
        })
      );

      // Test 1: ContentEditable element focused
      const editable = screen.getByTestId('editable-div');
      editable.focus();

      fireEvent.keyDown(editable, { key: 'ArrowLeft', shiftKey: true });
      fireEvent.keyDown(editable, { key: 'ArrowRight', altKey: true });
      fireEvent.keyDown(editable, { key: '[' });
      fireEvent.keyDown(editable, { key: ']' });
      fireEvent.keyDown(editable, { key: 'r' });
      fireEvent.keyDown(editable, { key: ' ' });

      expect(onSeek).not.toHaveBeenCalled();
      expect(onTogglePlay).not.toHaveBeenCalled();

      // Test 2: Role textbox focused
      const roleBox = screen.getByTestId('role-textbox');
      roleBox.focus();

      fireEvent.keyDown(roleBox, { key: 'ArrowLeft', shiftKey: true });
      fireEvent.keyDown(roleBox, { key: 'r' });
      fireEvent.keyDown(roleBox, { key: ' ' });

      expect(onSeek).not.toHaveBeenCalled();
      expect(onTogglePlay).not.toHaveBeenCalled();
    });

    it('suppresses precision shortcuts when a modal dialog is open in the DOM', () => {
      const onSeek = vi.fn();
      const onTogglePlay = vi.fn();

      render(
        <div>
          <div role="dialog" aria-modal="true" data-testid="open-modal">
            <button type="button">Modal Button</button>
          </div>
          <button type="button" data-testid="outside-button">
            Outside Button
          </button>
        </div>
      );

      renderHook(() =>
        useKeyboardShortcuts({
          onSeek,
          onTogglePlay,
          currentTime: 20.0,
          duration: 60.0,
          lines: sampleLines,
          precisionSeeking: true,
        })
      );

      // Focus is outside modal, but modal is in DOM
      const outsideBtn = screen.getByTestId('outside-button');
      outsideBtn.focus();

      fireEvent.keyDown(outsideBtn, { key: 'ArrowLeft', shiftKey: true });
      fireEvent.keyDown(outsideBtn, { key: 'ArrowRight', altKey: true });
      fireEvent.keyDown(outsideBtn, { key: '[' });
      fireEvent.keyDown(outsideBtn, { key: ']' });
      fireEvent.keyDown(outsideBtn, { key: 'r' });
      fireEvent.keyDown(outsideBtn, { key: ' ' });

      expect(onSeek).not.toHaveBeenCalled();
      expect(onTogglePlay).not.toHaveBeenCalled();
    });

    it('never intercepts system shortcuts when Ctrl or Meta (Command) is held', () => {
      const onSeek = vi.fn();
      const onTogglePlay = vi.fn();

      renderHook(() =>
        useKeyboardShortcuts({
          onSeek,
          onTogglePlay,
          currentTime: 20.0,
          duration: 60.0,
          lines: sampleLines,
          precisionSeeking: true,
        })
      );

      // Ctrl + R (Page reload) must not trigger active line replay
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true })
      );
      expect(onSeek).not.toHaveBeenCalled();

      // Meta + ArrowLeft (Browser back / Home) must not trigger fine seek
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', metaKey: true, bubbles: true })
      );
      expect(onSeek).not.toHaveBeenCalled();

      // Ctrl + Space (IME / OS shortcut) must not toggle play
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, bubbles: true })
      );
      expect(onTogglePlay).not.toHaveBeenCalled();
    });
  });
});

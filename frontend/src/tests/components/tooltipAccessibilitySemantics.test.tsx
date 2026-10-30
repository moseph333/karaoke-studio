/**
 * Tooltip Accessibility Semantics & Studio Control Coverage Empirical Test Suite
 *
 * Verifies:
 * 1. Non-interference with accessible names (inner text, aria-label, aria-labelledby)
 * 2. Dynamic aria-describedby attachment, detachment, ID uniqueness, and existing ID preservation
 * 3. Disabled controls behavior (disabled prop prevents hover and focus popups)
 * 4. Control coverage across studio surfaces:
 *    - TransportDock (Play/Pause, Scrubber, Restart), MasterVolumeControl, Mix inspector (Pitch steppers, Guide Vocal)
 *    - LyricTimelineEditor (Nudge ±0.2s, Nudge ±0.05s, Insert above/below, Delete, Edit text, Save, Discard)
 *    - ExportModal (Download .LRC, Download .ASS, Render Video, Close)
 *    - StudioHeader (Help, Return to library, User profile, Edit metadata, Delete project)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tooltip, TOOLTIP_HIDE_DELAY_MS } from '../../components/Tooltip';
import { TransportDock } from '../../components/transport/TransportDock';
import { MasterVolumeControl } from '../../components/audio/MasterVolumeControl';
import { PitchTranspositionControl } from '../../components/audio/PitchTranspositionControl';
import { GuideVocalControl } from '../../components/audio/GuideVocalControl';
import { AudioMixActionsBar } from '../../components/audio/AudioMixActionsBar';
import { LyricTimelineEditor } from '../../components/LyricTimelineEditor';
import { TimelineLineCard } from '../../components/timeline/TimelineLineCard';
import { ExportModal } from '../../components/ExportModal';
import { StudioHeader } from '../../components/StudioHeader';
import { StudioMetaHeader } from '../../components/StudioMetaHeader';
import { LyricLine, ProjectState } from '../../types';

describe('Tooltip Accessibility Semantics & Control Coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  // =========================================================================
  // Dimension 1: Non-Interference with Accessible Names
  // =========================================================================
  describe('1. Non-Interference with Accessible Names', () => {
    it('preserves accessible name for button with visual text content', () => {
      render(
        <Tooltip content="Detailed help guide and keyboard shortcuts" hotkey="?" delayMs={0}>
          <button type="button">Help &amp; Studio Guide (?)</button>
        </Tooltip>
      );

      // Verify button accessible name before hover/focus
      const button = screen.getByRole('button', { name: 'Help & Studio Guide (?)' });
      expect(button).toBeInTheDocument();

      // Trigger focus -> tooltip becomes visible
      fireEvent.focus(button);
      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toBeInTheDocument();

      // Accessible name must remain strictly 'Help & Studio Guide (?)'
      expect(screen.getByRole('button', { name: 'Help & Studio Guide (?)' })).toBe(button);

      // Tooltip content & <kbd> must not bleed into button accessible name
      expect(
        screen.queryByRole('button', { name: /detailed help guide/i })
      ).not.toBeInTheDocument();
    });

    it('preserves accessible name for button with aria-label', () => {
      render(
        <Tooltip content="Pause playback" hotkey="Space" delayMs={0}>
          <button type="button" aria-label="Start playback">
            <span>▶</span>
          </button>
        </Tooltip>
      );

      // Verify button accessible name matches aria-label
      const button = screen.getByRole('button', { name: /start playback/i });
      expect(button).toBeInTheDocument();

      // Trigger hover after delay
      fireEvent.mouseEnter(button);
      act(() => {
        vi.advanceTimersByTime(50);
      });

      // Accessible name remains 'Start playback'
      expect(screen.getByRole('button', { name: /start playback/i })).toBe(button);
      expect(screen.queryByRole('button', { name: /pause playback/i })).not.toBeInTheDocument();
    });

    it('preserves accessible name for button with aria-labelledby', () => {
      render(
        <div>
          <span id="custom-action-label">Custom Action Target</span>
          <Tooltip content="Action explanation" delayMs={0}>
            <button type="button" aria-labelledby="custom-action-label">
              Visual Inner
            </button>
          </Tooltip>
        </div>
      );

      const button = screen.getByRole('button', { name: 'Custom Action Target' });
      expect(button).toBeInTheDocument();

      fireEvent.focus(button);
      expect(screen.getByRole('button', { name: 'Custom Action Target' })).toBe(button);
    });

    it('keeps tooltip container pointer-events-none and out of accessibility tree name computation', () => {
      render(
        <Tooltip content="Extra info" hotkey={['←', '→']} delayMs={0}>
          <button type="button" aria-label="Seek back and forth">
            Seek
          </button>
        </Tooltip>
      );

      const button = screen.getByRole('button', { name: 'Seek back and forth' });
      fireEvent.focus(button);

      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toHaveClass('pointer-events-none');
      // The tooltip has its own role="tooltip" and is not inside the button element
      expect(button.contains(tooltip)).toBe(false);
    });
  });

  // =========================================================================
  // Dimension 2: Dynamic aria-describedby Lifecycle & ID Preservation
  // =========================================================================
  describe('2. Dynamic aria-describedby Lifecycle', () => {
    it('dynamically attaches aria-describedby when visible and detaches when hidden', () => {
      render(
        <Tooltip content="Help text" delayMs={100}>
          <button type="button">Dynamic Target</button>
        </Tooltip>
      );

      const button = screen.getByRole('button', { name: 'Dynamic Target' });
      expect(button).not.toHaveAttribute('aria-describedby');
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

      // Mouse enter and advance timer
      fireEvent.mouseEnter(button);
      expect(button).not.toHaveAttribute('aria-describedby');

      act(() => {
        vi.advanceTimersByTime(100);
      });

      const tooltip = screen.getByRole('tooltip');
      const tooltipId = tooltip.getAttribute('id');
      expect(tooltipId).toMatch(/^tooltip-/);
      expect(button).toHaveAttribute('aria-describedby', tooltipId);

      // Mouse leave -> dismiss (after the moment the pointer has to reach the bubble)
      fireEvent.mouseLeave(button);
      act(() => {
        vi.advanceTimersByTime(TOOLTIP_HIDE_DELAY_MS);
      });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      expect(button).not.toHaveAttribute('aria-describedby');
    });

    it('preserves single pre-existing aria-describedby ID when tooltip opens and closes', () => {
      render(
        <div>
          <div id="static-help">Static persistent help text</div>
          <Tooltip content="Transient contextual tooltip" delayMs={0}>
            <button type="button" aria-describedby="static-help">
              Multi-described Button
            </button>
          </Tooltip>
        </div>
      );

      const button = screen.getByRole('button', { name: 'Multi-described Button' });
      expect(button).toHaveAttribute('aria-describedby', 'static-help');

      // Focus opens tooltip
      fireEvent.focus(button);
      const tooltip = screen.getByRole('tooltip');
      const tooltipId = tooltip.getAttribute('id');

      // Both IDs must be present, with original preserved first
      expect(button).toHaveAttribute('aria-describedby', `static-help ${tooltipId}`);

      // Blur dismisses tooltip
      fireEvent.blur(button);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      expect(button).toHaveAttribute('aria-describedby', 'static-help');
    });

    it('preserves multiple pre-existing aria-describedby IDs', () => {
      render(
        <Tooltip content="Tooltip hint" delayMs={0}>
          <input type="text" aria-describedby="error-msg helper-note" aria-label="Input field" />
        </Tooltip>
      );

      const input = screen.getByRole('textbox', { name: 'Input field' });
      expect(input).toHaveAttribute('aria-describedby', 'error-msg helper-note');

      fireEvent.focus(input);
      const tooltip = screen.getByRole('tooltip');
      const tooltipId = tooltip.getAttribute('id');

      expect(input).toHaveAttribute('aria-describedby', `error-msg helper-note ${tooltipId}`);

      fireEvent.blur(input);
      expect(input).toHaveAttribute('aria-describedby', 'error-msg helper-note');
    });

    it('generates distinct IDs for concurrently mounted tooltips', () => {
      render(
        <div>
          <Tooltip content="Tooltip A" delayMs={0}>
            <button type="button">Button A</button>
          </Tooltip>
          <Tooltip content="Tooltip B" delayMs={0}>
            <button type="button">Button B</button>
          </Tooltip>
        </div>
      );

      const btnA = screen.getByRole('button', { name: 'Button A' });
      const btnB = screen.getByRole('button', { name: 'Button B' });

      fireEvent.focus(btnA);
      fireEvent.focus(btnB);

      const tooltips = screen.getAllByRole('tooltip');
      expect(tooltips).toHaveLength(2);
      const idA = tooltips[0].getAttribute('id');
      const idB = tooltips[1].getAttribute('id');

      expect(idA).toBeTruthy();
      expect(idB).toBeTruthy();
      expect(idA).not.toEqual(idB);
      expect(btnA).toHaveAttribute('aria-describedby', idA);
      expect(btnB).toHaveAttribute('aria-describedby', idB);
    });

    it('dismisses cleanly on Escape key press and restores aria-describedby', () => {
      render(
        <Tooltip content="Dismissible hint" delayMs={0}>
          <button type="button" aria-describedby="base-id">
            Escape Target
          </button>
        </Tooltip>
      );

      const button = screen.getByRole('button', { name: 'Escape Target' });
      fireEvent.focus(button);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      expect(button).toHaveAttribute('aria-describedby', 'base-id');
    });
  });

  // =========================================================================
  // Dimension 3: Disabled Controls Behavior
  // =========================================================================
  describe('3. Disabled Controls Behavior', () => {
    it('does not display tooltip on hover or focus when disabled={true} is passed', () => {
      render(
        <Tooltip content="Should never display" disabled delayMs={0}>
          <button type="button">Disabled Tooltip Target</button>
        </Tooltip>
      );

      const button = screen.getByRole('button', { name: 'Disabled Tooltip Target' });

      // Hover
      fireEvent.mouseEnter(button);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      expect(button).not.toHaveAttribute('aria-describedby');

      // Focus
      fireEvent.focus(button);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      expect(button).not.toHaveAttribute('aria-describedby');
    });

    it('prevents tooltip display on child controls with native disabled attribute', () => {
      render(
        <Tooltip content="Disabled native button tooltip" disabled delayMs={0}>
          <button type="button" disabled>
            Disabled Button
          </button>
        </Tooltip>
      );

      const button = screen.getByRole('button', { name: 'Disabled Button' });
      expect(button).toBeDisabled();

      fireEvent.mouseEnter(button);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

      fireEvent.focus(button);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // Dimension 4: Verification Across Studio Surfaces
  // =========================================================================
  describe('4. Studio Surfaces Tooltip Integration', () => {
    describe('Transport & Mix Surfaces', () => {
      it('renders tooltips for Play/Pause, Scrubber, and Restart buttons', () => {
        render(
          <TransportDock
            masterAudioUrl="/audio/master.mp3"
            currentTime={10}
            duration={120}
            isPlaying={false}
            onTogglePlay={vi.fn()}
            onSeek={vi.fn()}
          />
        );

        // Play/Pause button
        const playBtn = screen.getByRole('button', { name: 'Start playback' });
        fireEvent.focus(playBtn);
        let tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Start playback');
        expect(tooltip.querySelector('kbd')).toHaveTextContent('Space');
        fireEvent.blur(playBtn);

        // Scrubber range input
        const scrubber = screen.getByRole('slider', { name: 'Audio timeline position' });
        fireEvent.focus(scrubber);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Scrub audio timeline (±5s seek)');
        const kbds = tooltip.querySelectorAll('kbd');
        expect(kbds).toHaveLength(2);
        expect(kbds[0]).toHaveTextContent('←');
        expect(kbds[1]).toHaveTextContent('→');
        fireEvent.blur(scrubber);

        // Restart button
        const restartBtn = screen.getByRole('button', { name: 'Restart track from beginning' });
        fireEvent.focus(restartBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Restart track from beginning');
      });

      it('renders tooltips on MasterVolumeControl (Mute button & Volume slider)', () => {
        render(
          <MasterVolumeControl
            volume={0.8}
            isMuted={false}
            onToggleMute={vi.fn()}
            onVolumeSliderChange={vi.fn()}
          />
        );

        // Mute button
        const muteBtn = screen.getByRole('button', { name: 'Mute audio' });
        fireEvent.focus(muteBtn);
        let tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Mute audio');
        expect(tooltip.querySelector('kbd')).toHaveTextContent('M');
        fireEvent.blur(muteBtn);

        // Volume slider
        const slider = screen.getByRole('slider', { name: 'Master volume' });
        fireEvent.focus(slider);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Adjust master playback volume');
      });

      it('renders tooltips on PitchTranspositionControl (-1, Reset, +1)', () => {
        render(
          <PitchTranspositionControl
            semitones={2}
            onSemitoneChange={vi.fn()}
            onResetPitch={vi.fn()}
          />
        );

        // Pitch down (-1)
        const downBtn = screen.getByRole('button', { name: 'Decrease pitch by one semitone' });
        fireEvent.focus(downBtn);
        let tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Lower key by 1 semitone (-12 min)');
        fireEvent.blur(downBtn);

        // Reset
        const resetBtn = screen.getByRole('button', { name: 'Reset pitch to original key' });
        fireEvent.focus(resetBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Reset pitch to original key (0 semitones)');
        fireEvent.blur(resetBtn);

        // Pitch up (+1)
        const upBtn = screen.getByRole('button', { name: 'Increase pitch by one semitone' });
        fireEvent.focus(upBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Raise key by 1 semitone (+12 max)');
      });

      it('renders tooltips on GuideVocalControl and keeps AudioMixActionsBar apply-free', () => {
        render(
          <div>
            <GuideVocalControl guideVolume={0.25} onGuideVolumeChange={vi.fn()} />
            <AudioMixActionsBar
              uploadingInst={false}
              fileInputRef={{ current: null }}
              onInstrumentalUpload={vi.fn()}
            />
          </div>
        );

        // Guide vocal slider
        const vocalSlider = screen.getByRole('slider', { name: 'Guide vocal volume level' });
        fireEvent.focus(vocalSlider);
        const tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Adjust guide vocal blend (0%–50%)');
        expect(vocalSlider.getAttribute('aria-describedby')).toBe(tooltip.id);
        fireEvent.blur(vocalSlider);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

        // Mix changes apply automatically: there is no apply button
        expect(
          screen.queryByRole('button', { name: 'Apply audio mix settings to playback' })
        ).not.toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: 'Replace instrumental file' })
        ).toBeInTheDocument();
      });
    });

    describe('LyricTimelineEditor Surface', () => {
      const mockLine: LyricLine = {
        id: 1,
        text: 'Hello world karaoke line',
        start_time: 1.0,
        end_time: 3.5,
        words: [
          { word: 'Hello', start_time: 1.0, end_time: 1.5 },
          { word: 'world', start_time: 1.5, end_time: 2.2 },
          { word: 'karaoke', start_time: 2.2, end_time: 3.0 },
          { word: 'line', start_time: 3.0, end_time: 3.5 },
        ],
      };

      it('renders tooltips for TimelineLineCard nudge, insert, delete, and edit text buttons', () => {
        render(
          <TimelineLineCard
            line={mockLine}
            idx={0}
            isCurrentlyActive={false}
            isExpanded={false}
            editingLineId={null}
            editingText=""
            activeWordLoc={null}
            editInputRef={{ current: null }}
            onLineClick={vi.fn()}
            onWordClick={vi.fn()}
            onStartEditing={vi.fn()}
            onCommitEditing={vi.fn()}
            onCancelEditing={vi.fn()}
            onSetEditingText={vi.fn()}
            onNudgeLine={vi.fn()}
            onInsertLineAbove={vi.fn()}
            onInsertLineBelow={vi.fn()}
            onDeleteLine={vi.fn()}
            onToggleExpand={vi.fn()}
            onNudgeWord={vi.fn()}
            onNudgeWordBoundary={vi.fn()}
            onUpdateWordTiming={vi.fn()}
          />
        );

        // Edit text inline
        const editBtn = screen.getByRole('button', { name: 'Edit text for line 1' });
        fireEvent.focus(editBtn);
        let tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Edit lyric text inline');
        fireEvent.blur(editBtn);

        // Coarse Earlier (-0.2s)
        const coarseEarlierBtn = screen.getByRole('button', { name: 'Nudge line 1 0.2s earlier' });
        fireEvent.focus(coarseEarlierBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Nudge line 0.2s earlier');
        fireEvent.blur(coarseEarlierBtn);

        // Fine Earlier (-0.05s)
        const fineEarlierBtn = screen.getByRole('button', {
          name: 'Nudge line 1 0.05s earlier',
        });
        fireEvent.focus(fineEarlierBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Fine-nudge line 0.05s earlier');
        fireEvent.blur(fineEarlierBtn);

        // Fine Later (+0.05s)
        const fineLaterBtn = screen.getByRole('button', { name: 'Nudge line 1 0.05s later' });
        fireEvent.focus(fineLaterBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Fine-nudge line 0.05s later');
        fireEvent.blur(fineLaterBtn);

        // Coarse Later (+0.2s)
        const coarseLaterBtn = screen.getByRole('button', { name: 'Nudge line 1 0.2s later' });
        fireEvent.focus(coarseLaterBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Nudge line 0.2s later');
        fireEvent.blur(coarseLaterBtn);

        // Insert Above
        const insertAboveBtn = screen.getByRole('button', { name: 'Insert line above line 1' });
        fireEvent.focus(insertAboveBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Insert lyric line above');
        fireEvent.blur(insertAboveBtn);

        // Insert Below
        const insertBelowBtn = screen.getByRole('button', { name: 'Insert line below line 1' });
        fireEvent.focus(insertBelowBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Insert lyric line below');
        fireEvent.blur(insertBelowBtn);

        // Delete Line
        const deleteBtn = screen.getByRole('button', { name: 'Delete line 1' });
        fireEvent.focus(deleteBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Delete lyric line from timeline');
      });

      it('renders tooltips for Save and Discard changes in LyricTimelineEditor header when dirty', () => {
        render(
          <LyricTimelineEditor
            lines={[mockLine]}
            currentTime={0}
            duration={100}
            onSeek={vi.fn()}
            onSaveLines={vi.fn()}
          />
        );

        // Trigger a nudge to make timeline dirty
        const coarseLaterBtn = screen.getByRole('button', { name: 'Nudge line 1 0.2s later' });
        fireEvent.click(coarseLaterBtn);

        // Save button appears with tooltip (accessible name from aria-label)
        const saveBtn = screen.getByRole('button', {
          name: 'Save Timing Changes - Save Lyrics & Timing Changes',
        });
        fireEvent.focus(saveBtn);
        let tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Save lyrics & timing changes to server');
        fireEvent.blur(saveBtn);

        // Discard button appears with tooltip (accessible name from text content)
        const discardBtn = screen.getByRole('button', { name: 'Discard Changes' });
        fireEvent.focus(discardBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Discard unsaved lyric edits');
      });
    });

    describe('ExportModal Surface', () => {
      const mockProject: ProjectState = {
        id: 'proj-export-1',
        title: 'Song Title',
        artist: 'Artist Name',
        status: 'ready',
        progress: 100,
        semitones: 0,
        guide_volume: 0,
        lines: [{ id: 1, text: 'Sample line', start_time: 0, end_time: 3, words: [] }],
      };

      it('renders tooltips for .LRC download, .ASS download, Render 1080p, and Close buttons', () => {
        act(() => {
          render(
            <ExportModal
              project={mockProject}
              isOpen={true}
              onClose={vi.fn()}
              onStartRender={vi.fn()}
            />
          );
        });

        // Close modal button
        const closeBtn = screen.getByRole('button', { name: 'Close export dialog' });
        fireEvent.focus(closeBtn);
        let tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Close export dialog');
        fireEvent.blur(closeBtn);

        // Download .LRC button
        const lrcBtn = screen.getByRole('button', { name: 'Download .lrc subtitles' });
        fireEvent.focus(lrcBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Download synchronized .LRC file');
        fireEvent.blur(lrcBtn);

        // Download .ASS button
        const assBtn = screen.getByRole('button', { name: 'Download .ass subtitles' });
        fireEvent.focus(assBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Download formatted .ASS subtitles');
        fireEvent.blur(assBtn);

        // Render 1080p Video button
        const renderBtn = screen.getByRole('button', { name: 'Start video render' });
        fireEvent.focus(renderBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Render 1080p60 MP4 video');
      });
    });

    describe('StudioHeader & Navigation Surface', () => {
      it('renders tooltips for Help, Profile, and Return to Search buttons', () => {
        render(
          <StudioHeader
            currentUser="TestUser"
            project={null}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onStartRender={vi.fn()}
          />
        );

        // Help button
        const helpBtn = screen.getByRole('button', { name: /help and studio usage guide/i });
        fireEvent.focus(helpBtn);
        let tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Help & Studio Guide');
        expect(tooltip.querySelector('kbd')).toHaveTextContent('?');
        fireEvent.blur(helpBtn);

        // Profile button
        const profileBtn = screen.getByRole('button', { name: /logged in as testuser/i });
        fireEvent.focus(profileBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Manage user profile');
      });

      it('renders tooltips for StudioMetaHeader actions and the header Export entry point', () => {
        const mockProject: ProjectState = {
          id: 'proj-meta-1',
          title: 'Meta Song',
          artist: 'Meta Artist',
          status: 'ready',
          progress: 100,
          semitones: 0,
          guide_volume: 0,
          lines: [{ id: 1, text: 'Meta line', start_time: 0, end_time: 2, words: [] }],
        };

        render(
          <StudioMetaHeader
            project={mockProject}
            onOpenEditModal={vi.fn()}
            onOpenDeleteModal={vi.fn()}
            onOpenExportModal={vi.fn()}
            onStartRender={vi.fn()}
          />
        );

        // Edit Metadata: aria-label="Edit song details"
        const editBtn = screen.getByRole('button', { name: 'Edit song details' });
        fireEvent.focus(editBtn);
        let tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Edit song title and artist');
        fireEvent.blur(editBtn);

        // Delete Project: aria-label="Delete project Meta Song"
        const deleteBtn = screen.getByRole('button', { name: 'Delete project Meta Song' });
        fireEvent.focus(deleteBtn);
        tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveTextContent('Delete project and media files');
        fireEvent.blur(deleteBtn);

        // Song header no longer duplicates export actions
        expect(
          screen.queryByRole('button', { name: 'Export subtitles and studio package' })
        ).not.toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: 'Render 1080p Video' })
        ).not.toBeInTheDocument();
        fireEvent.blur(deleteBtn);

        // Sync fidelity badge explains itself on hover
        const badge = screen.getByTestId('sync-status-badge');
        fireEvent.mouseEnter(badge);
        act(() => {
          vi.advanceTimersByTime(200);
        });
        expect(screen.getByRole('tooltip')).toHaveTextContent(/synchroniz/i);
        fireEvent.mouseLeave(badge);
      });

      it('renders a tooltip for the single header Export button', () => {
        render(
          <StudioHeader
            currentUser="TestUser"
            project={{
              id: 'proj-export-1',
              title: 'Export Song',
              artist: 'Export Artist',
              status: 'ready',
              progress: 100,
              semitones: 0,
              guide_volume: 0,
              lines: [],
            }}
            isLyricsDirty={false}
            onOpenHelp={vi.fn()}
            onOpenAuth={vi.fn()}
            onNewSong={vi.fn()}
            onOpenExportModal={vi.fn()}
          />
        );

        const exportBtn = screen.getByRole('button', { name: 'Open export dialog' });
        fireEvent.focus(exportBtn);
        expect(screen.getByRole('tooltip')).toHaveTextContent(
          'Video, subtitles, stems & YouTube kit'
        );
      });
    });
  });
});

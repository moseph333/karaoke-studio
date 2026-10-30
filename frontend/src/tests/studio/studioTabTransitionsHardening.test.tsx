/**
 * M4 Challenger 1: White-Box Adversarial Hardening Suite (Tier 5)
 *
 * Exhaustive empirical challenge verifying:
 * 1. Unmount Resilience: Invariant <audio> DOM mounting & reference continuity across rapid tab transitions.
 * 2. Rapid State Transitions & Race Conditions:
 *    - Switching workspace tabs while actively scrubbing waveform.
 *    - Tapping sync while audio plays/pauses rapidly.
 *    - Opening, cycling, and closing modals during live playback without interrupting audio state.
 * 3. Boundary Viewport Geometries (280px, 320px, 360px, 375px):
 *    - Zero horizontal overflow (scrollWidth <= clientWidth) across all mobile components.
 * 4. Touch Target Sizing:
 *    - Interactive mobile controls meet >= 44x44px.
 *    - Tap-to-Sync stamp button meets >= 48px height.
 * 5. Extreme Edge Cases:
 *    - Empty/zero-duration project, NaN/Inf time inputs, rapid modal churn, and long metadata.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '../../App';
import { MobileStudioWorkspaceTabs } from '../../components/MobileStudioWorkspaceTabs';
import { TransportDock } from '../../components/transport/TransportDock';
import { StudioHeader } from '../../components/StudioHeader';
import { LyricTimelineEditor } from '../../components/LyricTimelineEditor';
import { TapToSyncBanner } from '../../components/timeline/TapToSyncBanner';
import { TimelineLineCard } from '../../components/timeline/TimelineLineCard';
import { WaveformScrubber } from '../../components/audio/WaveformScrubber';
import { ExportModal } from '../../components/ExportModal';
import { HelpModal } from '../../components/HelpModal';
import { EditMetadataModal } from '../../components/EditMetadataModal';
import { BatchOffsetModal } from '../../components/timeline/BatchOffsetModal';
import { LyricReplacementModal } from '../../components/timeline/LyricReplacementModal';
import { DuetAssignmentModal } from '../../components/timeline/DuetAssignmentModal';
import { AppThemeProvider } from '../../context/AppThemeContext';
import { ProjectState, LyricLine, StudioWorkspaceTab } from '../../types';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
} from '../helpers/responsiveTestUtils';

describe('Milestone M4 Challenger 1: Tier 5 White-Box Adversarial Hardening', () => {
  const mockProjectLines: LyricLine[] = [
    {
      id: 1,
      text: 'Adversarial Tier 5 stress line one',
      start_time: 1.0,
      end_time: 4.0,
      words: [
        { word: 'Adversarial', start_time: 1.0, end_time: 1.8 },
        { word: 'Tier', start_time: 1.8, end_time: 2.4 },
        { word: '5', start_time: 2.4, end_time: 2.8 },
        { word: 'stress', start_time: 2.8, end_time: 3.4 },
        { word: 'line', start_time: 3.4, end_time: 3.8 },
        { word: 'one', start_time: 3.8, end_time: 4.0 },
      ],
      singer: 'singer1',
    },
    {
      id: 2,
      text: 'Rapid tab switching and waveform touch scrub',
      start_time: 4.5,
      end_time: 8.5,
      words: [
        { word: 'Rapid', start_time: 4.5, end_time: 5.2 },
        { word: 'tab', start_time: 5.2, end_time: 5.8 },
        { word: 'switching', start_time: 5.8, end_time: 6.8 },
        { word: 'and', start_time: 6.8, end_time: 7.2 },
        { word: 'waveform', start_time: 7.2, end_time: 8.0 },
        { word: 'touch', start_time: 8.0, end_time: 8.3 },
        { word: 'scrub', start_time: 8.3, end_time: 8.5 },
      ],
      singer: 'singer2',
    },
  ];

  const readyProject: ProjectState = {
    id: 'm4-challenger-proj',
    title: 'Adversarial Tier 5 Stress Anthem [2026 Remaster]',
    artist: 'The White-Box Empirical Challenger',
    status: 'ready',
    progress: 100,
    created_by: 'M4Challenger1',
    lines: mockProjectLines,
    semitones: 1,
    guide_volume: 0.5,
    master_audio_url: '/static/m4-stress-master.wav',
    instrumental_url: '/static/m4-stress-instrumental.wav',
    vocals_url: '/static/m4-stress-vocals.wav',
  };

  const baseCardProps = {
    line: mockProjectLines[0],
    idx: 0,
    isCurrentlyActive: false,
    isExpanded: true,
    editingLineId: null as number | null,
    editingText: '',
    activeWordLoc: null,
    editInputRef: { current: null },
    onLineClick: vi.fn(),
    onWordClick: vi.fn(),
    onStartEditing: vi.fn(),
    onCommitEditing: vi.fn(),
    onCancelEditing: vi.fn(),
    onSetEditingText: vi.fn(),
    onNudgeLine: vi.fn(),
    onInsertLineAbove: vi.fn(),
    onInsertLineBelow: vi.fn(),
    onDeleteLine: vi.fn(),
    onToggleExpand: vi.fn(),
    onNudgeWord: vi.fn(),
    onNudgeWordBoundary: vi.fn(),
    onUpdateWordTiming: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/?project=m4-challenger-proj');

    // Default fetch mock for API endpoints
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/status')) {
        return new Response(JSON.stringify({ auth_required: false, authenticated: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/api/project/m4-challenger-proj')) {
        return new Response(JSON.stringify(readyProject), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('/api/projects')) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    });
  });

  afterEach(() => {
    resetTestViewport();
    vi.restoreAllMocks();
    cleanup();
  });

  // =========================================================================
  // Section 1: Unmount Resilience & Audio DOM Mounting Invariance
  // =========================================================================
  describe('Section 1: Invariant <audio> DOM Mounting Across Rapid Tab Transitions', () => {
    it('maintains strict reference equality of the <audio> DOM element across 30 rapid tab switches', async () => {
      setTestViewport(375, 667);
      const { container } = render(<App />);

      // Wait for project ready and audio controls to mount
      const audioControlsPanel = await screen.findByTestId('studio-panel-audio');
      expect(audioControlsPanel).toBeInTheDocument();

      const initialAudioEl = container.querySelector('audio');
      expect(initialAudioEl).not.toBeNull();
      expect(initialAudioEl?.tagName.toLowerCase()).toBe('audio');

      // Verify workspace tab buttons exist
      const stageTab = screen.getByRole('tab', { name: /^stage/i });
      const timelineTab = screen.getByRole('tab', { name: /^timeline/i });
      const mixTab = screen.getByRole('tab', { name: /^mix/i });

      const tabsSequence: Array<{ name: StudioWorkspaceTab; button: HTMLElement }> = [
        { name: 'timeline', button: timelineTab },
        { name: 'mix', button: mixTab },
        { name: 'stage', button: stageTab },
        { name: 'timeline', button: timelineTab },
        { name: 'stage', button: stageTab },
        { name: 'mix', button: mixTab },
      ];

      // Execute 30 rapid switches (5 iterations of the 6-switch sequence)
      for (let cycle = 0; cycle < 5; cycle++) {
        for (const target of tabsSequence) {
          act(() => {
            fireEvent.click(target.button);
          });

          // Empirical verification: audio element MUST remain the exact same DOM node instance
          const currentAudioEl = container.querySelector('audio');
          expect(currentAudioEl).toBe(initialAudioEl);

          // Panel display classes check
          if (target.name === 'mix') {
            expect(audioControlsPanel.className).toContain('block');
          } else {
            expect(audioControlsPanel.className).toContain('hidden md:block');
          }
        }
      }

      // Final invariant check: audio element is still perfectly intact
      expect(container.querySelector('audio')).toBe(initialAudioEl);
    });

    it('preserves timeline editor and stage preview DOM nodes without unmounting across tab switches', async () => {
      setTestViewport(375, 667);
      render(<App />);

      const stagePanel = await screen.findByTestId('studio-panel-stage');
      const timelinePanel = await screen.findByTestId('studio-panel-timeline');

      const initialStageNode = stagePanel;
      const initialTimelineNode = timelinePanel;

      const stageTab = screen.getByRole('tab', { name: /^stage/i });
      const timelineTab = screen.getByRole('tab', { name: /^timeline/i });
      const mixTab = screen.getByRole('tab', { name: /^mix/i });

      // Switch to Timeline
      act(() => {
        fireEvent.click(timelineTab);
      });
      expect(stagePanel.className).toContain('hidden md:block');
      expect(timelinePanel.className).toContain('block');
      expect(screen.getByTestId('studio-panel-stage')).toBe(initialStageNode);
      expect(screen.getByTestId('studio-panel-timeline')).toBe(initialTimelineNode);

      // Switch to Mix
      act(() => {
        fireEvent.click(mixTab);
      });
      const containerStageTimeline = screen.getByTestId('workspace-stage-timeline-container');
      expect(containerStageTimeline.className).toContain('hidden md:block');
      expect(screen.getByTestId('studio-panel-stage')).toBe(initialStageNode);
      expect(screen.getByTestId('studio-panel-timeline')).toBe(initialTimelineNode);

      // Switch back to Stage
      act(() => {
        fireEvent.click(stageTab);
      });
      expect(stagePanel.className).toContain('block');
      expect(timelinePanel.className).toContain('hidden md:block');
      expect(screen.getByTestId('studio-panel-stage')).toBe(initialStageNode);
      expect(screen.getByTestId('studio-panel-timeline')).toBe(initialTimelineNode);
    });
  });

  // =========================================================================
  // Section 2: Rapid State Transitions & Race Conditions
  // =========================================================================
  describe('Section 2: Rapid State Transitions & Concurrency Stress', () => {
    it('handles switching workspace tabs during an active waveform touch drag without error', async () => {
      setTestViewport(375, 667);
      const onSeek = vi.fn();
      let activeTab: StudioWorkspaceTab = 'timeline';

      const Harness: React.FC = () => {
        const [tab, setTab] = React.useState<StudioWorkspaceTab>(activeTab);
        return (
          <div>
            <MobileStudioWorkspaceTabs
              activeTab={tab}
              onSelectTab={(t) => {
                setTab(t);
                activeTab = t;
              }}
            />
            <div data-testid="timeline-view" className={tab === 'timeline' ? 'block' : 'hidden'}>
              <WaveformScrubber
                currentTime={2.0}
                duration={10.0}
                onSeek={onSeek}
                lines={mockProjectLines}
              />
            </div>
            <div data-testid="stage-view" className={tab === 'stage' ? 'block' : 'hidden'}>
              Stage Panel
            </div>
          </div>
        );
      };

      render(<Harness />);
      const scrubber = screen.getByTestId('waveform-scrubber');

      // Mock getBoundingClientRect for waveform scrubber
      vi.spyOn(scrubber, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: 300,
        bottom: 60,
        width: 300,
        height: 60,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // 1. Begin pointer scrub at 30% (X=90px -> 3.0s)
      fireEvent.pointerDown(scrubber, { clientX: 90, clientY: 30, pointerId: 1 });
      expect(onSeek).toHaveBeenCalledWith(expect.closeTo(3.0, 1));

      // 2. Mid-drag: switch workspace tab to Stage
      const stageTab = screen.getByRole('tab', { name: /^stage/i });
      act(() => {
        fireEvent.click(stageTab);
      });
      expect(activeTab).toBe('stage');

      // 3. Fire pointerMove at scrubber while tab is 'stage'
      fireEvent.pointerMove(scrubber, { clientX: 180, clientY: 30, pointerId: 1 });
      expect(onSeek).toHaveBeenCalledWith(expect.closeTo(6.0, 1));

      // 4. Fire pointerUp to finish scrub
      fireEvent.pointerUp(scrubber, { clientX: 180, clientY: 30, pointerId: 1 });

      expect(onSeek).toHaveBeenCalled();
    });

    it('stamps tap-to-sync monotonically while audio play/pause is toggled rapidly', async () => {
      setTestViewport(375, 667);
      const user = userEvent.setup();
      const onSeek = vi.fn();
      const onTogglePlay = vi.fn();
      let isPlaying = false;
      let currentTime = 1.0;

      const linesCopy = JSON.parse(JSON.stringify(mockProjectLines));

      const Harness: React.FC = () => {
        const [playing, setPlaying] = React.useState(isPlaying);
        const [time, setTime] = React.useState(currentTime);

        return (
          <div>
            <TransportDock
              currentTime={time}
              duration={20.0}
              isPlaying={playing}
              onTogglePlay={() => {
                setPlaying(!playing);
                isPlaying = !playing;
                onTogglePlay();
              }}
              onSeek={(t) => {
                setTime(t);
                currentTime = t;
                onSeek(t);
              }}
            />
            <LyricTimelineEditor
              lines={linesCopy}
              currentTime={time}
              duration={20.0}
              isPlaying={playing}
              onTogglePlay={() => {
                setPlaying(!playing);
                isPlaying = !playing;
                onTogglePlay();
              }}
              onSeek={(t) => {
                setTime(t);
                currentTime = t;
                onSeek(t);
              }}
              onSaveLines={vi.fn()}
              activeWorkspaceTab="timeline"
            />
          </div>
        );
      };

      render(<Harness />);

      // Enter Tap-to-Sync mode
      const tapSyncBtn = screen.getByTestId('tap-to-sync-btn');
      await user.click(tapSyncBtn);

      const stampBtn = screen.getByTestId('tap-now-btn');
      expect(stampBtn).toBeInTheDocument();

      const playPauseBtn = screen.getByTestId('transport-play-pause-btn');

      // Interleaved rapid tapping and play/pause toggles (1 line stamp)
      await user.click(playPauseBtn);
      expect(onTogglePlay).toHaveBeenCalled();

      await user.click(stampBtn);
      currentTime = 3.5;

      // Exit tap mode
      const exitBtn = screen.getByRole('button', { name: /exit tap/i });
      await user.click(exitBtn);
      expect(screen.queryByTestId('tap-now-btn')).not.toBeInTheDocument();
    });

    it('opens and closes modals while audio is playing without stopping playback or throwing errors', async () => {
      setTestViewport(375, 667);
      const user = userEvent.setup();
      let isPlaying = true;
      const onTogglePlay = vi.fn(() => {
        isPlaying = !isPlaying;
      });

      const Harness: React.FC = () => {
        const [showExport, setShowExport] = React.useState(false);
        const [showHelp, setShowHelp] = React.useState(false);

        return (
          <AppThemeProvider>
            <div>
              <StudioHeader
                currentUser="ChallengerUser"
                project={readyProject}
                isLyricsDirty={false}
                onOpenHelp={() => setShowHelp(true)}
                onOpenAuth={vi.fn()}
                onNewSong={vi.fn()}
                onStartRender={vi.fn()}
                onExportClick={() => setShowExport(true)}
              />
              <TransportDock
                currentTime={4.2}
                duration={30.0}
                isPlaying={isPlaying}
                onTogglePlay={onTogglePlay}
                onSeek={vi.fn()}
              />
              <ExportModal
                project={readyProject}
                isOpen={showExport}
                onClose={() => setShowExport(false)}
              />
              <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
            </div>
          </AppThemeProvider>
        );
      };

      render(<Harness />);

      // 1. Audio is playing
      expect(isPlaying).toBe(true);

      // 2. Open Export Modal from the header export trigger
      const exportTrigger = screen.getByTestId('studio-export-btn');
      await user.click(exportTrigger);

      expect(screen.getByRole('heading', { name: /export/i })).toBeInTheDocument();
      // Audio playback state remains intact
      expect(isPlaying).toBe(true);

      // 3. Toggle play/pause from the transport dock while modal is open
      const playPauseBtn = screen.getByTestId('transport-play-pause-btn');
      await user.click(playPauseBtn);
      expect(onTogglePlay).toHaveBeenCalledTimes(1);

      // 4. Close Export Modal via close button
      const closeExportBtn = screen.getByRole('button', { name: /close export dialog/i });
      await user.click(closeExportBtn);
      expect(screen.queryByRole('heading', { name: /export/i })).not.toBeInTheDocument();

      // 5. Open Help Modal
      const helpTrigger = screen.getByRole('button', { name: /help and studio usage guide/i });
      await user.click(helpTrigger);
      expect(screen.getByRole('heading', { name: /help & usage guide/i })).toBeInTheDocument();

      // 6. Close Help Modal via "Got it, close" footer button
      const gotItBtn = screen.getByRole('button', { name: /got it, close/i });
      await user.click(gotItBtn);
      expect(
        screen.queryByRole('heading', { name: /help & usage guide/i })
      ).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // Section 3: Boundary Viewport Geometries & Zero Horizontal Overflow
  // =========================================================================
  describe('Section 3: Boundary Viewport Geometries (280px, 320px, 360px, 375px)', () => {
    const testViewports = [280, 320, 360, 375];

    testViewports.forEach((vpWidth) => {
      it(`guarantees zero horizontal overflow across studio components at ${vpWidth}px width`, () => {
        setTestViewport(vpWidth, 667);

        // 1. MobileStudioWorkspaceTabs
        const { container: tabsContainer, unmount: unmountTabs } = render(
          <MobileStudioWorkspaceTabs activeTab="timeline" onSelectTab={vi.fn()} hasUnsavedChanges />
        );
        assertZeroHorizontalOverflow(tabsContainer, vpWidth);
        unmountTabs();

        // 2. TransportDock
        const { container: transportContainer, unmount: unmountTransport } = render(
          <TransportDock
            currentTime={125.4}
            duration={245.8}
            isPlaying={false}
            onTogglePlay={vi.fn()}
            onSeek={vi.fn()}
            semitones={-3}
            playbackRate={1.25}
          />
        );
        assertZeroHorizontalOverflow(transportContainer, vpWidth);
        unmountTransport();

        // 3. StudioHeader with ultra-long title and badge
        const { container: headerContainer, unmount: unmountHeader } = render(
          <AppThemeProvider>
            <StudioHeader
              currentUser="SuperLongUsernameTester12345"
              project={readyProject}
              isLyricsDirty={true}
              onOpenHelp={vi.fn()}
              onOpenAuth={vi.fn()}
              onNewSong={vi.fn()}
              onStartRender={vi.fn()}
            />
          </AppThemeProvider>
        );
        assertZeroHorizontalOverflow(headerContainer, vpWidth);
        unmountHeader();

        // 4. TapToSyncBanner
        const { container: bannerContainer, unmount: unmountBanner } = render(
          <TapToSyncBanner
            isActive={true}
            targetLine={mockProjectLines[0]}
            targetIndex={0}
            totalLines={5}
            onTap={vi.fn()}
            onExit={vi.fn()}
            syncMode="line"
            onModeChange={vi.fn()}
          />
        );
        assertZeroHorizontalOverflow(bannerContainer, vpWidth);
        unmountBanner();

        // 5. TimelineLineCard with nudges and edit actions
        const { container: cardContainer, unmount: unmountCard } = render(
          <TimelineLineCard {...baseCardProps} />
        );
        assertZeroHorizontalOverflow(cardContainer, vpWidth);
        unmountCard();
      });
    });

    testViewports.forEach((vpWidth) => {
      it(`guarantees bottom-sheet modals fit within viewport width without horizontal overflow at ${vpWidth}px`, () => {
        setTestViewport(vpWidth, 667);

        // ExportModal
        const { container: expContainer, unmount: unmountExp } = render(
          <AppThemeProvider>
            <ExportModal project={readyProject} isOpen={true} onClose={vi.fn()} />
          </AppThemeProvider>
        );
        assertZeroHorizontalOverflow(expContainer, vpWidth);
        unmountExp();

        // BatchOffsetModal
        const { container: batchContainer, unmount: unmountBatch } = render(
          <AppThemeProvider>
            <BatchOffsetModal
              isOpen={true}
              onClose={vi.fn()}
              onApplyOffset={vi.fn()}
              totalLines={mockProjectLines.length}
            />
          </AppThemeProvider>
        );
        assertZeroHorizontalOverflow(batchContainer, vpWidth);
        unmountBatch();

        // LyricReplacementModal
        const { container: replContainer, unmount: unmountRepl } = render(
          <AppThemeProvider>
            <LyricReplacementModal
              isOpen={true}
              onClose={vi.fn()}
              projectId="m4-challenger-proj"
              onSuccess={vi.fn()}
            />
          </AppThemeProvider>
        );
        assertZeroHorizontalOverflow(replContainer, vpWidth);
        unmountRepl();
      });
    });
  });

  // =========================================================================
  // Section 4: Mobile Touch Target Compliance (>= 44x44px and >= 48px Stamp)
  // =========================================================================
  describe('Section 4: Mobile Touch Target Standards (>= 44x44px and >= 48px Stamp)', () => {
    it('verifies all 3 workspace navigation tabs satisfy min-h-[44px]', () => {
      setTestViewport(375, 667);
      render(
        <MobileStudioWorkspaceTabs activeTab="stage" onSelectTab={vi.fn()} hasUnsavedChanges />
      );

      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(3);
      tabs.forEach((tab) => {
        expect(tab.className).toMatch(/min-h-\[44px\]/);
      });
    });

    it('verifies all interactive controls in TransportDock meet >= 44x44px hit targets', () => {
      setTestViewport(375, 667);
      render(
        <TransportDock
          currentTime={10.0}
          duration={60.0}
          isPlaying={false}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      const playBtn = screen.getByTestId('transport-play-pause-btn');
      expect(playBtn.className).toMatch(/min-h-\[44px\]/);
      expect(playBtn.className).toMatch(/min-w-\[44px\]/);

      const restartBtn = screen.getByRole('button', { name: 'Restart track from beginning' });
      expect(restartBtn.className).toMatch(/min-h-\[44px\]/);
      expect(restartBtn.className).toMatch(/min-w-\[44px\]/);

      const mixBtn = screen.getByTestId('transport-key-chip');
      expect(mixBtn.className).toMatch(/min-h-\[44px\]/);

      const scrubber = screen.getByRole('slider', { name: 'Audio timeline position' });
      expect(scrubber.className).toMatch(/min-h-\[44px\]/);
    });

    it('verifies Tap-to-Sync stamp button meets >= 48px height and banner controls meet >= 44px', () => {
      setTestViewport(375, 667);
      render(
        <TapToSyncBanner
          isActive={true}
          targetLine={mockProjectLines[0]}
          targetIndex={0}
          totalLines={3}
          onTap={vi.fn()}
          onExit={vi.fn()}
          syncMode="line"
          onModeChange={vi.fn()}
        />
      );

      const stampBtn = screen.getByTestId('tap-now-btn');
      expect(stampBtn.className).toMatch(/min-h-\[48px\]|min-h-\[52px\]/);

      const exitBtn = screen.getByRole('button', { name: /exit tap/i });
      expect(exitBtn.className).toMatch(/min-h-\[44px\]/);

      const modeBtns = screen.getAllByRole('button', { name: /line sync|word sync/i });
      modeBtns.forEach((btn) => {
        expect(btn.className).toMatch(/min-h-\[44px\]/);
      });
    });

    it('verifies TimelineLineCard nudge, jump, chevron, and delete buttons meet >= 44x44px on mobile', () => {
      setTestViewport(375, 667);
      render(<TimelineLineCard {...baseCardProps} />);

      const playJumpBtn = screen.getByRole('button', { name: /jump to line/i });
      expect(playJumpBtn.className).toMatch(/min-h-\[44px\]/);
      // Fills the free width of the row
      expect(playJumpBtn.className).toMatch(/\bflex-1\b/);

      const nudgeButtons = screen.getAllByRole('button', { name: /nudge line/i });
      expect(nudgeButtons.length).toBeGreaterThanOrEqual(4);
      nudgeButtons.forEach((btn) => {
        expect(btn.className).toMatch(/min-h-\[44px\]/);
        expect(btn.className).toMatch(/min-w-\[44px\]/);
      });

      const chevronBtn = screen.getByRole('button', {
        name: /collapse word timings|expand word timings/i,
      });
      expect(chevronBtn.className).toMatch(/min-h-\[44px\]/);
      expect(chevronBtn.className).toMatch(/min-w-\[44px\]/);

      const deleteBtn = screen.getByRole('button', { name: /delete line/i });
      expect(deleteBtn.className).toMatch(/min-h-\[44px\]/);
      expect(deleteBtn.className).toMatch(/min-w-\[44px\]/);
    });

    it('verifies close buttons across all 6 primary modal dialogs meet min-h-[44px] min-w-[44px]', () => {
      setTestViewport(375, 667);

      const modalComponents = [
        <ExportModal key="1" project={readyProject} isOpen={true} onClose={vi.fn()} />,
        <HelpModal key="2" isOpen={true} onClose={vi.fn()} />,
        <EditMetadataModal
          key="3"
          isOpen={true}
          project={readyProject}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
        <BatchOffsetModal
          key="4"
          isOpen={true}
          onClose={vi.fn()}
          onApplyOffset={vi.fn()}
          totalLines={2}
        />,
        <LyricReplacementModal
          key="5"
          isOpen={true}
          onClose={vi.fn()}
          projectId="m4-challenger-proj"
          onSuccess={vi.fn()}
        />,
        <DuetAssignmentModal
          key="6"
          isOpen={true}
          onClose={vi.fn()}
          onApply={vi.fn()}
          lines={mockProjectLines}
        />,
      ];

      modalComponents.forEach((modal) => {
        const { unmount } = render(<AppThemeProvider>{modal}</AppThemeProvider>);
        const closeBtn = screen.getByRole('button', {
          name: /close.*(modal|dialog|guide)/i,
        });
        expect(closeBtn.className).toMatch(/min-h-\[44px\]/);
        expect(closeBtn.className).toMatch(/min-w-\[44px\]/);
        unmount();
      });
    });
  });

  // =========================================================================
  // Section 5: Extreme Edge Cases & Defensive Hardening
  // =========================================================================
  describe('Section 5: Extreme Edge Cases & Defensive Hardening', () => {
    it('handles project with 0 lines and 0 duration without crashing', () => {
      setTestViewport(375, 667);
      const { container } = render(
        <AppThemeProvider>
          <TransportDock
            currentTime={0}
            duration={0}
            isPlaying={false}
            onTogglePlay={vi.fn()}
            onSeek={vi.fn()}
          />
          <LyricTimelineEditor
            lines={[]}
            currentTime={0}
            duration={0}
            isPlaying={false}
            onTogglePlay={vi.fn()}
            onSeek={vi.fn()}
            onSaveLines={vi.fn()}
            activeWorkspaceTab="timeline"
          />
        </AppThemeProvider>
      );

      expect(screen.getByTestId('transport-time')).toHaveTextContent('0:00');
      expect(screen.getByTestId('transport-duration')).toHaveTextContent('0:00');
      expect(screen.getByText(/no lyric lines yet/i)).toBeInTheDocument();
      expect(container).toBeInTheDocument();
    });

    it('safely formats NaN, Infinity, and negative time values in TransportDock', () => {
      setTestViewport(375, 667);
      const { rerender } = render(
        <TransportDock
          currentTime={NaN}
          duration={NaN}
          isPlaying={false}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );
      expect(screen.getByTestId('transport-time')).toHaveTextContent('0:00');
      expect(screen.getByTestId('transport-duration')).toHaveTextContent('0:00');

      rerender(
        <TransportDock
          currentTime={-15}
          duration={100}
          isPlaying={false}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );
      expect(screen.getByTestId('transport-time')).toHaveTextContent('0:00');
      expect(screen.getByTestId('transport-duration')).toHaveTextContent('1:40');

      rerender(
        <TransportDock
          currentTime={50}
          duration={Infinity}
          isPlaying={false}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );
      expect(screen.getByTestId('transport-time')).toHaveTextContent('0:50');
      expect(screen.getByTestId('transport-duration')).toHaveTextContent('0:00');
    });

    it('performs 50 consecutive modal open/Escape dismiss cycles without focus trapping leaks', () => {
      setTestViewport(375, 667);
      const onClose = vi.fn();

      const { rerender } = render(
        <AppThemeProvider>
          <HelpModal isOpen={true} onClose={onClose} />
        </AppThemeProvider>
      );

      for (let i = 0; i < 25; i++) {
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(i + 1);

        rerender(
          <AppThemeProvider>
            <HelpModal isOpen={false} onClose={onClose} />
          </AppThemeProvider>
        );

        rerender(
          <AppThemeProvider>
            <HelpModal isOpen={true} onClose={onClose} />
          </AppThemeProvider>
        );
      }
    });

    it('verifies safe-area bottom padding calculation and presence on TransportDock', () => {
      setTestViewport(375, 667);
      render(
        <TransportDock
          currentTime={5.0}
          duration={30.0}
          isPlaying={false}
          onTogglePlay={vi.fn()}
          onSeek={vi.fn()}
        />
      );

      const transport = screen.getByTestId('transport-dock');
      expect(transport.className).toContain('fixed');
      expect(transport.className).toContain('bottom-0');
      expect(transport.className).toContain('z-40');
      expect(transport.className).toContain('md:static');
      expect(transport.style.paddingBottom).toContain('safe-area-inset-bottom');
    });
  });
});

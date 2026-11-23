import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, renderHook, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricDisplay } from '../../components/LyricDisplay';
import { VisualThemePicker } from '../../components/VisualThemePicker';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { ExportSubtitleSection } from '../../components/export/ExportSubtitleSection';
import { LyricLine, ProjectState } from '../../types';
import * as apiModule from '../../api';
import {
  setTestViewport,
  resetTestViewport,
  assertZeroHorizontalOverflow,
  BREAKPOINTS,
  expectTouchTarget,
} from '../helpers/responsiveTestUtils';
import { getStageLook } from '../../theme/stageLooks';

const marquee = getStageLook('marquee');
const ktv = getStageLook('ktv');

describe('Fullscreen TV Stage Mode & Custom Theme Styling (Requirement R4)', () => {
  const sampleLines: LyricLine[] = [
    {
      id: 1,
      text: 'Live karaoke stage performance',
      start_time: 2.0,
      end_time: 5.0,
      words: [
        { word: 'Live', start_time: 2.0, end_time: 2.6 },
        { word: 'karaoke', start_time: 2.7, end_time: 3.5 },
        { word: 'stage', start_time: 3.6, end_time: 4.2 },
        { word: 'performance', start_time: 4.3, end_time: 5.0 },
      ],
    },
    {
      id: 2,
      text: 'Next line waiting in wings',
      start_time: 6.0,
      end_time: 9.0,
      words: [
        { word: 'Next', start_time: 6.0, end_time: 6.8 },
        { word: 'line', start_time: 6.9, end_time: 7.5 },
        { word: 'waiting', start_time: 7.6, end_time: 8.2 },
        { word: 'in', start_time: 8.3, end_time: 8.5 },
        { word: 'wings', start_time: 8.6, end_time: 9.0 },
      ],
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('useVisualTheme hook', () => {
    it('initializes with default theme and 1.0 font size scale', () => {
      const { result } = renderHook(() => useVisualTheme());
      expect(result.current.selectedTheme.id).toBe('marquee');
      expect(result.current.customSungColor).toBeNull();
      expect(result.current.customUnsungColor).toBeNull();
      expect(result.current.fontSizeScale).toBe(1.0);
      expect(result.current.aspectRatio).toBe('16:9');
      expect(result.current.activeSungColor).toBe(marquee.palette.sung);
      expect(result.current.activeUnsungColor).toBe(marquee.palette.unsung);
    });

    it('updates custom sung and unsung colors, font scale, and aspect ratio', () => {
      const { result } = renderHook(() => useVisualTheme());

      act(() => {
        result.current.setCustomSungColor('#ff0055');
        result.current.setCustomUnsungColor('#00ffcc');
        result.current.setFontSizeScale(1.5);
        result.current.setAspectRatio('9:16');
      });

      expect(result.current.customSungColor).toBe('#ff0055');
      expect(result.current.customUnsungColor).toBe('#00ffcc');
      expect(result.current.fontSizeScale).toBe(1.5);
      expect(result.current.aspectRatio).toBe('9:16');
      expect(result.current.activeSungColor).toBe('#ff0055');
      expect(result.current.activeUnsungColor).toBe('#00ffcc');
    });

    it('resets custom colors and font size scale to theme defaults', () => {
      const { result } = renderHook(() => useVisualTheme());

      act(() => {
        result.current.setCustomSungColor('#ff0055');
        result.current.setCustomUnsungColor('#00ffcc');
        result.current.setFontSizeScale(1.2);
      });

      expect(result.current.customSungColor).toBe('#ff0055');

      act(() => {
        result.current.resetThemeDefaults();
      });

      expect(result.current.customSungColor).toBeNull();
      expect(result.current.customUnsungColor).toBeNull();
      expect(result.current.fontSizeScale).toBe(1.0);
      expect(result.current.activeSungColor).toBe(marquee.palette.sung);
    });
  });

  describe('VisualThemePicker Component (Colors & Font Scaling)', () => {
    it('renders custom color pickers and font size scale selectors', () => {
      const onSungChange = vi.fn();
      const onUnsungChange = vi.fn();
      const onScaleChange = vi.fn();
      const onReset = vi.fn();

      render(
        <VisualThemePicker
          selectedTheme={marquee}
          onSelectTheme={vi.fn()}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
          customSungColor="#fbbf24"
          onCustomSungColorChange={onSungChange}
          customUnsungColor="#ffffff"
          onCustomUnsungColorChange={onUnsungChange}
          fontSizeScale={1.0}
          onFontSizeScaleChange={onScaleChange}
          onResetThemeDefaults={onReset}
        />
      );

      expect(screen.getByTestId('sung-color-picker')).toBeInTheDocument();
      expect(screen.getByTestId('unsung-color-picker')).toBeInTheDocument();
      expect(screen.getByTestId('font-scale-1.5x')).toBeInTheDocument();
      expect(screen.getByTestId('reset-theme-defaults-btn')).toBeInTheDocument();
    });

    it('triggers color changes and font size scale adjustments', () => {
      const onSungChange = vi.fn();
      const onScaleChange = vi.fn();
      const onReset = vi.fn();

      render(
        <VisualThemePicker
          selectedTheme={marquee}
          onSelectTheme={vi.fn()}
          aspectRatio="16:9"
          onChangeAspectRatio={vi.fn()}
          onCustomBgUploaded={vi.fn()}
          onCustomSungColorChange={onSungChange}
          onFontSizeScaleChange={onScaleChange}
          onResetThemeDefaults={onReset}
        />
      );

      const sungInput = screen.getByTestId('sung-color-picker');
      fireEvent.change(sungInput, { target: { value: '#ff0088' } });
      expect(onSungChange).toHaveBeenCalledWith('#ff0088');

      const scale15Btn = screen.getByTestId('font-scale-1.5x');
      fireEvent.click(scale15Btn);
      expect(onScaleChange).toHaveBeenCalledWith(1.5);

      const resetBtn = screen.getByTestId('reset-theme-defaults-btn');
      fireEvent.click(resetBtn);
      expect(onReset).toHaveBeenCalled();
    });
  });

  describe('LyricDisplay Fullscreen TV Stage Mode', () => {
    it('toggles stage mode via button click and renders floating controls', () => {
      render(
        <LyricDisplay lines={sampleLines} currentTime={3.0} duration={120} isPlaying={false} />
      );

      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveAttribute('data-fullscreen', 'false');

      const toggleBtn = screen.getByTestId('stage-fullscreen-toggle');
      fireEvent.click(toggleBtn);

      expect(stage).toHaveAttribute('data-fullscreen', 'true');
      expect(screen.getByTestId('stage-floating-controls')).toBeInTheDocument();
      expect(screen.getByTestId('stage-play-pause-btn')).toBeInTheDocument();
      expect(screen.getByTestId('stage-scrubber')).toBeInTheDocument();
      expect(screen.getByTestId('stage-time-display')).toHaveTextContent('0:03 / 2:00');
    });

    it('triggers play/pause and seek callbacks from floating controls', () => {
      const onTogglePlay = vi.fn();
      const onSeek = vi.fn();

      render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={3.0}
          duration={120}
          isPlaying={false}
          onTogglePlay={onTogglePlay}
          onSeek={onSeek}
        />
      );

      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      const playBtn = screen.getByTestId('stage-play-pause-btn');
      fireEvent.click(playBtn);
      expect(onTogglePlay).toHaveBeenCalledTimes(1);

      const scrubber = screen.getByTestId('stage-scrubber');
      fireEvent.change(scrubber, { target: { value: '45.0' } });
      expect(onSeek).toHaveBeenCalledWith(45.0);
    });

    it('enters and exits stage mode via F keyboard shortcut', () => {
      render(<LyricDisplay lines={sampleLines} currentTime={3.0} duration={120} />);

      const stage = screen.getByTestId('lyric-display-stage');
      expect(stage).toHaveAttribute('data-fullscreen', 'false');

      // Press 'f' to enter
      fireEvent.keyDown(window, { key: 'f' });
      expect(stage).toHaveAttribute('data-fullscreen', 'true');

      // Press 'Escape' to exit
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(stage).toHaveAttribute('data-fullscreen', 'false');

      // Press 'F' (uppercase) to re-enter
      fireEvent.keyDown(window, { key: 'F' });
      expect(stage).toHaveAttribute('data-fullscreen', 'true');
    });

    it('ignores F keypress when typing in an input element', () => {
      render(
        <div>
          <input data-testid="test-input" type="text" />
          <LyricDisplay lines={sampleLines} currentTime={3.0} />
        </div>
      );

      const stage = screen.getByTestId('lyric-display-stage');
      const input = screen.getByTestId('test-input');
      input.focus();

      fireEvent.keyDown(input, { key: 'f' });
      expect(stage).toHaveAttribute('data-fullscreen', 'false');
    });

    it('auto-hides floating controls after 3 seconds idle while playing', () => {
      vi.useFakeTimers();

      render(
        <LyricDisplay lines={sampleLines} currentTime={3.0} duration={120} isPlaying={true} />
      );

      // Enter fullscreen stage mode
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

      const controls = screen.getByTestId('stage-floating-controls');
      expect(controls).toHaveClass('opacity-100');

      // Advance time by 3000ms
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(controls).toHaveClass('opacity-0');

      // Moving mouse brings controls back
      const stage = screen.getByTestId('lyric-display-stage');
      fireEvent.mouseMove(stage);
      expect(controls).toHaveClass('opacity-100');

      // Advance 1500ms -> still visible
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(controls).toHaveClass('opacity-100');

      // Advance another 1500ms -> hides again
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(controls).toHaveClass('opacity-0');
    });
  });

  describe('LyricDisplay Font Size Scaling & Colors', () => {
    it('applies font size scaling and custom colors to active lyrics', () => {
      const { rerender } = render(
        <LyricDisplay
          lines={sampleLines}
          currentTime={3.0}
          selectedTheme={ktv}
          themeSungColor="#fbbf24"
          themeUnsungColor="#00ffee"
        />
      );
      const size = () =>
        Number(screen.getByTestId('active-lyrics-line').style.getPropertyValue('--size'));
      const lyricSize = ktv.frames['16:9'].lyric.size ?? 0;
      expect(size()).toBe(lyricSize);

      rerender(
        <LyricDisplay
          lines={sampleLines}
          currentTime={3.0}
          selectedTheme={ktv}
          fontSizeScale={1.5}
          themeSungColor="#fbbf24"
          themeUnsungColor="#00ffee"
        />
      );
      expect(size()).toBeCloseTo(lyricSize * 1.5, 5);

      // First word should have custom unsung color and sung overlay
      const liveSpans = screen.getAllByText('Live');
      expect(liveSpans[0]).toHaveStyle({ color: '#00ffee' });
      expect(screen.getByTestId('word-sung-0')).toHaveStyle({ color: '#fbbf24' });
    });
  });

  describe('ExportSubtitleSection URL Propagation', () => {
    it('propagates custom colors and font_size_scale into .ass download URL', async () => {
      const mockProject: ProjectState = {
        id: 'proj_test_export_prop',
        status: 'ready',
        progress: 100,
        title: 'Export Song',
        artist: 'Export Artist',
        lines: sampleLines,
        semitones: 0,
        guide_volume: 0,
      };

      if (!window.URL.createObjectURL) {
        window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      } else {
        vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:mock-url');
      }
      if (!window.URL.revokeObjectURL) {
        window.URL.revokeObjectURL = vi.fn();
      } else {
        vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
      }
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      const mockApiFetch = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['ASS Content'], { type: 'text/x-ssa' }),
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="Export.ass"',
        }),
      } as unknown as Response);

      render(
        <ExportSubtitleSection
          project={mockProject}
          selectedTheme={marquee}
          aspectRatio="16:9"
          primaryColor="#24bffb"
          secondaryColor="#ffffff"
          fontSizeScale={1.5}
        />
      );

      const assDownloadBtn = screen.getByLabelText(/Download .ass subtitles/i);
      await userEvent.click(assDownloadBtn);

      expect(mockApiFetch).toHaveBeenCalledTimes(1);
      const url = mockApiFetch.mock.calls[0][0] as string;
      expect(url).toContain('/api/project/proj_test_export_prop/export/ass');
      expect(url).toContain('theme_id=marquee');
      expect(url).toContain('primary_color=%2324bffb');
      expect(url).toContain('secondary_color=%23ffffff');
      expect(url).toContain('font_size_scale=1.5');
    });
  });
});

describe('LyricDisplay Fullscreen TV Stage Multi-Singer Integration (Requirement R2)', () => {
  const multiSingerLines: LyricLine[] = [
    {
      id: 101,
      text: 'Lead singer in Stage Mode',
      start_time: 1.0,
      end_time: 4.0,
      singer: 'singer1',
      words: [
        { word: 'Lead', start_time: 1.0, end_time: 2.0 },
        { word: 'singer', start_time: 2.1, end_time: 4.0 },
      ],
    },
    {
      id: 102,
      text: 'Partner singer in Stage Mode',
      start_time: 5.0,
      end_time: 8.0,
      singer: 'singer2',
      words: [
        { word: 'Partner', start_time: 5.0, end_time: 6.5 },
        { word: 'singer', start_time: 6.6, end_time: 8.0 },
      ],
    },
  ];

  afterEach(() => {
    resetTestViewport();
  });

  it('names the singer part and preserves color treatments in Fullscreen TV Stage Mode', () => {
    render(
      <LyricDisplay
        lines={multiSingerLines}
        currentTime={2.0}
        duration={120}
        selectedTheme={ktv}
        themeSungColor="#06b6d4"
      />
    );

    // Enter stage mode
    fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

    const stage = screen.getByTestId('lyric-display-stage');
    expect(stage).toHaveAttribute('data-fullscreen', 'true');

    // The part of the line being sung is named over it
    const part = screen.getByTestId('stage-part-name');
    expect(part).toHaveTextContent('Singer 1');
    expect(part).toHaveAttribute('data-line', '0');
    expect(screen.getByTestId('active-lyrics-line')).toHaveTextContent('Lead');

    // Singer 1 is filled in the sung colour
    expect(screen.getByTestId('word-sung-0')).toHaveStyle({ color: '#06b6d4' });

    // Fullscreen play and exit controls meet >=44px touch targets
    expectTouchTarget(screen.getByTestId('stage-play-pause-btn'));
    const exitBtn = screen.getByTestId('stage-fullscreen-toggle');
    expect(exitBtn).toHaveAccessibleName(/exit fullscreen stage/i);
    expectTouchTarget(exitBtn);
  });

  it('renders Singer 2 Partner color and part name in Fullscreen TV Stage Mode', () => {
    render(
      <LyricDisplay
        lines={multiSingerLines}
        currentTime={6.0}
        duration={120}
        selectedTheme={ktv}
        themeSungColor="#06b6d4"
      />
    );

    // Enter stage mode
    fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

    const part = screen.getByTestId('stage-part-name');
    expect(part).toHaveTextContent('Singer 2');
    expect(part).toHaveAttribute('data-line', '1');

    // Singer 2 is filled in the look's duet colour, not in Singer 1's
    const sungWord = screen.getByTestId('word-sung-0');
    expect(sungWord).toHaveStyle({ color: ktv.palette.singer2 });
  });

  it('has zero horizontal overflow in Stage Mode across all breakpoints down to 320px', () => {
    BREAKPOINTS.forEach((bp) => {
      setTestViewport(bp.width, bp.height);
      const { container } = render(
        <LyricDisplay lines={multiSingerLines} currentTime={2.0} duration={120} />
      );

      // Enter fullscreen
      fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));
      assertZeroHorizontalOverflow(container, bp.width);
      cleanup();
    });
  });

  it('renders the count-in in Fullscreen TV Stage Mode with zero overflow at 320px', () => {
    setTestViewport(320, 568);
    const { container } = render(
      <LyricDisplay
        lines={[{ id: 1, text: 'Stage line', start_time: 10.0, end_time: 15.0, words: [] }]}
        currentTime={8.0}
        duration={120}
      />
    );

    fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

    // Two seconds before the first line, the stage counts in to it
    expect(screen.getByTestId('stage-count-in')).toHaveTextContent('2');
    expect(screen.getByTestId('active-lyrics-line')).toHaveTextContent('STAGE LINE');

    assertZeroHorizontalOverflow(container, 320);
  });
});

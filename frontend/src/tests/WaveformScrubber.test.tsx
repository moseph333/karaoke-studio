import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WaveformScrubber } from '../components/audio/WaveformScrubber';

if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  // @ts-expect-error polyfill PointerEvent for jsdom environment
  window.PointerEvent = class PointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  };
}

describe('WaveformScrubber', () => {
  const defaultProps = {
    currentTime: 30,
    duration: 120,
    onSeek: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders 100 waveform bars and playhead needle', () => {
    render(<WaveformScrubber {...defaultProps} />);

    const scrubber = screen.getByTestId('waveform-scrubber');
    expect(scrubber).toBeInTheDocument();

    const bars = screen.getAllByTestId('waveform-bar');
    expect(bars).toHaveLength(100);

    const playhead = screen.getByTestId('waveform-playhead');
    expect(playhead).toBeInTheDocument();
    // 30 / 120 = 25%
    expect(playhead.style.left).toBe('25%');
  });

  it('applies played accent color to elapsed bars and unplayed color to remaining bars', () => {
    render(<WaveformScrubber {...defaultProps} currentTime={50} duration={100} />);

    const bars = screen.getAllByTestId('waveform-bar');
    // First 50 bars should be played (sung color token)
    for (const i of [0, 25, 49]) {
      expect(bars[i]).toHaveAttribute('data-played', 'true');
      expect(bars[i].className).toContain('bg-theme-sung');
    }

    // Remaining bars use the muted unplayed token
    for (const i of [55, 99]) {
      expect(bars[i]).toHaveAttribute('data-played', 'false');
      expect(bars[i].className).toContain('bg-theme-text-muted/25');
      expect(bars[i].className).not.toContain('bg-theme-sung');
    }
  });

  it('provides an internal accessible slider preserving accessibility assertions', () => {
    render(<WaveformScrubber {...defaultProps} />);

    const slider = screen.getByRole('slider', { name: 'Audio timeline position' });
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '120');
    expect(slider).toHaveAttribute('aria-valuenow', '30');
    expect(slider).toHaveAttribute('aria-valuetext', '0:30 of 2:00');
  });

  it('calls onSeek when changing the accessible range input', async () => {
    const onSeek = vi.fn();
    render(<WaveformScrubber {...defaultProps} onSeek={onSeek} />);

    const slider = screen.getByRole('slider', { name: 'Audio timeline position' });
    fireEvent.change(slider, { target: { value: '45' } });

    expect(onSeek).toHaveBeenCalledWith(45);
  });

  it('performs click-to-seek and drag-scrubbing using pointer events', () => {
    const onSeek = vi.fn();
    render(<WaveformScrubber {...defaultProps} onSeek={onSeek} />);

    const scrubber = screen.getByTestId('waveform-scrubber');

    // Mock getBoundingClientRect
    vi.spyOn(scrubber, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 400,
      top: 50,
      right: 500,
      bottom: 100,
      height: 50,
      x: 100,
      y: 50,
      toJSON: () => {},
    });

    // 1. Pointer Down at x = 300 (halfway across 100..500 -> ratio 0.5 -> 60s)
    fireEvent.pointerDown(scrubber, {
      clientX: 300,
      pointerId: 1,
    });
    expect(onSeek).toHaveBeenCalledWith(60);

    // 2. Pointer Move to x = 400 (3/4 across -> ratio 0.75 -> 90s)
    fireEvent.pointerMove(scrubber, {
      clientX: 400,
      pointerId: 1,
    });
    expect(onSeek).toHaveBeenCalledWith(90);

    // 3. Pointer Up ends drag
    fireEvent.pointerUp(scrubber, {
      clientX: 400,
      pointerId: 1,
    });

    // 4. Moving pointer when not dragging does not trigger seek
    onSeek.mockClear();
    fireEvent.pointerMove(scrubber, {
      clientX: 200,
      pointerId: 1,
    });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('modulates bar heights higher during vocal line timestamps than silent sections', () => {
    // Vocal lines between 20s and 40s in a 100s song
    const lines = [{ start: 20, end: 40, text: 'Vocal phrase' }];
    render(<WaveformScrubber duration={100} currentTime={0} onSeek={vi.fn()} lines={lines} />);

    const bars = screen.getAllByTestId('waveform-bar');

    // Bars around 30% (index 30) should be higher than bars at 5% (index 5)
    const silentHeightStr = bars[5].style.height;
    const vocalHeightStr = bars[30].style.height;

    const silentHeight = parseFloat(silentHeightStr);
    const vocalHeight = parseFloat(vocalHeightStr);

    expect(vocalHeight).toBeGreaterThan(silentHeight);
  });

  it('handles zero or negative duration gracefully without division by zero', () => {
    render(<WaveformScrubber duration={0} currentTime={0} onSeek={vi.fn()} />);

    const playhead = screen.getByTestId('waveform-playhead');
    expect(playhead.style.left).toBe('0%');

    const slider = screen.getByRole('slider', { name: 'Audio timeline position' });
    expect(slider).toHaveAttribute('aria-valuemax', '100');
  });

  it('clamps seeking within bounds [0, duration]', () => {
    const onSeek = vi.fn();
    render(<WaveformScrubber {...defaultProps} onSeek={onSeek} />);

    const scrubber = screen.getByTestId('waveform-scrubber');
    vi.spyOn(scrubber, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 400,
      top: 50,
      right: 500,
      bottom: 100,
      height: 50,
      x: 100,
      y: 50,
      toJSON: () => {},
    });

    // Pointer down beyond left edge (< 100) -> clamped to 0
    fireEvent.pointerDown(scrubber, { clientX: 50, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(0);

    // Pointer move beyond right edge (> 500) -> clamped to duration (120)
    fireEvent.pointerMove(scrubber, { clientX: 600, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(120);
  });
});

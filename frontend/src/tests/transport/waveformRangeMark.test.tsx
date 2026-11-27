/**
 * The scrubber marks a stretch of the song along its top (the part that repeats in practice):
 * placed by the song's length, kept inside the track, and absent without a usable stretch.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WaveformScrubber } from '../../components/audio/WaveformScrubber';

const PEAKS = Array.from({ length: 100 }, () => 0.5);

function scrubber(range: { start: number; end: number } | null | undefined, duration = 100) {
  return render(
    <WaveformScrubber
      currentTime={0}
      duration={duration}
      onSeek={() => {}}
      peaks={PEAKS}
      range={range}
    />
  );
}

const mark = () => screen.queryByTestId('waveform-range');

describe('the scrubber’s range mark', () => {
  it('is not drawn without a stretch', () => {
    scrubber(null);
    expect(mark()).toBeNull();
  });

  it('spans the stretch, in the lit colour and out of the pointer’s way', () => {
    scrubber({ start: 25, end: 40 });
    expect(mark()).toHaveStyle({ left: '25%', width: '15%' });
    expect(mark()).toHaveClass('bg-theme-accent', 'pointer-events-none');
    expect(mark()).toHaveAttribute('aria-hidden', 'true');
  });

  it('stays inside the track when the stretch runs past the song', () => {
    scrubber({ start: 90, end: 130 });
    expect(mark()).toHaveStyle({ left: '90%', width: '10%' });
  });

  it('moves with the stretch', () => {
    const { rerender } = scrubber({ start: 10, end: 20 });
    rerender(
      <WaveformScrubber
        currentTime={0}
        duration={100}
        onSeek={() => {}}
        peaks={PEAKS}
        range={{ start: 50, end: 80 }}
      />
    );
    expect(mark()).toHaveStyle({ left: '50%', width: '30%' });
  });

  it('is not drawn for an empty stretch or before the song’s length is known', () => {
    scrubber({ start: 30, end: 30 });
    expect(mark()).toBeNull();
    scrubber({ start: 10, end: 20 }, 0);
    expect(mark()).toBeNull();
  });
});

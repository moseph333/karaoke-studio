import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WaveformScrubber } from '../../components/audio/WaveformScrubber';
import { seekTargetForKey } from '../../utils/seekKeys';

describe('seekTargetForKey', () => {
  const at = (key: string, shiftKey = false) => seekTargetForKey({ key, shiftKey }, 30, 120);

  it('maps the slider keys to the global shortcut steps', () => {
    expect(at('ArrowRight')).toBe(35);
    expect(at('ArrowUp')).toBe(35);
    expect(at('ArrowLeft')).toBe(25);
    expect(at('ArrowDown')).toBe(25);
    expect(at('ArrowRight', true)).toBe(31);
    expect(at('ArrowLeft', true)).toBe(29);
    expect(at('PageUp')).toBe(45);
    expect(at('PageDown')).toBe(15);
    expect(at('Home')).toBe(0);
    expect(at('End')).toBe(120);
    expect(at('Enter')).toBeNull();
  });

  it('stays inside the song', () => {
    expect(seekTargetForKey({ key: 'ArrowLeft', shiftKey: false }, 2, 120)).toBe(0);
    expect(seekTargetForKey({ key: 'PageUp', shiftKey: false }, 110, 120)).toBe(120);
  });
});

describe('WaveformScrubber keyboard', () => {
  const slider = () => screen.getByRole('slider', { name: 'Audio timeline position' });

  it('seeks 5 seconds per arrow, as its tooltip says', () => {
    const onSeek = vi.fn();
    render(<WaveformScrubber currentTime={30} duration={120} onSeek={onSeek} />);

    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    fireEvent.keyDown(slider(), { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(slider(), { key: 'End' });

    expect(onSeek.mock.calls).toEqual([[35], [29], [120]]);
  });

  it('shows keyboard focus on the visible waveform', () => {
    render(<WaveformScrubber currentTime={30} duration={120} onSeek={vi.fn()} />);
    expect(screen.getByTestId('waveform-scrubber').className).toContain(
      'has-[input:focus-visible]:ring-2'
    );
  });

  it('holds its spoken value while focused during playback, so it is not read every second', () => {
    const props = { duration: 120, onSeek: vi.fn(), isPlaying: true };
    const { rerender } = render(<WaveformScrubber {...props} currentTime={30} />);

    fireEvent.focus(slider());
    rerender(<WaveformScrubber {...props} currentTime={31} />);
    rerender(<WaveformScrubber {...props} currentTime={32} />);
    expect(slider()).toHaveAttribute('aria-valuetext', '0:30 of 2:00');
    // The visible playhead keeps moving
    expect(screen.getByTestId('waveform-playhead').style.left).toBe(`${(32 / 120) * 100}%`);

    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    expect(slider()).toHaveAttribute('aria-valuetext', '0:37 of 2:00');

    fireEvent.blur(slider());
    expect(slider()).toHaveAttribute('aria-valuetext', '0:32 of 2:00');
  });

  it('follows playback when it is not focused or the song is paused', () => {
    const props = { duration: 120, onSeek: vi.fn() };
    const { rerender } = render(<WaveformScrubber {...props} currentTime={30} isPlaying />);
    rerender(<WaveformScrubber {...props} currentTime={40} isPlaying />);
    expect(slider()).toHaveAttribute('aria-valuetext', '0:40 of 2:00');

    fireEvent.focus(slider());
    rerender(<WaveformScrubber {...props} currentTime={41} isPlaying={false} />);
    expect(slider()).toHaveAttribute('aria-valuetext', '0:41 of 2:00');
  });
});

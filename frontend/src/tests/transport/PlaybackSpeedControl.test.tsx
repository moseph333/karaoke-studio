import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlaybackSpeedControl, PLAYBACK_SPEEDS } from '../../components/audio/PlaybackSpeedControl';

describe('PlaybackSpeedControl', () => {
  it('renders radio group with accessible name and all 5 speed options', () => {
    render(<PlaybackSpeedControl playbackRate={1.0} onPlaybackRateChange={vi.fn()} />);

    const group = screen.getByRole('radiogroup', { name: 'Playback speed' });
    expect(group).toBeInTheDocument();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(PLAYBACK_SPEEDS.length);

    for (const speed of PLAYBACK_SPEEDS) {
      expect(screen.getByRole('radio', { name: `Playback speed ${speed}x` })).toBeInTheDocument();
    }
  });

  it('marks current playback rate as checked and other speeds as unchecked', () => {
    const { rerender } = render(
      <PlaybackSpeedControl playbackRate={1.0} onPlaybackRateChange={vi.fn()} />
    );

    const normalBtn = screen.getByRole('radio', { name: 'Playback speed 1x' });
    const fastBtn = screen.getByRole('radio', { name: 'Playback speed 1.5x' });
    const slowBtn = screen.getByRole('radio', { name: 'Playback speed 0.5x' });

    expect(normalBtn).toHaveAttribute('aria-checked', 'true');
    expect(normalBtn.className).toContain('bg-theme-accent');
    expect(fastBtn.className).not.toContain('bg-theme-accent ');

    expect(fastBtn).toHaveAttribute('aria-checked', 'false');
    expect(slowBtn).toHaveAttribute('aria-checked', 'false');

    // Rerender with 0.75x
    rerender(<PlaybackSpeedControl playbackRate={0.75} onPlaybackRateChange={vi.fn()} />);
    const point75Btn = screen.getByRole('radio', { name: 'Playback speed 0.75x' });
    expect(point75Btn).toHaveAttribute('aria-checked', 'true');
    expect(normalBtn).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onPlaybackRateChange when clicking speed buttons', async () => {
    const user = userEvent.setup();
    const onPlaybackRateChange = vi.fn();

    render(<PlaybackSpeedControl playbackRate={1.0} onPlaybackRateChange={onPlaybackRateChange} />);

    const slowBtn = screen.getByRole('radio', { name: 'Playback speed 0.5x' });
    await user.click(slowBtn);
    expect(onPlaybackRateChange).toHaveBeenCalledWith(0.5);

    const fastBtn = screen.getByRole('radio', { name: 'Playback speed 1.25x' });
    await user.click(fastBtn);
    expect(onPlaybackRateChange).toHaveBeenCalledWith(1.25);
  });

  it('provides >= 36px touch targets for all speed buttons', () => {
    render(<PlaybackSpeedControl playbackRate={1.0} onPlaybackRateChange={vi.fn()} />);

    const radios = screen.getAllByRole('radio');
    for (const radio of radios) {
      expect(radio.className).toContain('min-h-[36px]');
      expect(radio.className).toContain('min-w-[36px]');
    }
  });
});

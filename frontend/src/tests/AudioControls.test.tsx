import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioControls } from '../components/AudioControls';

describe('AudioControls', () => {
  const defaultProps = {
    projectId: 'test-project-123',
    masterAudioUrl: '/static/test-master.wav',
    currentTime: 15,
    duration: 120,
    isPlaying: false,
    onTogglePlay: vi.fn(),
    onSeek: vi.fn(),
    onMixChange: vi.fn(),
  };

  it('renders playback duration and current time correctly formatted', () => {
    render(<AudioControls {...defaultProps} />);

    expect(screen.getByText('0:15')).toBeInTheDocument();
    expect(screen.getByText('2:00')).toBeInTheDocument();
  });

  it('toggles play/pause when the transport button is clicked', async () => {
    const user = userEvent.setup();
    const onTogglePlay = vi.fn();

    const { rerender } = render(
      <AudioControls {...defaultProps} isPlaying={false} onTogglePlay={onTogglePlay} />
    );

    const playBtn = screen.getByRole('button', { name: /start playback/i });
    await user.click(playBtn);
    expect(onTogglePlay).toHaveBeenCalledTimes(1);

    rerender(<AudioControls {...defaultProps} isPlaying={true} onTogglePlay={onTogglePlay} />);
    expect(screen.getByRole('button', { name: /pause playback/i })).toBeInTheDocument();
  });

  it('calls onSeek(0) when the restart button is clicked', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<AudioControls {...defaultProps} onSeek={onSeek} />);

    const restartBtn = screen.getByRole('button', { name: /restart track from beginning/i });
    await user.click(restartBtn);

    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it('increments, decrements, and resets pitch transposition within -12 to +12 bounds', async () => {
    const user = userEvent.setup();
    render(<AudioControls {...defaultProps} />);

    const decBtn = screen.getByRole('button', { name: /decrease pitch/i });
    const incBtn = screen.getByRole('button', { name: /increase pitch/i });
    const resetBtn = screen.getByRole('button', { name: /reset pitch/i });

    // Initial state
    expect(screen.getByText('0 (Original)')).toBeInTheDocument();

    // Increment
    await user.click(incBtn);
    expect(screen.getByText('+1 semitones')).toBeInTheDocument();

    await user.click(incBtn);
    expect(screen.getByText('+2 semitones')).toBeInTheDocument();

    // Decrement
    await user.click(decBtn);
    expect(screen.getByText('+1 semitones')).toBeInTheDocument();

    // Reset
    await user.click(resetBtn);
    expect(screen.getByText('0 (Original)')).toBeInTheDocument();
  });

  it('calls onMixChange with semitones and guide volume when Apply Audio Mix is clicked', async () => {
    const user = userEvent.setup();
    const onMixChange = vi.fn().mockResolvedValue(undefined);
    render(<AudioControls {...defaultProps} onMixChange={onMixChange} />);

    // Increase pitch by 2
    const incBtn = screen.getByRole('button', { name: /increase pitch/i });
    await user.click(incBtn);
    await user.click(incBtn);

    // Click apply mix
    const applyBtn = screen.getByRole('button', { name: /apply audio mix settings/i });
    await user.click(applyBtn);

    expect(onMixChange).toHaveBeenCalledTimes(1);
    expect(onMixChange).toHaveBeenCalledWith(2, 0.0);
  });
});

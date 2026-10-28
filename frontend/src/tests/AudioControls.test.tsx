import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioControls, parseMediaError } from '../components/AudioControls';
import * as apiModule from '../api';
import { VocalRangeData } from '../types';

describe('AudioControls (Mix inspector)', () => {
  const defaultProps = {
    projectId: 'test-project-123',
    onMixChange: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the mix inspector without any playback transport', () => {
    render(<AudioControls {...defaultProps} />);

    expect(screen.getByRole('region', { name: 'Audio mix' })).toBeInTheDocument();
    expect(screen.queryByTestId('audio-element')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start playback/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: /master volume/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply audio mix/i })).not.toBeInTheDocument();
  });

  it('increments, decrements, and resets pitch transposition within -12 to +12 bounds', async () => {
    const user = userEvent.setup();
    render(<AudioControls {...defaultProps} />);

    const decBtn = screen.getByRole('button', { name: /decrease pitch/i });
    const incBtn = screen.getByRole('button', { name: /increase pitch/i });
    const resetBtn = screen.getByRole('button', { name: /reset pitch/i });
    const readout = screen.getByTestId('pitch-readout-caption');

    expect(readout).toHaveTextContent('Original key');
    expect(screen.getByTestId('pitch-readout')).toHaveTextContent('0');
    expect(resetBtn).toBeDisabled();

    await user.click(incBtn);
    expect(readout).toHaveTextContent('1 semitone up');
    expect(screen.getByTestId('pitch-readout')).toHaveTextContent('+1');

    await user.click(incBtn);
    expect(readout).toHaveTextContent('2 semitones up');

    await user.click(decBtn);
    expect(readout).toHaveTextContent('1 semitone up');

    await user.click(resetBtn);
    expect(readout).toHaveTextContent('Original key');

    for (let i = 0; i < 14; i++) await user.click(decBtn);
    expect(readout).toHaveTextContent('12 semitones down');
    expect(screen.getByTestId('pitch-readout')).toHaveTextContent('−12');
    expect(decBtn).toBeDisabled();
  });

  it('applies key and guide changes automatically through onMixChange after a debounce', () => {
    vi.useFakeTimers();
    const onMixChange = vi.fn().mockResolvedValue(undefined);
    render(<AudioControls {...defaultProps} onMixChange={onMixChange} mixDebounceMs={400} />);

    const incBtn = screen.getByRole('button', { name: /increase pitch/i });
    fireEvent.click(incBtn);
    fireEvent.click(incBtn);

    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(onMixChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onMixChange).toHaveBeenCalledTimes(1);
    expect(onMixChange).toHaveBeenCalledWith(2, 0.0);

    // Guide slider applies on release, not on every drag step
    const guide = screen.getByRole('slider', { name: 'Guide vocal volume level' });
    fireEvent.change(guide, { target: { value: '0.2' } });
    fireEvent.change(guide, { target: { value: '0.3' } });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onMixChange).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(guide);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onMixChange).toHaveBeenCalledTimes(2);
    expect(onMixChange).toHaveBeenLastCalledWith(2, 0.3);
  });

  it('works controlled: renders requested values and reports changes without applying itself', async () => {
    const user = userEvent.setup();
    const onSemitonesChange = vi.fn();
    const onGuideVolumeChange = vi.fn();
    const onGuideVolumeCommit = vi.fn();
    const onMixChange = vi.fn();

    render(
      <AudioControls
        projectId="p1"
        semitones={-3}
        guideVolume={0.25}
        onSemitonesChange={onSemitonesChange}
        onGuideVolumeChange={onGuideVolumeChange}
        onGuideVolumeCommit={onGuideVolumeCommit}
        onMixChange={onMixChange}
        isMixPending
      />
    );

    expect(screen.getByTestId('pitch-readout-caption')).toHaveTextContent('3 semitones down');
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByTestId('pitch-pending-mix-badge')).toHaveTextContent('Applying…');

    await user.click(screen.getByRole('button', { name: /increase pitch/i }));
    expect(onSemitonesChange).toHaveBeenCalledWith(-2);
    // Controlled value is owned by the parent
    expect(screen.getByTestId('pitch-readout-caption')).toHaveTextContent('3 semitones down');

    const guide = screen.getByRole('slider', { name: 'Guide vocal volume level' });
    fireEvent.change(guide, { target: { value: '0.4' } });
    expect(onGuideVolumeChange).toHaveBeenCalledWith(0.4);
    expect(onMixChange).not.toHaveBeenCalled();
  });

  it('commits the controlled guide level on slider release', () => {
    const onGuideVolumeCommit = vi.fn();
    const Harness = () => {
      const [guide, setGuide] = useState(0.1);
      return (
        <AudioControls
          projectId="p1"
          semitones={0}
          guideVolume={guide}
          onGuideVolumeChange={setGuide}
          onGuideVolumeCommit={onGuideVolumeCommit}
        />
      );
    };
    render(<Harness />);

    const guide = screen.getByRole('slider', { name: 'Guide vocal volume level' });
    fireEvent.change(guide, { target: { value: '0.35' } });
    expect(screen.getByText('35%')).toBeInTheDocument();
    expect(onGuideVolumeCommit).not.toHaveBeenCalled();

    fireEvent.keyUp(guide, { key: 'ArrowRight' });
    expect(onGuideVolumeCommit).toHaveBeenCalledTimes(1);
    expect(onGuideVolumeCommit).toHaveBeenCalledWith(0.35);
  });

  it('shows the re-pitching status while the master mix re-renders', () => {
    render(<AudioControls projectId="p1" semitones={2} guideVolume={0} isRemixing />);
    expect(screen.getByTestId('pitch-pending-mix-badge')).toHaveTextContent('Re-pitching…');
  });

  it('synchronizes pitch and guide volume state with initial props', () => {
    const { rerender } = render(
      <AudioControls {...defaultProps} initialSemitones={3} initialGuideVolume={0.25} />
    );

    expect(screen.getByTestId('pitch-readout-caption')).toHaveTextContent('3 semitones up');
    expect(screen.getByText('25%')).toBeInTheDocument();

    rerender(<AudioControls {...defaultProps} initialSemitones={-2} initialGuideVolume={0.4} />);
    expect(screen.getByTestId('pitch-readout-caption')).toHaveTextContent('2 semitones down');
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('re-exports parseMediaError for MediaError codes', () => {
    expect(parseMediaError({ code: 1, message: '' } as MediaError).codeName).toBe(
      'MEDIA_ERR_ABORTED'
    );
    expect(parseMediaError({ code: 2, message: '' } as MediaError).codeName).toBe(
      'MEDIA_ERR_NETWORK'
    );
    expect(parseMediaError({ code: 3, message: '' } as MediaError).codeName).toBe(
      'MEDIA_ERR_DECODE'
    );
    expect(parseMediaError({ code: 4, message: '' } as MediaError).codeName).toBe(
      'MEDIA_ERR_SRC_NOT_SUPPORTED'
    );
  });

  it('handles instrumental upload failure gracefully without throwing unhandled exceptions', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Invalid WAV format' }), { status: 400 })
    );
    const onRequestRemix = vi.fn();

    render(<AudioControls {...defaultProps} onRequestRemix={onRequestRemix} />);

    const uploadInput = screen.getByLabelText(/upload custom instrumental audio file/i);
    await user.upload(uploadInput, new File(['corrupt-data'], 'bad.wav', { type: 'audio/wav' }));

    expect(screen.getByRole('button', { name: /replace instrumental file/i })).not.toBeDisabled();
    expect(onRequestRemix).not.toHaveBeenCalled();
  });

  it('re-mixes after a successful instrumental replacement', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ instrumental_url: '/static/stems/p/custom_inst.wav' }), {
        status: 200,
      })
    );
    const onRequestRemix = vi.fn();
    const onCustomInstrumentalUploaded = vi.fn();

    render(
      <AudioControls
        {...defaultProps}
        onRequestRemix={onRequestRemix}
        onCustomInstrumentalUploaded={onCustomInstrumentalUploaded}
      />
    );

    await user.upload(
      screen.getByLabelText(/upload custom instrumental audio file/i),
      new File(['RIFF'], 'mine.wav', { type: 'audio/wav' })
    );

    await waitFor(() => expect(onRequestRemix).toHaveBeenCalledTimes(1));
    expect(onCustomInstrumentalUploaded).toHaveBeenCalledWith('/static/stems/p/custom_inst.wav');
  });

  it('labels the instrumental source', () => {
    const { rerender } = render(<AudioControls {...defaultProps} />);
    expect(screen.getByText('Separated stem')).toBeInTheDocument();
    rerender(<AudioControls {...defaultProps} instrumentalUrl="/static/stems/p/custom_inst.wav" />);
    expect(screen.getByText('Custom backing track')).toBeInTheDocument();
  });

  describe('Vocal Range & Smart Recommender Integration (R1)', () => {
    const mockVocalRange: VocalRangeData = {
      lowest_note: 'C#3',
      highest_note: 'E4',
      lowest_hz: 140.6,
      highest_hz: 332.7,
      tessitura_low_note: 'B3',
      tessitura_high_note: 'D#4',
      tessitura_low_hz: 246.9,
      tessitura_high_hz: 311.1,
      median_note: 'C#4',
      median_hz: 279.9,
      estimated_key: 'C# Minor',
      key_confidence: 0.88,
      is_voiced: true,
    };

    it('displays detected vocal range badge when vocalRange is passed', () => {
      render(<AudioControls {...defaultProps} vocalRange={mockVocalRange} />);

      expect(screen.getByText(/C#3–E4/i)).toBeInTheDocument();
      expect(screen.getByText(/C# Minor/i)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /open smart key recommender/i })
      ).toBeInTheDocument();
    });

    it('opens Smart Key Recommender modal when button is clicked', async () => {
      const user = userEvent.setup();
      render(<AudioControls {...defaultProps} vocalRange={mockVocalRange} />);

      await user.click(screen.getByRole('button', { name: /open smart key recommender/i }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Smart Key Recommender')).toBeInTheDocument();
    });

    it('applies transposition from the modal and auto-applies the mix', async () => {
      const user = userEvent.setup();
      const onMixChange = vi.fn().mockResolvedValue(undefined);
      render(
        <AudioControls
          {...defaultProps}
          vocalRange={mockVocalRange}
          onMixChange={onMixChange}
          mixDebounceMs={0}
        />
      );

      await user.click(screen.getByRole('button', { name: /open smart key recommender/i }));
      await user.click(screen.getByRole('radio', { name: /^soprano$/i }));
      await user.click(screen.getByRole('button', { name: /apply transposition/i }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() => expect(onMixChange).toHaveBeenCalled());
      expect(screen.getByTestId('pitch-readout-caption')).not.toHaveTextContent('Original key');
    });

    it('propagates recommender keys to a controlled parent', async () => {
      const user = userEvent.setup();
      const Harness = () => {
        const [semitones, setSemitones] = useState(0);
        return (
          <AudioControls
            projectId="p1"
            semitones={semitones}
            guideVolume={0}
            onSemitonesChange={setSemitones}
            vocalRange={mockVocalRange}
          />
        );
      };
      render(<Harness />);

      await user.click(screen.getByRole('button', { name: /open smart key recommender/i }));
      await user.click(screen.getByRole('radio', { name: /^soprano$/i }));
      await user.click(screen.getByRole('button', { name: /apply transposition/i }));

      expect(screen.getByTestId('pitch-readout-caption')).not.toHaveTextContent('Original key');
    });
  });
});

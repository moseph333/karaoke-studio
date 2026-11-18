import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WaveformScrubber } from '../../components/audio/WaveformScrubber';

/** A 100 s song on a scrubber that spans x = 0…400, so 4 px is one second. */
function renderScrubber() {
  const onSeek = vi.fn();
  render(<WaveformScrubber currentTime={0} duration={100} onSeek={onSeek} />);
  const scrubber = screen.getByTestId('waveform-scrubber');
  vi.spyOn(scrubber, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 56));
  return { onSeek, scrubber };
}

describe('WaveformScrubber drags that never get a pointerup', () => {
  it('does not seek or start a drag on a right or middle press', () => {
    const { onSeek, scrubber } = renderScrubber();

    fireEvent.pointerDown(scrubber, { clientX: 200, pointerId: 1, button: 2 });
    // The context menu swallows the release; the mouse then moves over the waveform
    fireEvent.pointerMove(scrubber, { clientX: 300, pointerId: 1 });
    fireEvent.pointerDown(scrubber, { clientX: 100, pointerId: 1, button: 1 });
    fireEvent.pointerMove(scrubber, { clientX: 300, pointerId: 1 });

    expect(onSeek).not.toHaveBeenCalled();
  });

  it('ends the drag when the pointer capture is lost', () => {
    const { onSeek, scrubber } = renderScrubber();

    fireEvent.pointerDown(scrubber, { clientX: 200, pointerId: 1, button: 0 });
    expect(onSeek).toHaveBeenLastCalledWith(50);
    fireEvent.lostPointerCapture(scrubber, { pointerId: 1 });
    onSeek.mockClear();

    fireEvent.pointerMove(scrubber, { clientX: 300, pointerId: 1 });

    expect(onSeek).not.toHaveBeenCalled();
  });

  it('still scrubs with the primary button', () => {
    const { onSeek, scrubber } = renderScrubber();

    fireEvent.pointerDown(scrubber, { clientX: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(scrubber, { clientX: 300, pointerId: 1 });

    expect(onSeek).toHaveBeenLastCalledWith(75);
  });
});

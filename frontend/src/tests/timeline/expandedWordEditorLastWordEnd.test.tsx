import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ExpandedWordEditor } from '../../components/timeline/ExpandedWordEditor';

const line = {
  id: 7,
  text: 'one two',
  start_time: 10,
  end_time: 13,
  words: [
    { word: 'one', start_time: 10, end_time: 11 },
    { word: 'two', start_time: 11.5, end_time: 13 },
  ],
};

function renderEditor(playhead?: number) {
  const onUpdateWordTiming = vi.fn();
  render(
    <ExpandedWordEditor
      line={line}
      activeWordLoc={null}
      currentTime={playhead}
      onWordClick={vi.fn()}
      onNudgeWord={vi.fn()}
      onNudgeWordBoundary={vi.fn()}
      onUpdateWordTiming={onUpdateWordTiming}
    />
  );
  return onUpdateWordTiming;
}

describe("the end of a line's last word", () => {
  it('can be typed past where the line ends now', () => {
    const onUpdate = renderEditor();
    const end = screen.getByLabelText('End time for word two');

    fireEvent.change(end, { target: { value: '14.5' } });
    fireEvent.blur(end);

    expect(onUpdate).toHaveBeenCalledWith(7, 1, 'end_time', 14.5);
  });

  it('can be stepped later with the arrow key', () => {
    const onUpdate = renderEditor();

    fireEvent.keyDown(screen.getByLabelText('End time for word two'), { key: 'ArrowUp' });

    expect(onUpdate).toHaveBeenCalledWith(7, 1, 'end_time', 13.05);
  });

  it('snaps to a playhead that is past the end of the line', () => {
    const onUpdate = renderEditor(15.2);

    fireEvent.click(screen.getByRole('button', { name: 'Snap end of word two to playhead' }));

    expect(onUpdate).toHaveBeenCalledWith(7, 1, 'end_time', 15.2);
  });

  it('still stops an earlier word at the start of the next one', () => {
    const onUpdate = renderEditor();
    const end = screen.getByLabelText('End time for word one');

    fireEvent.change(end, { target: { value: '12' } });
    fireEvent.blur(end);

    expect(onUpdate).toHaveBeenCalledWith(7, 0, 'end_time', 11.5);
  });
});

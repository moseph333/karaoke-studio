import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DuetAssignmentModal } from '../../components/timeline/DuetAssignmentModal';
import type { LyricLine } from '../../types';

const lines: LyricLine[] = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  text: `line ${i + 1}`,
  start_time: i * 2,
  end_time: i * 2 + 1.5,
  words: [],
}));

/** Opens the Range tab's custom range with line 5 selected, so From and To start at 5 and 20. */
function openCustomRange() {
  const onApply = vi.fn();
  render(
    <DuetAssignmentModal
      isOpen
      onClose={vi.fn()}
      lines={lines}
      onApply={onApply}
      selectedLineIndex={4}
    />
  );
  fireEvent.click(screen.getByRole('tab', { name: /Range/i }));
  fireEvent.click(screen.getByText(/Custom Range/i));
  return onApply;
}

const apply = () => fireEvent.click(screen.getByTestId('apply-duet-btn'));

describe('typing a line number in the duet range', () => {
  it('takes a "To" number whose first digit is below the "From" line', async () => {
    const user = userEvent.setup();
    const onApply = openCustomRange();
    const to = screen.getByLabelText(/To Line #/i);

    await user.clear(to);
    await user.type(to, '12');

    expect(to).toHaveValue(12);
    apply();
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ startLineIndex: 4, endLineIndex: 11 })
    );
  });

  it('takes a retyped "From" number instead of appending to the old one', async () => {
    const user = userEvent.setup();
    const onApply = openCustomRange();
    const from = screen.getByLabelText(/From Line #/i);

    await user.clear(from);
    await user.type(from, '3');

    expect(from).toHaveValue(3);
    apply();
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ startLineIndex: 2 }));
  });

  it('brings a number outside the song back into range when the field is left', async () => {
    const user = userEvent.setup();
    openCustomRange();
    const from = screen.getByLabelText(/From Line #/i);
    const to = screen.getByLabelText(/To Line #/i);

    await user.clear(from);
    await user.type(from, '99');
    await user.tab();
    expect(from).toHaveValue(20);

    await user.clear(to);
    await user.tab();
    expect(to).toHaveValue(20);
  });

  it('puts a "To" below "From" back on the "From" line when the field is left', async () => {
    const user = userEvent.setup();
    const onApply = openCustomRange();
    const to = screen.getByLabelText(/To Line #/i);

    await user.clear(to);
    await user.type(to, '2');
    await user.tab();

    expect(to).toHaveValue(5);
    apply();
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ startLineIndex: 4, endLineIndex: 4 })
    );
  });
});

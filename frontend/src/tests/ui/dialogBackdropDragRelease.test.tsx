import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from '../../components/ui/Dialog';

function renderDialog() {
  const onClose = vi.fn();
  render(
    <Dialog open onClose={onClose} titleId="drag-title" testId="drag-dialog">
      <h2 id="drag-title">Rename</h2>
      <input aria-label="Name" defaultValue="A long song title" />
    </Dialog>
  );
  return { onClose, backdrop: screen.getByTestId('drag-dialog') };
}

// A browser reports a press inside the panel that is released on the backdrop as a click on
// the backdrop (the nearest element that contains both ends), which jsdom does not work out
// by itself: the tests fire the same events.
describe('Dialog backdrop dismissal', () => {
  it('stays open when a drag that began in the panel is released on the backdrop', () => {
    const { onClose, backdrop } = renderDialog();

    fireEvent.pointerDown(screen.getByLabelText('Name'));
    fireEvent.pointerUp(backdrop);
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on the next real backdrop click after such a drag', async () => {
    const user = userEvent.setup();
    const { onClose, backdrop } = renderDialog();

    fireEvent.pointerDown(screen.getByLabelText('Name'));
    fireEvent.click(backdrop);
    await user.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop itself is pressed and released', async () => {
    const user = userEvent.setup();
    const { onClose, backdrop } = renderDialog();

    await user.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not let a click inside the panel block the next backdrop click', async () => {
    const user = userEvent.setup();
    const { onClose, backdrop } = renderDialog();

    await user.click(screen.getByLabelText('Name'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

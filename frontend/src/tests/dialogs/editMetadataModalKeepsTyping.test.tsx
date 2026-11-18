import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EditMetadataModal } from '../../components/EditMetadataModal';

const noop = vi.fn();

/** Renders the modal the way its parents do: a new `project` object on every render. */
function modal(open: boolean, id = 'song-1', title = 'Old title') {
  return (
    <EditMetadataModal
      isOpen={open}
      project={{ id, title, artist: 'Old artist', part_names: {} }}
      onClose={noop}
      onSaved={noop}
    />
  );
}

describe('EditMetadataModal while its parent re-renders', () => {
  it('keeps what was typed when the parent passes a fresh project object', () => {
    const { rerender } = render(modal(true));
    fireEvent.change(screen.getByLabelText('Track Title'), { target: { value: 'New title' } });
    fireEvent.change(screen.getByLabelText('Singer 1 name'), { target: { value: 'Miho' } });

    // A library poll re-renders the parent with the same song
    rerender(modal(true));

    expect(screen.getByLabelText('Track Title')).toHaveValue('New title');
    expect(screen.getByLabelText('Singer 1 name')).toHaveValue('Miho');
  });

  it('starts from the saved details again when it is reopened', () => {
    const { rerender } = render(modal(true));
    fireEvent.change(screen.getByLabelText('Track Title'), { target: { value: 'Abandoned' } });

    rerender(modal(false));
    rerender(modal(true));

    expect(screen.getByLabelText('Track Title')).toHaveValue('Old title');
  });

  it('shows the other song when the open dialog is given a different one', () => {
    const { rerender } = render(modal(true));
    fireEvent.change(screen.getByLabelText('Track Title'), { target: { value: 'Typed' } });

    rerender(modal(true, 'song-2', 'Second song'));

    expect(screen.getByLabelText('Track Title')).toHaveValue('Second song');
  });
});

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InlineConfirm } from '../../components/ui/InlineConfirm';

const renderConfirm = (onConfirm = vi.fn()) => {
  render(
    <InlineConfirm
      message="Cancel the render? Its progress will be lost."
      confirmLabel="Confirm Cancel Render"
      keepLabel="Keep Rendering"
      onConfirm={onConfirm}
      renderTrigger={(trigger) => (
        <button ref={trigger.ref} type="button" onClick={trigger.onClick}>
          Cancel Render
        </button>
      )}
    />
  );
  return onConfirm;
};

describe('InlineConfirm', () => {
  it('asks in place, focusing the safe choice, and keeping returns focus to the trigger', () => {
    const onConfirm = renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Render' }));

    expect(
      screen.getByRole('alertdialog', { name: 'Cancel the render? Its progress will be lost.' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep Rendering' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Keep Rendering' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel Render' })).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms', () => {
    const onConfirm = renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Render' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Cancel Render' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('draws the confirm button like the destructive button, inverse text on danger', () => {
    renderConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Render' }));
    const confirm = screen.getByRole('button', { name: 'Confirm Cancel Render' });
    expect(confirm).toHaveClass('bg-theme-danger', 'text-theme-text-inverse');
    expect(confirm).not.toHaveClass('text-white');
  });
});

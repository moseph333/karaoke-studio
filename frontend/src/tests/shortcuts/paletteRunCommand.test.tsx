/**
 * Running a palette command by id: guidance (the song check-up, Help's fixes) opens the
 * studio's tools through the commands their components register, without the palette open.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPaletteProvider } from '../../components/commandPalette/CommandPaletteProvider';
import {
  PaletteCommand,
  useCommandPalette,
  useRegisterCommands,
} from '../../components/commandPalette/context';

const Registrar: React.FC<{ commands: PaletteCommand[] | null }> = ({ commands }) => {
  useRegisterCommands('test', commands);
  return null;
};

const Runner: React.FC<{ id: string; onResult: (ran: boolean) => void }> = ({ id, onResult }) => {
  const palette = useCommandPalette();
  return (
    <button type="button" onClick={() => onResult(Boolean(palette?.runCommand(id)))}>
      Run
    </button>
  );
};

describe('runCommand', () => {
  it('runs the registered command and reports that it did', async () => {
    const run = vi.fn();
    const onResult = vi.fn();
    render(
      <CommandPaletteProvider>
        <Registrar commands={[{ id: 'lyrics-replace', title: 'Replace', group: 'Lyrics', run }]} />
        <Runner id="lyrics-replace" onResult={onResult} />
      </CommandPaletteProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(true);
    // The palette itself stays closed
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reports false for a command nothing offers right now', async () => {
    const run = vi.fn();
    const onResult = vi.fn();
    render(
      <CommandPaletteProvider>
        <Registrar commands={[{ id: 'lyrics-replace', title: 'Replace', group: 'Lyrics', run }]} />
        <Runner id="lyrics-review-show" onResult={onResult} />
      </CommandPaletteProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(run).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(false);
  });

  it('runs the command as it is registered now, not as it was first registered', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const tree = (run: () => void) => (
      <CommandPaletteProvider>
        <Registrar commands={[{ id: 'lyrics-offset', title: 'Offset', group: 'Lyrics', run }]} />
        <Runner id="lyrics-offset" onResult={() => undefined} />
      </CommandPaletteProvider>
    );
    const { rerender } = render(tree(first));
    rerender(tree(latest));

    await userEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });
});

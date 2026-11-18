/**
 * Guidance buttons that open one of the timeline's tools: the timeline tab is selected
 * first (on a phone the tool's dialog lives in that panel, hidden otherwise), and when the
 * tool is not on offer the message says the real reason.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPaletteProvider } from '../../components/commandPalette/CommandPaletteProvider';
import { PaletteCommand, useRegisterCommands } from '../../components/commandPalette/context';
import { ToastProvider } from '../../hooks/useToast';
import { GuideActionTargets, useGuideActions } from '../../hooks/useGuideActions';
import type { GuideAction } from '../../utils/guideActions';
import type { LyricLine, ProjectState } from '../../types';

const line: LyricLine = { id: 1, text: 'one', start_time: 1, end_time: 2, words: [] };
const song = (lines: LyricLine[]): ProjectState =>
  ({ id: 'song1', status: 'ready', lines }) as unknown as ProjectState;

const Harness: React.FC<{
  action: GuideAction;
  targets: GuideActionTargets;
  commands: PaletteCommand[];
}> = ({ action, targets, commands }) => {
  useRegisterCommands('timeline', commands);
  const run = useGuideActions(targets);
  return (
    <button type="button" onClick={() => run(action)}>
      Go
    </button>
  );
};

function setup(action: GuideAction, project: ProjectState, commandIds: string[]) {
  const order: string[] = [];
  const targets: GuideActionTargets = {
    project,
    isPlaying: false,
    onTogglePlay: vi.fn(),
    onSeek: vi.fn(),
    onSelectTab: (tab) => order.push(`tab:${tab}`),
    onOpenMix: vi.fn(),
    onOpenExport: vi.fn(),
    onOpenCheckup: vi.fn(),
    onOpenHelpFix: vi.fn(),
    onCloseGuidance: () => order.push('close'),
  };
  const commands = commandIds.map((id) => ({
    id,
    title: id,
    group: 'Lyrics',
    run: () => {
      order.push(`run:${id}`);
    },
  }));
  render(
    <ToastProvider>
      <CommandPaletteProvider>
        <Harness action={action} targets={targets} commands={commands} />
      </CommandPaletteProvider>
    </ToastProvider>
  );
  return order;
}

describe('guide actions that open a timeline tool', () => {
  it.each([
    ['find-lyrics', 'lyrics-replace'],
    ['offset', 'lyrics-offset'],
    ['duet', 'lyrics-duet'],
    ['realign-all', 'lyrics-realign-all'],
  ] as const)('%s selects the timeline tab, then opens the tool', async (action, command) => {
    const order = setup(action, song([line]), [command]);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(order).toEqual(['close', 'tab:timeline', `run:${command}`]);
  });

  it('leaves the tab alone for the stems dialog, which is not in the timeline', async () => {
    const order = setup('improve-stems', song([line]), ['stems-improve']);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(order).toEqual(['close', 'run:stems-improve']);
  });

  it('says a song without lyrics has nothing to re-time', async () => {
    setup('realign-all', song([]), []);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(await screen.findByText(/no lyrics to re-time yet/)).toBeInTheDocument();
    expect(screen.queryByText(/already being re-timed/)).toBeNull();
  });

  it('says a re-timing is already running when the song has lyrics', async () => {
    setup('realign-all', song([line]), []);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(await screen.findByText(/already being re-timed/)).toBeInTheDocument();
  });
});

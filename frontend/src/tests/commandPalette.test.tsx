/**
 * Command palette: ranking, the Ctrl/⌘+K shortcut, combobox/listbox semantics, keyboard
 * navigation, recents, live sources, and the studio commands registered by the app.
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { rankItems, scoreText } from '../components/commandPalette/fuzzy';
import { CommandPaletteProvider } from '../components/commandPalette/CommandPaletteProvider';
import {
  PaletteCommand,
  PaletteSource,
  useCommandPalette,
  useRegisterCommandSource,
  useRegisterCommands,
} from '../components/commandPalette/context';
import { PALETTE_RECENT_STORAGE_KEY } from '../components/commandPalette/recent';
import App from '../App';
import { ProjectState } from '../types';

describe('palette ranking', () => {
  it('ranks prefix > word start > substring > subsequence', () => {
    const prefix = scoreText('play', 'Play')!;
    const wordStart = scoreText('play', 'Resume play')!;
    const substring = scoreText('lay', 'Play')!;
    const subsequence = scoreText('pbs', 'Playback speed')!;
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
    expect(scoreText('xyz', 'Play')).toBeNull();
  });

  it('rejects letters scattered across a long title', () => {
    expect(scoreText('glow', 'City lights are humming low tonight')).toBeNull();
    expect(scoreText('glow', 'Every window glowing like a sign')).not.toBeNull();
  });

  it('ignores case and accents and prefers shorter titles', () => {
    expect(scoreText('cafe', 'Café del Mar')).not.toBeNull();
    const items = [{ title: 'Playback speed 0.5x' }, { title: 'Play' }, { title: 'Display' }];
    expect(rankItems('play', items).map((i) => i.title)).toEqual([
      'Play',
      'Playback speed 0.5x',
      'Display',
    ]);
  });

  it('searches keywords and caps the result count', () => {
    expect(rankItems('tempo', [{ title: 'Playback speed 1x', keywords: ['tempo'] }])).toHaveLength(
      1
    );
    const many = Array.from({ length: 80 }, (_, i) => ({ title: `Item ${i}` }));
    expect(rankItems('item', many)).toHaveLength(50);
  });
});

const makeCommands = (spies: Record<string, () => void>): PaletteCommand[] => [
  { id: 'play', title: 'Play', group: 'Playback', shortcut: ['Space'], run: spies.play },
  { id: 'mute', title: 'Mute', group: 'Playback', run: spies.mute },
  { id: 'key-up', title: 'Raise key', group: 'Mix', keepOpen: true, run: spies.keyUp },
  { id: 'help', title: 'Help & keyboard shortcuts', group: 'Help', run: spies.help },
];

const Registrar: React.FC<{ commands: PaletteCommand[]; source?: PaletteSource }> = ({
  commands,
  source,
}) => {
  useRegisterCommands('test', commands);
  useRegisterCommandSource(source ?? null);
  const palette = useCommandPalette();
  return (
    <button type="button" onClick={palette?.open}>
      Open palette
    </button>
  );
};

const pressModK = (init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true, ...init });

const getDialog = () => document.querySelector('[data-modal="command-palette"]');

describe('command palette', () => {
  let spies: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    spies = { play: vi.fn(), mute: vi.fn(), keyUp: vi.fn(), help: vi.fn() };
  });

  const renderPalette = (source?: PaletteSource) =>
    render(
      <CommandPaletteProvider>
        <Registrar commands={makeCommands(spies)} source={source} />
      </CommandPaletteProvider>
    );

  it('opens with Ctrl+K or ⌘K, toggles closed, and ignores other modifiers', () => {
    renderPalette();
    pressModK({ shiftKey: true });
    expect(getDialog()).toBeNull();
    pressModK({ repeat: true });
    expect(getDialog()).toBeNull();

    pressModK();
    expect(getDialog()).not.toBeNull();
    expect(
      screen.getByRole('combobox', { name: 'Search commands, songs, and lyrics' })
    ).toHaveFocus();
    pressModK();
    expect(getDialog()).toBeNull();

    pressModK({ ctrlKey: false, metaKey: true });
    expect(getDialog()).not.toBeNull();
  });

  it('stays closed while another dialog owns the keyboard', () => {
    render(
      <CommandPaletteProvider>
        <Registrar commands={makeCommands(spies)} />
        <div role="dialog" aria-modal="true" aria-label="Other" />
      </CommandPaletteProvider>
    );
    pressModK();
    expect(getDialog()).toBeNull();
  });

  it('wires the combobox to a grouped listbox and moves the active option with the keyboard', () => {
    renderPalette();
    pressModK();
    const input = screen.getByRole('combobox', { name: /search commands/i });
    const listbox = screen.getByRole('listbox');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(input).toHaveAttribute('aria-autocomplete', 'list');

    const options = within(listbox).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Play'),
      expect.stringContaining('Mute'),
      expect.stringContaining('Raise key'),
      expect.stringContaining('Help'),
    ]);
    expect(screen.getByRole('group', { name: 'Playback' })).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
    fireEvent.keyDown(input, { key: 'End' });
    expect(input).toHaveAttribute('aria-activedescendant', options[3].id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveAttribute('aria-activedescendant', options[3].id);
    fireEvent.keyDown(input, { key: 'Home' });
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);
    fireEvent.keyDown(input, { key: 'PageDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[3].id);
  });

  it('filters as you type, announces the count, and runs the chosen command after closing', async () => {
    vi.useFakeTimers();
    try {
      renderPalette();
      pressModK();
      const input = screen.getByRole('combobox', { name: /search commands/i });
      fireEvent.change(input, { target: { value: 'mut' } });
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent('Mute');
      expect(
        screen.getByText('1 result', { selector: '[aria-live="polite"]' })
      ).toBeInTheDocument();

      fireEvent.keyDown(input, { key: 'Enter' });
      expect(getDialog()).toBeNull();
      expect(spies.mute).not.toHaveBeenCalled();
      await act(async () => {
        vi.runAllTimers();
      });
      expect(spies.mute).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows an empty state when nothing matches', () => {
    renderPalette();
    pressModK();
    fireEvent.change(screen.getByRole('combobox', { name: /search commands/i }), {
      target: { value: 'zzzz' },
    });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/No matches for/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /search commands/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('keeps the palette open for repeatable commands', async () => {
    renderPalette();
    pressModK();
    fireEvent.click(screen.getByRole('option', { name: /Raise key/ }));
    expect(getDialog()).not.toBeNull();
    await waitFor(() => expect(spies.keyUp).toHaveBeenCalledTimes(1));
  });

  it('lists recently run commands first', async () => {
    renderPalette();
    pressModK();
    fireEvent.click(screen.getByRole('option', { name: /Help & keyboard shortcuts/ }));
    await waitFor(() => expect(spies.help).toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem(PALETTE_RECENT_STORAGE_KEY) || '[]')).toEqual(['help']);

    pressModK();
    const recent = screen.getByRole('group', { name: 'Recent' });
    expect(within(recent).getByRole('option')).toHaveTextContent('Help & keyboard shortcuts');
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Help & keyboard shortcuts');
  });

  it('closes with Escape and returns focus to where it was', async () => {
    const user = userEvent.setup();
    renderPalette();
    const opener = screen.getByRole('button', { name: 'Open palette' });
    await user.click(opener);
    expect(getDialog()).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(getDialog()).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('queries sources once the query is long enough and merges their results', async () => {
    const load = vi.fn((q: string) => [
      {
        id: `line:${q}`,
        title: 'Every window glowing like a sign',
        group: 'Lyric lines',
        run: vi.fn(),
      },
    ]);
    const warm = vi.fn();
    renderPalette({ id: 'lines', group: 'Lyric lines', minQueryLength: 2, warm, load });
    pressModK();
    expect(warm).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole('combobox', { name: /search commands/i }), {
      target: { value: 'w' },
    });
    expect(load).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('combobox', { name: /search commands/i }), {
      target: { value: 'window' },
    });
    expect(await screen.findByRole('option', { name: /Every window glowing/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Lyric lines' })).toBeInTheDocument();
    expect(load).toHaveBeenLastCalledWith('window', expect.any(AbortSignal));
  });

  it('drops commands when their component unmounts', () => {
    const Toggle: React.FC = () => {
      const [shown, setShown] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setShown(false)}>
            Unmount
          </button>
          {shown && <Registrar commands={makeCommands(spies)} />}
        </>
      );
    };
    render(
      <CommandPaletteProvider>
        <Toggle />
      </CommandPaletteProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unmount' }));
    pressModK();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});

describe('studio commands', () => {
  const project: ProjectState = {
    id: 'palette-proj',
    title: 'Palette Anthem',
    artist: 'The Shortcuts',
    status: 'ready',
    progress: 100,
    duration: 64,
    lines: [
      { id: 1, text: 'First line of the song', start_time: 2, end_time: 6, words: [] },
      { id: 2, text: 'Every window glowing like a sign', start_time: 7, end_time: 11, words: [] },
    ],
    semitones: 0,
    guide_volume: 0,
    master_audio_url: '/static/output/palette_master.wav',
  };
  const other: ProjectState = { ...project, id: 'other-proj', title: 'Second Song', lines: [] };

  beforeEach(() => {
    window.history.pushState({}, '', '/?project=palette-proj');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes('/api/auth/status')) {
        return new Response(JSON.stringify({ auth_required: false, authenticated: true }));
      }
      if (u.includes('/api/projects')) {
        return new Response(
          JSON.stringify({ [project.id]: project, [other.id]: other, alias: other })
        );
      }
      if (u.includes('/api/project/palette-proj')) return new Response(JSON.stringify(project));
      return new Response('{}');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  const openStudio = async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText('Palette Anthem')).toBeInTheDocument());
  };

  it('offers playback, stage and theme commands and runs them', async () => {
    await openStudio();
    fireEvent.click(screen.getByRole('button', { name: /open command palette/i }));
    const input = screen.getByRole('combobox', { name: /search commands/i });
    expect(screen.getByRole('option', { name: /^Play\s?Space$/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /App theme: Afterglow/ })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'show beat visualizer' } });
    fireEvent.click(screen.getByRole('option', { name: /Show beat visualizer/ }));
    await waitFor(() =>
      expect(screen.getByTestId('toggle-visualizer-btn')).toHaveAttribute('aria-pressed', 'true')
    );
  });

  it('jumps to a lyric line found by text search', async () => {
    await openStudio();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByRole('combobox', { name: /search commands/i }), {
      target: { value: 'window glowing' },
    });
    const option = await screen.findByRole('option', { name: /Every window glowing/ });
    expect(option).toHaveTextContent('Line 2');
    fireEvent.click(option);
    await waitFor(() => expect(getDialog()).toBeNull());
  });

  it('finds other songs in the library without duplicates', async () => {
    await openStudio();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByRole('combobox', { name: /search commands/i }), {
      target: { value: 'second' },
    });
    const songs = await screen.findAllByRole('option', { name: /Second Song/ });
    expect(songs).toHaveLength(1);
    fireEvent.click(songs[0]);
    await waitFor(() => expect(screen.queryByText('Palette Anthem')).not.toBeInTheDocument());
  });
});

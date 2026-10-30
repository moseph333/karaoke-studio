/**
 * Studio accessible-name uniqueness guard.
 *
 * With css:false every responsive variant lives in the accessibility tree at once, so a
 * control rendered twice (e.g. a mobile copy plus a desktop copy) produces two elements
 * with the same role and name. Assistive technology users then hear duplicate controls,
 * and tests can no longer address a control unambiguously. This suite renders the full
 * studio and fails on any duplicated (role, accessible name) pair.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from '../App';
import { ProjectState } from '../types';
import { setTestViewport, resetTestViewport } from './helpers/responsiveTestUtils';

const INTERACTIVE_ROLES = [
  'button',
  'link',
  'slider',
  'radio',
  'checkbox',
  'switch',
  'tab',
  'combobox',
  'textbox',
  'spinbutton',
  'menuitem',
  'option',
] as const;

const project: ProjectState = {
  id: 'uniq-proj',
  title: 'Uniqueness Anthem',
  artist: 'The Guards',
  status: 'ready',
  progress: 100,
  duration: 64,
  lines: [
    {
      id: 1,
      text: 'Sing it once sing it twice',
      start_time: 2,
      end_time: 6,
      words: [
        { word: 'Sing', start_time: 2, end_time: 2.6 },
        { word: 'it', start_time: 2.6, end_time: 3 },
        { word: 'once', start_time: 3, end_time: 3.8 },
        { word: 'sing', start_time: 3.8, end_time: 4.6 },
        { word: 'it', start_time: 4.6, end_time: 5 },
        { word: 'twice', start_time: 5, end_time: 6 },
      ],
    },
    {
      id: 2,
      text: 'Every control has one name',
      start_time: 7,
      end_time: 11,
      singer: 'singer2',
      words: [
        { word: 'Every', start_time: 7, end_time: 7.8 },
        { word: 'control', start_time: 7.8, end_time: 8.8 },
        { word: 'has', start_time: 8.8, end_time: 9.4 },
        { word: 'one', start_time: 9.4, end_time: 10 },
        { word: 'name', start_time: 10, end_time: 11 },
      ],
    },
  ],
  semitones: 1,
  guide_volume: 0.2,
  master_audio_url: '/static/output/uniq_master.wav',
  instrumental_url: '/static/stems/uniq/no_vocals.wav',
  vocals_url: '/static/stems/uniq/vocals.wav',
  chords: [
    { start: 2, end: 6, chord: 'C' },
    { start: 7, end: 11, chord: 'Am' },
  ],
};

/** Per-word controls legitimately repeat when a word repeats in the lyrics. */
const isWordLevelControl = (name: string) =>
  /\bword\b/i.test(name) || /^(jump to|seek to) /i.test(name);

let lastControlCount = 0;

function collectDuplicates(): string[] {
  const seen = new Map<string, number>();
  for (const role of INTERACTIVE_ROLES) {
    screen.queryAllByRole(role, {
      name: (accessibleName: string) => {
        const key = `${role} "${accessibleName}"`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        return true;
      },
    });
  }
  lastControlCount = [...seen.values()].reduce((a, b) => a + b, 0);
  return [...seen.entries()]
    .filter(([key, count]) => {
      if (count < 2) return false;
      const name = key.slice(key.indexOf('"') + 1, -1);
      return name !== '' && !isWordLevelControl(name);
    })
    .map(([key, count]) => `${key} ×${count}`);
}

describe('Studio accessible-name uniqueness', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/?project=uniq-proj');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes('/api/auth/status')) {
        return new Response(JSON.stringify({ auth_required: false, authenticated: true }), {
          status: 200,
        });
      }
      if (u.includes('/api/project/uniq-proj')) {
        return new Response(JSON.stringify(project), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
  });

  afterEach(() => {
    resetTestViewport();
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  for (const [label, width, height] of [
    ['phone', 375, 812],
    ['desktop', 1280, 800],
  ] as const) {
    it(`has no duplicated (role, name) pairs in the studio at ${label} width (${width}px)`, async () => {
      setTestViewport(width, height);
      render(<App />);
      await waitFor(() => expect(screen.getByText('Uniqueness Anthem')).toBeInTheDocument());

      expect(collectDuplicates()).toEqual([]);
      // Sanity check: the scan really walked the studio controls
      expect(lastControlCount).toBeGreaterThan(40);

      // Every mobile tab exposes the same single set of controls
      for (const tab of ['Timeline', 'Mix & Theme', 'Stage']) {
        fireEvent.click(screen.getByRole('tab', { name: new RegExp(tab, 'i') }));
        expect(collectDuplicates(), `after selecting ${tab}`).toEqual([]);
      }
    });
  }

  it('exposes exactly one primary control per transport function', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText('Uniqueness Anthem')).toBeInTheDocument());

    expect(screen.getAllByRole('button', { name: /^(start|pause) playback$/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Restart track from beginning' })).toHaveLength(1);
    expect(screen.getAllByRole('slider', { name: 'Audio timeline position' })).toHaveLength(1);
    expect(screen.getAllByRole('slider', { name: 'Master volume' })).toHaveLength(1);
    expect(screen.getAllByRole('radiogroup', { name: 'Playback speed' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /increase pitch/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Open export dialog' })).toHaveLength(1);
    expect(screen.getAllByTestId('toggle-visualizer-btn')).toHaveLength(1);
    expect(screen.getAllByTestId('chord-bar-toggle')).toHaveLength(1);
    expect(screen.getAllByTestId('audio-element')).toHaveLength(1);
  });
});

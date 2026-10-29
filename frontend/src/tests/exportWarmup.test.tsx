/**
 * Opening the export dialog asks the server, with a beacon, to start a cloud CPU so a cloud
 * render can begin as soon as Render is clicked. The server ignores it for local renders.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { ExportModal } from '../components/ExportModal';
import { ProjectState } from '../types';

const project: ProjectState = {
  id: 'warmup-song',
  status: 'ready',
  progress: 100,
  title: 'Golden Hour',
  artist: 'The Night Shift',
  lines: [{ id: 1, start_time: 0, end_time: 2, text: 'Hello there', words: [] }],
  semitones: 0,
  guide_volume: 0,
  render_status: 'idle',
  render_progress: 0,
};

const originalBeacon = Object.getOwnPropertyDescriptor(navigator, 'sendBeacon');

function stubBeacon(impl: (url: string) => boolean = () => true) {
  const beacon = vi.fn(impl);
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon });
  return beacon;
}

afterEach(() => {
  if (originalBeacon) Object.defineProperty(navigator, 'sendBeacon', originalBeacon);
  else delete (navigator as { sendBeacon?: unknown }).sendBeacon;
  vi.restoreAllMocks();
});

describe('export dialog cloud CPU warm-up', () => {
  it('sends one warm-up beacon each time the dialog opens', () => {
    const beacon = stubBeacon();
    const { rerender } = render(<ExportModal project={project} isOpen={false} onClose={vi.fn()} />);
    expect(beacon).not.toHaveBeenCalled();

    rerender(<ExportModal project={project} isOpen onClose={vi.fn()} />);
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon).toHaveBeenCalledWith('/api/render/warmup');

    // Changes while it stays open don't send another
    rerender(<ExportModal project={{ ...project, semitones: 2 }} isOpen onClose={vi.fn()} />);
    expect(beacon).toHaveBeenCalledTimes(1);

    rerender(<ExportModal project={project} isOpen={false} onClose={vi.fn()} />);
    rerender(<ExportModal project={project} isOpen onClose={vi.fn()} />);
    expect(beacon).toHaveBeenCalledTimes(2);
  });

  it('opens normally when the beacon fails or the browser has none', () => {
    stubBeacon(() => {
      throw new Error('beacon blocked');
    });
    expect(() => render(<ExportModal project={project} isOpen onClose={vi.fn()} />)).not.toThrow();

    delete (navigator as { sendBeacon?: unknown }).sendBeacon;
    expect(() => render(<ExportModal project={project} isOpen onClose={vi.fn()} />)).not.toThrow();
  });
});

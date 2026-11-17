/**
 * What a new user is told to expect before a song is finished: on the home screen's "How it
 * works" steps and on the processing screen.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ProcessingView } from '../../components/ProcessingView';
import { TrackSearch } from '../../components/TrackSearch';
import type { ProjectState } from '../../types';

const processing: ProjectState = {
  id: 'p',
  status: 'separating',
  progress: 30,
  lines: [],
  semitones: 0,
  guide_volume: 0,
};

const serveLibrary = (entries: Record<string, unknown>) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify(entries), { status: 200 }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the processing screen', () => {
  it('says how long it takes, that the page can be left and that results may need a fix', () => {
    render(
      <ProcessingView project={processing} onCancelProcess={vi.fn()} onResetProject={vi.fn()} />
    );

    const section = screen.getByRole('region', { name: 'What to expect' });
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/Most songs take a few minutes/);
    expect(items[1]).toHaveTextContent(/You do not have to wait here/);
    expect(items[2]).toHaveTextContent(/now and then a lyric is wrong or a line is out of time/);
    expect(items[2]).toHaveTextContent(/The studio marks what to check and has a fix for each/);
    // Fixed text, not part of the live region that announces each stage
    expect(screen.getByRole('status')).not.toContainElement(section);
  });

  it('keeps the page heading first, then the expectations as a section heading', () => {
    render(
      <ProcessingView project={processing} onCancelProcess={vi.fn()} onResetProject={vi.fn()} />
    );
    const levels = screen.getAllByRole('heading').map((h) => h.tagName);
    expect(levels[0]).toBe('H1');
    expect(screen.getByRole('heading', { name: 'What to expect' }).tagName).toBe('H2');
  });

  it.each(['error', 'cancelled'] as const)('leaves them off the %s screen', (status) => {
    render(
      <ProcessingView
        project={{ ...processing, status, error: 'boom' }}
        onCancelProcess={vi.fn()}
        onResetProject={vi.fn()}
      />
    );
    expect(screen.queryByTestId('processing-expectations')).toBeNull();
  });
});

describe('the home screen', () => {
  it('tells a first-time visitor how long a song takes and that results may need a fix', async () => {
    serveLibrary({});
    render(<TrackSearch onSelectTrack={vi.fn()} isLoading={false} currentUser="Alex" />);

    const how = screen.getByRole('region', { name: 'How it works' });
    expect(within(how).getAllByRole('listitem')[1]).toHaveTextContent(
      /Most songs take a few minutes; the best stem quality and a server’s first song take longer/
    );
    expect(within(how).getByTestId('how-it-works-expectations')).toHaveTextContent(
      /now and then a lyric is wrong or a line is out of time/
    );
    await screen.findByText('No songs yet');
  });

  it('does not repeat it to a returning visitor who has songs', async () => {
    localStorage.setItem('karaoke_has_songs', '1');
    serveLibrary({
      a: { id: 'a', title: 'Song a', status: 'ready', created_by: 'Alex', summary: true },
    });
    render(<TrackSearch onSelectTrack={vi.fn()} isLoading={false} currentUser="Alex" />);

    await screen.findByText('Song a');
    expect(screen.queryByTestId('how-it-works-expectations')).toBeNull();
  });
});

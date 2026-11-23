import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricDisplay } from '../../components/LyricDisplay';
import { EditMetadataModal } from '../../components/EditMetadataModal';
import { getStageLook } from '../../theme/stageLooks';
import type { LyricLine } from '../../types';

const mockApiFetch = vi.fn();
vi.mock('../../api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  readApiError: async (_res: unknown, fallback: string) => fallback,
}));

const lines: LyricLine[] = [
  { id: 1, text: 'I get metaphysical', start_time: 10, end_time: 13, singer: 'singer1', words: [] },
  { id: 2, text: "It's a good day", start_time: 13.5, end_time: 16, singer: 'singer2', words: [] },
];

const partNamesOnStage = () =>
  screen.getAllByTestId('stage-part-name').map((name) => name.textContent);

describe('named singer parts', () => {
  beforeEach(() => mockApiFetch.mockReset());

  it('show on the stage where the singer changes', () => {
    // 13.2 s: the first part's line is still on stage and the second part's is showing
    render(
      <LyricDisplay
        lines={lines}
        currentTime={13.2}
        partNames={{ singer1: 'Rapper', singer2: 'Miho' }}
        selectedTheme={getStageLook('ktv')}
      />
    );
    expect(partNamesOnStage()).toEqual(['Rapper', 'Miho']);
  });

  it('fall back to the default labels for unnamed parts', () => {
    render(
      <LyricDisplay
        lines={lines}
        currentTime={13.2}
        partNames={{ singer2: 'Miho' }}
        selectedTheme={getStageLook('ktv')}
      />
    );
    expect(partNamesOnStage()).toEqual(['Singer 1', 'Miho']);
  });

  it('are edited with the song details in the studio', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'meta',
        title: 'Metaphysical',
        artist: 'HBMS',
        part_names: { singer2: 'Miho' },
      }),
    });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <EditMetadataModal
        isOpen
        project={{ id: 'meta', title: 'Metaphysical', artist: 'HBMS', part_names: {} }}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );
    await user.type(screen.getByLabelText('Singer 2 name'), 'Miho');
    await user.click(screen.getByRole('button', { name: /Save Changes/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = JSON.parse(mockApiFetch.mock.calls[0][1].body);
    expect(body.part_names).toEqual({ singer1: '', singer2: 'Miho' });
    expect(onSaved.mock.calls[0][0]).toMatchObject({ part_names: { singer2: 'Miho' } });
  });

  it('are not offered from the library, which edits title and artist only', () => {
    render(
      <EditMetadataModal
        isOpen
        project={{ id: 'meta', title: 'Metaphysical', artist: 'HBMS' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(screen.queryByLabelText('Singer 2 name')).not.toBeInTheDocument();
  });
});

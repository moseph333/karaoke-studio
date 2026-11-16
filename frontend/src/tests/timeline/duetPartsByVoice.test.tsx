import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DuetAssignmentModal } from '../../components/timeline/DuetAssignmentModal';
import { useLyricEditorState } from '../../hooks/useLyricEditorState';
import type { LyricLine } from '../../types';

const mockApiFetch = vi.fn();
vi.mock('../../api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  readApiError: async (_res: unknown, fallback: string) => fallback,
}));

const lines: LyricLine[] = [
  { id: 1, text: 'Hyposes scientifical parabolus', start_time: 12.9, end_time: 17, words: [] },
  { id: 2, text: 'Chronicle moderate bisected', start_time: 17, end_time: 19.7, words: [] },
  { id: 3, text: 'I get metaphysical', start_time: 33, end_time: 37, words: [] },
  { id: 4, text: "It's a good day", start_time: 39.9, end_time: 43, words: [] },
];

function answer(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body });
}

function renderModal(onApply = vi.fn(), projectId = 'meta') {
  render(
    <DuetAssignmentModal
      isOpen
      onClose={vi.fn()}
      lines={lines}
      onApply={onApply}
      projectId={projectId}
    />
  );
  return onApply;
}

describe('assigning duet parts by voice', () => {
  beforeEach(() => mockApiFetch.mockReset());

  it('applies the parts the server heard', async () => {
    mockApiFetch.mockReturnValue(
      answer({
        detected: true,
        confidence: 0.7,
        lines_singer2: 1,
        reason: '11 semitones apart',
        parts: [
          { id: 1, singer: 'singer1' },
          { id: 2, singer: 'singer1' },
          { id: 3, singer: 'singer1' },
          { id: 4, singer: 'singer2' },
        ],
      })
    );
    const user = userEvent.setup();
    const onApply = renderModal();
    await user.click(screen.getByRole('tab', { name: /By Voice/i }));
    await waitFor(() =>
      expect(screen.getByTestId('duet-voice-status')).toHaveTextContent('Two voices found')
    );
    expect(mockApiFetch).toHaveBeenCalledWith('/api/project/meta/voice-parts');
    expect(screen.getByTestId('duet-preview-summary')).toHaveTextContent('Singer 21 (25%)');
    await user.click(screen.getByTestId('apply-duet-btn'));
    expect(onApply).toHaveBeenCalledWith({
      mode: 'voice',
      parts: { 1: 'singer1', 2: 'singer1', 3: 'singer1', 4: 'singer2' },
    });
  });

  it('offers nothing to apply when only one voice is heard', async () => {
    mockApiFetch.mockReturnValue(
      answer({ detected: false, confidence: 0.1, lines_singer2: 0, reason: 'one voice', parts: [] })
    );
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('tab', { name: /By Voice/i }));
    await waitFor(() =>
      expect(screen.getByTestId('duet-voice-status')).toHaveTextContent('No second voice')
    );
    expect(screen.getByTestId('apply-duet-btn')).toBeDisabled();
  });

  it('is not offered without a song to listen to', () => {
    renderModal(vi.fn(), '');
    expect(screen.queryByRole('tab', { name: /By Voice/i })).not.toBeInTheDocument();
  });

  it('the editor applies voice parts as one undoable edit', () => {
    const { result } = renderHook(() =>
      useLyricEditorState({ lines, currentTime: 0, duration: 60, onSaveLines: vi.fn() })
    );
    act(() => result.current.handleBulkAssignSinger({ mode: 'voice', parts: { 4: 'singer2' } }));
    expect(result.current.editableLines.map((l) => l.singer ?? 'singer1')).toEqual([
      'singer1',
      'singer1',
      'singer1',
      'singer2',
    ]);
    act(() => result.current.handleUndo());
    expect(result.current.editableLines[3].singer ?? 'singer1').toBe('singer1');
  });
});

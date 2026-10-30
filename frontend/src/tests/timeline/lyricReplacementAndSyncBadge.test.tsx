import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderHook, act } from '@testing-library/react';
import { LyricReplacementModal } from '../../components/timeline/LyricReplacementModal';
import { StudioMetaHeader } from '../../components/StudioMetaHeader';
import { ExpandedWordEditor } from '../../components/timeline/ExpandedWordEditor';
import { TimelineLineCard } from '../../components/timeline/TimelineLineCard';
import { useLyricEditorState } from '../../hooks/useLyricEditorState';
import { ProjectState, LyricLine } from '../../types';

// Mock API Fetch
const mockApiFetch = vi.fn();
vi.mock('../../api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// Mock Toast
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe('Milestone 2: UX-3 Candidate Search & Paste Inspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Live Paste Syntax Inspector detects Synced LRC and Plain Text dynamically', async () => {
    const user = userEvent.setup();
    render(
      <LyricReplacementModal
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-123"
        trackTitle="Test Song"
        trackArtist="Test Artist"
        onSuccess={vi.fn()}
      />
    );

    const textarea = screen.getByLabelText(/Lyric Text or LRC Timestamps/i);

    // 1. Plain text with 3 lines
    await user.type(textarea, 'First line\nSecond line\nThird line');

    expect(screen.getByTestId('paste-syntax-inspector')).toBeInTheDocument();
    expect(screen.queryByText(/✓ Synced LRC/i, { selector: 'span' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/ℹ Plain Text \(3 lines, will require alignment\)/i)
    ).toBeInTheDocument();

    // 2. Paste LRC timestamps
    fireEvent.change(textarea, {
      target: {
        value: '[00:12.34] First lyric line\n[00:16.78] Second lyric line',
      },
    });

    expect(screen.getByText(/✓ Synced LRC \(2 lines detected\)/i)).toBeInTheDocument();
  });

  it('searches LRCLIB candidates, displays formatted duration, and renders badges', async () => {
    const user = userEvent.setup();
    const mockCandidates = [
      {
        id: 101,
        track_name: 'Bohemian Rhapsody',
        artist_name: 'Queen',
        album_name: 'A Night at the Opera',
        duration: 354, // 5:54
        instrumental: false,
        plain_lyrics: 'Is this the real life?\nIs this just fantasy?',
        synced_lyrics: '[00:00.50] Is this the real life?\n[00:04.20] Is this just fantasy?',
      },
      {
        id: 102,
        track_name: 'Bohemian Rhapsody (Live)',
        artist_name: 'Queen',
        album_name: 'Live at Wembley',
        duration: 372, // 6:12
        instrumental: false,
        plain_lyrics: 'Is this the real life? Live wembley intro...',
        synced_lyrics: '',
      },
    ];

    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCandidates,
    });

    render(
      <LyricReplacementModal
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-123"
        trackTitle="Bohemian Rhapsody"
        trackArtist="Queen"
        onSuccess={vi.fn()}
      />
    );

    // Switch to LRCLIB Candidates tab
    const tabBtn = screen.getByRole('button', { name: /Re-query LRCLIB/i });
    await user.click(tabBtn);

    // Verify search form inputs
    const titleInput = screen.getByLabelText(/Track Title/i);
    const artistInput = screen.getByLabelText(/Artist Name/i);
    expect(titleInput).toHaveValue('Bohemian Rhapsody');
    expect(artistInput).toHaveValue('Queen');

    // Trigger candidate search
    const searchBtn = screen.getByRole('button', { name: /Search Candidates/i });
    await user.click(searchBtn);

    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/project/proj-123/lyrics/candidates')
    );

    // Check candidate cards rendered
    await waitFor(() => {
      expect(screen.getByText('A Night at the Opera', { exact: false })).toBeInTheDocument();
    });

    // Check formatted mm:ss duration
    expect(screen.getByText('5:54', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('6:12', { exact: false })).toBeInTheDocument();

    // Check badges
    const syncedBadge = screen.getByTestId('badge-synced-lrc');
    expect(syncedBadge).toHaveTextContent('[Synced LRC]');

    const plainBadge = screen.getByTestId('badge-plain-lyrics');
    expect(plainBadge).toHaveTextContent('[Plain Lyrics]');
  });

  it('expands accordion line preview and applies selected candidate lyrics', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    const mockCandidates = [
      {
        id: 201,
        track_name: 'Don’t Stop Me Now',
        artist_name: 'Queen',
        album_name: 'Jazz',
        duration: 209,
        plain_lyrics: 'Tonight I’m gonna have myself a real good time',
        synced_lyrics: '[00:10.00] Tonight I’m gonna have myself a real good time',
      },
    ];

    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCandidates,
    });

    render(
      <LyricReplacementModal
        isOpen={true}
        onClose={onClose}
        projectId="proj-123"
        trackTitle="Don’t Stop Me Now"
        trackArtist="Queen"
        onSuccess={onSuccess}
      />
    );

    await user.click(screen.getByRole('button', { name: /Re-query LRCLIB/i }));
    await user.click(screen.getByRole('button', { name: /Search Candidates/i }));
    await waitFor(() => {
      expect(screen.getByTestId('lyric-candidate-0')).toBeInTheDocument();
    });
    expect(screen.getByText('Jazz', { exact: false })).toBeInTheDocument();

    // Expand accordion line preview
    const previewBtn = screen.getByRole('button', { name: /Toggle line preview/i });
    await user.click(previewBtn);

    const previewContainer = screen.getByTestId('candidate-preview-0');
    expect(previewContainer).toBeInTheDocument();
    expect(previewContainer).toHaveTextContent(/Tonight I’m gonna have myself/i);

    // Apply This Candidate
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'ok',
        lines: [
          {
            id: 1,
            text: 'Tonight I’m gonna have myself a real good time',
            start_time: 10.0,
            end_time: 15.0,
            words: [],
          },
        ],
      }),
    });

    const applyBtn = screen.getByRole('button', { name: /Apply candidate/i });
    await user.click(applyBtn);

    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/project/proj-123/realign-lyrics',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          custom_lyrics: '[00:10.00] Tonight I’m gonna have myself a real good time',
          fetch_lrclib: false,
        }),
      })
    );

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});

describe('Milestone 2: Sync Status Badge in StudioMetaHeader', () => {
  const baseProject: ProjectState = {
    id: 'proj-1',
    title: 'Radio Ga Ga',
    artist: 'Queen',
    status: 'ready',
    progress: 100,
    lines: [],
    semitones: 0,
    guide_volume: 0,
  };

  it('renders Plain Lyrics badge when project has untimed or empty lines', () => {
    const { rerender } = render(
      <StudioMetaHeader
        project={{ ...baseProject, lines: [] }}
        onOpenEditModal={vi.fn()}
        onOpenDeleteModal={vi.fn()}
        onOpenExportModal={vi.fn()}
        onStartRender={vi.fn()}
      />
    );

    const badge = screen.getByTestId('sync-status-badge');
    expect(badge).toHaveTextContent('Plain Lyrics');

    // Untimed lines (0 timestamps)
    rerender(
      <StudioMetaHeader
        project={{
          ...baseProject,
          lines: [
            { id: 1, text: 'Line 1', start_time: 0, end_time: 0, words: [] },
            { id: 2, text: 'Line 2', start_time: 0, end_time: 0, words: [] },
          ],
        }}
        onOpenEditModal={vi.fn()}
        onOpenDeleteModal={vi.fn()}
        onOpenExportModal={vi.fn()}
        onStartRender={vi.fn()}
      />
    );
    expect(screen.getByTestId('sync-status-badge')).toHaveTextContent('Plain Lyrics');
  });

  it('renders Line Synced badge when lines have timings but no sub-line words', () => {
    render(
      <StudioMetaHeader
        project={{
          ...baseProject,
          lines: [
            { id: 1, text: 'Line 1', start_time: 2.5, end_time: 5.0, words: [] },
            { id: 2, text: 'Line 2', start_time: 5.5, end_time: 8.0, words: [] },
          ],
        }}
        onOpenEditModal={vi.fn()}
        onOpenDeleteModal={vi.fn()}
        onOpenExportModal={vi.fn()}
        onStartRender={vi.fn()}
      />
    );

    const badge = screen.getByTestId('sync-status-badge');
    expect(badge).toHaveTextContent('Line Synced');
  });

  it('renders Synced Words badge when lines have sub-line word timings', () => {
    render(
      <StudioMetaHeader
        project={{
          ...baseProject,
          lines: [
            {
              id: 1,
              text: 'Radio ga ga',
              start_time: 2.5,
              end_time: 5.0,
              words: [
                { word: 'Radio', start_time: 2.5, end_time: 3.2 },
                { word: 'ga', start_time: 3.3, end_time: 4.0 },
                { word: 'ga', start_time: 4.1, end_time: 5.0 },
              ],
            },
          ],
        }}
        onOpenEditModal={vi.fn()}
        onOpenDeleteModal={vi.fn()}
        onOpenExportModal={vi.fn()}
        onStartRender={vi.fn()}
      />
    );

    const badge = screen.getByTestId('sync-status-badge');
    expect(badge).toHaveTextContent('Synced Words');
  });
});

describe('Milestone 2: Token-Preserving Text Edit & Monotonic Clamping', () => {
  it('preserves existing word start_time and end_time on typo fix with matching word count', () => {
    const initialLines: LyricLine[] = [
      {
        id: 1,
        text: 'Wii will rocc you',
        start_time: 10.0,
        end_time: 14.0,
        words: [
          { word: 'Wii', start_time: 10.0, end_time: 10.8 },
          { word: 'will', start_time: 11.0, end_time: 11.8 },
          { word: 'rocc', start_time: 12.0, end_time: 12.8 },
          { word: 'you', start_time: 13.0, end_time: 13.8 },
        ],
      },
    ];

    const { result } = renderHook(() =>
      useLyricEditorState({
        lines: initialLines,
        currentTime: 0,
        duration: 100,
        onSaveLines: vi.fn(),
      })
    );

    // Start editing line 1
    act(() => {
      result.current.handleStartEditing(initialLines[0]);
    });

    // Commit typo correction: 4 words to 4 words
    act(() => {
      result.current.handleCommitEditing(1, 'We will rock you');
    });

    const updatedLine = result.current.editableLines[0];
    expect(updatedLine.text).toBe('We will rock you');
    expect(updatedLine.words).toHaveLength(4);

    // Verify word strings updated
    expect(updatedLine.words.map((w) => w.word)).toEqual(['We', 'will', 'rock', 'you']);

    // Verify word boundaries are STRICTLY preserved
    expect(updatedLine.words[0].start_time).toBe(10.0);
    expect(updatedLine.words[0].end_time).toBe(10.8);
    expect(updatedLine.words[1].start_time).toBe(11.0);
    expect(updatedLine.words[1].end_time).toBe(11.8);
    expect(updatedLine.words[2].start_time).toBe(12.0);
    expect(updatedLine.words[2].end_time).toBe(12.8);
    expect(updatedLine.words[3].start_time).toBe(13.0);
    expect(updatedLine.words[3].end_time).toBe(13.8);
  });

  it('recalculates word timings when word count changes', () => {
    const initialLines: LyricLine[] = [
      {
        id: 1,
        text: 'Hello world',
        start_time: 10.0,
        end_time: 14.0,
        words: [
          { word: 'Hello', start_time: 10.0, end_time: 11.5 },
          { word: 'world', start_time: 12.0, end_time: 13.5 },
        ],
      },
    ];

    const { result } = renderHook(() =>
      useLyricEditorState({
        lines: initialLines,
        currentTime: 0,
        duration: 100,
        onSaveLines: vi.fn(),
      })
    );

    // Commit 3 words instead of 2
    act(() => {
      result.current.handleCommitEditing(1, 'Hello brave world');
    });

    const updatedLine = result.current.editableLines[0];
    expect(updatedLine.words).toHaveLength(3);
    expect(updatedLine.words.map((w) => w.word)).toEqual(['Hello', 'brave', 'world']);
  });

  it('enforces monotonic word boundary clamping so word end_time cannot exceed next word start_time', () => {
    const initialLines: LyricLine[] = [
      {
        id: 1,
        text: 'Word One Two',
        start_time: 5.0,
        end_time: 10.0,
        words: [
          { word: 'Word', start_time: 5.0, end_time: 6.0 },
          { word: 'One', start_time: 6.5, end_time: 7.5 },
          { word: 'Two', start_time: 8.0, end_time: 9.0 },
        ],
      },
    ];

    const { result } = renderHook(() =>
      useLyricEditorState({
        lines: initialLines,
        currentTime: 0,
        duration: 100,
        onSaveLines: vi.fn(),
      })
    );

    // Attempt to push Word 0's end_time past Word 1's start_time (to 7.0s)
    act(() => {
      result.current.updateWordTiming(1, 0, 'end_time', 7.0);
    });

    // Must be clamped to Word 1's start_time (6.5s)
    expect(result.current.editableLines[0].words[0].end_time).toBeLessThanOrEqual(6.5);

    // Attempt to nudge Word 1's start_time earlier than Word 0's end_time
    act(() => {
      result.current.updateWordTiming(1, 1, 'start_time', 5.5);
    });

    // Must be clamped to Word 0's end_time
    const w0End = result.current.editableLines[0].words[0].end_time;
    expect(result.current.editableLines[0].words[1].start_time).toBeGreaterThanOrEqual(w0End);
  });
});

describe('Milestone 2: Word Snapping & Shift-Click Stepper in ExpandedWordEditor', () => {
  const sampleLine: LyricLine = {
    id: 1,
    text: 'Somebody to love',
    start_time: 10.0,
    end_time: 15.0,
    words: [
      { word: 'Somebody', start_time: 10.0, end_time: 11.5 },
      { word: 'to', start_time: 11.8, end_time: 12.5 },
      { word: 'love', start_time: 13.0, end_time: 14.5 },
    ],
  };

  it('renders playhead snapping buttons when currentTime is provided and clamps correctly', () => {
    const onUpdateWordTiming = vi.fn();

    render(
      <ExpandedWordEditor
        line={sampleLine}
        activeWordLoc={null}
        currentTime={11.2}
        onWordClick={vi.fn()}
        onNudgeWord={vi.fn()}
        onNudgeWordBoundary={vi.fn()}
        onUpdateWordTiming={onUpdateWordTiming}
      />
    );

    // Check snapping buttons present for each word
    const startSnapBtns = screen.getAllByRole('button', { name: /Snap start of word/i });
    const endSnapBtns = screen.getAllByRole('button', { name: /Snap end of word/i });

    expect(startSnapBtns).toHaveLength(3);
    expect(endSnapBtns).toHaveLength(3);

    // Click snap start to playhead (11.2s) for Word 0 ('Somebody', [10.0, 11.5])
    fireEvent.click(startSnapBtns[0]);
    // 11.2 is between prevEnd (0) and maxStart (11.5), so snaps to 11.2
    expect(onUpdateWordTiming).toHaveBeenCalledWith(1, 0, 'start_time', 11.2);

    // Click snap end to playhead (11.2s) for Word 1 ('to', [11.8, 12.5])
    fireEvent.click(endSnapBtns[1]);
    // minEnd is 11.8, so playhead 11.2 clamps to 11.8
    expect(onUpdateWordTiming).toHaveBeenCalledWith(1, 1, 'end_time', 11.8);
  });

  it('performs Shift-click 0.20s coarse stepper on +/- buttons', () => {
    const onNudgeWordBoundary = vi.fn();

    render(
      <ExpandedWordEditor
        line={sampleLine}
        activeWordLoc={null}
        currentTime={10.0}
        onWordClick={vi.fn()}
        onNudgeWord={vi.fn()}
        onNudgeWordBoundary={onNudgeWordBoundary}
        onUpdateWordTiming={vi.fn()}
      />
    );

    // Start time +/- buttons for Word 0
    const startPlusBtn = screen.getByRole('button', {
      name: `Nudge start of word ${sampleLine.words[0].word} 0.05s later`,
    });
    const startMinusBtn = screen.getByRole('button', {
      name: `Nudge start of word ${sampleLine.words[0].word} 0.05s earlier`,
    });

    // Standard click -> 0.05s
    fireEvent.click(startPlusBtn, { shiftKey: false });
    expect(onNudgeWordBoundary).toHaveBeenLastCalledWith(1, 0, 'start_time', 0.05);

    fireEvent.click(startMinusBtn, { shiftKey: false });
    expect(onNudgeWordBoundary).toHaveBeenLastCalledWith(1, 0, 'start_time', -0.05);

    // Shift-click -> 0.20s coarse step
    fireEvent.click(startPlusBtn, { shiftKey: true });
    expect(onNudgeWordBoundary).toHaveBeenLastCalledWith(1, 0, 'start_time', 0.2);

    fireEvent.click(startMinusBtn, { shiftKey: true });
    expect(onNudgeWordBoundary).toHaveBeenLastCalledWith(1, 0, 'start_time', -0.2);
  });

  it('TimelineLineCard passes currentTime down to ExpandedWordEditor when expanded', () => {
    const onUpdateWordTiming = vi.fn();

    render(
      <TimelineLineCard
        line={sampleLine}
        idx={0}
        isCurrentlyActive={false}
        isExpanded={true}
        editingLineId={null}
        editingText=""
        activeWordLoc={null}
        currentTime={12.0}
        editInputRef={{ current: null }}
        onLineClick={vi.fn()}
        onWordClick={vi.fn()}
        onStartEditing={vi.fn()}
        onCommitEditing={vi.fn()}
        onCancelEditing={vi.fn()}
        onSetEditingText={vi.fn()}
        onNudgeLine={vi.fn()}
        onInsertLineAbove={vi.fn()}
        onInsertLineBelow={vi.fn()}
        onDeleteLine={vi.fn()}
        onToggleExpand={vi.fn()}
        onNudgeWord={vi.fn()}
        onNudgeWordBoundary={vi.fn()}
        onUpdateWordTiming={onUpdateWordTiming}
      />
    );

    // Snapping buttons should be rendered inside TimelineLineCard when isExpanded=true and currentTime=12.0
    expect(screen.getAllByRole('button', { name: /Snap start of word/i })).toHaveLength(3);
  });

  it('handles candidate search returning empty results with error message', async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    render(
      <LyricReplacementModal
        isOpen={true}
        onClose={vi.fn()}
        projectId="proj-404"
        trackTitle="Nonexistent Song"
        trackArtist="Unknown"
        onSuccess={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /Re-query LRCLIB/i }));
    await user.click(screen.getByRole('button', { name: /Search Candidates/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/No lyric candidates found for the specified query/i)
      ).toBeInTheDocument();
    });
  });

  it('preserves word timings even when new text contains irregular whitespace', () => {
    const initialLines: LyricLine[] = [
      {
        id: 1,
        text: 'Hello world',
        start_time: 1.0,
        end_time: 3.0,
        words: [
          { word: 'Hello', start_time: 1.0, end_time: 1.8 },
          { word: 'world', start_time: 2.0, end_time: 2.9 },
        ],
      },
    ];

    const { result } = renderHook(() =>
      useLyricEditorState({
        lines: initialLines,
        currentTime: 0,
        duration: 50,
        onSaveLines: vi.fn(),
      })
    );

    act(() => {
      result.current.handleStartEditing(initialLines[0]);
    });

    // 2 words with multiple spaces and tabs
    act(() => {
      result.current.handleCommitEditing(1, '  Hi    planet   ');
    });

    const updated = result.current.editableLines[0];
    expect(updated.text).toBe('Hi    planet');
    expect(updated.words).toHaveLength(2);
    expect(updated.words[0]).toEqual({ word: 'Hi', start_time: 1.0, end_time: 1.8 });
    expect(updated.words[1]).toEqual({ word: 'planet', start_time: 2.0, end_time: 2.9 });
  });
});

/**
 * Lyric Replacement / Re-Import Modal Component
 *
 * Replaces a song's lyrics without re-running stem separation:
 * 1. Paste plain or LRC lyrics, with a live syntax inspector.
 * 2. Search LRCLIB candidates by title and artist, preview their lines and apply one.
 * 3. Re-fetch from LRCLIB with the song's own metadata.
 * 4. Re-time the current lyrics without changing their text.
 * New lyrics are aligned against the existing vocal stem: right away by the fast aligner, or
 * in the background by the neural aligner when the server has it.
 */

import React, { useState } from 'react';
import {
  FileText,
  RefreshCw,
  Sparkles,
  AlertCircle,
  Search,
  ChevronDown,
  CheckCircle2,
  Info,
  Music,
  Wand2,
} from 'lucide-react';
import { LyricCandidate, LyricLine } from '../../types';
import { apiFetch, readApiError } from '../../api';
import { useToast } from '../../hooks/useToast';
import { useCapabilities } from '../../hooks/useCapabilities';
import type { BackgroundRealignRequest } from '../../hooks/useQualityJobs';
import { Checkbox } from '../ui/Checkbox';
import { Dialog, DialogFooter, DialogHeader } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { SegmentedControl } from '../ui/SegmentedControl';
import { EmptyState } from '../ui/EmptyState';
import { cn } from '../../utils/cn';
import { formatTime } from '../../utils/format';

const fieldCls =
  'w-full min-h-[44px] rounded-theme-md border border-theme-border-subtle bg-theme-bg px-3 py-2 text-base text-theme-text placeholder:text-theme-text-muted focus:border-theme-accent focus:outline-none focus:ring-2 focus:ring-theme-focus/60 sm:text-sm md:min-h-[38px]';

export interface LyricReplacementModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  trackTitle?: string;
  trackArtist?: string;
  onSuccess: (newLines: LyricLine[]) => void;
  /** The timeline's lines, offered for re-timing without changing the text. */
  currentLines?: LyricLine[];
  /** Starts a background re-alignment; offered when the server has the neural aligner. */
  onStartBackground?: (request: BackgroundRealignRequest) => Promise<unknown>;
}

export const LyricReplacementModal: React.FC<LyricReplacementModalProps> = ({
  isOpen,
  onClose,
  projectId,
  trackTitle = 'Track',
  trackArtist = 'Artist',
  onSuccess,
  currentLines,
  onStartBackground,
}) => {
  const { toast } = useToast();
  const capabilities = useCapabilities(isOpen && Boolean(onStartBackground));
  const neural = capabilities?.alignment;
  const canUseNeural = Boolean(onStartBackground && neural?.ctc_available);
  const [useNeural, setUseNeural] = useState(true);
  const inBackground = canUseNeural && useNeural;
  const [activeTab, setActiveTab] = useState<'paste' | 'lrclib'>('paste');
  const [lyricsText, setLyricsText] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Candidate Search State
  const [searchTitle, setSearchTitle] = useState<string>(trackTitle);
  const [searchArtist, setSearchArtist] = useState<string>(trackArtist);
  const [candidates, setCandidates] = useState<LyricCandidate[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | number | null>(null);
  const [applyingCandidateId, setApplyingCandidateId] = useState<string | number | null>(null);

  const isBusy = isLoading || isSearching;
  const handleClose = () => {
    if (!isLoading) onClose();
  };

  // Live Paste Syntax Inspector calculation
  const getPasteInspectorInfo = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return null;

    const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
    const totalLines = lines.length;
    // The same test as the server's LyricsService.is_lrc_format: [m:ss], [mm:ss.xx], [mmm:ss.xxx]
    const lrcRegex = /\[\d{1,4}:\d{2}(?:\.\d{1,3})?\]/;
    const lrcLines = lines.filter((l) => lrcRegex.test(l));
    const isLrc = lrcLines.length > 0;

    if (isLrc) {
      return {
        type: 'synced' as const,
        text: `✓ Synced LRC (${totalLines} lines detected)`,
        detail:
          lrcLines.length === totalLines
            ? 'All lines contain valid LRC timestamps'
            : `${lrcLines.length} of ${totalLines} lines contain LRC timestamps`,
        className: 'border-theme-success/35 bg-theme-success/10 text-theme-success',
      };
    }

    return {
      type: 'plain' as const,
      text: `ℹ Plain Text (${totalLines} lines, will require alignment)`,
      detail: 'Untimed text will be acoustically aligned to vocal stem',
      className: 'border-theme-info/35 bg-theme-info/10 text-theme-info',
    };
  };

  const pasteInspector = getPasteInspectorInfo(lyricsText);

  /** Re-aligns `body`: queued for the neural aligner, or answered now by the fast one. */
  const realign = async (body: BackgroundRealignRequest, done: string, failed: string) => {
    if (inBackground && onStartBackground) {
      await onStartBackground(body);
      toast.info('Re-aligning with the neural aligner in the background. Keep working meanwhile.');
      onClose();
      return;
    }
    const res = await apiFetch(`/api/project/${projectId}/realign-lyrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(await readApiError(res, failed));
    }
    const data = await res.json();
    toast.success(done);
    onSuccess(data.lines || []);
    onClose();
  };

  const handleRealignCurrent = async () => {
    if (!currentLines?.length || !projectId) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await realign({ lines: currentLines }, 'Lyrics re-aligned', 'Failed to re-align lyrics');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to re-align lyrics';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = lyricsText.trim();
    if (!trimmed) {
      setErrorMsg('Please enter or paste lyric text or LRC content.');
      return;
    }
    if (!projectId) {
      setErrorMsg('No active project ID found.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    try {
      await realign(
        { custom_lyrics: trimmed, fetch_lrclib: false },
        'Lyrics replaced and aligned successfully',
        'Failed to realign lyrics'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to realign lyrics';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchCandidates = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!projectId) {
      setErrorMsg('No active project ID found.');
      return;
    }

    setIsSearching(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams();
      if (searchTitle.trim()) params.append('track_name', searchTitle.trim());
      if (searchArtist.trim()) params.append('artist_name', searchArtist.trim());

      const res = await apiFetch(
        `/api/project/${projectId}/lyrics/candidates?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error(await readApiError(res, 'Failed to search lyric candidates'));
      }
      const data = await res.json();

      const list: LyricCandidate[] = Array.isArray(data) ? data : data.candidates || [];
      setCandidates(list);

      if (list.length === 0) {
        setErrorMsg('No lyric candidates found for the specified query.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to search candidates';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsSearching(false);
    }
  };

  const handleApplyCandidate = async (candidate: LyricCandidate) => {
    const lyricsToApply = candidate.synced_lyrics || candidate.plain_lyrics || '';
    if (!lyricsToApply.trim()) {
      setErrorMsg('Selected candidate has empty lyrics.');
      return;
    }
    if (!projectId) {
      setErrorMsg('No active project ID found.');
      return;
    }

    setApplyingCandidateId(candidate.id ?? 'selected');
    setIsLoading(true);
    setErrorMsg(null);

    try {
      await realign(
        { custom_lyrics: lyricsToApply, fetch_lrclib: false },
        'Candidate lyrics applied and realigned successfully',
        'Failed to apply candidate lyrics'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to apply candidate lyrics';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
      setApplyingCandidateId(null);
    }
  };

  const handleBlindLrclibSubmit = async () => {
    if (!projectId) {
      setErrorMsg('No active project ID found.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    try {
      await realign(
        { fetch_lrclib: true },
        'Lyrics re-fetched from LRCLIB and aligned',
        'Failed to re-query LRCLIB lyrics'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to re-query LRCLIB';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onClose={handleClose}
      titleId="lyric-replacement-title"
      descriptionId="lyric-replacement-desc"
      size="2xl"
      showDragHandle
    >
      <DialogHeader
        title="Replace / Re-align Lyrics"
        titleId="lyric-replacement-title"
        description="Update lyrics without re-running stem separation"
        descriptionId="lyric-replacement-desc"
        icon={<FileText className="h-5 w-5" />}
        onClose={handleClose}
        closeDisabled={isBusy}
      />

      <div className="space-y-4">
        <SegmentedControl<'paste' | 'lrclib'>
          ariaLabel="Lyric source"
          value={activeTab}
          onChange={(tab) => {
            setActiveTab(tab);
            setErrorMsg(null);
          }}
          fullWidth
          tone="neutral"
          size="sm"
          options={[
            {
              value: 'paste',
              label: 'Paste Lyrics / LRC',
              icon: <FileText className="h-4 w-4" aria-hidden="true" />,
            },
            {
              value: 'lrclib',
              label: 'Re-query LRCLIB',
              icon: <RefreshCw className="h-4 w-4" aria-hidden="true" />,
            },
          ]}
        />

        {(canUseNeural || neural || (currentLines?.length ?? 0) > 0) && (
          <div className="divide-y divide-theme-border-subtle rounded-theme-lg border border-theme-border-subtle bg-theme-surface-subtle/60 px-3">
            {canUseNeural ? (
              <Checkbox
                checked={useNeural}
                onChange={setUseNeural}
                label="Use the neural aligner"
                description="More accurate word timing. It runs in the background, so you can keep working."
                testId="lyric-replacement-neural"
              />
            ) : neural && onStartBackground ? (
              <p className="py-2 text-[11px] text-theme-text-muted">
                Aligned by the fast aligner: the neural aligner is not available on this server
                {neural.reason ? ` (${neural.reason})` : ''}.
              </p>
            ) : null}
            {(currentLines?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-xs text-theme-text-muted">
                  Keep the current text and re-time every line.
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleRealignCurrent}
                  disabled={isBusy}
                  leftIcon={<Wand2 className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                  Re-align current lyrics
                </Button>
              </div>
            )}
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-theme-md border border-theme-danger/35 bg-theme-danger/10 p-3 text-xs text-theme-danger"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        {activeTab === 'paste' && (
          <form onSubmit={handlePasteSubmit}>
            <div className="space-y-3">
              <div className="space-y-1">
                <label
                  htmlFor="custom-lyrics-textarea"
                  className="text-xs font-semibold text-theme-text"
                >
                  Lyric Text or LRC Timestamps
                </label>
                <textarea
                  id="custom-lyrics-textarea"
                  rows={8}
                  value={lyricsText}
                  onChange={(e) => setLyricsText(e.target.value)}
                  placeholder="[00:12.34] First lyric line&#10;[00:16.78] Second line&#10;Or paste plain untimed lyrics..."
                  className="min-h-[160px] w-full resize-y rounded-theme-md border border-theme-border-subtle bg-theme-bg px-3.5 py-2.5 font-mono text-base text-theme-text placeholder:text-theme-text-muted focus:border-theme-accent focus:outline-none focus:ring-2 focus:ring-theme-focus/60 sm:text-xs"
                />
              </div>

              {pasteInspector && (
                <div
                  data-testid="paste-syntax-inspector"
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-2 rounded-theme-md border p-2.5 text-xs',
                    pasteInspector.className
                  )}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    {pasteInspector.type === 'synced' ? (
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Info className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>{pasteInspector.text}</span>
                  </div>
                  <span className="text-[11px] opacity-80">{pasteInspector.detail}</span>
                </div>
              )}

              <p className="text-[11px] text-theme-text-muted">
                Auto-detects LRC timestamps or runs acoustic forced alignment across your existing
                vocal stem.
              </p>
            </div>

            <DialogFooter>
              <Button
                variant="secondary"
                fullWidth="mobile"
                onClick={handleClose}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="gradient"
                fullWidth="mobile"
                disabled={!lyricsText.trim()}
                loading={isLoading}
                loadingLabel="Aligning Lyrics..."
                leftIcon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
              >
                Re-align Lyrics
              </Button>
            </DialogFooter>
          </form>
        )}

        {activeTab === 'lrclib' && (
          <div className="space-y-4">
            <form
              onSubmit={handleSearchCandidates}
              className="space-y-3 rounded-theme-lg border border-theme-border-subtle bg-theme-bg/60 p-3.5"
            >
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="space-y-1">
                  <label
                    htmlFor="candidate-track-title"
                    className="text-[11px] font-semibold text-theme-text-muted"
                  >
                    Track Title
                  </label>
                  <input
                    id="candidate-track-title"
                    type="text"
                    value={searchTitle}
                    onChange={(e) => setSearchTitle(e.target.value)}
                    placeholder="Track Title"
                    className={fieldCls}
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="candidate-artist-name"
                    className="text-[11px] font-semibold text-theme-text-muted"
                  >
                    Artist Name
                  </label>
                  <input
                    id="candidate-artist-name"
                    type="text"
                    value={searchArtist}
                    onChange={(e) => setSearchArtist(e.target.value)}
                    placeholder="Artist Name"
                    className={fieldCls}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-theme-text-muted">
                  Target: <span className="font-bold text-theme-text">{trackTitle}</span> by{' '}
                  <span className="font-bold text-theme-text">{trackArtist}</span>
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleBlindLrclibSubmit}
                    disabled={isBusy}
                    title="Directly re-query LRCLIB using original song metadata"
                    leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                  >
                    Fetch from LRCLIB
                  </Button>
                  <Button
                    type="submit"
                    variant="gradient"
                    size="sm"
                    disabled={!searchTitle.trim() && !searchArtist.trim()}
                    loading={isSearching}
                    loadingLabel="Searching..."
                    leftIcon={<Search className="h-3.5 w-3.5" aria-hidden="true" />}
                  >
                    Search Candidates
                  </Button>
                </div>
              </div>
            </form>

            <div className="space-y-2.5">
              {candidates.length === 0 && !isSearching && (
                <EmptyState
                  icon={<Music className="h-6 w-6" />}
                  title="No candidates yet"
                  description='Click "Search Candidates" above to find alternative lyric versions on LRCLIB.'
                  className="py-6"
                />
              )}

              {candidates.map((cand, cIdx) => {
                const candId = cand.id ?? cIdx;
                const isExpanded = expandedCandidateId === candId;
                const isApplying = applyingCandidateId === candId;
                const hasSynced = Boolean(cand.synced_lyrics && cand.synced_lyrics.trim());
                const lyricPreview =
                  cand.synced_lyrics || cand.plain_lyrics || 'No lyrics available';

                return (
                  <div
                    key={candId}
                    data-testid={`lyric-candidate-${cIdx}`}
                    className="space-y-2 rounded-theme-lg border border-theme-border-subtle bg-theme-bg/60 p-3 transition-colors hover:border-theme-border"
                  >
                    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-bold text-theme-text">
                            {cand.track_name || 'Untitled Track'}
                          </span>
                          {hasSynced ? (
                            <span
                              data-testid="badge-synced-lrc"
                              className="rounded-theme-sm border border-theme-success/35 bg-theme-success/15 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-theme-success"
                            >
                              [Synced LRC]
                            </span>
                          ) : (
                            <span
                              data-testid="badge-plain-lyrics"
                              className="rounded-theme-sm border border-theme-warning/35 bg-theme-warning/15 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-theme-warning"
                            >
                              [Plain Lyrics]
                            </span>
                          )}
                          {cand.instrumental && (
                            <span className="rounded-theme-sm border border-theme-accent/35 bg-theme-accent/15 px-1.5 py-0.5 font-mono text-[10px] text-theme-highlight">
                              Instrumental
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-theme-text-muted">
                          {cand.artist_name || 'Unknown Artist'} •{' '}
                          {cand.album_name || 'Single / Unknown Album'} •{' '}
                          <span className="font-mono tabular-nums">
                            {formatTime(cand.duration)}
                          </span>
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedCandidateId(isExpanded ? null : candId)}
                          aria-expanded={isExpanded}
                          aria-label={`Toggle line preview for ${cand.track_name}`}
                          rightIcon={
                            <ChevronDown
                              className={cn(
                                'h-3.5 w-3.5 transition-transform',
                                isExpanded && 'rotate-180'
                              )}
                              aria-hidden="true"
                            />
                          }
                        >
                          Preview Lines
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleApplyCandidate(cand)}
                          disabled={isLoading || applyingCandidateId !== null}
                          aria-label={`Apply candidate ${cand.track_name} by ${cand.artist_name}`}
                          loading={isApplying}
                          loadingLabel="Applying..."
                          leftIcon={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
                        >
                          Apply This Candidate
                        </Button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div
                        data-testid={`candidate-preview-${cIdx}`}
                        className="mt-2 max-h-40 space-y-1 overflow-y-auto whitespace-pre-wrap rounded-theme-md border border-theme-border-subtle bg-theme-surface p-3 font-mono text-xs leading-relaxed text-theme-text"
                      >
                        <div className="flex justify-between border-b border-theme-border-subtle pb-1 text-[10px] font-bold uppercase tracking-wider text-theme-highlight">
                          <span>Lyric Content Preview</span>
                          <span>{hasSynced ? 'LRC Timed' : 'Plain Text'}</span>
                        </div>
                        <div className="pt-1">{lyricPreview}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <DialogFooter>
              <Button
                variant="secondary"
                fullWidth="mobile"
                onClick={handleClose}
                disabled={isBusy}
              >
                Close
              </Button>
            </DialogFooter>
          </div>
        )}
      </div>
    </Dialog>
  );
};

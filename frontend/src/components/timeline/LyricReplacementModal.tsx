/**
 * Lyric Replacement / Re-Import Modal Component
 *
 * Focus-trapped dialog allowing users to:
 * 1. Manually paste new plain or LRC lyrics with a live syntax inspector.
 * 2. Interactively search LRCLIB candidates by title & artist, review duration & sync badges,
 *    expand line previews in an accordion, and apply the chosen candidate.
 * 3. Acoustically realign words without re-running Demucs stem separation.
 */

import React, { useState } from 'react';
import {
  FileText,
  RefreshCw,
  X,
  Loader2,
  Sparkles,
  AlertCircle,
  Search,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Music,
} from 'lucide-react';
import { LyricCandidate, LyricLine } from '../../types';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { apiFetch } from '../../api';
import { useToast } from '../../hooks/useToast';

export interface LyricReplacementModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  trackTitle?: string;
  trackArtist?: string;
  onSuccess: (newLines: LyricLine[]) => void;
}

export const LyricReplacementModal: React.FC<LyricReplacementModalProps> = ({
  isOpen,
  onClose,
  projectId,
  trackTitle = 'Track',
  trackArtist = 'Artist',
  onSuccess,
}) => {
  const { toast } = useToast();
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

  const modalRef = useFocusTrap<HTMLDivElement>({
    isOpen,
    onClose: isLoading ? () => {} : onClose,
  });

  if (!isOpen) return null;

  // Format seconds to mm:ss
  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Live Paste Syntax Inspector calculation
  const getPasteInspectorInfo = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return null;

    const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
    const totalLines = lines.length;
    const lrcRegex = /\[\d{2}:\d{2}\.\d{2,3}\]/;
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
        className: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
      };
    }

    return {
      type: 'plain' as const,
      text: `ℹ Plain Text (${totalLines} lines, will require alignment)`,
      detail: 'Untimed text will be acoustically aligned to vocal stem',
      className: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300',
    };
  };

  const pasteInspector = getPasteInspectorInfo(lyricsText);

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
      const res = await apiFetch(`/api/project/${projectId}/realign-lyrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_lyrics: trimmed, fetch_lrclib: false }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to realign lyrics');
      }

      toast.success('Lyrics replaced and aligned successfully');
      onSuccess(data.lines || []);
      onClose();
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
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || 'Failed to search lyric candidates');
      }

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
      const res = await apiFetch(`/api/project/${projectId}/realign-lyrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom_lyrics: lyricsToApply, fetch_lrclib: false }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to apply candidate lyrics');
      }

      toast.success('Candidate lyrics applied and realigned successfully');
      onSuccess(data.lines || []);
      onClose();
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
      const res = await apiFetch(`/api/project/${projectId}/realign-lyrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fetch_lrclib: true }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to re-query LRCLIB lyrics');
      }

      toast.success('Lyrics re-fetched from LRCLIB and aligned');
      onSuccess(data.lines || []);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to re-query LRCLIB';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      ref={modalRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lyric-replacement-title"
      aria-describedby="lyric-replacement-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl rounded-b-none sm:rounded-b-2xl max-w-2xl w-full p-4 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto flex flex-col pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
        <div
          data-testid="bottom-sheet-drag-handle"
          className="w-10 h-1 bg-slate-700 rounded-full mx-auto my-2 sm:hidden shrink-0"
        />
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 text-cyan-400">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
              <FileText className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h3 id="lyric-replacement-title" className="text-base font-bold text-white">
                Replace / Re-align Lyrics
              </h3>
              <p id="lyric-replacement-desc" className="text-xs text-slate-400">
                Update lyrics without re-running stem separation
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading || isSearching}
            aria-label="Close dialog"
            className="min-w-[44px] min-h-[44px] p-2.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Buttons */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-xl border border-slate-800 shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab('paste');
              setErrorMsg(null);
            }}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'paste'
                ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            Paste Lyrics / LRC
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('lrclib');
              setErrorMsg(null);
            }}
            className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'lrclib'
                ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <RefreshCw className="w-4 h-4" />
            Re-query LRCLIB
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Tab 1: Paste Plain or LRC Lyrics */}
        {activeTab === 'paste' && (
          <form onSubmit={handlePasteSubmit} className="space-y-3 flex-1 flex flex-col min-h-0">
            <div className="space-y-1 flex-1 flex flex-col min-h-0">
              <label
                htmlFor="custom-lyrics-textarea"
                className="text-xs font-semibold text-slate-300"
              >
                Lyric Text or LRC Timestamps
              </label>
              <textarea
                id="custom-lyrics-textarea"
                rows={8}
                value={lyricsText}
                onChange={(e) => setLyricsText(e.target.value)}
                placeholder="[00:12.34] First lyric line&#10;[00:16.78] Second line&#10;Or paste plain untimed lyrics..."
                className="w-full flex-1 min-h-[160px] px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 text-white text-xs font-mono outline-none resize-none transition-all placeholder:text-slate-600"
              />
            </div>

            {/* Live Paste Syntax Inspector */}
            {pasteInspector && (
              <div
                data-testid="paste-syntax-inspector"
                className={`p-2.5 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 transition-all shrink-0 ${pasteInspector.className}`}
              >
                <div className="flex items-center gap-1.5 font-bold">
                  {pasteInspector.type === 'synced' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <FileText className="w-4 h-4 text-cyan-400" />
                  )}
                  <span>{pasteInspector.text}</span>
                </div>
                <span className="text-[11px] opacity-80">{pasteInspector.detail}</span>
              </div>
            )}

            <p className="text-[11px] text-slate-400 shrink-0">
              Auto-detects LRC timestamps or runs acoustic forced alignment across your existing
              vocal stem.
            </p>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading || !lyricsText.trim()}
                className="w-full sm:w-auto min-h-[44px] px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-lg shadow-cyan-600/20 flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Aligning Lyrics...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Re-align Lyrics
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Tab 2: Candidate Search & Paste Inspector */}
        {activeTab === 'lrclib' && (
          <div className="space-y-4 flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Interactive Candidate Search Form */}
            <form
              onSubmit={handleSearchCandidates}
              className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3 shrink-0"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label
                    htmlFor="candidate-track-title"
                    className="text-[11px] font-semibold text-slate-400"
                  >
                    Track Title
                  </label>
                  <input
                    id="candidate-track-title"
                    type="text"
                    value={searchTitle}
                    onChange={(e) => setSearchTitle(e.target.value)}
                    placeholder="Track Title"
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400"
                  />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="candidate-artist-name"
                    className="text-[11px] font-semibold text-slate-400"
                  >
                    Artist Name
                  </label>
                  <input
                    id="candidate-artist-name"
                    type="text"
                    value={searchArtist}
                    onChange={(e) => setSearchArtist(e.target.value)}
                    placeholder="Artist Name"
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:ring-1 focus:ring-cyan-400"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-slate-400">
                  Target: <span className="text-white font-bold">{trackTitle}</span> by{' '}
                  <span className="text-white font-bold">{trackArtist}</span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleBlindLrclibSubmit}
                    disabled={isLoading || isSearching}
                    title="Directly re-query LRCLIB using original song metadata"
                    className="min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Fetch from LRCLIB
                  </button>
                  <button
                    type="submit"
                    disabled={isSearching || (!searchTitle.trim() && !searchArtist.trim())}
                    className="min-h-[36px] px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all shadow-md shadow-cyan-600/20 flex items-center gap-1.5 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  >
                    {isSearching ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Searching...
                      </>
                    ) : (
                      <>
                        <Search className="w-3.5 h-3.5" />
                        Search Candidates
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>

            {/* Candidate Results List */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-[120px]">
              {candidates.length === 0 && !isSearching && (
                <div className="p-6 rounded-xl bg-slate-950/60 border border-slate-800/80 text-center space-y-2">
                  <Music className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-xs text-slate-400">
                    Click &quot;Search Candidates&quot; above to find alternative lyric versions on
                    LRCLIB.
                  </p>
                </div>
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
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 transition-all space-y-2"
                  >
                    {/* Candidate Header Row */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-white truncate">
                            {cand.track_name || 'Untitled Track'}
                          </span>
                          {/* Badges: [Synced LRC] vs [Plain Lyrics] */}
                          {hasSynced ? (
                            <span
                              data-testid="badge-synced-lrc"
                              className="px-2 py-0.5 rounded text-[10px] font-bold font-mono tracking-wider bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                            >
                              [Synced LRC]
                            </span>
                          ) : (
                            <span
                              data-testid="badge-plain-lyrics"
                              className="px-2 py-0.5 rounded text-[10px] font-bold font-mono tracking-wider bg-amber-500/15 border border-amber-500/30 text-amber-300"
                            >
                              [Plain Lyrics]
                            </span>
                          )}
                          {cand.instrumental && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-500/15 border border-purple-500/30 text-purple-300">
                              Instrumental
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 truncate">
                          {cand.artist_name || 'Unknown Artist'} •{' '}
                          {cand.album_name || 'Single / Unknown Album'} •{' '}
                          <span className="font-mono">{formatDuration(cand.duration)}</span>
                        </p>
                      </div>

                      {/* Actions: Expand Preview & Apply This Candidate */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setExpandedCandidateId(isExpanded ? null : candId)}
                          aria-expanded={isExpanded}
                          aria-label={`Toggle line preview for ${cand.track_name}`}
                          className="min-h-[34px] px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium transition-colors flex items-center gap-1 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                        >
                          <span>Preview Lines</span>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplyCandidate(cand)}
                          disabled={isLoading || applyingCandidateId !== null}
                          aria-label={`Apply candidate ${cand.track_name} by ${cand.artist_name}`}
                          className="min-h-[34px] px-3.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all shadow-md shadow-cyan-600/20 flex items-center gap-1.5 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                        >
                          {isApplying ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Applying...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              Apply This Candidate
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Expandable Line Preview Accordion */}
                    {isExpanded && (
                      <div
                        data-testid={`candidate-preview-${cIdx}`}
                        className="mt-2 p-3 rounded-lg bg-slate-900/90 border border-slate-800 text-xs font-mono text-slate-300 max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed space-y-1"
                      >
                        <div className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider pb-1 border-b border-slate-800 flex justify-between">
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

            {/* Modal Bottom Cancel Button */}
            <div className="flex justify-end pt-2 border-t border-slate-800 shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading || isSearching}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

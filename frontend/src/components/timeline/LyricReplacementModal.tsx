/**
 * Lyric Replacement / Re-Import Modal Component
 *
 * Focus-trapped dialog allowing users to paste new plain or LRC lyrics or re-query
 * LRCLIB for an existing project and acoustically realign words without re-running Demucs.
 */

import React, { useState } from 'react';
import { FileText, RefreshCw, X, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { LyricLine } from '../../types';
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

  const modalRef = useFocusTrap<HTMLDivElement>({
    isOpen,
    onClose: isLoading ? () => {} : onClose,
  });

  if (!isOpen) return null;

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

  const handleLrclibSubmit = async () => {
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
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lyric-replacement-title"
      aria-describedby="lyric-replacement-desc"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
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
            disabled={isLoading}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Buttons */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-xl border border-slate-800">
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
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Tab 1: Paste Plain or LRC Lyrics */}
        {activeTab === 'paste' && (
          <form onSubmit={handlePasteSubmit} className="space-y-3">
            <div className="space-y-1">
              <label
                htmlFor="custom-lyrics-textarea"
                className="text-xs font-semibold text-slate-300"
              >
                Lyric Text or LRC Timestamps
              </label>
              <textarea
                id="custom-lyrics-textarea"
                rows={7}
                value={lyricsText}
                onChange={(e) => setLyricsText(e.target.value)}
                placeholder="[00:12.34] First lyric line&#10;[00:16.78] Second line&#10;Or paste plain untimed lyrics..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 text-white text-xs font-mono outline-none resize-none transition-all placeholder:text-slate-600"
              />
            </div>
            <p className="text-[11px] text-slate-400">
              Auto-detects LRC timestamps or runs acoustic forced alignment across your existing
              vocal stem.
            </p>
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2">
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

        {/* Tab 2: Re-query LRCLIB */}
        {activeTab === 'lrclib' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="text-xs text-slate-400">Querying LRCLIB database for:</div>
              <div className="text-sm font-bold text-white">
                {trackTitle} <span className="text-slate-400 font-normal">by</span> {trackArtist}
              </div>
              <p className="text-[11px] text-slate-400 pt-1">
                Fetches word or line-synchronized lyrics from LRCLIB and realigns them with the
                vocal stem.
              </p>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLrclibSubmit}
                disabled={isLoading}
                className="w-full sm:w-auto min-h-[44px] px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-lg shadow-cyan-600/20 flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-cyan-400"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Fetching & Aligning...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Fetch from LRCLIB
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

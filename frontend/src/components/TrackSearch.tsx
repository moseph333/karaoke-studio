import React, { useState } from 'react';
import { Search, Music, Link2, Sparkles, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { SearchResult } from '../types';

interface TrackSearchProps {
  onSelectTrack: (urlOrId: string, customLyrics?: string) => void;
  isLoading: boolean;
}

export const TrackSearch: React.FC<TrackSearchProps> = ({ onSelectTrack, isLoading }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showCustomLyrics, setShowCustomLyrics] = useState(false);
  const [customLyrics, setCustomLyrics] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    // If query is directly a URL, we can start immediately
    if (query.includes('youtube.com/') || query.includes('youtu.be/')) {
      onSelectTrack(query.trim(), customLyrics.trim() || undefined);
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), limit: 5 }),
      });
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setResults(data.results || []);
      if (!data.results || data.results.length === 0) {
        setError('No matching tracks found. Try a different title or paste a direct YouTube URL.');
      }
    } catch (err: any) {
      setError(err.message || 'Error searching YouTube');
    } finally {
      setSearching(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/40 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-4">
          <Sparkles className="w-3.5 h-3.5" />
          AI-Powered Karaoke Studio
        </div>
        <h1 className="text-4xl font-extrabold text-white tracking-tight sm:text-5xl font-['Montserrat']">
          Turn Any YouTube Song Into a Karaoke Track
        </h1>
        <p className="mt-3 text-lg text-slate-400 max-w-xl mx-auto">
          Isolated instrumentals, word-by-word synchronized highlighting, pitch transposition, and 60fps YouTube-ready export.
        </p>
      </div>

      <form onSubmit={handleSearch} className="relative mb-6">
        <div className="relative flex items-center">
          <Search className="absolute left-4 w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Paste YouTube / YouTube Music URL or search song title..."
            className="w-full pl-12 pr-32 py-4 rounded-xl bg-slate-900/90 border border-slate-700/80 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-base shadow-xl"
            disabled={isLoading || searching}
          />
          <button
            type="submit"
            disabled={isLoading || searching || !query.trim()}
            className="absolute right-2.5 px-5 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-sm transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {searching ? (
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : (
              'Search / Go'
            )}
          </button>
        </div>
      </form>

      {/* Optional Custom Lyrics Toggle */}
      <div className="mb-6 bg-slate-900/40 border border-slate-800/80 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowCustomLyrics(!showCustomLyrics)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <span className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-cyan-400" />
            (Optional) Provide your own custom lyrics text
          </span>
          {showCustomLyrics ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showCustomLyrics && (
          <div className="p-4 pt-1 border-t border-slate-800/50">
            <textarea
              value={customLyrics}
              onChange={(e) => setCustomLyrics(e.target.value)}
              placeholder="Paste line-by-line lyrics here. If left empty, lyrics will be automatically fetched from LRCLIB/Genius."
              rows={5}
              className="w-full p-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/50 text-red-300 text-sm mb-6">
          {error}
        </div>
      )}

      {/* Search Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 px-1">
            Search Results
          </h3>
          {results.map((track) => (
            <div
              key={track.id}
              onClick={() => onSelectTrack(track.url, customLyrics.trim() || undefined)}
              className="group flex items-center justify-between p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-cyan-500/50 hover:bg-slate-800/60 transition-all cursor-pointer shadow-md"
            >
              <div className="flex items-center gap-3.5 overflow-hidden">
                {track.thumbnail ? (
                  <img
                    src={track.thumbnail}
                    alt={track.title}
                    className="w-16 h-12 object-cover rounded-lg shadow"
                  />
                ) : (
                  <div className="w-16 h-12 rounded-lg bg-slate-800 flex items-center justify-center">
                    <Music className="w-5 h-5 text-slate-500" />
                  </div>
                )}
                <div className="truncate">
                  <h4 className="text-base font-semibold text-white group-hover:text-cyan-300 truncate transition-colors">
                    {track.title}
                  </h4>
                  <p className="text-xs text-slate-400 truncate mt-0.5">
                    {track.artist} {track.duration ? `• ${formatDuration(track.duration)}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 ml-4 px-4 py-2 rounded-lg bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-500 group-hover:text-slate-950 font-medium text-xs transition-all border border-cyan-500/30"
              >
                Create Karaoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { Search, Music, Sparkles, FileText, ChevronDown, ChevronUp, FolderHeart, Globe, CheckCircle2, Clock, Play } from 'lucide-react';
import { SearchResult, ProjectState } from '../types';
import { apiFetch } from '../api';

interface TrackSearchProps {
  onSelectTrack: (urlOrId: string, customLyrics?: string) => void;
  onOpenProject?: (project: ProjectState) => void;
  isLoading: boolean;
  currentUser?: string;
  authToken?: string;
}

export const TrackSearch: React.FC<TrackSearchProps> = ({
  onSelectTrack,
  onOpenProject,
  isLoading,
  currentUser = 'Friend',
  authToken = '',
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showCustomLyrics, setShowCustomLyrics] = useState(false);
  const [customLyrics, setCustomLyrics] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Library / existing projects state
  const [libraryProjects, setLibraryProjects] = useState<ProjectState[]>([]);
  const [activeTab, setActiveTab] = useState<'my' | 'community'>('my');
  const [loadingLibrary, setLoadingLibrary] = useState(false);

  // Fetch recent projects from the studio
  const fetchLibrary = async () => {
    setLoadingLibrary(true);
    try {
      const res = await apiFetch('/api/projects?scope=all');
      if (res.ok) {
        const data: Record<string, ProjectState> = await res.json();
        // Deduplicate projects by ID
        const uniqueMap = new Map<string, ProjectState>();
        Object.values(data).forEach((p) => {
          if (p && p.id && !uniqueMap.has(p.id)) {
            uniqueMap.set(p.id, p);
          }
        });
        setLibraryProjects(Array.from(uniqueMap.values()).reverse());
      }
    } catch (e) {
      console.error('Failed to load project library', e);
    } finally {
      setLoadingLibrary(false);
    }
  };

  useEffect(() => {
    fetchLibrary();
  }, [authToken]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    if (query.includes('youtube.com/') || query.includes('youtu.be/')) {
      onSelectTrack(query.trim(), customLyrics.trim() || undefined);
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const res = await apiFetch('/api/search', {
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

  const myProjects = libraryProjects.filter(
    (p) => p.created_by && p.created_by.toLowerCase() === currentUser.toLowerCase()
  );
  const displayProjects = activeTab === 'my' ? myProjects : libraryProjects;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/40 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-4">
          <Sparkles className="w-3.5 h-3.5" />
          AI-Powered Karaoke Studio
        </div>
        <h1 className="text-4xl font-extrabold text-white tracking-tight sm:text-5xl font-['Montserrat']">
          Turn Any YouTube Song Into Karaoke
        </h1>
        <p className="mt-3 text-sm text-slate-400 max-w-xl mx-auto">
          Word-by-word synchronized highlighting, isolated instrumentals, pitch control, and 1080p60 YouTube exports.
        </p>
      </div>

      {/* Search Input */}
      <form onSubmit={handleSearch} className="relative">
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
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowCustomLyrics(!showCustomLyrics)}
          className="w-full flex items-center justify-between px-4 py-3 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          <span className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-cyan-400" />
            (Optional) Provide custom lyrics text
          </span>
          {showCustomLyrics ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showCustomLyrics && (
          <div className="p-4 pt-1 border-t border-slate-800/50">
            <textarea
              value={customLyrics}
              onChange={(e) => setCustomLyrics(e.target.value)}
              placeholder="Paste line-by-line lyrics here. If left blank, synchronized lyrics are queried automatically from LRCLIB."
              rows={4}
              className="w-full p-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500 font-mono"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/50 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Search Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-1">
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
                  <h4 className="text-sm font-semibold text-white group-hover:text-cyan-300 truncate transition-colors">
                    {track.title}
                  </h4>
                  <p className="text-xs text-slate-400 truncate mt-0.5">
                    {track.artist} {track.duration ? `• ${formatDuration(track.duration)}` : ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 ml-4 px-3.5 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-500 group-hover:text-slate-950 font-medium text-xs transition-all border border-cyan-500/30"
              >
                Create Karaoke
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Studio Library / Recent Songs */}
      <div className="pt-4 border-t border-slate-800/80 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('my')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                activeTab === 'my'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <FolderHeart className="w-3.5 h-3.5" />
              My Songs ({myProjects.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('community')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                activeTab === 'community'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                  : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              Community Library ({libraryProjects.length})
            </button>
          </div>
          <button
            type="button"
            onClick={fetchLibrary}
            className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            Refresh
          </button>
        </div>

        {loadingLibrary ? (
          <div className="py-8 text-center text-xs text-slate-500">
            Loading library tracks...
          </div>
        ) : displayProjects.length === 0 ? (
          <div className="py-8 text-center rounded-xl bg-slate-900/30 border border-slate-800/50 p-6 space-y-1">
            <p className="text-xs text-slate-400">
              {activeTab === 'my'
                ? `No songs created yet by "${currentUser}". Search a song above to generate your first track!`
                : 'No tracks in the studio library yet.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {displayProjects.map((p) => {
              const isReady = p.status === 'ready';
              return (
                <div
                  key={p.id}
                  onClick={() => onOpenProject && onOpenProject(p)}
                  className="group flex items-center gap-3 p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-cyan-500/50 hover:bg-slate-800/50 transition-all cursor-pointer shadow"
                >
                  {p.thumbnail_url ? (
                    <img
                      src={p.thumbnail_url}
                      alt={p.title || 'Track'}
                      className="w-14 h-14 object-cover rounded-lg shrink-0 shadow"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                      <Music className="w-5 h-5 text-slate-500" />
                    </div>
                  )}

                  <div className="truncate flex-1 min-w-0">
                    <h4 className="text-xs font-semibold text-white group-hover:text-cyan-300 truncate transition-colors">
                      {p.title || `Track ${p.id}`}
                    </h4>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      {p.artist || 'Karaoke'}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          isReady
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                        }`}
                      >
                        {isReady ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
                        {isReady ? 'Ready' : p.status}
                      </span>
                      {p.created_by && (
                        <span className="text-[10px] text-slate-500 truncate">
                          by {p.created_by}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 p-2 rounded-lg bg-slate-800/60 text-slate-400 group-hover:bg-cyan-500 group-hover:text-slate-950 transition-colors">
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

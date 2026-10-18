/**
 * Project Library Component
 *
 * Displays the recent projects library grid with tab filtering ("My Songs" vs
 * "Community Library"), status indicators, metadata editing, and project deletion.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  FolderHeart,
  Globe,
  Music,
  CheckCircle2,
  Clock,
  Play,
  Pencil,
  Trash2,
  Search,
  X,
} from 'lucide-react';
import { ProjectState } from '../../types';
import { apiFetch } from '../../api';
import { DeleteConfirmModal } from '../DeleteConfirmModal';
import { EditMetadataModal } from '../EditMetadataModal';
import { Tooltip } from '../Tooltip';

export interface ProjectLibraryProps {
  currentUser?: string;
  authToken?: string;
  onOpenProject?: (project: ProjectState) => void;
}

export const ProjectLibrary: React.FC<ProjectLibraryProps> = ({
  currentUser = 'Friend',
  authToken = '',
  onOpenProject,
}) => {
  const [libraryProjects, setLibraryProjects] = useState<ProjectState[]>([]);
  const [activeTab, setActiveTab] = useState<'my' | 'community'>('my');
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [deletingProject, setDeletingProject] = useState<ProjectState | null>(null);
  const [editingProject, setEditingProject] = useState<ProjectState | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'in_progress_error'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'title_asc' | 'artist_asc'>('recent');

  const handleProjectDeleted = (deletedId: string) => {
    setLibraryProjects((prev) => prev.filter((p) => p.id !== deletedId));
    setDeletingProject(null);
  };

  const handleMetadataSaved = (updated: { id: string; title: string; artist: string }) => {
    setLibraryProjects((prev) =>
      prev.map((p) =>
        p.id === updated.id ? { ...p, title: updated.title, artist: updated.artist } : p
      )
    );
    setEditingProject(null);
  };

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

  const myProjects = useMemo(
    () =>
      libraryProjects.filter(
        (p) => p.created_by && p.created_by.toLowerCase() === currentUser.toLowerCase()
      ),
    [libraryProjects, currentUser]
  );
  const baseProjects = activeTab === 'my' ? myProjects : libraryProjects;

  const filteredProjects = useMemo(() => {
    let result = [...baseProjects];

    if (statusFilter === 'ready') {
      result = result.filter((p) => p.status === 'ready');
    } else if (statusFilter === 'in_progress_error') {
      result = result.filter((p) => p.status !== 'ready');
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((p) => {
        const titleMatch = (p.title || '').toLowerCase().includes(q);
        const artistMatch = (p.artist || '').toLowerCase().includes(q);
        const creatorMatch = (p.created_by || '').toLowerCase().includes(q);
        return titleMatch || artistMatch || creatorMatch;
      });
    }

    if (sortBy === 'title_asc') {
      result.sort((a, b) => {
        const titleA = (a.title || a.id || '').toLowerCase();
        const titleB = (b.title || b.id || '').toLowerCase();
        return titleA.localeCompare(titleB);
      });
    } else if (sortBy === 'artist_asc') {
      result.sort((a, b) => {
        const artistA = (a.artist || '').toLowerCase();
        const artistB = (b.artist || '').toLowerCase();
        return artistA.localeCompare(artistB);
      });
    } else {
      result.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    }

    return result;
  }, [baseProjects, statusFilter, searchQuery, sortBy]);

  return (
    <div className="pt-4 border-t border-slate-800/80 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex items-center gap-1.5 sm:gap-2 flex-wrap"
          role="tablist"
          aria-label="Song library filters"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'my'}
            aria-label={`My Songs (${myProjects.length})`}
            onClick={() => setActiveTab('my')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors min-h-[36px] ${
              activeTab === 'my'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <FolderHeart className="w-3.5 h-3.5" aria-hidden="true" />
            My Songs ({myProjects.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'community'}
            aria-label={`Community Library (${libraryProjects.length})`}
            onClick={() => setActiveTab('community')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors min-h-[36px] ${
              activeTab === 'community'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <Globe className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden xs:inline sm:inline">Community </span>Library (
            {libraryProjects.length})
          </button>
        </div>
        <button
          type="button"
          onClick={fetchLibrary}
          className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors py-1 px-2 min-h-[36px] flex items-center"
        >
          Refresh
        </button>
      </div>

      {/* Search, Filter & Sort Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search
            className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search library by title, artist, or creator..."
            aria-label="Search project library"
            className="w-full bg-slate-900/80 border border-slate-800 text-slate-200 placeholder-slate-500 text-xs rounded-xl pl-9 pr-8 py-2 min-h-[36px] focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search query"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white rounded-md min-h-[28px] min-w-[28px] flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'all' | 'ready' | 'in_progress_error')
            }
            aria-label="Filter projects by status"
            className="bg-slate-900/80 border border-slate-800 text-slate-300 text-xs rounded-xl px-2.5 py-1.5 min-h-[36px] focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 cursor-pointer flex-1 sm:flex-initial"
          >
            <option value="all">All Statuses</option>
            <option value="ready">Ready</option>
            <option value="in_progress_error">In Progress / Error</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'recent' | 'title_asc' | 'artist_asc')}
            aria-label="Sort projects"
            className="bg-slate-900/80 border border-slate-800 text-slate-300 text-xs rounded-xl px-2.5 py-1.5 min-h-[36px] focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 cursor-pointer flex-1 sm:flex-initial"
          >
            <option value="recent">Recent (Newest)</option>
            <option value="title_asc">Title (A–Z)</option>
            <option value="artist_asc">Artist (A–Z)</option>
          </select>

          {(searchQuery || statusFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStatusFilter('all');
              }}
              aria-label="Reset filters"
              className="text-[11px] text-cyan-400 hover:text-cyan-300 py-1.5 px-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 min-h-[36px] transition-colors"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {loadingLibrary ? (
        <div className="py-8 text-center text-xs text-slate-500">Loading library tracks...</div>
      ) : baseProjects.length === 0 ? (
        <div className="py-8 text-center rounded-xl bg-slate-900/30 border border-slate-800/50 p-6 space-y-1">
          <p className="text-xs text-slate-400">
            {activeTab === 'my'
              ? `No songs created yet by "${currentUser}". Search a song above to generate your first track!`
              : 'No tracks in the studio library yet.'}
          </p>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="py-8 text-center rounded-xl bg-slate-900/30 border border-slate-800/50 p-6 space-y-3">
          <p className="text-xs text-slate-400">
            No matching songs found for your search or filter.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('all');
            }}
            aria-label="Clear filters and restore tracks"
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-medium transition-colors min-h-[36px]"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filteredProjects.map((p) => {
            const isReady = p.status === 'ready';
            return (
              <div
                key={p.id}
                onClick={() => onOpenProject && onOpenProject(p)}
                className="group flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-cyan-500/50 hover:bg-slate-800/50 transition-all cursor-pointer shadow min-h-[64px]"
              >
                <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                  {p.thumbnail_url ? (
                    <img
                      src={p.thumbnail_url}
                      alt={p.title || 'Track'}
                      className="w-12 h-12 sm:w-14 sm:h-14 object-cover rounded-lg shrink-0 shadow"
                    />
                  ) : (
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                      <Music className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" />
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
                        {isReady ? (
                          <CheckCircle2 className="w-2.5 h-2.5" />
                        ) : (
                          <Clock className="w-2.5 h-2.5" />
                        )}
                        {isReady ? 'Ready' : p.status}
                      </span>
                      {p.created_by && (
                        <span className="text-[10px] text-slate-500 truncate">
                          by {p.created_by}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1.5 shrink-0 self-end sm:self-center">
                  <Tooltip content="Edit song title and artist" position="top">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingProject(p);
                      }}
                      aria-label={`Edit metadata for ${p.title || p.id}`}
                      className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl bg-slate-800/70 hover:bg-slate-700 text-slate-400 hover:text-cyan-300 transition-colors flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                      <Pencil className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </Tooltip>
                  <Tooltip content="Delete project and media files" position="top">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingProject(p);
                      }}
                      aria-label={`Delete project ${p.title || p.id}`}
                      className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl bg-slate-800/70 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 transition-colors flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-rose-500"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </Tooltip>
                  <div
                    aria-hidden="true"
                    className="shrink-0 p-2 rounded-xl bg-slate-800/60 text-slate-400 group-hover:bg-cyan-500 group-hover:text-slate-950 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                  >
                    <Play className="w-4 h-4 fill-current" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DeleteConfirmModal
        isOpen={Boolean(deletingProject)}
        projectId={deletingProject?.id || ''}
        projectTitle={deletingProject?.title || ''}
        projectArtist={deletingProject?.artist}
        onClose={() => setDeletingProject(null)}
        onDeleted={handleProjectDeleted}
      />

      <EditMetadataModal
        isOpen={Boolean(editingProject)}
        project={
          editingProject
            ? {
                id: editingProject.id,
                title: editingProject.title || '',
                artist: editingProject.artist || '',
              }
            : null
        }
        onClose={() => setEditingProject(null)}
        onSaved={handleMetadataSaved}
      />
    </div>
  );
};

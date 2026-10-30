/**
 * Project Library Component
 *
 * The song library below the intake card: "My Songs" / "Community Library" tabs,
 * search, status filter and sort, and a grid of album-art cards with edit and delete
 * actions. Shows skeleton cards while the library loads.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  type LucideIcon,
  FolderHeart,
  Globe,
  Library,
  Music,
  Pencil,
  Play,
  RefreshCw,
  Search,
  SearchX,
  Trash2,
  X,
} from 'lucide-react';
import { ProjectState } from '../../types';
import { apiFetch, readApiError } from '../../api';
import { DeleteConfirmModal } from '../DeleteConfirmModal';
import { EditMetadataModal } from '../EditMetadataModal';
import { IconButton } from '../ui/IconButton';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { focusRing } from '../ui/variants';
import { cn } from '../../utils/cn';

export interface ProjectLibraryProps {
  currentUser?: string;
  authToken?: string;
  onOpenProject?: (project: ProjectState) => void;
}

type LibraryTab = 'my' | 'community';
type StatusFilter = 'all' | 'ready' | 'in_progress_error';
type SortKey = 'recent' | 'title_asc' | 'artist_asc';

const TAB_IDS: Record<LibraryTab, string> = {
  my: 'library-tab-my',
  community: 'library-tab-community',
};

const controlCls =
  'min-h-[36px] rounded-theme-md border border-theme-border-subtle bg-theme-surface text-xs text-theme-text shadow-theme-sm focus:border-theme-accent focus:outline-none focus:ring-2 focus:ring-theme-focus/50';

const statusLabel = (status: string) => status.replace(/_/g, ' ');

/** Badge shown over a library card's artwork for its processing status. */
const statusBadge = (status: string): { label: string; Icon: LucideIcon; tone: string } => {
  if (status === 'ready')
    return { label: 'Ready', Icon: CheckCircle2, tone: 'bg-theme-success/30' };
  if (status === 'error') return { label: 'Error', Icon: AlertCircle, tone: 'bg-theme-danger/50' };
  if (status === 'cancelled') return { label: 'Cancelled', Icon: XCircle, tone: 'bg-black/50' };
  return { label: statusLabel(status), Icon: Clock, tone: 'bg-theme-warning/35' };
};

export const ProjectLibrary: React.FC<ProjectLibraryProps> = ({
  currentUser = 'Friend',
  authToken = '',
  onOpenProject,
}) => {
  const [libraryProjects, setLibraryProjects] = useState<ProjectState[]>([]);
  const [activeTab, setActiveTab] = useState<LibraryTab>('my');
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [deletingProject, setDeletingProject] = useState<ProjectState | null>(null);
  const [editingProject, setEditingProject] = useState<ProjectState | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const tabRefs = useRef<Record<LibraryTab, HTMLButtonElement | null>>({
    my: null,
    community: null,
  });

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

  const fetchLibrary = async () => {
    setLoadingLibrary(true);
    setLibraryError(null);
    try {
      const res = await apiFetch('/api/projects?scope=all');
      if (!res.ok) {
        setLibraryError(await readApiError(res, 'The server could not list your songs.'));
      } else {
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
      setLibraryError('Could not reach the server to load your songs.');
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

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
  };

  const onTabKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End')
      return;
    e.preventDefault();
    const next: LibraryTab =
      e.key === 'Home'
        ? 'my'
        : e.key === 'End'
          ? 'community'
          : activeTab === 'my'
            ? 'community'
            : 'my';
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  };

  const tabs: Array<{
    id: LibraryTab;
    label: string;
    text: React.ReactNode;
    count: number;
    Icon: typeof Globe;
  }> = [
    { id: 'my', label: 'My Songs', text: 'My Songs', count: myProjects.length, Icon: FolderHeart },
    {
      id: 'community',
      label: 'Community Library',
      text: (
        <>
          <span className="hidden sm:inline">Community </span>Library
        </>
      ),
      count: libraryProjects.length,
      Icon: Globe,
    },
  ];

  return (
    <div className="space-y-4 font-theme-body sm:px-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 font-theme-heading text-lg font-bold text-theme-text">
            <Library className="h-5 w-5 text-theme-highlight" aria-hidden="true" />
            Song library
          </h2>
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="tablist"
            aria-label="Song library filters"
          >
            {tabs.map(({ id, label, text, count, Icon }) => {
              const selected = activeTab === id;
              return (
                <button
                  key={id}
                  ref={(el) => {
                    tabRefs.current[id] = el;
                  }}
                  id={TAB_IDS[id]}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="library-panel"
                  tabIndex={selected ? 0 : -1}
                  aria-label={`${label} (${count})`}
                  onClick={() => setActiveTab(id)}
                  onKeyDown={onTabKeyDown}
                  className={cn(
                    'flex min-h-[36px] items-center gap-1.5 rounded-theme-pill border px-3 font-theme-heading text-xs font-semibold transition-colors',
                    selected
                      ? 'border-theme-accent/50 bg-theme-accent/15 text-theme-highlight'
                      : 'border-theme-border-subtle bg-theme-surface text-theme-text-muted hover:border-theme-border hover:text-theme-text',
                    focusRing
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{text}</span>
                  <span className="rounded-theme-pill bg-theme-surface-raised px-1.5 text-[10px] tabular-nums text-theme-text-muted">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchLibrary}
          leftIcon={
            <RefreshCw
              className={cn('h-3.5 w-3.5', loadingLibrary && 'animate-spin')}
              aria-hidden="true"
            />
          }
          className="min-h-[36px]"
        >
          Refresh
        </Button>
      </div>

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-text-muted"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search library by title, artist, or creator..."
            aria-label="Search project library"
            className={cn(controlCls, 'w-full py-2 pl-9 pr-9 placeholder:text-theme-text-muted')}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search query"
              className={cn(
                'absolute right-1.5 top-1/2 flex min-h-[28px] min-w-[28px] -translate-y-1/2 items-center justify-center rounded-theme-sm p-1 text-theme-text-muted transition-colors hover:text-theme-text',
                focusRing
              )}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Filter projects by status"
            className={cn(controlCls, 'flex-1 cursor-pointer px-2.5 py-1.5 sm:flex-initial')}
          >
            <option value="all">All Statuses</option>
            <option value="ready">Ready</option>
            <option value="in_progress_error">In Progress / Error</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            aria-label="Sort projects"
            className={cn(controlCls, 'flex-1 cursor-pointer px-2.5 py-1.5 sm:flex-initial')}
          >
            <option value="recent">Recent (Newest)</option>
            <option value="title_asc">Title (A–Z)</option>
            <option value="artist_asc">Artist (A–Z)</option>
          </select>

          {(searchQuery || statusFilter !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              aria-label="Reset filters"
              className="min-h-[36px] text-theme-highlight"
            >
              Clear Filters
            </Button>
          )}
        </div>
      </div>

      <div id="library-panel" role="tabpanel" aria-labelledby={TAB_IDS[activeTab]}>
        {loadingLibrary ? (
          <>
            <p className="sr-only">Loading library tracks...</p>
            <div
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              aria-hidden="true"
            >
              {Array.from({ length: 8 }, (_, i) => (
                <div
                  key={i}
                  className="overflow-hidden rounded-theme-lg border border-theme-border-subtle bg-theme-surface"
                >
                  <Skeleton className="aspect-square rounded-none" />
                  <div className="space-y-2 p-3">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : libraryError && baseProjects.length === 0 ? (
          // A failed load is not an empty library: say so and offer to try again
          <EmptyState
            icon={<AlertCircle className="h-6 w-6" />}
            title="Your songs could not be loaded"
            description={libraryError}
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void fetchLibrary()}
                leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                className="min-h-[44px]"
              >
                Retry loading library
              </Button>
            }
          />
        ) : baseProjects.length === 0 ? (
          <EmptyState
            icon={<Music className="h-6 w-6" />}
            title={activeTab === 'my' ? 'No songs yet' : 'The library is empty'}
            description={
              activeTab === 'my'
                ? `No songs created yet by "${currentUser}". Search a song above to generate your first track!`
                : 'No tracks in the studio library yet.'
            }
          />
        ) : filteredProjects.length === 0 ? (
          <EmptyState
            icon={<SearchX className="h-6 w-6" />}
            title="No matching songs"
            description="No matching songs found for your search or filter."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={clearFilters}
                aria-label="Clear filters and restore tracks"
                className="min-h-[36px]"
              >
                Clear Filters
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {/* Keeps heading levels in order: Song library (h2) › this tab › song cards (h4) */}
            <h3 className="sr-only">{activeTab === 'my' ? 'My Songs' : 'Community Library'}</h3>
            {filteredProjects.map((p) => {
              const badge = statusBadge(p.status);
              const title = p.title || `Track ${p.id}`;
              return (
                <div
                  key={p.id}
                  onClick={() => onOpenProject && onOpenProject(p)}
                  className="group relative flex cursor-pointer flex-col overflow-hidden rounded-theme-lg border border-theme-border-subtle bg-theme-surface shadow-theme-sm transition-[border-color,box-shadow,transform] duration-200 hover:border-theme-border hover:shadow-theme-md motion-safe:hover:-translate-y-0.5"
                >
                  <div className="relative aspect-square overflow-hidden bg-theme-surface-raised">
                    {p.thumbnail_url ? (
                      <img
                        src={p.thumbnail_url}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-stage">
                        <Music className="h-8 w-8 text-theme-text-muted" aria-hidden="true" />
                      </div>
                    )}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent"
                    />
                    <span
                      data-status={p.status}
                      className={cn(
                        'absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-theme-pill px-2 py-0.5 text-[10px] font-semibold capitalize text-white backdrop-blur-md',
                        badge.tone
                      )}
                    >
                      <badge.Icon className="h-3 w-3" aria-hidden="true" />
                      {badge.label}
                    </span>
                    <span
                      aria-hidden="true"
                      className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-theme-pill bg-gradient-accent text-theme-accent-text opacity-0 shadow-theme-glow transition-opacity group-hover:opacity-100"
                    >
                      <Play className="ml-0.5 h-4 w-4 fill-current" />
                    </span>
                    <div className="absolute right-1.5 top-1.5 flex gap-1 transition-opacity [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                      <IconButton
                        variant="overlay"
                        size="sm"
                        label={`Edit metadata for ${p.title || p.id}`}
                        tooltip="Edit song title and artist"
                        icon={<Pencil className="h-3.5 w-3.5" />}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingProject(p);
                        }}
                      />
                      <IconButton
                        variant="overlay"
                        size="sm"
                        label={`Delete project ${p.title || p.id}`}
                        tooltip="Delete project and media files"
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        className="hover:bg-theme-danger/80"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingProject(p);
                        }}
                      />
                    </div>
                  </div>

                  <div className="min-w-0 space-y-0.5 p-2.5 sm:p-3">
                    <h4 className="truncate font-theme-heading text-sm font-semibold text-theme-text">
                      <button
                        type="button"
                        className={cn(
                          'max-w-full truncate rounded-theme-sm text-left transition-colors group-hover:text-theme-highlight',
                          focusRing
                        )}
                      >
                        {title}
                      </button>
                    </h4>
                    <p className="truncate text-xs text-theme-text-muted">
                      {p.artist || 'Karaoke'}
                    </p>
                    {p.created_by && (
                      <p className="truncate text-[11px] text-theme-text-muted/80">
                        by {p.created_by}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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

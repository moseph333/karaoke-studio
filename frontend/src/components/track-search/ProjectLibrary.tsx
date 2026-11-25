/**
 * Project Library Component
 *
 * The song library below the intake band, laid out as a setlist: "My Songs" / "Community
 * Library" tabs, search, status filter and sort, and one row per song with its number, cover,
 * title, artist and length. A song that is still being made, or failed, says so in place of
 * its length; a finished song says nothing. Shows skeleton rows while the library loads.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Clock,
  XCircle,
  Disc3,
  type LucideIcon,
  Music,
  Pencil,
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
import { Spinner } from '../ui/Spinner';
import { focusRing } from '../ui/variants';
import { cn } from '../../utils/cn';
import { formatTime } from '../../utils/format';

/** How many songs the library holds, reported after each successful load. */
export interface LibraryCounts {
  /** Songs made by the current user. */
  mine: number;
  /** Every song on the server. */
  total: number;
}

export interface ProjectLibraryProps {
  currentUser?: string;
  authToken?: string;
  onOpenProject?: (project: ProjectState) => void;
  /** Called when the library has loaded (and when the user's own count changes). */
  onCounts?: (counts: LibraryCounts) => void;
  /** The song being fetched in full after its card was chosen; its card shows a spinner. */
  openingProjectId?: string | null;
}

type LibraryTab = 'my' | 'community';
type StatusFilter = 'all' | 'ready' | 'in_progress_error';
type SortKey = 'recent' | 'title_asc' | 'artist_asc';

const TAB_IDS: Record<LibraryTab, string> = {
  my: 'library-tab-my',
  community: 'library-tab-community',
};

const controlCls =
  'min-h-[36px] border border-theme-border bg-theme-bg text-sm text-theme-text focus:border-theme-accent focus:outline-none';

const statusLabel = (status: string) => status.replace(/_/g, ' ');

interface SongState {
  label: string;
  Icon: LucideIcon;
  tone: string;
  /** Percent done while the song is being made, else null. */
  progress: number | null;
}

/**
 * What a row says in place of the song's length. A finished song says nothing (null): only
 * a song that is still being made, failed, was cancelled or is a whole album is labelled.
 */
const songState = (project: ProjectState): SongState | null => {
  const { status } = project;
  if (status === 'ready') return null;
  if (status === 'error')
    return { label: 'Failed', Icon: AlertCircle, tone: 'text-theme-danger', progress: null };
  if (status === 'cancelled')
    return { label: 'Cancelled', Icon: XCircle, tone: 'text-theme-text-muted', progress: null };
  if (status === 'album')
    return { label: 'Album', Icon: Disc3, tone: 'text-theme-text', progress: null };
  const progress = Math.max(0, Math.min(100, Math.round(project.progress || 0)));
  return {
    label: `${statusLabel(status)} ${progress}%`,
    Icon: Clock,
    tone: 'text-theme-accent',
    progress,
  };
};

export const ProjectLibrary: React.FC<ProjectLibraryProps> = ({
  currentUser = 'Friend',
  authToken = '',
  onOpenProject,
  onCounts,
  openingProjectId = null,
}) => {
  const [libraryProjects, setLibraryProjects] = useState<ProjectState[]>([]);
  const [activeTab, setActiveTab] = useState<LibraryTab>('my');
  // Until the visitor picks a tab, the library chooses one for them (see below)
  const tabChosenRef = useRef(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
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
      // Card-sized entries only; a song is fetched in full when it is opened
      const res = await apiFetch('/api/projects?scope=all&summary=1');
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
        setLoadedOnce(true);
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

  const myCount = myProjects.length;
  const totalCount = libraryProjects.length;
  useEffect(() => {
    if (!loadedOnce) return;
    onCounts?.({ mine: myCount, total: totalCount });
    // A visitor with no songs of their own lands on the songs that are there, not on an
    // empty "My Songs"
    if (!tabChosenRef.current && myCount === 0 && totalCount > 0) setActiveTab('community');
    // onCounts is left out: a new callback identity is not a new count
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedOnce, myCount, totalCount]);

  const selectTab = (tab: LibraryTab) => {
    tabChosenRef.current = true;
    setActiveTab(tab);
  };

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
    selectTab(next);
    tabRefs.current[next]?.focus();
  };

  const tabs: Array<{ id: LibraryTab; label: string; text: string; count: number }> = [
    { id: 'my', label: 'My Songs', text: 'My Songs', count: myProjects.length },
    {
      id: 'community',
      label: 'Community Library',
      text: 'Community',
      count: libraryProjects.length,
    },
  ];

  // A song's number is the order it was made in within this tab (the oldest is 01)
  const songNumbers = useMemo(() => {
    const oldestFirst = [...baseProjects].sort(
      (a, b) => (a.created_at ?? 0) - (b.created_at ?? 0) || a.id.localeCompare(b.id)
    );
    return new Map(oldestFirst.map((project, index) => [project.id, index + 1]));
  }, [baseProjects]);

  return (
    <div className="mt-10 space-y-4 border-t-2 border-theme-border pt-5 font-theme-body sm:mt-14 sm:pt-6">
      <div
        data-guide="setlist"
        className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2"
      >
        <h2 className="ks-display text-[36px] font-black text-theme-text sm:text-[64px] sm:leading-[0.9]">
          Setlist
        </h2>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <div
            className="flex flex-wrap items-center gap-x-5"
            role="tablist"
            aria-label="Song library filters"
          >
            {tabs.map(({ id, label, text, count }) => {
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
                  onClick={() => selectTab(id)}
                  onKeyDown={onTabKeyDown}
                  className={cn(
                    'ks-display flex min-h-[44px] items-center gap-2 border-b-[3px] text-[22px] transition-colors md:min-h-[38px]',
                    selected
                      ? 'border-theme-accent text-theme-text'
                      : 'border-transparent text-theme-text-muted hover:text-theme-text',
                    focusRing
                  )}
                >
                  <span>{text}</span>
                  <span className="tabular-nums text-theme-text-muted">{count}</span>
                </button>
              );
            })}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchLibrary}
            leftIcon={
              <RefreshCw
                className={cn('h-4 w-4', loadingLibrary && 'animate-spin')}
                aria-hidden="true"
              />
            }
            className="min-h-[36px]"
          >
            Refresh
          </Button>
        </div>
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
                'absolute right-1.5 top-1/2 flex min-h-[28px] min-w-[28px] -translate-y-1/2 items-center justify-center p-1 text-theme-text-muted transition-colors hover:text-theme-text',
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
              className="min-h-[36px]"
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
            <div className="border-t border-theme-border-subtle" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b border-theme-border-subtle py-2 sm:gap-5"
                >
                  <Skeleton className="aspect-square h-12 w-12 shrink-0 rounded-none" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-5 w-2/5" />
                    <Skeleton className="h-3 w-1/4" />
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
                leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
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
          <div className="border-t border-theme-border-subtle">
            {/* Keeps heading levels in order: Setlist (h2) › this tab › songs (h4) */}
            <h3 className="sr-only">{activeTab === 'my' ? 'My Songs' : 'Community Library'}</h3>
            {filteredProjects.map((p) => {
              const state = songState(p);
              const title = p.title || `Track ${p.id}`;
              const opening = openingProjectId === p.id;
              return (
                <div
                  key={p.id}
                  aria-busy={opening || undefined}
                  onClick={() => onOpenProject && onOpenProject(p)}
                  // On a phone a song's state drops to a line of its own under the title
                  className="group flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 border-b border-theme-border-subtle py-2 transition-colors hover:bg-theme-surface-subtle sm:flex-nowrap sm:gap-x-5"
                >
                  {/* The order the song was made in, so sorting and filtering never renumber */}
                  <span
                    aria-hidden="true"
                    className="ks-display hidden w-10 shrink-0 text-[30px] tabular-nums text-theme-text-muted sm:block"
                  >
                    {opening ? (
                      <Spinner className="h-5 w-5" />
                    ) : (
                      String(songNumbers.get(p.id) ?? 0).padStart(2, '0')
                    )}
                  </span>
                  <span className="relative block aspect-square h-12 w-12 shrink-0 overflow-hidden bg-theme-surface-raised">
                    {p.thumbnail_url ? (
                      <img
                        src={p.thumbnail_url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center">
                        <Music className="h-5 w-5 text-theme-text-muted" aria-hidden="true" />
                      </span>
                    )}
                  </span>

                  <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-5">
                    <h4 className="ks-display min-w-0 truncate text-[26px] text-theme-text sm:flex-[1.2] sm:text-[36px]">
                      <button
                        type="button"
                        className={cn('max-w-full truncate text-left uppercase', focusRing)}
                      >
                        {title}
                      </button>
                    </h4>
                    <p className="min-w-0 truncate text-sm text-theme-text-muted sm:flex-1 sm:text-base">
                      {p.artist || 'Karaoke'}
                      {activeTab === 'community' && p.created_by && <span> by {p.created_by}</span>}
                    </p>
                  </div>

                  <span
                    data-status={p.status}
                    className={cn(
                      'shrink-0 flex-col gap-1 text-sm tabular-nums sm:w-44 sm:items-end sm:text-right',
                      state
                        ? cn(
                            'order-last flex w-full items-start pl-[3.75rem] sm:order-none sm:pl-0',
                            state.tone
                          )
                        : 'hidden text-theme-text sm:flex'
                    )}
                  >
                    {state ? (
                      <>
                        <span className="ks-display flex items-center gap-1.5 text-[20px]">
                          <state.Icon className="h-4 w-4" aria-hidden="true" />
                          {state.label}
                        </span>
                        {state.progress !== null && (
                          <span
                            aria-hidden="true"
                            className="block h-1 w-24 bg-theme-surface-raised"
                          >
                            <span
                              className="block h-1 bg-theme-accent"
                              style={{ width: `${state.progress}%` }}
                            />
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="sr-only">Ready</span>
                        {p.duration ? formatTime(p.duration) : null}
                      </>
                    )}
                  </span>

                  <div className="flex shrink-0 transition-opacity [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                    <IconButton
                      variant="ghost"
                      size="sm"
                      label={`Edit metadata for ${p.title || p.id}`}
                      tooltip="Edit song title and artist"
                      icon={<Pencil className="h-4 w-4" />}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingProject(p);
                      }}
                    />
                    <IconButton
                      variant="ghost"
                      size="sm"
                      label={`Delete project ${p.title || p.id}`}
                      tooltip="Delete project and media files"
                      icon={<Trash2 className="h-4 w-4" />}
                      className="hover:text-theme-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingProject(p);
                      }}
                    />
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

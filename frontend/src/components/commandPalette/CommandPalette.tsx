/**
 * Command Palette
 *
 * Ctrl/⌘+K search over every registered command plus live sources (songs, lyric lines).
 * A combobox input drives a grouped listbox: arrows, Home/End and Page Up/Down move the
 * active option, Enter runs it and Escape closes (focus returns to where it was).
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Kbd } from '../ui/Kbd';
import { cn } from '../../utils/cn';
import { PALETTE_MODAL_ID, PaletteCommand, PaletteSource } from './context';
import { scoreItem } from './fuzzy';
import { loadRecentCommandIds, rememberRecentCommand } from './recent';

export interface CommandPaletteProps {
  onClose: () => void;
  getCommands: () => PaletteCommand[];
  getSources: () => PaletteSource[];
  /** Changes when commands or sources are (un)registered. */
  registryVersion: number;
}

interface Section {
  group: string;
  items: PaletteCommand[];
}

const RESULT_LIMIT = 50;
const RECENT_LIMIT = 5;
const PAGE_STEP = 8;
/** Score given to source results the fuzzy ranker cannot place (the source matched them). */
const SOURCE_FALLBACK_SCORE = 500;

function groupInOrder(items: PaletteCommand[]): Section[] {
  const sections: Section[] = [];
  const byGroup = new Map<string, Section>();
  for (const item of items) {
    let section = byGroup.get(item.group);
    if (!section) {
      section = { group: item.group, items: [] };
      byGroup.set(item.group, section);
      sections.push(section);
    }
    section.items.push(item);
  }
  return sections;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  onClose,
  getCommands,
  getSources,
  registryVersion,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [sourceResults, setSourceResults] = useState<Record<string, PaletteCommand[]>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const baseId = useId().replace(/:/g, '');
  const titleId = `${baseId}-title`;
  const listboxId = `${baseId}-listbox`;
  const optionDomId = (id: string) => `${baseId}-opt-${id.replace(/[^\w-]/g, '_')}`;

  // Read on every render so titles like "Play" / "Pause" follow the live state
  const commands = getCommands();

  useEffect(() => {
    getSources().forEach((source) => source.warm?.());
  }, [getSources]);

  useEffect(() => {
    const q = query.trim();
    const controller = new AbortController();
    const sources = getSources();
    const active = sources.filter((s) => q.length >= (s.minQueryLength ?? 1));
    setSourceResults((prev) => {
      const next: Record<string, PaletteCommand[]> = {};
      for (const s of active) if (prev[s.id]) next[s.id] = prev[s.id];
      return next;
    });
    for (const source of active) {
      Promise.resolve()
        .then(() => source.load(q, controller.signal))
        .then((items) => {
          if (!controller.signal.aborted) {
            setSourceResults((prev) => ({ ...prev, [source.id]: items }));
          }
        })
        .catch((err) => {
          if (!controller.signal.aborted) console.error(`Palette source ${source.id} failed`, err);
        });
    }
    return () => controller.abort();
  }, [query, getSources, registryVersion]);

  const sections = useMemo<Section[]>(() => {
    const q = query.trim();
    if (!q) {
      const byId = new Map(commands.map((c) => [c.id, c]));
      const recent = loadRecentCommandIds()
        .map((id) => byId.get(id))
        .filter((c): c is PaletteCommand => Boolean(c))
        .slice(0, RECENT_LIMIT);
      const recentIds = new Set(recent.map((c) => c.id));
      const rest = commands
        .filter((c) => !recentIds.has(c.id))
        .slice(0, RESULT_LIMIT - recent.length);
      return [
        ...(recent.length ? [{ group: 'Recent', items: recent }] : []),
        ...groupInOrder(rest),
      ];
    }

    const seen = new Set<string>();
    const scored: { item: PaletteCommand; score: number; order: number }[] = [];
    let order = 0;
    const consider = (item: PaletteCommand, fromSource: boolean) => {
      if (seen.has(item.id)) return;
      const score = scoreItem(q, item);
      if (score === null && !fromSource) return;
      seen.add(item.id);
      scored.push({ item, score: score ?? SOURCE_FALLBACK_SCORE, order: order++ });
    };
    commands.forEach((c) => consider(c, false));
    Object.values(sourceResults).forEach((items) => items.forEach((c) => consider(c, true)));
    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    return groupInOrder(scored.slice(0, RESULT_LIMIT).map((s) => s.item));
  }, [query, commands, sourceResults]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const activeIndex = Math.max(
    0,
    flat.findIndex((c) => c.id === activeId)
  );
  const active = flat[activeIndex] ?? null;
  const activeDomId = active ? optionDomId(active.id) : undefined;

  // Keep the active option visible while moving through a long list
  useEffect(() => {
    if (activeDomId) document.getElementById(activeDomId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeDomId]);

  const run = (command: PaletteCommand) => {
    if (!command.transient) rememberRecentCommand(command.id);
    if (!command.keepOpen) onClose();
    // Run after the palette has closed so dialogs and focus moves land on the page
    window.setTimeout(() => {
      Promise.resolve()
        .then(() => command.run())
        .catch((err) => console.error(`Command "${command.title}" failed`, err));
    }, 0);
  };

  const moveTo = (index: number) => {
    if (flat.length === 0) return;
    const clamped = Math.min(Math.max(index, 0), flat.length - 1);
    setActiveId(flat[clamped].id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const last = flat.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        moveTo(activeIndex >= last ? 0 : activeIndex + 1);
        break;
      case 'ArrowUp':
        moveTo(activeIndex <= 0 ? last : activeIndex - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(last);
        break;
      case 'PageDown':
        moveTo(activeIndex + PAGE_STEP);
        break;
      case 'PageUp':
        moveTo(activeIndex - PAGE_STEP);
        break;
      case 'Enter':
        if (active) run(active);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const resultLabel =
    flat.length === 0 ? 'No results' : `${flat.length} ${flat.length === 1 ? 'result' : 'results'}`;

  return (
    <Dialog
      open
      onClose={onClose}
      titleId={titleId}
      variant="palette"
      size="2xl"
      dataModal={PALETTE_MODAL_ID}
      initialFocusRef={inputRef}
      className="flex max-h-[min(80vh,640px)] flex-col overflow-hidden p-0 pb-[env(safe-area-inset-bottom,0px)] sm:p-0 sm:pb-0"
    >
      <h2 id={titleId} className="sr-only">
        Command palette
      </h2>

      <div className="flex shrink-0 items-center gap-3 border-b border-theme-border-subtle px-4">
        <Search className="h-5 w-5 shrink-0 text-theme-text-muted" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search commands, songs, and lyrics"
          aria-expanded={flat.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={activeDomId}
          aria-autocomplete="list"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Type a command, song, or lyric…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveId(null);
          }}
          onKeyDown={onKeyDown}
          className="min-h-[56px] w-full min-w-0 bg-transparent text-base text-theme-text placeholder:text-theme-text-muted focus:outline-none"
        />
        <Kbd keys="Esc" className="hidden shrink-0 sm:inline-flex" />
      </div>

      <div
        id={listboxId}
        role="listbox"
        aria-label="Commands and results"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
      >
        {sections.map((section) => {
          const headerId = `${baseId}-group-${section.group.replace(/[^\w-]/g, '_')}`;
          return (
            <div key={section.group} role="group" aria-labelledby={headerId} className="mb-1">
              <div
                id={headerId}
                role="presentation"
                className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-theme-text-muted"
              >
                {section.group}
              </div>
              {section.items.map((item) => {
                const isActive = item.id === active?.id;
                return (
                  <div
                    key={item.id}
                    id={optionDomId(item.id)}
                    role="option"
                    aria-selected={isActive}
                    data-command-id={item.id}
                    onMouseMove={() => {
                      if (!isActive) setActiveId(item.id);
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => run(item)}
                    className={cn(
                      'flex min-h-[44px] cursor-pointer select-none items-center gap-3 rounded-theme-md px-2.5 py-2 text-sm',
                      isActive
                        ? 'bg-theme-accent/15 text-theme-text ring-1 ring-inset ring-theme-accent/40'
                        : 'text-theme-text'
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4',
                        isActive ? 'text-theme-highlight' : 'text-theme-text-muted'
                      )}
                    >
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.title}</span>
                      {item.subtitle && (
                        <span className="block truncate text-xs text-theme-text-muted">
                          {item.subtitle}
                        </span>
                      )}
                    </span>
                    {item.shortcut && <Kbd keys={item.shortcut} className="shrink-0" />}
                  </div>
                );
              })}
            </div>
          );
        })}
        {flat.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-theme-text-muted">
            No matches for “{query.trim()}”
          </p>
        )}
      </div>

      <div className="hidden shrink-0 items-center justify-between gap-4 border-t border-theme-border-subtle px-4 py-2.5 text-xs text-theme-text-muted sm:flex">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <Kbd keys={['↑', '↓']} /> Navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd keys="↵" /> Run
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd keys={['Mod', 'K']} /> Toggle
          </span>
        </span>
        <span aria-hidden="true">{resultLabel}</span>
      </div>
      <span className="sr-only" aria-live="polite">
        {resultLabel}
      </span>
    </Dialog>
  );
};

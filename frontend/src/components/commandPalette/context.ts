/**
 * Command palette registry
 *
 * Components register commands and searchable sources while they are mounted; the palette
 * reads them lazily when it opens, so every command runs against the latest state.
 */

import React, { createContext, useContext, useLayoutEffect, useRef, useEffect } from 'react';

/** data-modal marker of the palette dialog. */
export const PALETTE_MODAL_ID = 'command-palette';

export interface PaletteCommand {
  id: string;
  title: string;
  /** Heading the command is listed under (e.g. "Playback", "Stage"). */
  group: string;
  subtitle?: string;
  keywords?: string[];
  icon?: React.ReactNode;
  /** Key caps shown on the right (e.g. ["Space"], ["Mod", "K"]). */
  shortcut?: string[];
  /** Keep the palette open after running (e.g. stepping the key). */
  keepOpen?: boolean;
  /** Excluded from the "Recent" list (e.g. one-off song results). */
  transient?: boolean;
  run: () => void | Promise<unknown>;
}

export interface PaletteSource {
  id: string;
  group: string;
  /** Characters needed before the source is queried (default 1). */
  minQueryLength?: number;
  /** Called when the palette opens, e.g. to prefetch data. */
  warm?: () => void;
  load: (query: string, signal: AbortSignal) => PaletteCommand[] | Promise<PaletteCommand[]>;
}

export interface CommandPaletteContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  registerCommands: (scope: string, getCommands: () => PaletteCommand[]) => () => void;
  registerSource: (id: string, getSource: () => PaletteSource) => () => void;
}

export const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

/** The palette controls, or null outside a CommandPaletteProvider. */
export function useCommandPalette(): CommandPaletteContextValue | null {
  return useContext(CommandPaletteContext);
}

/** Registers `commands` under `scope` while mounted; pass null to register nothing. */
export function useRegisterCommands(
  scope: string,
  commands: PaletteCommand[] | null | undefined
): void {
  const register = useContext(CommandPaletteContext)?.registerCommands;
  const latest = useRef(commands);
  useLayoutEffect(() => {
    latest.current = commands;
  });
  const enabled = Boolean(commands);
  useEffect(() => {
    if (!register || !enabled) return;
    return register(scope, () => latest.current ?? []);
  }, [register, scope, enabled]);
}

/** Registers a searchable source while mounted; pass null to register nothing. */
export function useRegisterCommandSource(source: PaletteSource | null | undefined): void {
  const register = useContext(CommandPaletteContext)?.registerSource;
  const latest = useRef(source);
  useLayoutEffect(() => {
    latest.current = source;
  });
  const id = source?.id;
  useEffect(() => {
    if (!register || !id) return;
    return register(id, () => latest.current as PaletteSource);
  }, [register, id]);
}

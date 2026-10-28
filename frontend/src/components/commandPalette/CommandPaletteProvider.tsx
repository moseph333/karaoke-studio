/**
 * Command Palette Provider
 *
 * Owns the palette's open state, the command/source registry and the global Ctrl/⌘+K
 * shortcut. The palette itself mounts only while open.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CommandPaletteContext,
  CommandPaletteContextValue,
  PALETTE_MODAL_ID,
  PaletteCommand,
  PaletteSource,
} from './context';
import { CommandPalette } from './CommandPalette';
import { isModalActive } from '../../hooks/useKeyboardShortcuts';

export interface CommandPaletteProviderProps {
  children: React.ReactNode;
  /** When false the shortcut is ignored and the palette stays closed (e.g. auth gate). */
  enabled?: boolean;
}

export const CommandPaletteProvider: React.FC<CommandPaletteProviderProps> = ({
  children,
  enabled = true,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const commandScopes = useRef(new Map<string, () => PaletteCommand[]>());
  const sourceGetters = useRef(new Map<string, () => PaletteSource | null>());
  const [registryVersion, setRegistryVersion] = useState(0);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  const registerCommands = useCallback((scope: string, get: () => PaletteCommand[]) => {
    commandScopes.current.set(scope, get);
    setRegistryVersion((v) => v + 1);
    return () => {
      if (commandScopes.current.get(scope) === get) {
        commandScopes.current.delete(scope);
        setRegistryVersion((v) => v + 1);
      }
    };
  }, []);

  const registerSource = useCallback((id: string, get: () => PaletteSource | null) => {
    sourceGetters.current.set(id, get);
    setRegistryVersion((v) => v + 1);
    return () => {
      if (sourceGetters.current.get(id) === get) {
        sourceGetters.current.delete(id);
        setRegistryVersion((v) => v + 1);
      }
    };
  }, []);

  const getCommands = useCallback(
    () => Array.from(commandScopes.current.values()).flatMap((get) => get()),
    []
  );
  const getSources = useCallback(
    () =>
      Array.from(sourceGetters.current.values())
        .map((get) => get())
        .filter((s): s is PaletteSource => Boolean(s)),
    []
  );

  useEffect(() => {
    if (!enabled) {
      setIsOpen(false);
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.repeat) return;
      if (e.key.toLowerCase() !== 'k') return;
      // Another dialog (or the access gate) owns the keyboard while it is open
      const paletteOpen = Boolean(document.querySelector(`[data-modal="${PALETTE_MODAL_ID}"]`));
      if (!paletteOpen && isModalActive()) return;
      e.preventDefault();
      setIsOpen((prev) => !prev);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);

  const value = useMemo<CommandPaletteContextValue>(
    () => ({ isOpen, open, close, toggle, registerCommands, registerSource }),
    [isOpen, open, close, toggle, registerCommands, registerSource]
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      {isOpen && enabled && (
        <CommandPalette
          onClose={close}
          getCommands={getCommands}
          getSources={getSources}
          registryVersion={registryVersion}
        />
      )}
    </CommandPaletteContext.Provider>
  );
};

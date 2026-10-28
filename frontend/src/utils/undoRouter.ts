/**
 * Undo Router
 *
 * Lyric and chord edits keep separate histories, each listening for Ctrl/Cmd+Z. The
 * router decides which history a keyboard undo or redo belongs to so one key press
 * never rewinds both: undo goes to the most recently edited history that can undo,
 * redo to the most recently undone history that can redo.
 */

export type UndoScope = 'lyrics' | 'chords';

export interface UndoScopeState {
  canUndo: () => boolean;
  canRedo: () => boolean;
}

interface ScopeEntry extends UndoScopeState {
  token: symbol;
  lastEdit: number;
  lastUndo: number;
}

const scopes = new Map<UndoScope, ScopeEntry>();
let clock = 0;

/** Registers a history for routing; returns an unregister function. */
export function registerUndoScope(scope: UndoScope, state: UndoScopeState): () => void {
  const token = Symbol(scope);
  const previous = scopes.get(scope);
  scopes.set(scope, {
    ...state,
    token,
    lastEdit: previous?.lastEdit ?? 0,
    lastUndo: previous?.lastUndo ?? 0,
  });
  return () => {
    if (scopes.get(scope)?.token === token) scopes.delete(scope);
  };
}

/** Records that a new undoable edit was made in `scope`. */
export function noteUndoableEdit(scope: UndoScope): void {
  const entry = scopes.get(scope);
  if (entry) entry.lastEdit = ++clock;
}

/** Records that `scope` just performed an undo (so redo returns to it first). */
export function noteUndo(scope: UndoScope): void {
  const entry = scopes.get(scope);
  if (entry) entry.lastUndo = ++clock;
}

/**
 * The scope that should handle a keyboard undo/redo, or null when no registered
 * history can perform it.
 */
export function resolveUndoScope(action: 'undo' | 'redo'): UndoScope | null {
  let best: UndoScope | null = null;
  let bestStamp = -1;
  for (const [scope, entry] of scopes) {
    const able = action === 'undo' ? entry.canUndo() : entry.canRedo();
    if (!able) continue;
    const stamp = action === 'undo' ? entry.lastEdit : entry.lastUndo;
    if (stamp > bestStamp) {
      best = scope;
      bestStamp = stamp;
    }
  }
  return best;
}

// Every history listens to the same key event; the first listener's decision is reused
// so an undo performed by one listener cannot redirect the next one.
const decisions = new WeakMap<Event, UndoScope | null>();

/**
 * True when a keyboard undo/redo should be left to another history. A history that
 * cannot act is still allowed to handle the key when no other history can.
 */
export function isUndoRoutedElsewhere(
  scope: UndoScope,
  action: 'undo' | 'redo',
  event?: Event
): boolean {
  let target: UndoScope | null;
  if (event && decisions.has(event)) {
    target = decisions.get(event) ?? null;
  } else {
    target = resolveUndoScope(action);
    if (event) decisions.set(event, target);
  }
  return target !== null && target !== scope;
}

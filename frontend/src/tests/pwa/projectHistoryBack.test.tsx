/**
 * Back returns from a song to the library (the Android back gesture in the installed app),
 * with ?project= kept in the address bar so a reload reopens the song.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DISCARD_ON_BACK_MESSAGE, useProjectHistory } from '../../hooks/useProjectHistory';

interface Props {
  projectId: string | undefined;
  hasUnsavedEdits: boolean;
}

function setup(initial: Props = { projectId: undefined, hasUnsavedEdits: false }) {
  const onBackToLibrary = vi.fn();
  const onRestoreProject = vi.fn();
  const hook = renderHook(
    (props: Props) => useProjectHistory({ ...props, onBackToLibrary, onRestoreProject }),
    { initialProps: initial }
  );
  return { ...hook, onBackToLibrary, onRestoreProject };
}

/** Moves to a history entry the way Back/Forward do: change the URL, then fire popstate. */
function travelTo(url: string) {
  act(() => {
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

describe('useProjectHistory', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('pushes an entry when a song opens from the library', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const { rerender } = setup();
    rerender({ projectId: 'p1', hasUnsavedEdits: false });
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?project=p1');
  });

  it('replaces the entry when switching straight to another song, so Back still leads home', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const { rerender } = setup();
    rerender({ projectId: 'p1', hasUnsavedEdits: false });
    rerender({ projectId: 'p2', hasUnsavedEdits: false });
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?project=p2');
  });

  it('closes the song on Back', () => {
    const { rerender, onBackToLibrary } = setup();
    rerender({ projectId: 'p1', hasUnsavedEdits: false });
    travelTo('/');
    expect(onBackToLibrary).toHaveBeenCalledTimes(1);
  });

  it('asks before Back discards unsaved edits, and stays on the song if told to', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { rerender, onBackToLibrary } = setup();
    rerender({ projectId: 'p1', hasUnsavedEdits: true });
    travelTo('/');
    expect(confirm).toHaveBeenCalledWith(DISCARD_ON_BACK_MESSAGE);
    expect(onBackToLibrary).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?project=p1');

    confirm.mockReturnValue(true);
    travelTo('/');
    expect(onBackToLibrary).toHaveBeenCalledTimes(1);
  });

  it('steps back over its own entry when the song is closed in the app', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const { rerender } = setup();
    rerender({ projectId: 'p1', hasUnsavedEdits: false });
    rerender({ projectId: undefined, hasUnsavedEdits: false });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('keeps a deep-linked song as is and only clears ?project when it closes', () => {
    window.history.replaceState(null, '', '/?project=p9&t=12');
    const push = vi.spyOn(window.history, 'pushState');
    const back = vi.spyOn(window.history, 'back');
    const { rerender } = setup();
    rerender({ projectId: 'p9', hasUnsavedEdits: false });
    expect(push).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?project=p9&t=12');

    rerender({ projectId: undefined, hasUnsavedEdits: false });
    expect(back).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it('does nothing more after Back already closed the song', () => {
    const back = vi.spyOn(window.history, 'back');
    const { rerender, onBackToLibrary } = setup();
    rerender({ projectId: 'p1', hasUnsavedEdits: false });
    travelTo('/');
    rerender({ projectId: undefined, hasUnsavedEdits: false });
    expect(onBackToLibrary).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });

  it('reopens the song when Forward returns to its entry', () => {
    const { onRestoreProject } = setup();
    travelTo('/?project=p1');
    expect(onRestoreProject).toHaveBeenCalledWith('p1');
  });
});

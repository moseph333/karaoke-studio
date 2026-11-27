/**
 * Show: the host screen of a karaoke night (`/?show=1`).
 *
 * One computer drives two screens: this one is the host's (who is on, the queue, adding a
 * singer), and the stage window is the room's (`/?stage=1`, on the TV). The host adds a
 * singer and their song, a karaoke video from YouTube or a song from the library, and starts
 * each in turn; between singers the stage window calls the next one. The queue and the
 * night's name are kept in this browser, so a reload does not lose them. A song that cannot
 * be found is asked for instead: requests are kept on the server, for the owner to make.
 *
 * It mounts in place of the app (`main.tsx`): it has no library to edit and no song open,
 * only the sign-in, the stage looks as saved, and one `<audio>` element for library songs.
 */

import React, { useCallback, useEffect, useId, useMemo, useReducer, useState } from 'react';
import { ArrowLeft, MonitorUp } from 'lucide-react';
import { isInputElement } from '../../hooks/useKeyboardShortcuts';
import { useScreenWakeLock } from '../../hooks/useScreenWakeLock';
import { useShowPlayer } from '../../hooks/useShowPlayer';
import { useShowVideos } from '../../hooks/useShowVideos';
import { useSongRequests } from '../../hooks/useSongRequests';
import { useToast } from '../../hooks/useToast';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import {
  cleanShowTitle,
  finishedEntries,
  loadShowQueue,
  loadShowTitle,
  newEntryId,
  saveShowQueue,
  saveShowTitle,
  showQueueReducer,
  waitingEntries,
  type ShowSource,
} from '../../utils/showQueue';
import { Button, Input } from '../ui';
import { ShowAddSinger } from './ShowAddSinger';
import { ShowNowSinging } from './ShowNowSinging';
import { ShowQueueList } from './ShowQueueList';
import { ShowRequests } from './ShowRequests';

const POPUP_BLOCKED = 'The browser blocked the stage window. Allow pop-ups for this site.';

export interface ShowScreenProps {
  /** Whether the screen offers the way back to the songs. A show-only sign-in has none: the
   *  library and the studio would not answer it. */
  canLeave?: boolean;
}

export const ShowScreen: React.FC<ShowScreenProps> = ({ canLeave = true }) => {
  const [queue, dispatch] = useReducer(showQueueReducer, undefined, loadShowQueue);
  const [titleText, setTitleText] = useState(loadShowTitle);
  const title = cleanShowTitle(titleText);
  const titleId = useId();
  const { toast } = useToast();

  useEffect(() => saveShowQueue(queue), [queue]);
  useEffect(() => saveShowTitle(title), [title]);
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Karaoke Studio`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  // Every queued video that may still be played is asked about
  const videoIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of queue) {
      if (entry.source.kind === 'youtube' && entry.status !== 'done') {
        ids.add(entry.source.videoId);
      }
    }
    return Array.from(ids);
  }, [queue]);
  const { videos, fetchCopy } = useShowVideos(videoIds);
  // The stage looks as the studio saved them
  const theme = useVisualTheme(undefined, { persist: true });
  const player = useShowPlayer({ queue, dispatch, title, videos, fetchCopy });
  const { stage, current, project, audio, audioEvents } = player;
  useScreenWakeLock(player.isPlaying);

  const waiting = useMemo(() => waitingEntries(queue), [queue]);
  const finished = useMemo(() => finishedEntries(queue), [queue]);

  const openStage = useCallback(() => {
    if (!stage.open()) toast.warning(POPUP_BLOCKED);
  }, [stage, toast]);

  const addSinger = useCallback(
    (singer: string, source: ShowSource) => {
      dispatch({ type: 'add', id: newEntryId(), singer, source });
      toast.success(`${singer} is in the queue`);
    },
    [toast]
  );

  // A song nobody could find goes on the server's request list, with who asked and where
  const { requests, ask } = useSongRequests();
  const requestSong = useCallback(
    async (song: string, singer: string) => {
      const result = await ask(song, singer, title);
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      const count = result.request?.count ?? 1;
      toast.success(
        count > 1
          ? `“${song}” has now been asked for ${count} times`
          : `“${song}” is on the request list`
      );
      return true;
    },
    [ask, title, toast]
  );

  // Space plays and pauses the song on stage
  const { toggle } = player;
  const onStage = Boolean(current);
  useEffect(() => {
    if (!onStage) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey || isInputElement(e.target)) return;
      // On a button, Space presses the button
      if (e.target instanceof HTMLElement && e.target.closest('button, a, [role="tab"]')) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onStage, toggle]);

  return (
    <div className="flex min-h-screen flex-col bg-theme-bg font-theme-body text-theme-text">
      <header className="border-b-2 border-theme-border pt-[env(safe-area-inset-top,0px)]">
        <div className="mx-auto flex w-full max-w-screen-2xl flex-wrap items-end gap-x-6 gap-y-3 px-4 py-3 sm:px-8">
          {canLeave && (
            <a
              href={window.location.pathname}
              className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-theme-text-muted hover:text-theme-text focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to the songs
            </a>
          )}
          <div className="min-w-[12rem] flex-1 sm:max-w-sm">
            <label htmlFor={titleId} className="block text-sm font-semibold text-theme-text">
              Name of the night
            </label>
            <Input
              id={titleId}
              value={titleText}
              maxLength={60}
              autoComplete="off"
              onChange={(e) => setTitleText(e.target.value)}
              onBlur={() => setTitleText(title)}
            />
          </div>
          {stage.canOpen && (
            <div className="ml-auto flex items-center gap-3">
              <p role="status" className="text-sm text-theme-text-muted">
                {stage.isOpen ? 'The stage window is open' : 'No stage window yet'}
              </p>
              <Button
                variant="secondary"
                className="min-h-[44px]"
                leftIcon={<MonitorUp className="h-4 w-4" aria-hidden="true" />}
                onClick={openStage}
              >
                {stage.isOpen ? 'Show stage window' : 'Open stage window'}
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-screen-2xl flex-1 gap-x-10 gap-y-10 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <h1 className="sr-only">{title}: host screen</h1>
        <div className="flex min-w-0 flex-col gap-10">
          <ShowNowSinging
            player={player}
            next={waiting[0] ?? null}
            theme={theme}
            onOpenStage={openStage}
          />
          <ShowQueueList
            waiting={waiting}
            finished={finished}
            videos={videos}
            busy={onStage}
            onStart={player.start}
            onMove={(id, by) => dispatch({ type: 'move', id, by })}
            onRemove={(id) => dispatch({ type: 'remove', id })}
            onAgain={(id) => dispatch({ type: 'again', id })}
            onClearFinished={() => dispatch({ type: 'clear-finished' })}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-10">
          <ShowAddSinger onAdd={addSinger} onRequest={requestSong} />
          <ShowRequests requests={requests} />
        </div>
      </main>

      {project?.master_audio_url && (
        <audio
          key={project.id}
          ref={audio.audioRef}
          data-testid="show-audio"
          src={project.master_audio_url}
          crossOrigin="use-credentials"
          preload="auto"
          onTimeUpdate={audio.handleTimeUpdate}
          onLoadedMetadata={audio.handleLoadedMetadata}
          {...audioEvents}
          className="hidden"
          aria-hidden="true"
        />
      )}
    </div>
  );
};

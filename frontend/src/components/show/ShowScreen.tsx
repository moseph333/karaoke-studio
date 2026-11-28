/**
 * Show: the host screen of a karaoke night (`/?show=1`).
 *
 * One computer drives two screens: this one is the host's (who is on, the queue, adding a
 * singer), and the stage window is the room's (`/?stage=1`, on the TV). The host adds a
 * singer and their song, a karaoke video from YouTube or a song from the library, and starts
 * each in turn; between singers the stage window calls the next one. Singers take turns
 * unless the host turns that off: a singer's next song waits behind everybody who has not
 * been on. The queue, that choice and the night's name are kept in this browser, so a reload
 * does not lose them. A song that cannot be found is asked for instead: requests are kept on
 * the server, for the owner to make.
 *
 * It mounts in place of the app (`main.tsx`): it has no library to edit and no song open,
 * only the sign-in, the stage looks as saved, and one `<audio>` element for library songs.
 */

import React, { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
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
  joinPlace,
  loadShowQueue,
  loadShowTitle,
  loadShowTurns,
  newEntryId,
  saveShowQueue,
  saveShowTitle,
  saveShowTurns,
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
/** A toast with Undo stays this long: the host is usually looking at the room. */
const UNDO_MS = 10_000;

export interface ShowScreenProps {
  /** Whether the screen offers the way back to the songs. A show-only sign-in has none: the
   *  library and the studio would not answer it. */
  canLeave?: boolean;
  /** Goes up each time the host signs in while the screen is open (`useShowAuth`): what the
   *  ended sign-in refused is tried again. */
  session?: number;
}

export const ShowScreen: React.FC<ShowScreenProps> = ({ canLeave = true, session = 0 }) => {
  const [queue, dispatch] = useReducer(showQueueReducer, undefined, loadShowQueue);
  const [titleText, setTitleText] = useState(loadShowTitle);
  const title = cleanShowTitle(titleText);
  const [turns, setTurns] = useState(loadShowTurns);
  const titleId = useId();
  const { toast } = useToast();

  useEffect(() => saveShowQueue(queue), [queue]);
  useEffect(() => saveShowTitle(title), [title]);
  useEffect(() => saveShowTurns(turns), [turns]);
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

  // Signed in again: a song the ended sign-in would not load is tried once more
  const { retry } = player;
  const failed = player.trouble?.kind === 'failed';
  const lastSession = useRef(session);
  useEffect(() => {
    if (session === lastSession.current) return;
    lastSession.current = session;
    if (failed) retry();
  }, [session, failed, retry]);

  const waiting = useMemo(() => waitingEntries(queue), [queue]);
  const finished = useMemo(() => finishedEntries(queue), [queue]);

  const openStage = useCallback(() => {
    if (!stage.open()) toast.warning(POPUP_BLOCKED);
  }, [stage, toast]);

  // A song that did not join the end of the line says where it went
  const addSinger = useCallback(
    (singer: string, source: ShowSource) => {
      const place = joinPlace(queue, singer, turns);
      const ahead = waiting[place - 1];
      dispatch({ type: 'add', id: newEntryId(), singer, source, turns });
      if (place === waiting.length) toast.success(`${singer} is in the queue`);
      else if (ahead) toast.success(`${singer} is in the queue, after ${ahead.singer}`);
      else toast.success(`${singer} is in the queue, next to sing`);
    },
    [queue, waiting, turns, toast]
  );

  // What the host does by hand to a singer can be taken back from the toast that says it.
  // Each Undo is that one action's opposite, so two of them up at once do not collide
  const { current: onNow, finish, skip } = player;
  const takeOff = useCallback(
    (id: string) => {
      const entry = queue.find((e) => e.id === id);
      dispatch({ type: 'set-aside', id });
      if (!entry) return;
      toast.show(`${entry.singer} is off the queue`, 'info', UNDO_MS, {
        label: 'Undo',
        onClick: () => dispatch({ type: 'recall', id }),
      });
    },
    [queue, toast]
  );
  const offStage = useCallback(
    (how: 'finish' | 'skip') => {
      const entry = onNow;
      if (how === 'finish') finish();
      else skip();
      if (!entry) return;
      const said = how === 'finish' ? `${entry.singer}’s song is over` : `${entry.singer} skipped`;
      // Called next again; the place the song was at is kept, so it can be resumed
      toast.show(said, 'info', UNDO_MS, {
        label: 'Undo',
        onClick: () => dispatch({ type: 'recall', id: entry.id, head: true }),
      });
    },
    [onNow, finish, skip, toast]
  );
  const endSong = useCallback(() => offStage('finish'), [offStage]);
  const skipSong = useCallback(() => offStage('skip'), [offStage]);

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
            onFinish={endSong}
            onSkip={skipSong}
          />
          <ShowQueueList
            waiting={waiting}
            finished={finished}
            videos={videos}
            busy={onStage}
            onStart={player.start}
            onMove={(id, by) => dispatch({ type: 'move', id, by })}
            onPlace={(id, at) => dispatch({ type: 'place', id, at })}
            onRemove={takeOff}
            onAgain={(id) => {
              // Going again is a new song from the top, not the one that was cut off
              player.forgetPlace(id);
              dispatch({ type: 'again', id, turns });
            }}
            turns={turns}
            onTurnsChange={setTurns}
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
          onLoadedMetadata={audio.handleLoadedMetadata}
          {...audioEvents}
          className="hidden"
          aria-hidden="true"
        />
      )}
    </div>
  );
};

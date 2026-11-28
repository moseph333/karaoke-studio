/**
 * A show's player: puts the entry that is on stage on, whatever kind of song it is, and
 * decides what the stage window shows around it.
 *
 * - A library song plays here, in the host's window (`useStudioAudio` and the screen's one
 *   `<audio>` element), and its lyrics stage goes to the stage window as in the studio.
 * - A YouTube video plays in the stage window, in YouTube's player, and reports back
 *   (`useShowStage`). One whose uploader does not allow embedding plays from the server's
 *   copy instead; found out only when it is played, it is fetched then and starts once the
 *   copy is ready. The host screen shows the same video without sound, following those
 *   reports (`show/ShowStageMonitor`).
 *
 * Between singers the stage window shows a card: the next singer in line, or the night's
 * name when nobody is waiting. A song that ends is marked done and the card comes back.
 *
 * Where the song on stage is gets written down as it goes (`utils/showResume`), so a song
 * that was cut off (the host's page reloaded, a wrong button undone, a sign-in that ended)
 * can be started again from there: `start(entry, at)`, offered as "Resume" by the screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { apiFetch } from '../api';
import type { ProjectState } from '../types';
import {
  billingOf,
  playingEntry,
  waitingEntries,
  type ShowAction,
  type ShowEntry,
  type ShowQueue,
} from '../utils/showQueue';
import {
  RESUME_SAVE_SEC,
  loadShowResume,
  resumePlace,
  saveShowResume,
  type ShowResume,
} from '../utils/showResume';
import type { PlayerReport, StageScene } from '../utils/stageLink';
import { getStoredMasterVolume, setStoredMasterVolume } from '../utils/volumeStorage';
import { useShowStage, type UseShowStage } from './useShowStage';
import { useStudioAudio, type UseStudioAudioReturn } from './useStudioAudio';
import type { ShowVideoInfo } from './useShowVideos';

/** Why the song on stage is not playing, and what the host can do about it. */
export type ShowTrouble =
  /** A video plays in the stage window, and none is open. */
  | { kind: 'no-stage' }
  /** The browser will not start sound in the stage window until it has been clicked. */
  | { kind: 'blocked' }
  /** The video cannot be embedded; the server is fetching a copy. */
  | { kind: 'fetching'; progress: number }
  | { kind: 'failed'; message: string };

/** How a video gets on stage: YouTube's player, the server's copy, or not (yet). */
export type VideoMode = 'embed' | 'file' | 'copy' | 'failed';

export function videoMode(info: ShowVideoInfo | undefined, foundBlocked: boolean): VideoMode {
  if (!foundBlocked && info?.embeddable !== false) return 'embed';
  if (info?.status === 'ready' && info.url) return 'file';
  if (info && (!info.downloads || info.status === 'failed')) return 'failed';
  return 'copy';
}

interface VideoPlay {
  entryId: string;
  videoId: string;
  /** Tells this playing's reports from an earlier one's. */
  play: number;
  status: PlayerReport['status'];
  time: number;
  duration: number;
  failure: string | null;
  /** Where this playing was asked to start, when not from the top. */
  at?: number;
}

export interface UseShowPlayerOptions {
  queue: ShowQueue;
  dispatch: React.Dispatch<ShowAction>;
  /** The night's name, shown on the stage's cards. */
  title: string;
  videos: Record<string, ShowVideoInfo>;
  fetchCopy: (videoId: string) => void;
}

export interface UseShowPlayer {
  stage: UseShowStage;
  /** The entry on stage. */
  current: ShowEntry | null;
  /** The library song loaded for the entry on stage. */
  project: ProjectState | null;
  /** What the stage window is showing. */
  scene: StageScene;
  audio: UseStudioAudioReturn;
  /** Handlers for the host screen's `<audio>` element. */
  audioEvents: {
    onTimeUpdate: () => void;
    onCanPlay: () => void;
    onPlay: () => void;
    onPause: () => void;
    onEnded: () => void;
    onError: () => void;
  };
  isVideo: boolean;
  isPlaying: boolean;
  /** The song is being loaded or is starting. */
  isLoading: boolean;
  /** A video's position; a library song's is on the playback clock (`audio.clock`). */
  videoTime: number;
  duration: number;
  trouble: ShowTrouble | null;
  volume: number;
  setVolume: (volume: number) => void;
  /** Puts an entry on stage; with `at`, from that many seconds in. */
  start: (entry: ShowEntry, at?: number) => void;
  /** Where an entry that was cut off would be picked up (seconds), or null. */
  resumeFor: (entry: ShowEntry) => number | null;
  /** Forgets the place kept for an entry (its next start is from the top), or with no
   *  entry, whatever place is kept. */
  forgetPlace: (entryId?: string) => void;
  toggle: () => void;
  seek: (time: number) => void;
  restart: () => void;
  /** Puts the entry on stage on again, after it failed to load or play. */
  retry: () => void;
  /** Ends the song now and marks it sung. Its place is kept, in case that was a mistake. */
  finish: () => void;
  /** Takes the entry off stage without it counting as sung; its place is kept too. */
  skip: () => void;
}

const SONG_FAILED = 'That song could not be loaded.';
const VIDEO_GONE = 'That video is gone or private. Pick another upload of the song.';
const VIDEO_FAILED = 'That video could not be played. Pick another upload of the song.';
const NO_COPIES =
  'That video only plays on YouTube itself, and this server keeps no copies. Pick another upload.';

export function useShowPlayer({
  queue,
  dispatch,
  title,
  videos,
  fetchCopy,
}: UseShowPlayerOptions): UseShowPlayer {
  const current = playingEntry(queue);
  const currentId = current?.id ?? null;
  const [project, setProject] = useState<ProjectState | null>(null);
  const [songFailure, setSongFailure] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoPlay | null>(null);
  /** Videos YouTube refused to play in its embedded player this session. */
  const [foundBlocked, setFoundBlocked] = useState<ReadonlySet<string>>(() => new Set());
  const [volume, setVolumeState] = useState(() => getStoredMasterVolume(1));

  const audio = useStudioAudio(project);
  const { audioRef, setIsPlaying, queueSeek, handleTimeUpdate } = audio;

  // --- Where the song is, written down as it goes -----------------------------------------
  /** The place the screen offers to resume from: read when it opens, kept when a song is
   *  taken off by hand. The writes made while a song plays go to storage only. */
  const [resume, setResume] = useState<ShowResume | null>(loadShowResume);
  const written = useRef('');
  const keepPlace = useCallback(
    (entryId: string, time: number, duration: number, now = false): ShowResume | null => {
      if (!Number.isFinite(time) || time < 0) return null;
      const step = `${entryId}:${Math.floor(time / RESUME_SAVE_SEC)}`;
      const place = { entryId, time, duration: Number.isFinite(duration) ? duration : 0 };
      if (!now && step === written.current) return place;
      written.current = step;
      saveShowResume(place);
      return place;
    },
    []
  );
  const playCounter = useRef(0);
  const pendingPlay = useRef(false);
  const loadingId = useRef<string | null>(null);
  const latest = useRef({ currentId, video, fetchCopy, dispatch, volume });
  latest.current = { currentId, video, fetchCopy, dispatch, volume };

  /** Where the entry on stage is now: a video's last report, a library song's element. */
  const placeNow = useCallback((): { time: number; duration: number } | null => {
    const playing = latest.current.video;
    if (playing) return { time: playing.time, duration: playing.duration };
    const element = audioRef.current;
    return element ? { time: element.currentTime, duration: element.duration } : null;
  }, [audioRef]);

  const leaveStage = useCallback(
    (how: 'finish' | 'skip', byHand: boolean) => {
      const id = latest.current.currentId;
      // Taken off by hand, the place is kept: the host may put the singer straight back.
      // A song that ran to its end has no place to go back to
      const place = byHand && id ? placeNow() : null;
      const kept = place && id ? keepPlace(id, place.time, place.duration, true) : null;
      if (!kept) saveShowResume(null);
      setResume(kept);
      written.current = '';
      pendingPlay.current = false;
      loadingId.current = null;
      audioRef.current?.pause();
      setProject(null);
      setVideo(null);
      setSongFailure(null);
      if (id) latest.current.dispatch({ type: how, id });
    },
    [audioRef, keepPlace, placeNow]
  );
  const finish = useCallback(() => leaveStage('finish', true), [leaveStage]);
  const skip = useCallback(() => leaveStage('skip', true), [leaveStage]);
  /** The song reached its end. */
  const ended = useCallback(() => leaveStage('finish', false), [leaveStage]);

  // --- Reports from the video in the stage window ---------------------------------------
  const onReport = useCallback(
    (report: PlayerReport) => {
      const playing = latest.current.video;
      if (!playing || report.play !== playing.play) return;
      if (report.status === 'ended') {
        ended();
        return;
      }
      if (report.status === 'playing' || report.status === 'paused') {
        keepPlace(
          playing.entryId,
          report.time,
          report.duration || playing.duration,
          report.status === 'paused'
        );
      }
      if (report.status === 'error' && report.error === 'embed') {
        // Not allowed in YouTube's player after all: play the server's copy instead
        setFoundBlocked((all) => new Set(all).add(playing.videoId));
        latest.current.fetchCopy(playing.videoId);
        setVideo((v) => (v && v.play === report.play ? { ...v, status: 'loading' } : v));
        return;
      }
      const failure =
        report.status !== 'error'
          ? null
          : report.error === 'unavailable'
            ? VIDEO_GONE
            : VIDEO_FAILED;
      // A player that is being made, or held back by the browser, reports from 0: where the
      // video was is kept, so the host's slider and its own picture do not jump to the start
      const knowsPlace = report.status !== 'loading' && report.status !== 'blocked';
      setVideo((v) =>
        v && v.play === report.play
          ? {
              ...v,
              status: report.status,
              time: knowsPlace ? report.time : v.time,
              duration: report.duration || v.duration,
              failure,
            }
          : v
      );
    },
    [ended, keepPlace]
  );
  const stage = useShowStage(onReport, title);
  const { show, command } = stage;

  // --- Putting an entry on stage --------------------------------------------------------
  const start = useCallback(
    (entry: ShowEntry, at?: number) => {
      audioRef.current?.pause();
      setSongFailure(null);
      // From the top, or another singer's song: the place that was kept is no use now
      if (at === undefined || loadShowResume()?.entryId !== entry.id) saveShowResume(null);
      setResume(null);
      written.current = '';
      dispatch({ type: 'start', id: entry.id });
      if (entry.source.kind === 'youtube') {
        pendingPlay.current = false;
        loadingId.current = null;
        setProject(null);
        setVideo({
          entryId: entry.id,
          videoId: entry.source.videoId,
          play: ++playCounter.current,
          status: 'loading',
          time: at ?? 0,
          duration: entry.source.duration ?? 0,
          failure: null,
          ...(at ? { at } : {}),
        });
        return;
      }
      setVideo(null);
      setProject(null);
      pendingPlay.current = true;
      const projectId = entry.source.projectId;
      loadingId.current = projectId;
      apiFetch(`/api/project/${encodeURIComponent(projectId)}`)
        .then(async (response) => {
          if (!response.ok) throw new Error(SONG_FAILED);
          const data = (await response.json()) as ProjectState | null;
          if (!data?.id || data.status !== 'ready') throw new Error(SONG_FAILED);
          return data;
        })
        .then((data) => {
          if (loadingId.current !== projectId) return;
          // Before the song's element exists: it goes there once it has loaded
          if (at) queueSeek(at);
          setProject(data);
        })
        .catch(() => {
          if (loadingId.current !== projectId) return;
          loadingId.current = null;
          pendingPlay.current = false;
          setSongFailure(SONG_FAILED);
        });
    },
    [audioRef, dispatch, queueSeek]
  );

  // A song that failed part-way goes on from where it was
  const retry = useCallback(() => {
    if (current) start(current, resumePlace(loadShowResume(), current.id) ?? undefined);
  }, [current, start]);

  const resumeFor = useCallback((entry: ShowEntry) => resumePlace(resume, entry.id), [resume]);
  const forgetPlace = useCallback((entryId?: string) => {
    const mine = (kept: ShowResume | null) => !entryId || kept?.entryId === entryId;
    if (mine(loadShowResume())) saveShowResume(null);
    setResume((kept) => (mine(kept) ? null : kept));
  }, []);

  // The page is going (a reload, a closed tab): write down exactly where the song is
  useEffect(() => {
    const going = () => {
      const id = latest.current.currentId;
      const place = id ? placeNow() : null;
      if (id && place) keepPlace(id, place.time, place.duration, true);
    };
    window.addEventListener('pagehide', going);
    return () => {
      window.removeEventListener('pagehide', going);
      // The screen itself is going (another tab took the show over): the same
      going();
    };
  }, [keepPlace, placeNow]);

  // The entry on stage was removed from the queue: stop what it was playing. Only when
  // somebody was on: run as the screen opens, with nobody on yet, this would wipe the note
  // of which song is loading, after a press on "Start the song" that came before React got
  // round to the screen's first effects, and the song's data would be dropped on arrival
  const wasOn = useRef(currentId);
  useEffect(() => {
    const was = wasOn.current;
    wasOn.current = currentId;
    if (currentId || !was) return;
    pendingPlay.current = false;
    loadingId.current = null;
    audioRef.current?.pause();
    setProject(null);
    setVideo(null);
    setSongFailure(null);
  }, [currentId, audioRef]);

  // --- The library song's <audio> element -----------------------------------------------
  const audioEvents = useMemo(
    () => ({
      onCanPlay: () => {
        const element = audioRef.current;
        if (!element || !pendingPlay.current) return;
        pendingPlay.current = false;
        element.volume = latest.current.volume;
        void element.play()?.catch(() => setIsPlaying(false));
      },
      onTimeUpdate: () => {
        handleTimeUpdate();
        const element = audioRef.current;
        const id = latest.current.currentId;
        if (element && id) keepPlace(id, element.currentTime, element.duration);
      },
      onPlay: () => setIsPlaying(true),
      onPause: () => setIsPlaying(false),
      onEnded: () => ended(),
      onError: () => {
        if (latest.current.currentId) setSongFailure(SONG_FAILED);
      },
    }),
    [audioRef, setIsPlaying, ended, handleTimeUpdate, keepPlace]
  );

  // --- What the stage window shows ------------------------------------------------------
  const videoId = current?.source.kind === 'youtube' ? current.source.videoId : null;
  const info = videoId ? videos[videoId] : undefined;
  const isVideo = videoId !== null;
  const videoOnStage = video && video.entryId === currentId ? video : null;
  const mode = videoId ? videoMode(info, foundBlocked.has(videoId)) : null;
  const copyUrl = info?.url ?? null;
  const projectId = current?.source.kind === 'library' ? current.source.projectId : null;
  const songOnStage = project && project.id === projectId ? project : null;

  const scene = useMemo<StageScene>(() => {
    const waiting = waitingEntries(queue);
    if (!current) {
      return waiting.length > 0
        ? {
            kind: 'upnext',
            title,
            now: billingOf(waiting[0]),
            next: waiting.slice(1, 4).map(billingOf),
          }
        : { kind: 'idle', title, next: [] };
    }
    const called: StageScene = {
      kind: 'upnext',
      title,
      now: billingOf(current),
      next: waiting.slice(0, 3).map(billingOf),
    };
    if (songOnStage) return { kind: 'lyrics' };
    if (!videoOnStage || videoOnStage.failure) return called;
    // A playing that was asked to start part-way says where
    const from = videoOnStage.at ? { at: videoOnStage.at } : {};
    if (mode === 'embed') {
      return { kind: 'youtube', videoId: videoOnStage.videoId, play: videoOnStage.play, ...from };
    }
    if (mode === 'file' && copyUrl) {
      return { kind: 'file', url: copyUrl, play: videoOnStage.play, ...from };
    }
    return called;
  }, [queue, current, title, songOnStage, videoOnStage, mode, copyUrl]);
  const sceneKey = JSON.stringify(scene);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  useEffect(() => {
    show(sceneRef.current);
  }, [sceneKey, show]);

  // --- Volume: the song's element here, the video's player there ------------------------
  const setVolume = useCallback(
    (next: number) => {
      const clamped = Math.min(1, Math.max(0, next));
      setVolumeState(clamped);
      setStoredMasterVolume(clamped);
      if (audioRef.current) audioRef.current.volume = clamped;
      command({ name: 'volume', volume: clamped, muted: false });
    },
    [audioRef, command]
  );
  // A video that has just started takes the host's volume
  const videoStarted = videoOnStage?.status === 'playing' ? videoOnStage.play : null;
  useEffect(() => {
    if (videoStarted === null) return;
    command({ name: 'volume', volume: latest.current.volume, muted: false });
  }, [videoStarted, command]);

  // --- Transport ------------------------------------------------------------------------
  const isPlaying = isVideo ? videoOnStage?.status === 'playing' : audio.isPlaying;
  const toggle = useCallback(() => {
    if (!latest.current.currentId) return;
    const playing = latest.current.video;
    if (playing) command({ name: playing.status === 'playing' ? 'pause' : 'play' });
    else audio.handleTogglePlay();
  }, [audio, command]);
  const seek = useCallback(
    (time: number) => {
      const playing = latest.current.video;
      if (playing) {
        command({ name: 'seek', time });
        setVideo((v) => (v && v.play === playing.play ? { ...v, time } : v));
      } else {
        audio.handleSeek(time);
      }
    },
    [audio, command]
  );
  const restart = useCallback(() => {
    seek(0);
    const playing = latest.current.video;
    if (playing) command({ name: 'play' });
    else if (audioRef.current?.paused) audio.handleTogglePlay();
  }, [seek, command, audio, audioRef]);

  let trouble: ShowTrouble | null = null;
  if (songFailure) trouble = { kind: 'failed', message: songFailure };
  else if (isVideo && videoOnStage) {
    if (videoOnStage.failure) trouble = { kind: 'failed', message: videoOnStage.failure };
    else if (mode === 'failed') {
      trouble = { kind: 'failed', message: info && !info.downloads ? NO_COPIES : VIDEO_FAILED };
      if (info?.status === 'failed' && info.error) trouble.message = info.error;
    } else if (mode === 'copy') trouble = { kind: 'fetching', progress: info?.progress ?? 0 };
    else if (!stage.isOpen) trouble = { kind: 'no-stage' };
    else if (videoOnStage.status === 'blocked') trouble = { kind: 'blocked' };
  }

  const isLoading =
    Boolean(current) &&
    !trouble &&
    (isVideo
      ? videoOnStage?.status === 'loading'
      : !songOnStage || (!audio.isPlaying && pendingPlay.current));

  return {
    stage,
    current,
    project: songOnStage,
    scene,
    audio,
    audioEvents,
    isVideo,
    isPlaying: Boolean(isPlaying),
    isLoading,
    videoTime: videoOnStage?.time ?? 0,
    duration: isVideo ? (videoOnStage?.duration ?? 0) : audio.duration,
    trouble,
    volume,
    setVolume,
    start,
    resumeFor,
    forgetPlace,
    toggle,
    seek,
    restart,
    retry,
    finish,
    skip,
  };
}

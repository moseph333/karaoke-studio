/**
 * What the server knows of a show's queued YouTube videos (`GET /api/show/videos/{id}`):
 * whether YouTube's embedded player will play each one, and where the server's own copy of
 * it stands.
 *
 * A video is asked about when it joins the queue. One whose uploader does not allow
 * embedding is fetched at once (`POST …/fetch`), so its copy is ready by the time its singer
 * is called; a video being fetched is asked about again every two seconds.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';

export interface ShowVideoInfo {
  embeddable: boolean | null;
  title?: string | null;
  channel?: string | null;
  status: 'none' | 'fetching' | 'ready' | 'failed';
  progress: number;
  /** The server's copy, once `status` is `ready`. */
  url: string | null;
  error: string | null;
  /** Whether this server keeps copies at all. */
  downloads: boolean;
}

const POLL_MS = 2000;

/** What stands between a queued video and the stage, in a few words; null when nothing does. */
export function videoNote(info: ShowVideoInfo | undefined): string | null {
  if (!info || info.embeddable !== false) return null;
  if (info.status === 'ready') return 'Plays from a copy';
  if (info.status === 'fetching') return `Fetching a copy, ${Math.round(info.progress)}%`;
  if (info.status === 'failed') return 'Cannot be played. Pick another video';
  return info.downloads ? 'Fetching a copy' : 'Only plays on YouTube itself. Pick another video';
}

function isVideoInfo(value: unknown): value is ShowVideoInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ShowVideoInfo).status === 'string'
  );
}

async function request(videoId: string, fetchCopy: boolean): Promise<ShowVideoInfo | null> {
  try {
    const path = `/api/show/videos/${encodeURIComponent(videoId)}`;
    const response = await apiFetch(fetchCopy ? `${path}/fetch` : path, {
      method: fetchCopy ? 'POST' : 'GET',
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isVideoInfo(body) ? body : null;
  } catch {
    return null;
  }
}

/** Reads what the server says of one video (also used for a pasted link's title). */
export function fetchShowVideo(videoId: string): Promise<ShowVideoInfo | null> {
  return request(videoId, false);
}

export interface UseShowVideos {
  videos: Record<string, ShowVideoInfo>;
  /** Asks the server to keep a copy of the video (a video found blocked while playing). */
  fetchCopy: (videoId: string) => void;
}

export function useShowVideos(videoIds: string[]): UseShowVideos {
  const [videos, setVideos] = useState<Record<string, ShowVideoInfo>>({});
  const asked = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const merge = useCallback((videoId: string, info: ShowVideoInfo | null) => {
    if (!info || !alive.current) return;
    setVideos((all) => {
      // A fetch's answer does not ask YouTube again: keep what is known of the video
      const known = all[videoId];
      return {
        ...all,
        [videoId]: {
          ...info,
          embeddable: info.embeddable ?? known?.embeddable ?? null,
          title: info.title ?? known?.title ?? null,
          channel: info.channel ?? known?.channel ?? null,
        },
      };
    });
  }, []);

  const fetchCopy = useCallback(
    (videoId: string) => {
      void request(videoId, true).then((info) => merge(videoId, info));
    },
    [merge]
  );

  // A video joining the queue: ask about it once, and fetch it if it cannot be embedded
  const key = videoIds.join(' ');
  useEffect(() => {
    for (const videoId of key ? key.split(' ') : []) {
      if (asked.current.has(videoId)) continue;
      asked.current.add(videoId);
      void request(videoId, false).then((info) => {
        if (!info) {
          // Not answered (the server was away): ask again when the queue next changes
          asked.current.delete(videoId);
          return;
        }
        merge(videoId, info);
        if (info.embeddable === false && info.downloads && info.status === 'none') {
          fetchCopy(videoId);
        }
      });
    }
  }, [key, merge, fetchCopy]);

  // Videos being fetched: follow them until they are ready or have failed
  const fetching = Object.keys(videos)
    .filter((videoId) => videos[videoId].status === 'fetching')
    .join(' ');
  useEffect(() => {
    if (!fetching) return;
    const timer = setInterval(() => {
      for (const videoId of fetching.split(' ')) {
        void request(videoId, false).then((info) => merge(videoId, info));
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [fetching, merge]);

  return { videos, fetchCopy };
}

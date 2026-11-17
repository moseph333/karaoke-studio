/**
 * App shortcuts: the installed app's icon menu offers "New song", "Upload audio" and
 * "Continue last song". Each is a manifest shortcut with icons that opens `/?shortcut=<id>`,
 * which the app turns into a ready intake card or the last song, then drops from the address.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { TrackSearch } from '../../components/TrackSearch';
import {
  APP_SHORTCUTS,
  LAST_PROJECT_STORAGE_KEY,
  launchShortcut,
  readLastProject,
  rememberLastProject,
  urlWithoutShortcut,
} from '../../utils/appShortcut';
import { readFrontendFile, resolveFrontendFile } from '../helpers/bootScriptUtils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = eval('require') as (mod: string) => any;
const fs = nodeRequire('fs');

interface ShortcutIcon {
  src: string;
  sizes: string;
  type: string;
}
interface ManifestShortcut {
  name: string;
  short_name: string;
  description: string;
  url: string;
  icons: ShortcutIcon[];
}

const manifest = JSON.parse(readFrontendFile('public/manifest.json'));
const shortcuts: ManifestShortcut[] = manifest.shortcuts;

function pngSize(src: string): [number, number] {
  const bytes: Uint8Array = fs.readFileSync(resolveFrontendFile(`public${src}`));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

const SEARCH_BOX = 'Paste YouTube or YouTube Music URL or search song title';

describe('manifest shortcuts', () => {
  it('lists one shortcut for every id the app understands, inside the app scope', () => {
    const ids = shortcuts.map((s) =>
      new URL(s.url, 'https://studio.test').searchParams.get('shortcut')
    );
    expect(ids).toEqual([...APP_SHORTCUTS]);
    for (const shortcut of shortcuts) {
      expect(shortcut.url.startsWith(manifest.scope), shortcut.url).toBe(true);
      expect(new URL(shortcut.url, 'https://studio.test').pathname).toBe(manifest.start_url);
    }
  });

  it('names each shortcut, with a short name that fits under a launcher icon', () => {
    expect(shortcuts.map((s) => s.name)).toEqual([
      'New song',
      'Upload audio',
      'Continue last song',
    ]);
    expect(new Set(shortcuts.map((s) => s.name)).size).toBe(shortcuts.length);
    for (const shortcut of shortcuts) {
      expect(shortcut.short_name.length, shortcut.short_name).toBeLessThanOrEqual(12);
      expect(shortcut.description.length).toBeGreaterThan(0);
    }
  });

  it('ships a 96 px and a 192 px icon for each, at the size the manifest states', () => {
    for (const shortcut of shortcuts) {
      expect(shortcut.icons.map((icon) => icon.sizes)).toEqual(['96x96', '192x192']);
      for (const icon of shortcut.icons) {
        const [w, h] = icon.sizes.split('x').map(Number);
        expect(icon.type).toBe('image/png');
        expect(pngSize(icon.src), icon.src).toEqual([w, h]);
      }
    }
  });
});

describe('reading a shortcut launch', () => {
  it('recognises the three shortcuts and nothing else', () => {
    expect(launchShortcut(new URLSearchParams('shortcut=new'))).toBe('new');
    expect(launchShortcut(new URLSearchParams('shortcut=upload'))).toBe('upload');
    expect(launchShortcut(new URLSearchParams('shortcut=resume'))).toBe('resume');
    expect(launchShortcut(new URLSearchParams('shortcut=delete-everything'))).toBeNull();
    expect(launchShortcut(new URLSearchParams(''))).toBeNull();
  });

  it('lets a link to a song win over a shortcut', () => {
    expect(launchShortcut(new URLSearchParams('project=p1&shortcut=new'))).toBeNull();
  });

  it('removes only the shortcut from the address', () => {
    expect(urlWithoutShortcut({ pathname: '/', search: '?shortcut=new', hash: '' })).toBe('/');
    expect(
      urlWithoutShortcut({ pathname: '/', search: '?project=p1&shortcut=resume', hash: '#x' })
    ).toBe('/?project=p1#x');
  });

  it('remembers the last song across launches', () => {
    expect(readLastProject()).toBeNull();
    rememberLastProject('p1');
    expect(localStorage.getItem(LAST_PROJECT_STORAGE_KEY)).toBe('p1');
    expect(readLastProject()).toBe('p1');
  });
});

describe('the intake card after a shortcut', () => {
  const props = { onSelectTrack: vi.fn(), onUploadTrack: vi.fn(), isLoading: false };

  beforeEach(() => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = mockFetch;
    window.fetch = mockFetch;
  });

  it('"New song" puts the keyboard in the song search', () => {
    render(<TrackSearch {...props} focusSearch />);
    expect(document.activeElement).toBe(screen.getByLabelText(SEARCH_BOX));
  });

  it('"Upload audio" opens on the upload tab', () => {
    render(<TrackSearch {...props} initialMode="local" />);
    expect(document.getElementById('panel-local')).not.toBeNull();
    expect(screen.queryByLabelText(SEARCH_BOX)).toBeNull();
  });

  it('opens on the search tab, unfocused, without a shortcut', () => {
    render(<TrackSearch {...props} />);
    expect(document.activeElement).not.toBe(screen.getByLabelText(SEARCH_BOX));
    expect(document.getElementById('panel-local')).toBeNull();
  });
});

describe('launching the app from a shortcut', () => {
  const lastSong = {
    id: 'last-song',
    title: 'Neon Skyline',
    artist: 'The Midnight Static',
    status: 'processing',
    progress: 40,
    lines: [],
  };
  let fetched: string[];
  let songStatus: number;

  beforeEach(() => {
    fetched = [];
    songStatus = 200;
    const mockFetch = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      const urlStr = url.toString();
      fetched.push(urlStr);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      if (urlStr.includes('/api/auth/status')) {
        return json({ auth_required: false, authenticated: true });
      }
      if (urlStr.includes('/api/project/last-song')) {
        return songStatus === 200 ? json(lastSong) : json({ detail: 'Not found' }, songStatus);
      }
      if (urlStr.includes('/api/projects')) return json({});
      return json({});
    });
    globalThis.fetch = mockFetch;
    window.fetch = mockFetch;
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('"Upload audio" shows the upload tab and tidies the address', async () => {
    window.history.replaceState(null, '', '/?shortcut=upload');
    render(<App />);
    await waitFor(() => expect(document.getElementById('panel-local')).not.toBeNull());
    expect(window.location.search).toBe('');
  });

  it('"New song" focuses the song search', async () => {
    window.history.replaceState(null, '', '/?shortcut=new');
    render(<App />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(SEARCH_BOX)));
    expect(window.location.search).toBe('');
  });

  it('"Continue last song" reopens the song this device had open last', async () => {
    rememberLastProject('last-song');
    window.history.replaceState(null, '', '/?shortcut=resume');
    render(<App />);
    // The song gets a history entry of its own, so Back returns to the library
    await waitFor(() => expect(window.location.search).toBe('?project=last-song'));
    expect(fetched.some((url) => url.includes('/api/project/last-song'))).toBe(true);
  });

  it('"Continue last song" opens the library when no song was opened yet', async () => {
    window.history.replaceState(null, '', '/?shortcut=resume');
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText(SEARCH_BOX)).toBeInTheDocument());
    expect(window.location.search).toBe('');
    expect(fetched.some((url) => /\/api\/project\/[^s]/.test(url))).toBe(false);
  });

  it('forgets a last song that was deleted since', async () => {
    rememberLastProject('last-song');
    songStatus = 404;
    window.history.replaceState(null, '', '/?shortcut=resume');
    render(<App />);
    await waitFor(() => expect(readLastProject()).toBeNull());
    expect(screen.getByLabelText(SEARCH_BOX)).toBeInTheDocument();
  });

  it('remembers a song as soon as it opens', async () => {
    window.history.replaceState(null, '', '/?project=last-song');
    render(<App />);
    await waitFor(() => expect(readLastProject()).toBe('last-song'));
  });
});

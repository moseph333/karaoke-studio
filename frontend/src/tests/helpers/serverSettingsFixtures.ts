import { type MockInstance, vi } from 'vitest';
import type { ServerSettingValue, ServerSettingsState } from '../../types';
import { CAPABILITIES } from './qualityFixtures';

export const ADMIN_PASSPHRASE = 'owner-only-words';
export const ADMIN_TOKEN = 'admin.token';

const MODELS = [
  { id: 'wan22', label: 'Best', note: 'Wan 2.2 (5B), about 8 minutes a loop' },
  { id: 'ltx', label: 'Fast', note: 'LTX-Video 0.9.7 (distilled), about 2 minutes a loop' },
];
const PRESETS = [
  { id: 'fast', label: 'Fast', note: 'Demucs. Always offered: the others fall back to it' },
  { id: 'balanced', label: 'Balanced', note: 'Mel-Band RoFormer' },
  { id: 'best', label: 'Best', note: 'Two RoFormer models averaged' },
];

/** What a server answers before its owner has changed anything (as GET /api/admin/settings
 * does: every value is the environment's). */
export function serverSettings(): ServerSettingsState {
  const untouched = (value: ServerSettingValue, options?: typeof MODELS) => ({
    value,
    default: value,
    overridden: false,
    ...(options ? { options } : {}),
  });
  return {
    settings: {
      'song_loop.enabled': untouched(true),
      'song_loop.models': untouched(['wan22', 'ltx'], MODELS),
      'song_loop.default_model': untouched('wan22', MODELS),
      'separation.presets': untouched(['fast', 'balanced', 'best'], PRESETS),
      'separation.default': untouched('best', PRESETS),
      'separation.cloud': untouched(true),
      'render.cloud': untouched(true),
      'render.prewarm': untouched(true),
      'separation.prewarm': untouched(true),
      'limits.song_minutes': untouched(60),
      'limits.album_minutes': untouched(120),
      'search.sources': untouched(
        ['deezer', 'itunes', 'suggest'],
        [
          { id: 'deezer', label: 'Deezer', note: "Songs from Deezer's catalog" },
          { id: 'itunes', label: 'iTunes Store', note: "Songs from the iTunes Store's catalog" },
          { id: 'suggest', label: 'Spelling help', note: 'Respells a mistyped search' },
        ]
      ),
      'alignment.engine': untouched('auto', [
        { id: 'auto', label: 'Automatic', note: 'The neural aligner when its model can run' },
        { id: 'ctc', label: 'Neural', note: 'The neural aligner' },
        { id: 'dsp', label: 'Signal only', note: 'Signal analysis alone' },
      ]),
    },
    cloud: { ready: true, reason: null },
  };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

export interface AdminServer {
  /** Whether the server has an admin passphrase. */
  enabled: boolean;
  state: ServerSettingsState;
  /** The `values` of every PUT the page sent. */
  saves: Array<Record<string, ServerSettingValue | null>>;
  /** Answers the next save with this instead (a refusal, a full disk). */
  failNextSave: { status: number; detail: string } | null;
  capabilityRequests: number;
  spy: MockInstance<typeof fetch>;
}

/** A stand-in for the server behind the page: the studio is open (no studio passphrase), the
 * admin passphrase is ADMIN_PASSPHRASE, and saved changes are kept and shown as changed. */
export function mockAdminServer(options: { enabled?: boolean } = {}): AdminServer {
  const server: AdminServer = {
    enabled: options.enabled ?? true,
    state: serverSettings(),
    saves: [],
    failNextSave: null,
    capabilityRequests: 0,
    spy: undefined as unknown as MockInstance<typeof fetch>,
  };
  const isOwner = (init?: RequestInit) =>
    new Headers(init?.headers).get('X-Admin-Token') === ADMIN_TOKEN;
  const refuse = () =>
    json({ detail: "Enter the admin passphrase to change this server's settings." }, 403);

  server.spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/api/auth/status')) {
        return json({ auth_required: false, authenticated: true, admin: server.enabled });
      }
      if (url.includes('/api/admin/status')) {
        return json({ enabled: server.enabled, authenticated: server.enabled && isOwner(init) });
      }
      if (url.includes('/api/admin/login')) {
        const { password } = JSON.parse(String(init?.body)) as { password: string };
        return password === ADMIN_PASSPHRASE
          ? json({ status: 'ok', token: ADMIN_TOKEN })
          : json({ detail: 'Incorrect admin passphrase' }, 403);
      }
      if (url.includes('/api/admin/settings')) {
        if (!isOwner(init)) return refuse();
        if (method !== 'PUT') return json(server.state);
        const { values } = JSON.parse(String(init?.body)) as {
          values: Record<string, ServerSettingValue | null>;
        };
        server.saves.push(values);
        if (server.failNextSave) {
          const { status, detail } = server.failNextSave;
          server.failNextSave = null;
          return json({ detail }, status);
        }
        for (const [id, value] of Object.entries(values)) {
          const entry = server.state.settings[id];
          server.state.settings[id] =
            value === null
              ? { ...entry, value: entry.default, overridden: false }
              : { ...entry, value, overridden: true };
        }
        return json(server.state);
      }
      if (url.includes('/api/capabilities')) {
        server.capabilityRequests += 1;
        const offered = server.state.settings['separation.presets'].value as string[];
        return json({
          ...CAPABILITIES,
          separation: {
            ...CAPABILITIES.separation,
            presets: CAPABILITIES.separation.presets.filter((preset) =>
              offered.includes(preset.id)
            ),
          },
        });
      }
      if (url.includes('/api/projects')) return json([]);
      return json({});
    });
  return server;
}

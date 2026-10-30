import { vi } from 'vitest';
import type { StudioCapabilities } from '../../types';

/** A server that can run Fast and Balanced but not Best, with the neural aligner ready. */
export const CAPABILITIES: StudioCapabilities = {
  separation: {
    default: 'best',
    effective_default: 'balanced',
    downloads_allowed: true,
    presets: [
      {
        id: 'fast',
        label: 'Fast · Demucs',
        engine: 'demucs',
        models: ['htdemucs'],
        available: true,
        reason: null,
        weights_cached: null,
        cpu_realtime_factor: 0.35,
        gpu_recommended: false,
      },
      {
        id: 'balanced',
        label: 'Balanced · Mel-Band RoFormer',
        engine: 'roformer',
        models: ['vocals_mel_band_roformer.ckpt'],
        available: true,
        reason: null,
        weights_cached: false,
        cpu_realtime_factor: 1.6,
        gpu_recommended: false,
      },
      {
        id: 'best',
        label: 'Best · RoFormer ensemble',
        engine: 'roformer',
        models: ['a.ckpt', 'b.ckpt'],
        available: false,
        reason: 'Not enough memory for two models',
        weights_cached: false,
        cpu_realtime_factor: 6.4,
        gpu_recommended: true,
      },
    ],
  },
  alignment: {
    requested: 'auto',
    effective: 'ctc',
    ctc_available: true,
    reason: null,
    weights_cached: true,
    downloads_allowed: true,
    license_note: 'MMS model, CC-BY-NC 4.0',
  },
};

export type FetchRoute = (url: string, init?: RequestInit) => Response | undefined;

/** Mocks fetch: /api/capabilities answers with `capabilities`, `route` handles the rest,
 * anything else gets an empty JSON object. Returns the spy. */
export function mockStudioFetch(
  route: FetchRoute = () => undefined,
  capabilities: StudioCapabilities | null = CAPABILITIES
) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes('/api/capabilities')) {
        return capabilities
          ? new Response(JSON.stringify(capabilities), { status: 200 })
          : new Response('{}', { status: 500 });
      }
      return route(url, init) ?? new Response(JSON.stringify({}), { status: 200 });
    });
}

export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

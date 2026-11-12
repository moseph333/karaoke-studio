/**
 * The Help dialog's footer names the version the server runs, read once from GET /api/health.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { HelpModal } from '../../components/HelpModal';
import { resetServerVersionCache } from '../../hooks/useServerVersion';

let health: Record<string, unknown> | Error = { version: 'v2.4.0' };
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
  if (health instanceof Error) throw health;
  return new Response(JSON.stringify(health), { status: 200 });
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

const versionLine = () => screen.queryByText(/^Karaoke Studio v/);

beforeEach(() => {
  health = { version: 'v2.4.0' };
  fetchMock.mockClear();
  resetServerVersionCache();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Help dialog version', () => {
  it('shows the version the server runs', async () => {
    render(<HelpModal isOpen onClose={() => {}} />);
    await settle();

    expect(versionLine()?.textContent).toBe('Karaoke Studio v2.4.0');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/health');
  });

  it('shows a version between releases as git describes it', async () => {
    health = { version: ' v2.4.0-3-gabc1234 ' };
    render(<HelpModal isOpen onClose={() => {}} />);
    await settle();

    expect(versionLine()?.textContent).toBe('Karaoke Studio v2.4.0-3-gabc1234');
  });

  it('asks the server only once however often the dialog opens', async () => {
    const { rerender } = render(<HelpModal isOpen onClose={() => {}} />);
    await settle();
    rerender(<HelpModal isOpen={false} onClose={() => {}} />);
    rerender(<HelpModal isOpen onClose={() => {}} />);
    await settle();

    expect(versionLine()).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('opens without a version when the server cannot be reached', async () => {
    health = new Error('offline');
    render(<HelpModal isOpen onClose={() => {}} />);
    await settle();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(versionLine()).toBeNull();
  });

  it('does not ask the server while the dialog is closed', async () => {
    render(<HelpModal isOpen={false} onClose={() => {}} />);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

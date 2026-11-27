/**
 * The stage link's own rules: how a stage window keeps time from the last position it was
 * told, which address opens one, and that messages reach the other window as copies.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_COAST_SEC,
  STAGE_CHANNEL_NAME,
  isStageWindowUrl,
  openStageLink,
  transportTime,
  type StageMessage,
  type StageTransport,
} from '../../utils/stageLink';
import { installFakeBroadcastChannel } from '../helpers/fakeBroadcastChannel';

const playing: StageTransport = { time: 10, at: 1_000_000, isPlaying: true, rate: 1, seek: false };

describe('the song position a stage window works out', () => {
  it('stays where it was told while the song is paused', () => {
    const paused = { ...playing, isPlaying: false };
    expect(transportTime(paused, paused.at + 5000)).toBe(10);
  });

  it('moves on with the clock while the song plays', () => {
    expect(transportTime(playing, playing.at + 200)).toBeCloseTo(10.2, 6);
  });

  it('moves at the playback speed', () => {
    expect(transportTime({ ...playing, rate: 0.5 }, playing.at + 400)).toBeCloseTo(10.2, 6);
  });

  it('stops moving when the studio has gone quiet for too long', () => {
    const stalled = transportTime(playing, playing.at + 60_000);
    expect(stalled).toBeCloseTo(10 + MAX_COAST_SEC, 6);
  });

  it('never runs backwards when the two clocks disagree', () => {
    expect(transportTime(playing, playing.at - 300)).toBe(10);
  });
});

describe('the stage window address', () => {
  it('is the app with ?stage', () => {
    expect(isStageWindowUrl('?stage=1')).toBe(true);
    expect(isStageWindowUrl('?project=abc&stage=1')).toBe(true);
  });

  it('is not the app opened on a song', () => {
    expect(isStageWindowUrl('')).toBe(false);
    expect(isStageWindowUrl('?project=stage')).toBe(false);
  });
});

describe('the channel between the windows', () => {
  afterEach(() => installFakeBroadcastChannel());

  it('delivers a message to the other window, not back to the sender', () => {
    const heardByStudio = vi.fn();
    const heardByStage = vi.fn();
    const studio = openStageLink(heardByStudio);
    const stage = openStageLink(heardByStage);

    stage?.post({ type: 'hello' });

    expect(heardByStudio).toHaveBeenCalledWith({ type: 'hello' });
    expect(heardByStage).not.toHaveBeenCalled();
    studio?.close();
    stage?.close();
  });

  it('ignores what is not a stage message', () => {
    const heard = vi.fn();
    const link = openStageLink(heard);
    const stranger = new BroadcastChannel(STAGE_CHANNEL_NAME);

    stranger.postMessage('ping');
    stranger.postMessage(null);

    expect(heard).not.toHaveBeenCalled();
    link?.close();
    stranger.close();
  });

  it('stops delivering once closed, and posting after that is harmless', () => {
    const heard = vi.fn();
    const closed = openStageLink(heard);
    const other = openStageLink(() => {});
    closed?.close();

    const message: StageMessage = { type: 'who' };
    other?.post(message);
    expect(() => closed?.post(message)).not.toThrow();

    expect(heard).not.toHaveBeenCalled();
    other?.close();
  });

  it('is absent in a browser without BroadcastChannel', () => {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    expect(openStageLink(() => {})).toBeNull();
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useStudioAudio, UseStudioAudioReturn } from '../hooks/useStudioAudio';
import { ProjectState } from '../types';

const baseProject: ProjectState = {
  id: 'p1',
  status: 'ready',
  progress: 100,
  lines: [],
  semitones: 0,
  guide_volume: 0,
  master_audio_url: '/static/output/p1_master.wav',
};

let hook: UseStudioAudioReturn;

const Harness: React.FC<{ project: ProjectState | null }> = ({ project }) => {
  hook = useStudioAudio(project);
  return (
    <audio
      data-testid="harness-audio"
      ref={hook.audioRef}
      src={project?.master_audio_url}
      onTimeUpdate={hook.handleTimeUpdate}
      onLoadedMetadata={hook.handleLoadedMetadata}
    />
  );
};

const setElementTime = (el: HTMLAudioElement, time: number) => {
  el.currentTime = time;
  fireEvent.timeUpdate(el);
};

describe('useStudioAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('master source swaps (re-pitch / guide blend)', () => {
    it('restores the playback position and resumes playing after the new mix loads', async () => {
      const { rerender } = render(<Harness project={baseProject} />);
      const el = screen.getByTestId('harness-audio') as HTMLAudioElement;

      await act(async () => {
        hook.handleTogglePlay();
      });
      expect(hook.isPlaying).toBe(true);
      expect(el.play).toHaveBeenCalledTimes(1);

      setElementTime(el, 42.5);
      expect(hook.clock.getState().time).toBe(42.5);

      rerender(
        <Harness
          project={{ ...baseProject, master_audio_url: '/static/output/p1_mix_2_0.wav?v=1' }}
        />
      );

      // The reloading element reports 0; the studio clock must not jump back
      setElementTime(el, 0);
      expect(hook.clock.getState().time).toBe(42.5);

      await act(async () => {
        fireEvent.loadedMetadata(el);
      });

      expect(el.currentTime).toBe(42.5);
      expect(hook.clock.getState().time).toBe(42.5);
      expect(el.play).toHaveBeenCalledTimes(2);
      expect(hook.isPlaying).toBe(true);

      // Normal time updates resume after the restore
      setElementTime(el, 43);
      expect(hook.clock.getState().time).toBe(43);
    });

    it('restores the position without auto-playing when playback was paused', async () => {
      const { rerender } = render(<Harness project={baseProject} />);
      const el = screen.getByTestId('harness-audio') as HTMLAudioElement;

      setElementTime(el, 12);
      rerender(<Harness project={{ ...baseProject, master_audio_url: '/static/output/v2.wav' }} />);
      await act(async () => {
        fireEvent.loadedMetadata(el);
      });

      expect(el.currentTime).toBe(12);
      expect(el.play).not.toHaveBeenCalled();
      expect(hook.isPlaying).toBe(false);
    });

    it('clamps the restored position to the new duration', async () => {
      const { rerender } = render(<Harness project={baseProject} />);
      const el = screen.getByTestId('harness-audio') as HTMLAudioElement;

      setElementTime(el, 500);
      rerender(<Harness project={{ ...baseProject, master_audio_url: '/static/output/v2.wav' }} />);
      Object.defineProperty(el, 'duration', { value: 200, configurable: true });
      await act(async () => {
        fireEvent.loadedMetadata(el);
      });

      expect(el.currentTime).toBe(200);
    });

    it('keeps a seek made while the new source is still loading', async () => {
      const { rerender } = render(<Harness project={baseProject} />);
      const el = screen.getByTestId('harness-audio') as HTMLAudioElement;

      setElementTime(el, 30);
      rerender(<Harness project={{ ...baseProject, master_audio_url: '/static/output/v2.wav' }} />);
      act(() => hook.handleSeek(90));
      await act(async () => {
        fireEvent.loadedMetadata(el);
      });

      expect(el.currentTime).toBe(90);
      expect(hook.clock.getState().time).toBe(90);
    });

    it('does not carry a playing restore over to a different project', async () => {
      const { rerender } = render(<Harness project={baseProject} />);
      const el = screen.getByTestId('harness-audio') as HTMLAudioElement;

      await act(async () => {
        hook.handleTogglePlay();
      });
      setElementTime(el, 20);

      rerender(
        <Harness
          project={{ ...baseProject, id: 'p2', master_audio_url: '/static/output/p2.wav' }}
        />
      );
      await act(async () => {
        fireEvent.loadedMetadata(el);
      });

      expect(el.play).toHaveBeenCalledTimes(1);
    });
  });

  describe('switching songs', () => {
    it('starts the next song from the top even when paused mid-song', async () => {
      const { rerender } = render(<Harness project={baseProject} />);
      const el = screen.getByTestId('harness-audio') as HTMLAudioElement;
      setElementTime(el, 90);

      rerender(
        <Harness
          project={{ ...baseProject, id: 'p2', master_audio_url: '/static/output/p2.wav' }}
        />
      );
      setElementTime(el, 0);
      await act(async () => {
        fireEvent.loadedMetadata(el);
      });

      expect(el.currentTime).toBe(0);
      expect(hook.getCurrentTime()).toBe(0);
      expect(el.play).not.toHaveBeenCalled();
    });
  });

  describe('queueSeek (deep links)', () => {
    it('applies a queued seek once metadata has loaded', async () => {
      render(<Harness project={baseProject} />);
      const el = screen.getByTestId('harness-audio') as HTMLAudioElement;

      act(() => hook.queueSeek(75));
      expect(hook.clock.getState().time).toBe(75);

      await act(async () => {
        fireEvent.loadedMetadata(el);
      });
      expect(el.currentTime).toBe(75);
      expect(el.play).not.toHaveBeenCalled();
    });

    it('seeks immediately when the element already has metadata', () => {
      render(<Harness project={baseProject} />);
      const el = screen.getByTestId('harness-audio') as HTMLAudioElement;
      Object.defineProperty(el, 'readyState', { value: 4, configurable: true });

      act(() => hook.queueSeek(33));
      expect(el.currentTime).toBe(33);
    });

    it('ignores invalid times', () => {
      render(<Harness project={baseProject} />);
      act(() => hook.queueSeek(-5));
      act(() => hook.queueSeek(Number.NaN));
      expect(hook.clock.getState().time).toBe(0);
    });
  });

  it('getCurrentTime reads the live media clock', () => {
    render(<Harness project={baseProject} />);
    const el = screen.getByTestId('harness-audio') as HTMLAudioElement;
    el.currentTime = 64.25;
    expect(hook.getCurrentTime()).toBe(64.25);
  });

  it('getCurrentTime reports the pending position while a seek waits for metadata', () => {
    render(<Harness project={baseProject} />);
    const el = screen.getByTestId('harness-audio') as HTMLAudioElement;
    // jsdom media never loads metadata, so the deep-link seek stays queued
    act(() => hook.queueSeek(33));
    expect(el.currentTime).toBe(0);
    expect(hook.getCurrentTime()).toBe(33);
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useStudioAudio, UseStudioAudioReturn } from '../../hooks/useStudioAudio';
import { ProjectState } from '../../types';

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
let harnessRenders = 0;

const Harness: React.FC<{ project: ProjectState | null }> = ({ project }) => {
  harnessRenders++;
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

    it("resets the position, play state and duration to the new song's at once", async () => {
      const { rerender } = render(<Harness project={{ ...baseProject, duration: 200 }} />);
      const el = screen.getByTestId('harness-audio') as HTMLAudioElement;
      await act(async () => {
        hook.handleTogglePlay();
      });
      setElementTime(el, 90);
      expect(hook.isPlaying).toBe(true);
      expect(hook.duration).toBe(200);
      const seeksBefore = hook.clock.getState().seekId;

      rerender(
        <Harness
          project={{
            ...baseProject,
            id: 'p2',
            duration: 150,
            master_audio_url: '/static/output/p2.wav',
          }}
        />
      );

      // Before the new media loads: the previous song's values used to linger until play
      expect(hook.clock.getState().time).toBe(0);
      expect(hook.isPlaying).toBe(false);
      expect(hook.duration).toBe(150);
      expect(el.pause).toHaveBeenCalled();
      // A jump, so a paused timeline auto-scroll resumes for the new song
      expect(hook.clock.getState().seekId).toBe(seeksBefore + 1);
    });

    it('keeps a deep-link seek queued for the song being opened', async () => {
      const { rerender } = render(<Harness project={null} />);
      // App: setProject(deep-linked song), then queueSeek(t) before the next render
      act(() => hook.queueSeek(75));
      rerender(<Harness project={baseProject} />);
      expect(hook.clock.getState().time).toBe(75);
      expect(hook.getCurrentTime()).toBe(75);

      const el = screen.getByTestId('harness-audio') as HTMLAudioElement;
      await act(async () => {
        fireEvent.loadedMetadata(el);
      });
      expect(el.currentTime).toBe(75);
      expect(hook.clock.getState().time).toBe(75);
    });
  });

  describe('playback clock', () => {
    it('publishes timeupdates without re-rendering the component that owns the hook', () => {
      render(<Harness project={baseProject} />);
      const el = screen.getByTestId('harness-audio') as HTMLAudioElement;
      const before = harnessRenders;
      const result = hook;

      for (const t of [1, 1.25, 1.5, 1.75, 2]) setElementTime(el, t);

      expect(hook.clock.getState().time).toBe(2);
      expect(harnessRenders).toBe(before);
      // Same memoised object: nothing the studio receives changed
      expect(hook).toBe(result);
    });

    it('keeps its handlers across renders', async () => {
      const { rerender } = render(<Harness project={baseProject} />);
      const first = hook;
      await act(async () => {
        hook.handleTogglePlay();
      });
      rerender(<Harness project={{ ...baseProject, lines: [] }} />);

      expect(hook.isPlaying).toBe(true);
      expect(hook.handleTogglePlay).toBe(first.handleTogglePlay);
      expect(hook.handleSeek).toBe(first.handleSeek);
      expect(hook.handleTimeUpdate).toBe(first.handleTimeUpdate);
      expect(hook.getCurrentTime).toBe(first.getCurrentTime);
    });

    it('marks seeks but not the position restored after a source swap', async () => {
      const { rerender } = render(<Harness project={baseProject} />);
      const el = screen.getByTestId('harness-audio') as HTMLAudioElement;

      // handleSeek clamps to the duration, which jsdom media reports as NaN
      Object.defineProperty(el, 'duration', { value: 300, configurable: true });
      act(() => hook.handleSeek(42));
      expect(hook.clock.getState()).toMatchObject({ time: 42 });
      const seeks = hook.clock.getState().seekId;

      rerender(<Harness project={{ ...baseProject, master_audio_url: '/static/output/v2.wav' }} />);
      await act(async () => {
        fireEvent.loadedMetadata(el);
      });
      expect(hook.clock.getState()).toEqual({ time: 42, seekId: seeks });
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

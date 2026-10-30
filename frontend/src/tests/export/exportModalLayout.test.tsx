/**
 * Export dialog layout: section order, the shape-aware video preview and the YouTube kit's
 * clipboard fallback for plain-HTTP installs.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ExportModal } from '../../components/ExportModal';
import { ExportYouTubeKit } from '../../components/export/ExportYouTubeKit';
import { copyText } from '../../utils/clipboard';
import { ProjectState } from '../../types';

const baseProject: ProjectState = {
  id: 'export-layout',
  status: 'ready',
  progress: 100,
  title: 'Golden Hour',
  artist: 'The Night Shift',
  lines: [{ id: 1, start_time: 0, end_time: 2, text: 'Hello there', words: [] }],
  semitones: 0,
  guide_volume: 0,
  render_status: 'idle',
  render_progress: 0,
};

const youtubePackage = {
  title: 'Golden Hour (Karaoke)',
  description: 'Sing along\n00:00 Intro',
  tags: ['karaoke', 'golden hour'],
  key_note: '0',
  lyrics: 'Hello there',
  privacy_status: 'public',
};

const completedProject: ProjectState = {
  ...baseProject,
  render_status: 'completed',
  render_progress: 100,
  video_url: '/media/golden-hour.mp4',
  youtube_package: youtubePackage,
};

const headingOrder = () =>
  screen
    .getAllByRole('heading', { level: 3 })
    .map((h) => h.textContent?.trim() ?? '')
    .filter(Boolean);

describe('ExportModal layout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leads with the video section, then subtitles, stems and the chord sheet', () => {
    render(<ExportModal project={baseProject} isOpen onClose={vi.fn()} />);
    const order = headingOrder();
    const index = (re: RegExp) => order.findIndex((t) => re.test(t));
    expect(index(/full video render/i)).toBe(0);
    expect(index(/synchronized subtitles/i)).toBeGreaterThan(index(/full video render/i));
    expect(index(/audio stem downloads/i)).toBeGreaterThan(index(/synchronized subtitles/i));
    expect(index(/chord & lyric sheet/i)).toBeGreaterThan(index(/audio stem downloads/i));
    // The YouTube kit only appears once a video has been rendered.
    expect(index(/youtube metadata/i)).toBe(-1);
  });

  it('adds the YouTube kit last after a completed render', () => {
    render(<ExportModal project={completedProject} isOpen onClose={vi.fn()} />);
    const order = headingOrder();
    expect(order[0]).toMatch(/your video is ready/i);
    expect(order[order.length - 1]).toMatch(/youtube metadata & upload kit/i);
  });

  it('labels each section region by its heading', () => {
    render(<ExportModal project={completedProject} isOpen onClose={vi.fn()} />);
    for (const name of [
      /your video is ready/i,
      /synchronized subtitles/i,
      /audio stem downloads/i,
      /chord & lyric sheet/i,
      /youtube metadata/i,
    ]) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
  });

  it('lets keyboard users scroll the long YouTube description', () => {
    render(<ExportModal project={completedProject} isOpen onClose={vi.fn()} />);
    const description = screen.getByRole('region', {
      name: 'Description (with Chapters & Lyrics)',
    });
    expect(description.tagName).toBe('PRE');
    expect(description).toHaveAttribute('tabindex', '0');
  });

  it('frames the preview to the rendered video shape once metadata loads', () => {
    const { container } = render(
      <ExportModal project={completedProject} isOpen onClose={vi.fn()} />
    );
    const video = container.querySelector('video') as HTMLVideoElement;
    const frame = video.parentElement as HTMLElement;
    expect(Number(frame.style.aspectRatio)).toBeCloseTo(16 / 9, 3);
    expect(frame.className).not.toContain('max-w-xs');

    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1080 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1920 });
    fireEvent.loadedMetadata(video);

    expect(Number(frame.style.aspectRatio)).toBeCloseTo(9 / 16, 3);
    expect(frame.className).toContain('max-w-xs');
  });

  it('uses a portrait frame for 9:16 exports before metadata arrives', () => {
    const { container } = render(
      <ExportModal project={completedProject} isOpen onClose={vi.fn()} aspectRatio="9:16" />
    );
    const frame = (container.querySelector('video') as HTMLVideoElement)
      .parentElement as HTMLElement;
    expect(Number(frame.style.aspectRatio)).toBeCloseTo(9 / 16, 3);
    expect(frame.className).toContain('max-w-xs');
  });
});

describe('copyText', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
  const originalExec = Object.getOwnPropertyDescriptor(document, 'execCommand');

  const setClipboard = (value: unknown) =>
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value });
  const setExecCommand = (value: unknown) =>
    Object.defineProperty(document, 'execCommand', { configurable: true, value });

  afterEach(() => {
    if (originalClipboard) Object.defineProperty(window.navigator, 'clipboard', originalClipboard);
    else delete (window.navigator as unknown as Record<string, unknown>).clipboard;
    if (originalExec) Object.defineProperty(document, 'execCommand', originalExec);
    else delete (document as unknown as Record<string, unknown>).execCommand;
    vi.useRealTimers();
  });

  it('uses the async Clipboard API when it is available', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    expect(copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to a hidden textarea when the Clipboard API is missing (plain HTTP)', () => {
    setClipboard(undefined);
    const exec = vi.fn().mockReturnValue(true);
    setExecCommand(exec);
    expect(copyText('lan copy')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports failure when no copy path exists, and the kit says so', () => {
    vi.useFakeTimers();
    setClipboard(undefined);
    setExecCommand(undefined);
    expect(copyText('nothing')).toBe(false);

    render(<ExportYouTubeKit youtubePackage={youtubePackage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Tags' }));
    expect(screen.getByRole('button', { name: 'Copy blocked' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'Copy Tags' })).toBeInTheDocument();
  });

  it('shows Copied! feedback for the field that was copied', () => {
    vi.useFakeTimers();
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    render(<ExportYouTubeKit youtubePackage={youtubePackage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy Title' }));
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Description' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole('button', { name: 'Copied!' })).toBeNull();
  });
});

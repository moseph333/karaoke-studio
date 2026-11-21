/**
 * What the Export dialog tells a new user: before a first render, what the button starts
 * and what comes after; while rendering, that the dialog can be closed; after it, the steps
 * of a YouTube upload.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ExportModal } from '../../components/ExportModal';
import { ExportYouTubeKit } from '../../components/export/ExportYouTubeKit';
import type { ProjectState } from '../../types';

const song: ProjectState = {
  id: 'export-guidance',
  status: 'ready',
  progress: 100,
  title: 'Golden Hour',
  artist: 'The Night Shift',
  duration: 200,
  lines: [{ id: 1, start_time: 0, end_time: 2, text: 'Hello there', words: [] }],
  semitones: 0,
  guide_volume: 0,
  render_status: 'idle',
  render_progress: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('before a first render', () => {
  it('lists the three steps from here to YouTube', () => {
    render(<ExportModal project={song} isOpen onClose={vi.fn()} />);

    const steps = within(screen.getByRole('list', { name: 'From here to YouTube' })).getAllByRole(
      'listitem'
    );
    expect(steps.map((step) => step.textContent)).toEqual([
      '1. RenderA few minutes for most songs. You can close this dialog meanwhile.',
      '2. DownloadThe MP4 appears here, with a preview.',
      '3. Upload to YouTubeThe title, description and tags are written for you to paste.',
    ]);
  });

  it('says in plain words what goes into the video', () => {
    render(<ExportModal project={song} isOpen onClose={vi.fn()} />);
    const video = screen.getByRole('region', { name: /karaoke video/i });
    expect(video).toHaveTextContent(/the song as it is now/);
    expect(video).toHaveTextContent(/key and guide vocal from Audio mix/);
    expect(video).toHaveTextContent(/16:9 or 9:16 Shorts/);
    expect(video).not.toHaveTextContent(/Synthesize/);
  });

  it('drops the steps once the song has a video, as when rendering again', () => {
    render(
      <ExportModal
        project={{ ...song, render_status: 'error', video_url: '/media/golden-hour.mp4' }}
        isOpen
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByTestId('export-next-steps')).toBeNull();
  });
});

describe('while rendering', () => {
  it('says the dialog can be closed and where the progress shows', () => {
    render(
      <ExportModal
        project={{ ...song, render_status: 'rendering', render_progress: 40 }}
        isOpen
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId('render-leave-note')).toHaveTextContent(
      'You can close this dialog and keep working. The header shows the progress, and a message tells you when the video is ready.'
    );
    expect(screen.queryByTestId('export-next-steps')).toBeNull();
  });
});

describe('after a render: the upload to YouTube', () => {
  const kit = {
    title: 'The Night Shift - Golden Hour (Karaoke Version)',
    description:
      'Sing along\n\n🕒 Timestamps:\n0:00 - Intro\n0:20 - Verse\n1:10 - Chorus\n\n📜 Lyrics:\nHello there',
    tags: ['karaoke', 'golden hour'],
    key_note: 'Key: Original Key',
    lyrics: 'Hello there',
    privacy_status: 'unlisted',
  };
  const checks = () =>
    within(screen.getByTestId('youtube-publish-checks'))
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '');

  it('walks through five steps, with the title, description and tags to copy', () => {
    render(<ExportYouTubeKit youtubePackage={kit} format="16:9" durationSeconds={200} />);

    const region = screen.getByRole('region', { name: 'Upload to YouTube' });
    expect(region).toHaveTextContent(/The upload happens on YouTube; nothing is sent from here/);
    expect(
      within(region)
        .getAllByRole('heading', { level: 4 })
        .map((heading) => heading.textContent)
    ).toEqual([
      '1. Download the video and start an upload',
      '2. Paste the title',
      '3. Paste the description',
      '4. Paste the tags',
      '5. Check before you publish',
    ]);
    for (const name of ['Copy title', 'Copy description', 'Copy tags']) {
      expect(within(region).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(region).toHaveTextContent(/choose Create, then Upload videos/);
    expect(region).toHaveTextContent(/tags are under “Show more”/);
  });

  it('says whether the description carries chapters, and labels it to match', () => {
    const { rerender } = render(<ExportYouTubeKit youtubePackage={kit} />);
    expect(
      screen.getByText(/chapter timestamps \(YouTube turns them into chapters\)/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Description, with chapters and lyrics' })
    ).toBeInTheDocument();

    rerender(
      <ExportYouTubeKit
        youtubePackage={{ ...kit, description: 'Sing along\n\n📜 Lyrics:\nHello' }}
      />
    );
    expect(screen.getByText(/too few sections for chapters/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Description, with lyrics' })).toBeInTheDocument();
    expect(screen.queryByText(/with Chapters/)).toBeNull();
  });

  it('does not take a lyric that starts with a clock time for a chapter', () => {
    render(
      <ExportYouTubeKit
        youtubePackage={{
          ...kit,
          description: 'Sing along\n\n📜 Lyrics:\n3:00 in the morning\n10:15 on a Saturday night',
        }}
      />
    );
    expect(screen.getByRole('region', { name: 'Description, with lyrics' })).toBeInTheDocument();
    expect(screen.getByText(/too few sections for chapters/)).toBeInTheDocument();
  });

  it('advises an unlisted first upload and warns about copyright claims', () => {
    render(<ExportYouTubeKit youtubePackage={kit} format="16:9" durationSeconds={200} />);
    const items = checks();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatch(/Start with Unlisted or Private/);
    expect(items[1]).toMatch(/copyright claim/);
    expect(items[1]).toMatch(/Upload only songs you have the right to share/);
  });

  it.each([
    [150, /three minutes or shorter, so YouTube publishes it as a Short/],
    [180, /three minutes or shorter, so YouTube publishes it as a Short/],
    [200, /longer than three minutes, so YouTube publishes it as a regular video/],
    [undefined, /9:16 videos of up to three minutes as Shorts/],
  ])('says what a 9:16 video of %s seconds becomes', (durationSeconds, note) => {
    render(
      <ExportYouTubeKit youtubePackage={kit} format="9:16" durationSeconds={durationSeconds} />
    );
    const items = checks();
    expect(items).toHaveLength(3);
    expect(items[1]).toMatch(note);
  });

  it('gets the rendered format and the song length from the dialog', () => {
    render(
      <ExportModal
        project={{
          ...song,
          duration: 150,
          render_status: 'completed',
          render_progress: 100,
          video_url: '/media/golden-hour-vertical.mp4',
          videos_by_aspect: { '9:16': '/media/golden-hour-vertical.mp4' },
          youtube_package: kit,
        }}
        isOpen
        onClose={vi.fn()}
      />
    );
    expect(checks()[1]).toMatch(/publishes it as a Short/);
    // The steps point at the buttons of the video section above them
    expect(screen.getByRole('link', { name: /Download video/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open YouTube Studio/ })).toBeInTheDocument();
  });
});

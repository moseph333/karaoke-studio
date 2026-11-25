/**
 * Help's "Fix a problem" tab and the first-song block of its usage guide: what they list,
 * the buttons a finished song adds, and the ways the studio opens Help on that tab.
 */

import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { HelpModal } from '../../components/HelpModal';
import { loadDeferredScreens } from '../../deferredScreens';
import type { LyricLine, ProjectState } from '../../types';
import { GUIDE_ACTION_LABELS } from '../../utils/guideActions';
import { FIRST_SONG_STEPS, PROBLEMS } from '../../utils/troubleshooting';
import { json, mockStudioFetch } from '../helpers/qualityFixtures';
import {
  assertTouchTargets,
  setTestViewport,
  resetTestViewport,
} from '../helpers/responsiveTestUtils';

beforeAll(() => loadDeferredScreens());

beforeEach(() => {
  mockStudioFetch();
});

afterEach(() => {
  resetTestViewport();
  vi.restoreAllMocks();
});

const fixPanel = () => screen.getByRole('tabpanel', { name: 'Fix a problem' });

describe('the Fix a problem tab', () => {
  it('is the last help topic and opens when asked for', () => {
    render(<HelpModal isOpen onClose={vi.fn()} initialTab="fix" />);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Keyboard shortcuts',
      'What you can do',
      'Studio usage guide',
      'Fix a problem',
    ]);
    const tab = screen.getByRole('tab', { name: 'Fix a problem' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('aria-controls', 'tabpanel-fix');
    expect(fixPanel()).toHaveAttribute('id', 'tabpanel-fix');
  });

  it('scrolls its tab into view, since the tab list scrolls sideways on phones', () => {
    // setup.ts stubs scrollIntoView on HTMLElement; watch which element it is called on
    const scrolled: Element[] = [];
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (
      this: HTMLElement
    ) {
      scrolled.push(this);
    });

    render(<HelpModal isOpen onClose={vi.fn()} initialTab="fix" />);

    expect(scrolled[scrolled.length - 1]).toBe(screen.getByRole('tab', { name: 'Fix a problem' }));
  });

  it('lists every problem as a symptom that opens to its cause and steps', async () => {
    render(<HelpModal isOpen onClose={vi.fn()} initialTab="fix" />);

    const items = within(within(fixPanel()).getByRole('list', { name: 'Common problems' }))
      .getAllByRole('listitem')
      .filter((item) => item.querySelector('details'));
    expect(items.map((item) => item.querySelector('summary')?.textContent)).toEqual(
      PROBLEMS.map((problem) => problem.symptom)
    );

    const singer = fixPanel().querySelector('details[data-problem="singer-audible"]');
    expect(singer).not.toHaveAttribute('open');
    await userEvent.click(within(singer as HTMLElement).getByText('I can still hear the singer'));
    expect(singer).toHaveAttribute('open');
    expect(singer).toHaveTextContent('In Audio mix, set Guide vocal to Off.');
    expect(singer).toHaveTextContent(/Fast quality leaves the most/);
  });

  it('has no buttons into the studio until a finished song is open', () => {
    render(<HelpModal isOpen onClose={vi.fn()} initialTab="fix" onAction={vi.fn()} />);

    expect(fixPanel()).toHaveTextContent(/Open a finished song and the fixes get buttons/);
    expect(within(fixPanel()).queryAllByRole('button')).toHaveLength(0);
  });

  it('adds a check-up button and a button per fix once a song is open', async () => {
    const onAction = vi.fn();
    render(<HelpModal isOpen onClose={vi.fn()} initialTab="fix" songOpen onAction={onAction} />);

    await userEvent.click(within(fixPanel()).getByRole('button', { name: 'Check this song' }));
    await userEvent.click(
      within(fixPanel()).getByRole('button', {
        name: 'Open the audio mix (I can still hear the singer)',
        hidden: true,
      })
    );
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(['checkup', 'mix']);

    // Every fix button says which problem it belongs to, so no two share a name
    const names = within(fixPanel())
      .getAllByRole('button', { hidden: true })
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);
    expect(new Set(names).size).toBe(names.length);
    const expected = PROBLEMS.reduce((count, problem) => count + problem.actions.length, 1);
    expect(names).toHaveLength(expected);
    for (const problem of PROBLEMS) {
      for (const action of problem.actions) {
        expect(names).toContain(`${GUIDE_ACTION_LABELS[action]} (${problem.symptom})`);
      }
    }
  });

  it('covers a failed render and the YouTube upload, both leading to Export', async () => {
    const onAction = vi.fn();
    render(<HelpModal isOpen onClose={vi.fn()} initialTab="fix" songOpen onAction={onAction} />);

    const upload = fixPanel().querySelector('details[data-problem="youtube-upload"]');
    expect(upload).toHaveTextContent('I don’t know how to get the video onto YouTube');
    expect(upload).toHaveTextContent(/Follow “Upload to YouTube” under the finished video/);
    expect(upload).toHaveTextContent(/Publish as Unlisted first/);
    expect(fixPanel().querySelector('details[data-problem="render-failed"]')).toHaveTextContent(
      /press Try Again/
    );

    for (const symptom of [
      'The video render failed, or takes very long',
      'I don’t know how to get the video onto YouTube',
    ]) {
      await userEvent.click(
        within(fixPanel()).getByRole('button', { name: `Open export (${symptom})`, hidden: true })
      );
    }
    expect(onAction.mock.calls.map(([action]) => action)).toEqual(['export', 'export']);
  });

  it('keeps 44px touch targets on a phone', () => {
    setTestViewport(320);
    const { container } = render(
      <HelpModal isOpen onClose={vi.fn()} initialTab="fix" songOpen onAction={vi.fn()} />
    );
    const targets = assertTouchTargets(container, 44);
    expect(targets.failed).toEqual([]);
    expect(targets.total).toBeGreaterThan(PROBLEMS.length);
    for (const summary of Array.from(container.querySelectorAll('summary'))) {
      expect(summary.className).toContain('min-h-[44px]');
    }
  });
});

describe('the usage guide', () => {
  it('starts with the first-song steps and what to expect', () => {
    render(<HelpModal isOpen onClose={vi.fn()} initialTab="guide" />);

    const block = screen.getByRole('region', { name: 'Your first song' });
    expect(within(block).getAllByRole('listitem')).toHaveLength(FIRST_SONG_STEPS.length);
    expect(block).toHaveTextContent('Play and sing. Press Space or the play button.');
    expect(block).toHaveTextContent(/What to expect\. Songs are made automatically/);
    // Not offered without a song, or while the card is already showing
    expect(within(block).queryByRole('button')).toBeNull();
  });

  it('brings the first-song card back and closes', async () => {
    const onShow = vi.fn();
    const onClose = vi.fn();
    render(
      <HelpModal
        isOpen
        onClose={onClose}
        initialTab="guide"
        songOpen
        onShowFirstSongSteps={onShow}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show the first-song steps' }));
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('no longer says every song is separated with Demucs', () => {
    render(<HelpModal isOpen onClose={vi.fn()} initialTab="guide" />);
    const guide = screen.getByRole('tabpanel', { name: 'Studio usage guide' });
    expect(guide).not.toHaveTextContent(/Demucs AI/);
    expect(guide).toHaveTextContent(/Fast, Balanced or Best/);
  });
});

describe('in the studio', () => {
  const line = (id: number, start: number): LyricLine => ({
    id,
    text: `Line number ${id}`,
    start_time: start,
    end_time: start + 3,
    words: [
      { word: 'Line', start_time: start, end_time: start + 1 },
      { word: 'number', start_time: start + 1, end_time: start + 2 },
      { word: `${id}`, start_time: start + 2, end_time: start + 3 },
    ],
    confidence: 0.9,
    align_method: 'ctc',
  });
  const project: ProjectState = {
    id: 'help-proj',
    title: 'Helped Song',
    artist: 'The Guides',
    status: 'ready',
    progress: 100,
    duration: 60,
    lines: [line(1, 5), line(2, 10)],
    semitones: 0,
    guide_volume: 0,
    lyric_timing: 'aligned',
    master_audio_url: '/static/output/help_master.wav',
    separation: { preset: 'balanced', label: 'Balanced · Mel-Band RoFormer' },
  };

  const serve = (open: boolean) => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', open ? '/?project=help-proj' : '/');
    mockStudioFetch((url) => {
      if (url.includes('/api/auth/status')) {
        return json({ auth_required: false, authenticated: true });
      }
      if (url.includes('/api/project/help-proj')) return json(project);
      return undefined;
    });
  };

  it('opens Help on Fix a problem from the first-song card', async () => {
    serve(true);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Something off? Fix a problem' }));

    expect(await screen.findByRole('tab', { name: 'Fix a problem' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('opens Help on Fix a problem from the check-up, which closes', async () => {
    serve(true);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Song check-up:/ }));
    const checkup = await screen.findByRole('dialog', { name: 'Song check-up' });

    await user.click(within(checkup).getByRole('button', { name: 'Not listed? Fix a problem' }));

    expect(screen.queryByRole('dialog', { name: 'Song check-up' })).toBeNull();
    expect(await screen.findByRole('tab', { name: 'Fix a problem' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('takes a fix to its tool and closes Help', async () => {
    serve(true);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Something off? Fix a problem' }));
    await screen.findByRole('tab', { name: 'Fix a problem' });

    await user.click(screen.getByText('There are no lyrics'));
    await user.click(
      screen.getByRole('button', { name: 'Find or paste lyrics (There are no lyrics)' })
    );

    expect(
      await screen.findByRole('dialog', { name: /Replace \/ Re-align Lyrics/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Fix a problem' })).toBeNull();
  });

  it('still opens on the shortcut list from the ? key, even after Fix a problem', async () => {
    serve(true);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Something off? Fix a problem' }));
    await user.click(await screen.findByRole('button', { name: 'Close' }));

    fireEvent.keyDown(window, { key: '?' });

    expect(await screen.findByRole('tab', { name: /keyboard shortcuts/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('shows the fixes without buttons on the library screen', async () => {
    serve(false);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /help and studio usage guide/i }));
    await user.click(await screen.findByRole('tab', { name: 'Fix a problem' }));

    expect(fixPanel()).toHaveTextContent(/Open a finished song/);
    expect(within(fixPanel()).queryAllByRole('button', { hidden: true })).toHaveLength(0);
  });
});

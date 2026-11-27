/**
 * Seeing your pitch in the studio: the practice panel's switch asks for the microphone, the
 * pitch lane appears under the stage's screen (outside the video's frame, and never in a
 * stage window), the melody is asked of the server only then, and each way it can go wrong
 * is said in plain words.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { LyricDisplay } from '../../components/LyricDisplay';
import { loadDeferredScreens } from '../../deferredScreens';
import { installFakeMicrophone, type FakeMicrophone } from '../helpers/fakeMicrophone';
import { resolveFrontendFile } from '../helpers/frontendFiles';
import { PRACTICE_LINES, PRACTICE_SONG, mockPracticeFetch } from '../helpers/practiceFixtures';

beforeAll(() => loadDeferredScreens());

interface NodeFs {
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
}
const fs = (eval('require') as (mod: string) => unknown)('fs') as NodeFs;

/** The source files of a folder of the frontend, with their text. */
function sourceFiles(folder: string): { path: string; text: string }[] {
  const dir = resolveFrontendFile(folder);
  return fs
    .readdirSync(dir)
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => ({
      path: `${folder}/${name}`,
      text: fs.readFileSync(`${dir}/${name}`, 'utf8'),
    }));
}

let mic: FakeMicrophone;
let fetchSpy: ReturnType<typeof mockPracticeFetch>;

async function openPractice() {
  window.history.pushState({}, '', `/?project=${PRACTICE_SONG.id}&practice=1`);
  render(<App />);
  await screen.findByTestId('practice-panel');
}

const pitchSwitch = () => screen.getByRole('switch', { name: 'See your pitch' });
const lane = () => screen.queryByTestId('practice-pitch-lane');
const melodyRequests = () =>
  fetchSpy.mock.calls.filter(([input]) => input.toString().includes('/melody'));
/** Switches the pitch display on and lets the browser's answer arrive. */
async function switchOn() {
  await act(async () => {
    fireEvent.click(pitchSwitch());
    await Promise.resolve();
  });
}

describe('seeing your pitch in the studio', () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSpy = mockPracticeFetch();
    mic = installFakeMicrophone();
  });

  afterEach(() => {
    mic.restore();
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('asks for nothing until the switch is turned on', async () => {
    await openPractice();
    expect(pitchSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(lane()).toBeNull();
    expect(mic.getUserMedia).not.toHaveBeenCalled();
    expect(melodyRequests()).toHaveLength(0);
    expect(screen.getByText(/Nothing you sing leaves this device/)).toBeVisible();
  });

  it('asks for the microphone and the melody, and shows the lane', async () => {
    await openPractice();
    await switchOn();

    expect(mic.getUserMedia).toHaveBeenCalledTimes(1);
    expect(pitchSwitch()).toHaveAttribute('aria-checked', 'true');
    expect(lane()).toBeInTheDocument();
    expect(screen.getByText(/Listening\. Wear headphones/)).toBeVisible();
    await waitFor(() => expect(melodyRequests()).toHaveLength(1));
    expect(melodyRequests()[0][0].toString()).toBe(`/api/project/${PRACTICE_SONG.id}/melody`);
    await screen.findByText(/The grey line is the song/);
  });

  it('puts the lane under the stage’s screen, outside the video’s frame', async () => {
    await openPractice();
    await switchOn();

    const stage = screen.getByTestId('lyric-display-stage');
    const stageScreen = screen.getByTestId('stage-screen');
    expect(stage.contains(lane())).toBe(true);
    expect(stageScreen.contains(lane())).toBe(false);
    // After the screen: it goes with the stage into fullscreen
    expect(stageScreen.compareDocumentPosition(lane()!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('lets the microphone go and takes the lane away when switched off', async () => {
    await openPractice();
    await switchOn();

    fireEvent.click(pitchSwitch());

    expect(lane()).toBeNull();
    expect(mic.tracks[0].stop).toHaveBeenCalled();
    expect(pitchSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('lets the microphone go when practice is left', async () => {
    await openPractice();
    await switchOn();

    fireEvent.click(screen.getByRole('button', { name: 'Back to the timeline' }));

    expect(mic.tracks[0].stop).toHaveBeenCalled();
    expect(lane()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    expect(pitchSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('says so when the browser refuses, and still draws the melody', async () => {
    mic.restore();
    mic = installFakeMicrophone({ refuse: 'NotAllowedError' });
    await openPractice();
    await switchOn();

    expect(screen.getByText(/was not allowed to use the microphone/)).toBeVisible();
    expect(lane()).toBeInTheDocument();
    await waitFor(() => expect(melodyRequests()).toHaveLength(1));
  });

  it('says so when there is no microphone, or no secure address', async () => {
    mic.restore();
    mic = installFakeMicrophone({ refuse: 'NotFoundError' });
    await openPractice();
    await switchOn();
    expect(screen.getByText(/No microphone can be used here/)).toBeVisible();
  });

  it('says so when the song has no melody to show', async () => {
    vi.restoreAllMocks();
    fetchSpy = mockPracticeFetch({ ...PRACTICE_SONG, vocals_url: undefined });
    await openPractice();
    await switchOn();

    expect(screen.getByText(/This song has no melody to show/)).toBeVisible();
    expect(screen.getByRole('img', { name: /This song has no melody to show/ })).toBe(lane());
    expect(melodyRequests()).toHaveLength(0);
  });

  it('can be switched from the command palette', async () => {
    await openPractice();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    fireEvent.change(await screen.findByRole('combobox', { name: /search commands/i }), {
      target: { value: 'see my pitch' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /See my pitch/ }));
    await waitFor(() => expect(mic.getUserMedia).toHaveBeenCalled());
    await waitFor(() => expect(lane()).toBeInTheDocument());
  });
});

describe('the lane and the video’s frame', () => {
  it('is not drawn by a stage window, which shows the screen alone', () => {
    render(
      <LyricDisplay
        lines={PRACTICE_LINES}
        currentTime={11}
        duration={64}
        bare
        underScreen={<div data-testid="under-screen" />}
      />
    );
    expect(screen.queryByTestId('under-screen')).toBeNull();
  });

  it('is drawn under the screen of the studio’s own stage', () => {
    render(
      <LyricDisplay
        lines={PRACTICE_LINES}
        currentTime={11}
        duration={64}
        underScreen={<div data-testid="under-screen" />}
      />
    );
    expect(screen.getByTestId('lyric-display-stage')).toContainElement(
      screen.getByTestId('under-screen')
    );
    expect(screen.getByTestId('stage-screen')).not.toContainElement(
      screen.getByTestId('under-screen')
    );
  });

  it('is nothing the frame of the video knows about', () => {
    // The frame holds only what the export can draw: no stage file reaches into practice
    const frameFiles = sourceFiles('src/components/stage').concat(
      sourceFiles('src/components/stage-window')
    );
    expect(frameFiles.length).toBeGreaterThan(5);
    for (const file of frameFiles) {
      expect(file.text, file.path).not.toMatch(/components\/practice|\.\.\/practice\//);
      expect(file.text, file.path).not.toMatch(/PracticePitchLane|useMicPitch/);
    }
  });
});

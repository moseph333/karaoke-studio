/**
 * The practice panel's repeat controls, in the studio: the switch, the part rows and the two
 * line pickers all set the stretch that goes round, and the scrubber marks it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import App from '../../App';
import { loadDeferredScreens } from '../../deferredScreens';
import { PRACTICE_SONG, mockPracticeFetch } from '../helpers/practiceFixtures';
import { expectTouchTarget } from '../helpers/responsiveTestUtils';

beforeAll(() => loadDeferredScreens());

async function openPractice() {
  window.history.pushState({}, '', `/?project=${PRACTICE_SONG.id}&practice=1`);
  render(<App />);
  await screen.findByTestId('practice-panel');
}

const repeatSwitch = () => screen.getByRole('switch', { name: 'Repeat this part' });
const partButton = (number: number) =>
  screen.getByRole('button', { name: new RegExp(`^Repeat part ${number}:`) });
const fromLine = () => screen.getByLabelText('Repeat from line') as HTMLSelectElement;
const toLine = () => screen.getByLabelText('Repeat to line') as HTMLSelectElement;
const audio = () => screen.getByTestId('audio-element') as HTMLAudioElement;
/** The scrubber's mark, as [left %, width %] of the 64 s song. */
const mark = () => {
  const style = screen.getByTestId('waveform-range').style;
  return [parseFloat(style.left), parseFloat(style.width)];
};

describe('repeat in the practice panel', () => {
  beforeEach(() => {
    localStorage.clear();
    mockPracticeFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('starts with nothing repeating and nothing marked', async () => {
    await openPractice();
    expect(repeatSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('waveform-range')).toBeNull();
    expect(fromLine().value).toBe('');
    expect(toLine().value).toBe('');
  });

  it('repeats the part being sung from the switch', async () => {
    await openPractice();
    fireEvent.click(repeatSwitch());

    expect(repeatSwitch()).toHaveAttribute('aria-checked', 'true');
    expect(partButton(1)).toHaveAttribute('aria-pressed', 'true');
    expect(partButton(1)).toHaveTextContent('Repeating');
    expect(screen.getByText('Lines 1 to 3 repeat, starting 2 seconds early.')).toBeInTheDocument();
    // Lines 1-3 run from 10 s to 18.5 s
    expect(mark()[0]).toBeCloseTo((10 / 64) * 100);
    expect(mark()[1]).toBeCloseTo((8.5 / 64) * 100);
    expect(fromLine().value).toBe('0');
    expect(toLine().value).toBe('2');
  });

  it('repeats a picked part from two seconds before it', async () => {
    await openPractice();
    fireEvent.click(partButton(2));

    expect(partButton(2)).toHaveAttribute('aria-pressed', 'true');
    expect(partButton(1)).toHaveAttribute('aria-pressed', 'false');
    expect(audio().currentTime).toBe(24);
    expect(mark()[0]).toBeCloseTo((26 / 64) * 100);

    // Pressing the part that repeats stops it
    fireEvent.click(partButton(2));
    expect(repeatSwitch()).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('waveform-range')).toBeNull();
  });

  it('repeats a stretch picked line by line', async () => {
    await openPractice();
    fireEvent.change(fromLine(), { target: { value: '4' } });
    expect(screen.getByText('Line 5 repeats, starting 2 seconds early.')).toBeInTheDocument();
    expect(audio().currentTime).toBe(27);

    fireEvent.change(toLine(), { target: { value: '6' } });
    expect(screen.getByText('Lines 5 to 7 repeat, starting 2 seconds early.')).toBeInTheDocument();
    // A stretch of its own: no part is the one repeating
    expect(partButton(2)).toHaveAttribute('aria-pressed', 'false');
    expect(mark()[0]).toBeCloseTo((29 / 64) * 100);
    expect(mark()[1]).toBeCloseTo((8.5 / 64) * 100);
  });

  it('makes one line of it when the start is picked after the end', async () => {
    await openPractice();
    fireEvent.change(fromLine(), { target: { value: '2' } });
    fireEvent.change(toLine(), { target: { value: '4' } });
    fireEvent.change(fromLine(), { target: { value: '9' } });
    expect(fromLine().value).toBe('9');
    expect(toLine().value).toBe('9');

    fireEvent.change(toLine(), { target: { value: '3' } });
    expect(fromLine().value).toBe('3');
    expect(toLine().value).toBe('3');
  });

  it('stops repeating when practice is left', async () => {
    await openPractice();
    fireEvent.click(partButton(3));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the timeline' }));
    expect(screen.queryByTestId('waveform-range')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Practice' }));
    expect(repeatSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('gives every control a finger-sized target', async () => {
    await openPractice();
    expectTouchTarget(screen.getByRole('button', { name: 'Practice' }));
    expectTouchTarget(screen.getByRole('button', { name: 'Back to the timeline' }));
    expectTouchTarget(repeatSwitch().parentElement);
    expectTouchTarget(fromLine());
    expectTouchTarget(toLine());
    expectTouchTarget(partButton(1));
  });
});

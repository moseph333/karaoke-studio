/**
 * The self-playing lyric preview on the home screen: words light up in order, the pause
 * button stops it, and it stands still for viewers who ask for reduced motion.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { HeroStageDemo } from '../../components/track-search/HeroStageDemo';

const wordStates = () =>
  Array.from(document.querySelectorAll('[data-word-state]')).map(
    (el) => `${el.firstChild?.textContent}:${el.getAttribute('data-word-state')}`
  );

function reduceMotion(reduced: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduced && query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      }) as unknown as MediaQueryList
  );
}

describe('HeroStageDemo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reduceMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is one labelled image for assistive tech, with its lyrics hidden from it', () => {
    render(<HeroStageDemo />);
    const image = screen.getByRole('img', { name: /lyrics light up word by word/i });
    expect(
      image.querySelector('[data-word-state]')?.closest('[aria-hidden="true"]')
    ).not.toBeNull();
  });

  it('sings the first line word by word, then moves to the next line', () => {
    render(<HeroStageDemo />);
    // The pause before the line: nothing sung yet
    expect(wordStates()).toEqual([
      'City:ahead',
      'lights:ahead',
      'are:ahead',
      'humming:ahead',
      'low:ahead',
    ]);

    act(() => void vi.advanceTimersByTime(520));
    expect(wordStates().slice(0, 2)).toEqual(['City:active', 'lights:ahead']);

    act(() => void vi.advanceTimersByTime(420));
    expect(wordStates().slice(0, 3)).toEqual(['City:sung', 'lights:active', 'are:ahead']);

    // The rest of the line (400 + 240 + 560 + 760 ms) and on to the second line's pause
    act(() => void vi.advanceTimersByTime(400));
    act(() => void vi.advanceTimersByTime(240));
    act(() => void vi.advanceTimersByTime(560));
    act(() => void vi.advanceTimersByTime(760));
    expect(wordStates()[0]).toBe('I:ahead');
  });

  it('sweeps the active word for as long as it is sung', () => {
    render(<HeroStageDemo />);
    act(() => void vi.advanceTimersByTime(520));
    const sweep = document.querySelector('[data-word-state="active"] span') as HTMLElement;
    expect(sweep.className).toContain('animate-word-sweep');
    expect(sweep.style.animationDuration).toBe('420ms');
  });

  it('stops and resumes with the pause button, a 44 px target', () => {
    render(<HeroStageDemo />);
    act(() => void vi.advanceTimersByTime(520));
    const before = wordStates();

    const pause = screen.getByRole('button', { name: 'Pause the lyric preview' });
    expect(pause.className).toContain('min-h-[44px]');
    expect(pause.className).toContain('min-w-[44px]');
    fireEvent.click(pause);

    act(() => void vi.advanceTimersByTime(10000));
    expect(wordStates()).toEqual(before);
    expect(screen.getByTestId('hero-stage-demo')).toHaveAttribute('data-playing', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Play the lyric preview' }));
    act(() => void vi.advanceTimersByTime(420));
    expect(wordStates()).not.toEqual(before);
  });

  it('shows a still, half-sung line when reduced motion is requested', () => {
    reduceMotion(true);
    render(<HeroStageDemo />);
    const still = wordStates();
    expect(still.slice(0, 3)).toEqual(['City:sung', 'lights:sung', 'are:active']);

    act(() => void vi.advanceTimersByTime(10000));
    expect(wordStates()).toEqual(still);
    expect(document.querySelector('.animate-word-sweep')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause the lyric preview' })).toBeDisabled();
  });
});

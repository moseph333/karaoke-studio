/**
 * Tips on the processing screen: they advance on their own until the viewer takes over
 * with "Next tip", and stand still under reduced motion.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ProcessingTips } from '../../components/ProcessingTips';
import { ProcessingView } from '../../components/ProcessingView';

const tipText = () => screen.getByTestId('processing-tips').querySelector('p')?.textContent;

describe('ProcessingTips', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts by saying the page can be left', () => {
    render(<ProcessingTips />);
    expect(tipText()).toMatch(/^Tip: You can leave this page/);
  });

  it('moves to the next tip every 8 seconds and wraps around', () => {
    render(<ProcessingTips />);
    const first = tipText();

    act(() => void vi.advanceTimersByTime(8000));
    const second = tipText();
    expect(second).not.toBe(first);

    act(() => void vi.advanceTimersByTime(8000 * 5));
    expect(tipText()).toBe(first);
  });

  it('hands control to the viewer once they press Next tip', () => {
    render(<ProcessingTips />);
    const next = screen.getByRole('button', { name: 'Next tip' });
    expect(next.className).toContain('min-h-[44px]');

    fireEvent.click(next);
    const chosen = tipText();
    expect(chosen).toMatch(/Every word gets its own timing/);

    act(() => void vi.advanceTimersByTime(60000));
    expect(tipText()).toBe(chosen);
  });

  it('does not advance on its own under reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList
    );
    render(<ProcessingTips />);
    const first = tipText();
    act(() => void vi.advanceTimersByTime(60000));
    expect(tipText()).toBe(first);
  });

  it('is part of the processing screen but not of its end states', () => {
    const project = {
      id: 'p',
      status: 'separating' as const,
      progress: 10,
      lines: [],
      semitones: 0,
      guide_volume: 0,
    };
    const noop = () => {};
    const { rerender } = render(
      <ProcessingView project={project} onCancelProcess={noop} onResetProject={noop} />
    );
    expect(screen.getByTestId('processing-tips')).toBeInTheDocument();
    // The tip is not inside the live region that announces the stage
    expect(screen.getByRole('status')).not.toContainElement(screen.getByTestId('processing-tips'));

    rerender(
      <ProcessingView
        project={{ ...project, status: 'error', error: 'boom' }}
        onCancelProcess={noop}
        onResetProject={noop}
      />
    );
    expect(screen.queryByTestId('processing-tips')).not.toBeInTheDocument();
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tooltip } from '../components/Tooltip';

describe('Tooltip Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('renders child element without tooltip popup initially', () => {
    render(
      <Tooltip content="Helpful information">
        <button type="button">Test Button</button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Test Button' });
    expect(button).toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('displays tooltip on hover after delay', () => {
    render(
      <Tooltip content="Helpful information" delayMs={150}>
        <button type="button">Test Button</button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Test Button' });
    fireEvent.mouseEnter(button);

    // Before delay expires, tooltip is not yet visible
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // Advance timers by delayMs
    act(() => {
      vi.advanceTimersByTime(150);
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('Helpful information');
  });

  it('displays tooltip immediately on keyboard focus', () => {
    render(
      <Tooltip content="Keyboard focus information" delayMs={300}>
        <button type="button">Action</button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Action' });
    fireEvent.focus(button);

    // Focus shows immediately without waiting for delayMs
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('Keyboard focus information');
  });

  it('dismisses tooltip on mouse leave', () => {
    render(
      <Tooltip content="Helpful text" delayMs={0}>
        <button type="button">Dismiss Me</button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Dismiss Me' });
    fireEvent.mouseEnter(button);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.mouseLeave(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('cancels scheduled tooltip if mouse leaves before delay expires', () => {
    render(
      <Tooltip content="Cancelled text" delayMs={200}>
        <button type="button">Hover Button</button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Hover Button' });
    fireEvent.mouseEnter(button);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.mouseLeave(button);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('dismisses tooltip on blur', () => {
    render(
      <Tooltip content="Focus text">
        <button type="button">Focus Me</button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Focus Me' });
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.blur(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('dismisses tooltip on click', () => {
    render(
      <Tooltip content="Clickable item" delayMs={0}>
        <button type="button">Click Me</button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Click Me' });
    fireEvent.mouseEnter(button);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('dismisses tooltip when Escape key is pressed', () => {
    render(
      <Tooltip content="Escape dismiss test" delayMs={0}>
        <button type="button">Esc Me</button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Esc Me' });
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('dynamically attaches aria-describedby pointing to the tooltip id', () => {
    render(
      <Tooltip content="Accessible description" delayMs={0}>
        <button type="button">Accessible Button</button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Accessible Button' });
    expect(button).not.toHaveAttribute('aria-describedby');

    fireEvent.focus(button);
    const tooltip = screen.getByRole('tooltip');
    const tooltipId = tooltip.getAttribute('id');
    expect(tooltipId).toBeTruthy();
    expect(button).toHaveAttribute('aria-describedby', tooltipId);

    fireEvent.blur(button);
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('preserves existing aria-describedby and appends tooltip id when open', () => {
    render(
      <Tooltip content="Additional hint" delayMs={0}>
        <button type="button" aria-describedby="existing-desc">
          Combined Button
        </button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Combined Button' });
    expect(button).toHaveAttribute('aria-describedby', 'existing-desc');

    fireEvent.focus(button);
    const tooltip = screen.getByRole('tooltip');
    const tooltipId = tooltip.getAttribute('id');
    expect(button).toHaveAttribute('aria-describedby', `existing-desc ${tooltipId}`);

    fireEvent.blur(button);
    expect(button).toHaveAttribute('aria-describedby', 'existing-desc');
  });

  it('renders pointer-events-none on tooltip popup container', () => {
    render(
      <Tooltip content="Pointer events test" delayMs={0}>
        <button type="button">Target</button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Target' });
    fireEvent.focus(button);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveClass('pointer-events-none');
    expect(tooltip).toHaveClass('backdrop-blur-md');
  });

  it('renders single hotkey badge in <kbd>', () => {
    render(
      <Tooltip content="Play or Pause" hotkey="Space" delayMs={0}>
        <button type="button" aria-label="Start playback">
          Play
        </button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Start playback' });
    fireEvent.focus(button);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Play or Pause');

    const kbd = tooltip.querySelector('kbd');
    expect(kbd).toBeInTheDocument();
    expect(kbd).toHaveTextContent('Space');
    expect(kbd).toHaveClass('font-mono');
  });

  it('renders multiple hotkey badges for array hotkeys (e.g. ["←", "→"])', () => {
    render(
      <Tooltip content="Scrub timeline" hotkey={['←', '→']} delayMs={0}>
        <input type="range" aria-label="Audio scrubber" />
      </Tooltip>
    );

    const scrubber = screen.getByRole('slider', { name: 'Audio scrubber' });
    fireEvent.focus(scrubber);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Scrub timeline');

    const kbds = tooltip.querySelectorAll('kbd');
    expect(kbds).toHaveLength(2);
    expect(kbds[0]).toHaveTextContent('←');
    expect(kbds[1]).toHaveTextContent('→');
  });

  it('renders hotkey badges for M and ? shortcuts', () => {
    const { unmount } = render(
      <Tooltip content="Mute audio" hotkey="M" delayMs={0}>
        <button type="button" aria-label="Mute">
          Mute
        </button>
      </Tooltip>
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Mute' }));
    expect(screen.getByRole('tooltip').querySelector('kbd')).toHaveTextContent('M');
    unmount();

    render(
      <Tooltip content="Studio Help" hotkey="?" delayMs={0}>
        <button type="button" aria-label="Help">
          Help
        </button>
      </Tooltip>
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('tooltip').querySelector('kbd')).toHaveTextContent('?');
  });

  it('completely preserves the child button accessible name calculation', () => {
    render(
      <Tooltip content="Tooltip explanation text that differs from button label" delayMs={0}>
        <button type="button" aria-label="Unique Accessible Name">
          Button Visual Label
        </button>
      </Tooltip>
    );

    // getByRole must find the button strictly by its accessible name
    const button = screen.getByRole('button', { name: 'Unique Accessible Name' });
    expect(button).toBeInTheDocument();

    fireEvent.focus(button);
    // Even when tooltip is open, getByRole by accessible name still works cleanly
    expect(screen.getByRole('button', { name: 'Unique Accessible Name' })).toBe(button);
  });

  it('suppresses native title attribute on child element', () => {
    render(
      <Tooltip content="Modern glassmorphism tooltip" delayMs={0}>
        <button type="button" title="Old native browser tooltip">
          Native Title Button
        </button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Native Title Button' });
    expect(button).not.toHaveAttribute('title');
  });

  it('respects disabled prop and prevents tooltip from opening', () => {
    render(
      <Tooltip content="Disabled tooltip content" disabled delayMs={0}>
        <button type="button">Disabled Target</button>
      </Tooltip>
    );

    const button = screen.getByRole('button', { name: 'Disabled Target' });
    fireEvent.mouseEnter(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.focus(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('supports different placement classes (top, bottom, left, right)', () => {
    const { unmount } = render(
      <Tooltip content="Bottom content" position="bottom" align="start" delayMs={0}>
        <button type="button">Bottom Start</button>
      </Tooltip>
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Bottom Start' }));
    let tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveClass('top-full');
    expect(tooltip).toHaveClass('left-0');
    unmount();

    render(
      <Tooltip content="Left content" position="left" delayMs={0}>
        <button type="button">Left Center</button>
      </Tooltip>
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Left Center' }));
    tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveClass('right-full');
  });

  it('applies high-contrast theme surface and text tokens in Brutalist Clean Paper theme (never black-on-black)', () => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'clean_paper');
    root.style.setProperty('--theme-surface', '#ffffff');
    root.style.setProperty('--theme-text', '#111111');
    root.style.setProperty('--theme-border', '#111111');
    root.style.setProperty('--theme-surface-subtle', '#eaeae4');
    root.style.setProperty('--theme-accent', '#111111');

    render(
      <Tooltip content="Readable paper tooltip" hotkey="Space" delayMs={0}>
        <button type="button">Paper Button</button>
      </Tooltip>
    );

    fireEvent.focus(screen.getByRole('button', { name: 'Paper Button' }));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.style.backgroundColor).toBe('var(--theme-surface, #020617)');
    expect(tooltip.style.color).toBe('var(--theme-text, #f1f5f9)');
    expect(tooltip.style.borderColor).toBe('var(--theme-border, #334155)');

    const kbd = tooltip.querySelector('kbd') as HTMLElement;
    expect(kbd.style.backgroundColor).toBe('var(--theme-surface-subtle, #1e293b)');
    expect(kbd.style.color).toBe('var(--theme-accent, #67e8f9)');
  });
});

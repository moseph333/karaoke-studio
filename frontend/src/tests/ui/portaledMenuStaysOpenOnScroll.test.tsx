import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Menu } from '../../components/ui/Menu';

/** A portaled menu whose trigger sits at `top` in an 800 px tall viewport. */
function openMenuAt(top: number) {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  render(
    <div data-testid="scroller">
      <Menu
        label="Row actions"
        portal
        trigger={(props) => (
          <button {...props} type="button">
            More
          </button>
        )}
        items={[{ id: 'a', label: 'Duplicate', onSelect: vi.fn() }]}
      />
      <div data-testid="elsewhere" />
    </div>
  );
  const trigger = screen.getByRole('button', { name: 'More' });
  const moveTo = (y: number) => {
    trigger.getBoundingClientRect = () => new DOMRect(100, y, 40, 40);
  };
  moveTo(top);
  fireEvent.click(trigger);
  return { moveTo, menu: screen.getByRole('menu') };
}

/** Scroll events do not bubble; the menu listens for them in the capture phase. */
const scroll = (el: Element) => act(() => void el.dispatchEvent(new Event('scroll')));

describe('a portaled menu while the page scrolls', () => {
  it('stays open when another part of the page scrolls', () => {
    const { menu } = openMenuAt(200);

    scroll(screen.getByTestId('elsewhere'));

    expect(menu).toBeInTheDocument();
    expect(menu.style.top).toBe('246px');
  });

  it('follows its trigger when the list it is in scrolls by itself', () => {
    const { moveTo, menu } = openMenuAt(200);

    moveTo(120);
    scroll(screen.getByTestId('scroller'));

    expect(screen.getByRole('menu')).toBe(menu);
    expect(menu.style.top).toBe('166px');
  });

  it('closes once its trigger has scrolled out of sight', () => {
    const { moveTo } = openMenuAt(200);

    moveTo(-60);
    scroll(screen.getByTestId('scroller'));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('still closes when the window is resized', () => {
    openMenuAt(200);

    act(() => void window.dispatchEvent(new Event('resize')));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

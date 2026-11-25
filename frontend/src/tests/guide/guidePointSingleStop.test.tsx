/**
 * Pointing at one control ("Show me"): a note beside the control, not a dialog. The
 * keyboard shortcuts stay on, the control can be pressed, and the note goes away when the
 * control is used, when "Got it" is pressed, or when the page beside it is.
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuideTour } from '../../components/guide/GuideTour';
import { isModalActive } from '../../hooks/useKeyboardShortcuts';
import { ToastProvider } from '../../hooks/useToast';
import type { StudioWorkspaceTab } from '../../types';
import { featureById } from '../../utils/features';

interface PageProps {
  feature: string;
  onEnd?: () => void;
  onTab?: (tab: StudioWorkspaceTab) => void;
  children: React.ReactNode;
}

/** A page with some controls and the pointer asked to show one feature. */
const Page: React.FC<PageProps> = ({ feature, onEnd = () => {}, onTab, children }) => {
  const [tab, setTab] = useState<StudioWorkspaceTab>('stage');
  return (
    <ToastProvider>
      <main>
        <p data-testid="tab">{tab}</p>
        {children}
      </main>
      <GuideTour
        request={{ feature }}
        activeTab={tab}
        onSelectTab={(next) => {
          onTab?.(next);
          setTab(next);
        }}
        isPlaying={true}
        onTogglePlay={() => {
          throw new Error('pointing at one control must not stop the song');
        }}
        onEnd={onEnd}
      />
    </ToastProvider>
  );
};

const offset = featureById('offset')!;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pointing at one control', () => {
  it('opens the tab the control is on and says what to do with it', () => {
    const onTab = vi.fn();
    render(
      <Page feature="offset" onTab={onTab}>
        <button data-guide="timeline-offset">Offset</button>
      </Page>
    );

    expect(onTab).toHaveBeenCalledWith('timeline');
    expect(screen.getByTestId('tab')).toHaveTextContent('timeline');
    const note = screen.getByRole('group', { name: offset.title });
    expect(note).toHaveTextContent(offset.how);
    expect(note).toHaveFocus();
    expect(screen.queryByText(/ of \d/)).toBeNull();
  });

  it('is not a dialog, so the keyboard shortcuts stay on', () => {
    render(
      <Page feature="offset">
        <button data-guide="timeline-offset">Offset</button>
      </Page>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[aria-modal]')).toBeNull();
    expect(isModalActive()).toBe(false);
  });

  it('ends on "Got it" with focus on the control', async () => {
    const onEnd = vi.fn();
    render(
      <Page feature="offset" onEnd={onEnd}>
        <button data-guide="timeline-offset">Offset</button>
      </Page>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(onEnd).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Offset' })).toHaveFocus();
  });

  it('ends on Escape with focus on the control inside the pointed-at area', () => {
    const onEnd = vi.fn();
    render(
      <Page feature="change-key" onEnd={onEnd}>
        <div data-guide="key">
          <span>Key</span>
          <button>Lower the key</button>
        </div>
      </Page>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onEnd).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Lower the key' })).toHaveFocus();
  });

  it('lets a press on the control through, and goes away', async () => {
    const onEnd = vi.fn();
    const onOffset = vi.fn();
    render(
      <Page feature="offset" onEnd={onEnd}>
        <button data-guide="timeline-offset" onClick={onOffset}>
          Offset
        </button>
      </Page>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Offset' }));
    expect(onOffset).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalled();
  });

  it('goes away on a press beside the control', () => {
    const onEnd = vi.fn();
    render(
      <Page feature="offset" onEnd={onEnd}>
        <button data-guide="timeline-offset">Offset</button>
      </Page>
    );
    fireEvent.pointerDown(document.querySelector('[data-guide-dim]')!);
    expect(onEnd).toHaveBeenCalled();
  });

  it('goes away when focus moves on into the page', async () => {
    const onEnd = vi.fn();
    render(
      <Page feature="offset" onEnd={onEnd}>
        <button data-guide="timeline-offset">Offset</button>
        <button>Something else</button>
      </Page>
    );
    screen.getByRole('button', { name: 'Something else' }).focus();
    expect(onEnd).toHaveBeenCalled();
  });

  it('presses the button that uncovers a collapsed control first', () => {
    const Dock = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button data-guide="transport-more" aria-expanded={open} onClick={() => setOpen(!open)}>
            More
          </button>
          {open && <div data-guide="speed">Speed</div>}
        </>
      );
    };
    render(
      <Page feature="speed">
        <Dock />
      </Page>
    );
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: featureById('speed')!.title })).toBeInTheDocument();
  });

  it('still finds the uncovered control when React runs its effects twice', () => {
    const Dock = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button data-guide="transport-more" aria-expanded={open} onClick={() => setOpen(!open)}>
            More
          </button>
          {open && <div data-guide="speed">Speed</div>}
        </>
      );
    };
    render(
      <React.StrictMode>
        <Page feature="speed">
          <Dock />
        </Page>
      </React.StrictMode>
    );
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: featureById('speed')!.title })).toBeInTheDocument();
  });

  it('says once why a control is missing, even when React runs its effects twice', async () => {
    render(
      <React.StrictMode>
        <Page feature="needs-review">
          <button>Anything</button>
        </Page>
      </React.StrictMode>
    );
    expect(await screen.findAllByText(featureById('needs-review')!.missing!)).toHaveLength(1);
  });

  it('says why when the control is not on this screen, and points at nothing', async () => {
    const onEnd = vi.fn();
    render(
      <Page feature="needs-review" onEnd={onEnd}>
        <button data-guide="timeline-offset">Offset</button>
      </Page>
    );
    expect(await screen.findByText(featureById('needs-review')!.missing!)).toBeInTheDocument();
    expect(onEnd).toHaveBeenCalled();
    expect(screen.queryByTestId('guide-pointer')).toBeNull();
  });

  it('ends quietly for a feature that does not exist', () => {
    const onEnd = vi.fn();
    render(
      <Page feature="no-such-feature" onEnd={onEnd}>
        <button>Anything</button>
      </Page>
    );
    expect(onEnd).toHaveBeenCalled();
    expect(screen.queryByTestId('guide-pointer')).toBeNull();
  });
});

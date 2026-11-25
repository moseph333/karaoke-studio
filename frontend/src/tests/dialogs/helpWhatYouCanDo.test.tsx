/**
 * Help's "What you can do" tab: the features that are easy to miss, each with a "Show me"
 * button on the screen it belongs to, and from the studio the whole way to the pointer.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { HelpModal } from '../../components/HelpModal';
import { loadDeferredScreens } from '../../deferredScreens';
import { isModalActive } from '../../hooks/useKeyboardShortcuts';
import { FEATURES, featureById, featureGroups } from '../../utils/features';
import { GUIDE_SONG, mockGuideFetch } from '../helpers/guideFixtures';
import {
  assertZeroHorizontalOverflow,
  expectTouchTarget,
  resetTestViewport,
  setTestViewport,
} from '../helpers/responsiveTestUtils';

const panel = () => screen.getByRole('tabpanel', { name: 'What you can do' });
const showButtons = () => within(panel()).queryAllByRole('button', { name: /^Show me: / });
const on = (screenName: 'studio' | 'home') => FEATURES.filter((f) => f.screen === screenName);

beforeAll(() => loadDeferredScreens());

beforeEach(() => {
  localStorage.clear();
  mockGuideFetch();
});

afterEach(() => {
  cleanup();
  resetTestViewport();
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/');
});

describe('the What you can do tab', () => {
  it('is the second help topic', () => {
    render(<HelpModal isOpen onClose={vi.fn()} initialTab="features" />);
    const tab = screen.getByRole('tab', { name: 'What you can do' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('aria-controls', 'tabpanel-features');
    expect(screen.getAllByRole('tab')[1]).toBe(tab);
  });

  it('lists every feature under its group, with what it is for', () => {
    render(<HelpModal isOpen onClose={vi.fn()} initialTab="features" />);

    for (const { group, features } of featureGroups()) {
      expect(within(panel()).getByRole('heading', { name: group })).toBeInTheDocument();
      const rows = within(within(panel()).getByRole('list', { name: group })).getAllByRole(
        'listitem'
      );
      expect(rows.map((row) => row.getAttribute('data-feature'))).toEqual(
        features.map((feature) => feature.id)
      );
      for (const [i, row] of rows.entries()) {
        expect(row).toHaveTextContent(features[i].title);
        expect(row).toHaveTextContent(features[i].text);
      }
    }
  });

  it('has no buttons while no screen the guide can point at is up', () => {
    render(<HelpModal isOpen onClose={vi.fn()} initialTab="features" onShowFeature={vi.fn()} />);
    expect(within(panel()).queryAllByRole('button')).toHaveLength(0);
    expect(panel()).toHaveTextContent(/Open a finished song and each one gets a button/);
  });

  it('gives the studio’s features a button in the studio, each with a name of its own', async () => {
    const onShowFeature = vi.fn();
    render(
      <HelpModal
        isOpen
        onClose={vi.fn()}
        initialTab="features"
        guideScreen="studio"
        onShowFeature={onShowFeature}
      />
    );

    // No studio is behind this dialog, so the controls that are not always there are absent
    const always = on('studio').filter((feature) => !feature.optional);
    const names = showButtons().map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(always.map((feature) => `Show me: ${feature.title}`));
    expect(new Set(names).size).toBe(names.length);
    for (const button of showButtons()) expectTouchTarget(button);

    await userEvent.click(screen.getByRole('button', { name: 'Show me: Find your key' }));
    expect(onShowFeature).toHaveBeenCalledWith('find-key');
    expect(panel()).toHaveTextContent('Go back to the home screen to be shown where this is.');
  });

  it('says why a control this song or server does not have cannot be shown', () => {
    render(
      <HelpModal
        isOpen
        onClose={vi.fn()}
        initialTab="features"
        guideScreen="studio"
        onShowFeature={vi.fn()}
      />
    );
    for (const feature of on('studio').filter((f) => f.optional)) {
      const row = panel().querySelector(`[data-feature="${feature.id}"]`) as HTMLElement;
      expect(row).toHaveTextContent(feature.missing!);
      expect(within(row).queryByRole('button')).toBeNull();
    }
  });

  it('gives a control that is there its button, optional or not', () => {
    // The studio is on the page before Help opens over it
    const page = (helpOpen: boolean) => (
      <>
        <section data-guide="song-loop">Song loop</section>
        <HelpModal
          isOpen={helpOpen}
          onClose={vi.fn()}
          initialTab="features"
          guideScreen="studio"
          onShowFeature={vi.fn()}
        />
      </>
    );
    const { rerender } = render(page(false));
    rerender(page(true));

    const loop = featureById('song-loop')!;
    expect(screen.getByRole('button', { name: `Show me: ${loop.title}` })).toBeInTheDocument();
    expect(panel()).not.toHaveTextContent(loop.missing!);
  });

  it('gives the home screen’s features a button on the home screen', () => {
    render(
      <HelpModal
        isOpen
        onClose={vi.fn()}
        initialTab="features"
        guideScreen="home"
        onShowFeature={vi.fn()}
      />
    );
    expect(showButtons().map((button) => button.getAttribute('aria-label'))).toEqual(
      on('home').map((feature) => `Show me: ${feature.title}`)
    );
    expect(panel()).toHaveTextContent('Open a finished song to be shown where this is.');
  });

  it('starts the tour when there is one to start', async () => {
    const onStartTour = vi.fn();
    const { rerender } = render(<HelpModal isOpen onClose={vi.fn()} initialTab="features" />);
    expect(screen.queryByRole('button', { name: 'Start the tour' })).toBeNull();

    rerender(
      <HelpModal
        isOpen
        onClose={vi.fn()}
        initialTab="features"
        guideScreen="studio"
        onStartTour={onStartTour}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Start the tour' }));
    expect(onStartTour).toHaveBeenCalledTimes(1);
  });

  it('fits a phone', () => {
    setTestViewport(375, 667);
    const { container } = render(
      <HelpModal
        isOpen
        onClose={vi.fn()}
        initialTab="features"
        guideScreen="studio"
        onShowFeature={vi.fn()}
        onStartTour={vi.fn()}
      />
    );
    assertZeroHorizontalOverflow(container, 375);
  });
});

describe('Show me, from Help in the studio', () => {
  const openHelpTab = async (user: ReturnType<typeof userEvent.setup>) => {
    window.history.pushState({}, '', `/?project=${GUIDE_SONG.id}`);
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: GUIDE_SONG.title });
    fireEvent.keyDown(window, { key: '?' });
    await user.click(await screen.findByRole('tab', { name: 'What you can do' }));
  };

  it('closes Help, opens the control’s tab and points at the control', async () => {
    setTestViewport(375, 812);
    const user = userEvent.setup();
    await openHelpTab(user);
    const offset = featureById('offset')!;

    await user.click(screen.getByRole('button', { name: `Show me: ${offset.title}` }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const note = await screen.findByRole('group', { name: offset.title });
    expect(note).toHaveTextContent(offset.how);
    expect(screen.getByRole('tab', { name: /Timeline/ })).toHaveAttribute('aria-selected', 'true');
    expect(isModalActive()).toBe(false);

    await user.click(within(note).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByTestId('guide-pointer')).toBeNull();
    expect(screen.getByTestId('batch-offset-btn')).toHaveFocus();
  });

  it('says why a control this song does not have cannot be shown', async () => {
    const user = userEvent.setup();
    await openHelpTab(user);
    // The song has nothing to review, so the filter is not on the timeline
    const review = featureById('needs-review')!;
    const row = panel().querySelector(`[data-feature="${review.id}"]`) as HTMLElement;
    expect(row).toHaveTextContent(review.missing!);
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('starts the tour from Help, which steps aside for it', async () => {
    const user = userEvent.setup();
    await openHelpTab(user);
    await user.click(screen.getByRole('button', { name: 'Start the tour' }));

    const tour = await screen.findByRole('dialog');
    expect(tour).toHaveAccessibleName('Your song');
    expect(screen.queryByRole('tab', { name: 'What you can do' })).toBeNull();
  });
});

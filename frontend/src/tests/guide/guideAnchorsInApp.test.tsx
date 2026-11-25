/**
 * Every place the guide points at exists in the app: each tour stop and each feature of
 * "What you can do" names a control the studio or the home screen really renders, on the
 * phone tab it says. A renamed or removed control fails here, not in front of a new user.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../../App';
import { loadDeferredScreens } from '../../deferredScreens';
import { FEATURES } from '../../utils/features';
import { GUIDE_STOPS, type GuideScreen, type GuideTarget } from '../../utils/guideStops';
import { anchorOnPage, findTarget } from '../../utils/guideAnchors';
import { GUIDE_SONG, mockGuideFetch } from '../helpers/guideFixtures';
import { resetTestViewport, setTestViewport } from '../helpers/responsiveTestUtils';

const PANELS = {
  stage: '#workspace-panel-stage',
  timeline: '#workspace-panel-timeline',
  mix: '#workspace-panel-mix-audio, #workspace-panel-mix-theme',
} as const;

const targets = (screenName: GuideScreen): (GuideTarget & { id: string })[] =>
  [...GUIDE_STOPS, ...FEATURES].filter((target) => target.screen === screenName);

beforeAll(() => loadDeferredScreens());

describe('the controls the guide points at', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGuideFetch();
  });

  afterEach(() => {
    resetTestViewport();
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  for (const [label, width, height] of [
    ['phone', 375, 812],
    ['desktop', 1280, 800],
  ] as const) {
    it(`are all in the studio at ${label} width`, async () => {
      setTestViewport(width, height);
      window.history.pushState({}, '', `/?project=${GUIDE_SONG.id}`);
      render(<App />);
      await screen.findByRole('heading', { level: 1, name: GUIDE_SONG.title });

      for (const target of targets('studio')) {
        if (target.optional) continue;
        expect(anchorOnPage(target.anchors), `${target.id}: ${target.anchors}`).toBe(true);
        if (target.tab) {
          const control = findTarget(target.anchors);
          expect(
            control?.closest(PANELS[target.tab]),
            `${target.id} is on ${target.tab}`
          ).not.toBeNull();
        }
      }
    });

    it(`are all on the home screen at ${label} width`, async () => {
      setTestViewport(width, height);
      render(<App />);
      await screen.findByRole('heading', { level: 1 });

      for (const target of targets('home')) {
        if (target.optional) continue;
        expect(anchorOnPage(target.anchors), `${target.id}: ${target.anchors}`).toBe(true);
      }
    });
  }

  it('names the button that uncovers a collapsed control', async () => {
    window.history.pushState({}, '', `/?project=${GUIDE_SONG.id}`);
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: GUIDE_SONG.title });

    for (const target of targets('studio')) {
      if (!target.open) continue;
      const opener = findTarget([target.open]);
      expect(opener, `${target.id} opens with ${target.open}`).not.toBeNull();
      expect(opener).toHaveAttribute('aria-expanded');
    }
  });
});

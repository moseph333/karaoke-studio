/**
 * Guide commands: the tour and "What you can do" in the command palette. "Show me around"
 * starts the tour of the screen that is up, and typing a feature's name ("slow", "merge",
 * "key") lists "Show me: …" entries that point at its control. The feature list is fetched
 * when the palette first searches it, so its words stay out of the first-load script.
 */

import React from 'react';
import { Compass, ListPlus, MousePointerClick } from 'lucide-react';
import {
  useRegisterCommandSource,
  useRegisterCommands,
  type PaletteCommand,
} from '../components/commandPalette/context';
import { rankItems } from '../components/commandPalette/fuzzy';
import { anchorOnPage } from '../utils/guideAnchors';
import type { GuideScreen } from '../utils/guideStops';

export interface GuideCommandOptions {
  /** The screen that is up, when the guide can point at its controls. */
  screen: GuideScreen | null;
  /** Starts the tour of that screen; left out where there is none. */
  onStartTour?: () => void;
  /** Points at one feature's control. */
  onShowFeature: (featureId: string) => void;
  /** Opens Help on "What you can do". */
  onOpenFeatures: () => void;
}

const FEATURE_RESULTS = 6;

const TOUR_SUBTITLES: Record<GuideScreen, string> = {
  studio: 'A tour of the studio, one part at a time',
  home: 'A tour of the home screen',
};

export function useGuideCommands(opts: GuideCommandOptions): void {
  const { screen } = opts;
  const commands: PaletteCommand[] = [
    {
      id: 'help-features',
      title: 'What you can do',
      subtitle: 'The features that are easy to miss, and where each one is',
      group: 'Help',
      icon: <ListPlus />,
      keywords: ['features', 'find', 'where', 'how to', 'discover', 'tips'],
      run: opts.onOpenFeatures,
    },
  ];
  if (screen && opts.onStartTour) {
    commands.unshift({
      id: 'guide-tour',
      title: 'Show me around',
      subtitle: TOUR_SUBTITLES[screen],
      group: 'Help',
      icon: <Compass />,
      keywords: ['tour', 'guide', 'walkthrough', 'tutorial', 'where', 'new', 'intro', 'how to'],
      run: opts.onStartTour,
    });
  }
  useRegisterCommands('guide', commands);

  useRegisterCommandSource(
    screen
      ? {
          id: 'features',
          group: 'Show me',
          minQueryLength: 2,
          load: async (query) => {
            const { FEATURES } = await import('../utils/features');
            return rankItems(
              query,
              FEATURES.filter(
                (feature) =>
                  feature.screen === screen &&
                  // A control this song or server does not have cannot be pointed at
                  (!feature.optional || anchorOnPage(feature.anchors))
              ).map((feature) => ({
                id: `feature:${feature.id}`,
                title: `Show me: ${feature.title}`,
                subtitle: feature.text,
                group: 'Show me',
                keywords: [feature.group],
                transient: true,
                icon: <MousePointerClick />,
                run: () => opts.onShowFeature(feature.id),
              })),
              FEATURE_RESULTS
            );
          },
        }
      : null
  );
}

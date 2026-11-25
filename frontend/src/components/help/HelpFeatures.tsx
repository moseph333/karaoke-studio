/**
 * Help: What you can do
 *
 * The features a new user is unlikely to find (`utils/features`), grouped by what they are
 * for. On the screen a feature belongs to, "Show me" closes Help and points at its control
 * (`components/guide`); a control this song or this server does not have says why instead.
 */

import React from 'react';
import { featureGroups, type Feature } from '../../utils/features';
import { anchorOnPage } from '../../utils/guideAnchors';
import type { GuideScreen } from '../../utils/guideStops';
import { Button } from '../ui/Button';

export interface HelpFeaturesProps {
  /** The screen behind Help, when it is one the guide can point at. */
  screen?: GuideScreen | null;
  /** Points at a feature's control; the caller closes this dialog first. */
  onShow?: (featureId: string) => void;
  /** Starts the tour of the screen behind Help. */
  onStartTour?: () => void;
}

/** Said over a group whose controls are on the other screen. */
const ELSEWHERE: Record<GuideScreen, string> = {
  studio: 'Open a finished song to be shown where this is.',
  home: 'Go back to the home screen to be shown where this is.',
};

const FeatureRow: React.FC<{
  feature: Feature;
  here: boolean;
  onShow?: (featureId: string) => void;
}> = ({ feature, here, onShow }) => {
  // A control that is not always there (this server cannot make it, this song has none)
  const absent = here && Boolean(feature.optional) && !anchorOnPage(feature.anchors);
  return (
    <li data-feature={feature.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-base font-semibold text-theme-text">{feature.title}</p>
        <p className="text-pretty text-sm text-theme-text-muted">{feature.text}</p>
        {absent && <p className="text-sm text-theme-text-muted">{feature.missing}</p>}
      </div>
      {here && onShow && !absent && (
        <Button
          size="sm"
          aria-label={`Show me: ${feature.title}`}
          onClick={() => onShow(feature.id)}
        >
          Show me
        </Button>
      )}
    </li>
  );
};

export const HelpFeatures: React.FC<HelpFeaturesProps> = ({
  screen = null,
  onShow,
  onStartTour,
}) => (
  <div className="space-y-5">
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-theme-text-muted">
        Things the studio does that are easy to miss.{' '}
        {screen
          ? 'Show me closes this and points at the control.'
          : 'Open a finished song and each one gets a button that points at its control.'}
      </p>
      {onStartTour && (
        <Button size="sm" onClick={onStartTour}>
          Start the tour
        </Button>
      )}
    </div>

    {featureGroups().map(({ group, features }) => {
      const groupScreen = features[0].screen;
      const headingId = `help-features-${features[0].id}`;
      return (
        <section key={group} aria-labelledby={headingId}>
          <h3
            id={headingId}
            className="ks-display border-b-2 border-theme-border pb-1 text-[24px] text-theme-text"
          >
            {group}
          </h3>
          {screen && screen !== groupScreen && (
            <p className="pt-2 text-sm text-theme-text-muted">{ELSEWHERE[groupScreen]}</p>
          )}
          <ul aria-label={group} className="divide-y divide-theme-border-subtle">
            {features.map((feature) => (
              <FeatureRow
                key={feature.id}
                feature={feature}
                here={screen === feature.screen}
                onShow={onShow}
              />
            ))}
          </ul>
        </section>
      );
    })}
  </div>
);

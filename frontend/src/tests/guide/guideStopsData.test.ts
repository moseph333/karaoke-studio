/**
 * The guide's words: every tour stop and every feature is something the pointer can find and
 * a reader can tell apart.
 */
import { describe, it, expect } from 'vitest';
import { FEATURES, featureById, featureGroups } from '../../utils/features';
import { GUIDE_STOPS, TOURS, tourStops } from '../../utils/guideStops';

describe('guide stops', () => {
  it('have ids of their own', () => {
    const ids = GUIDE_STOPS.map((stop) => stop.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('are each on a tour, and every tour entry is a stop', () => {
    const toured = new Set([...TOURS.studio, ...TOURS.home]);
    expect([...toured].sort()).toEqual(GUIDE_STOPS.map((stop) => stop.id).sort());
    expect(tourStops('studio').map((stop) => stop.id)).toEqual(TOURS.studio);
    expect(tourStops('home').map((stop) => stop.id)).toEqual(TOURS.home);
  });

  it('belong to the screen their tour is on', () => {
    for (const stop of tourStops('studio')) expect(stop.screen, stop.id).toBe('studio');
    for (const stop of tourStops('home')) expect(stop.screen, stop.id).toBe('home');
  });

  it('name something to point at and say what it is', () => {
    for (const stop of GUIDE_STOPS) {
      expect(stop.anchors.length, stop.id).toBeGreaterThan(0);
      expect(stop.title.length, stop.id).toBeGreaterThan(2);
      expect(stop.body.length, stop.id).toBeGreaterThan(20);
    }
  });

  it('name each icon of a legend once', () => {
    for (const stop of GUIDE_STOPS) {
      const names = (stop.legend ?? []).map((row) => row.name);
      expect(new Set(names).size, stop.id).toBe(names.length);
    }
  });

  it('only use phone tabs in the studio', () => {
    for (const stop of GUIDE_STOPS) {
      if (stop.screen === 'home') expect(stop.tab, stop.id).toBeUndefined();
    }
  });
});

describe('what you can do', () => {
  it('lists features with ids and titles of their own', () => {
    const ids = FEATURES.map((feature) => feature.id);
    const titles = FEATURES.map((feature) => feature.title);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(titles).size).toBe(titles.length);
    for (const feature of FEATURES) expect(featureById(feature.id)).toBe(feature);
  });

  it('says what each is for and what to do with its control', () => {
    for (const feature of FEATURES) {
      expect(feature.anchors.length, feature.id).toBeGreaterThan(0);
      expect(feature.text.length, feature.id).toBeGreaterThan(15);
      expect(feature.how.length, feature.id).toBeGreaterThan(15);
    }
  });

  it('says why a control that is not always there is missing', () => {
    for (const feature of FEATURES) {
      if (feature.optional) expect(feature.missing, feature.id).toBeTruthy();
    }
  });

  it('keeps each group together and on one screen', () => {
    const groups = featureGroups();
    expect(groups.flatMap((g) => g.features)).toHaveLength(FEATURES.length);
    expect(new Set(groups.map((g) => g.group)).size).toBe(groups.length);
    for (const { group, features } of groups) {
      expect(new Set(features.map((f) => f.screen)).size, group).toBe(1);
    }
    expect(groups[0].features[0].screen).toBe('home');
  });
});

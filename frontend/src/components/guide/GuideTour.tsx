/**
 * Guide Tour
 *
 * Walks the guide's stops: for each one it selects the phone tab the control is on, uncovers
 * a collapsed control, scrolls the control clear of the header and the dock, and measures it
 * for `GuidePointer` to ring. A stop whose control is not on this screen is passed over. The
 * same steps point at one control for Help's "Show me" (`{ feature }`), as a single stop that
 * leaves the control pressable.
 *
 * Shown only when asked for (the first-song card, Help, the command palette). A tour is a
 * dialog, so the keyboard shortcuts rest while it is up; it pauses the song first, since
 * Space could not, and a playing song scrolls the timeline under the pointer.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { StudioWorkspaceTab } from '../../types';
import { useToast } from '../../hooks/useToast';
import { featureById } from '../../utils/features';
import { findAnchor, findTarget, hasLayout, visibleBox } from '../../utils/guideAnchors';
import {
  holeFor,
  intersect,
  scrollIntoBand,
  type Box,
  type Size,
} from '../../utils/guidePlacement';
import { tourStops, type GuideRequest, type GuideTarget } from '../../utils/guideStops';
import { focusQuietly } from '../../utils/focusIntent';
import { FOCUSABLE_SELECTOR } from '../../hooks/useFocusTrap';
import { useCommandPalette } from '../commandPalette/context';
import { GuidePointer, type GuideCard } from './GuidePointer';

export interface GuideTourProps {
  request: GuideRequest;
  /** The studio's phone tab, which a stop on another tab changes. */
  activeTab: StudioWorkspaceTab;
  onSelectTab: (tab: StudioWorkspaceTab) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onEnd: () => void;
}

interface Stop extends GuideCard {
  target: GuideTarget;
}

const NOT_HERE = 'That is not on this screen right now.';

/** The stops a request asks for. A tour leaves out the optional ones this screen lacks. */
function stopsFor(request: GuideRequest): Stop[] {
  if ('feature' in request) {
    const feature = featureById(request.feature);
    return feature ? [{ target: feature, title: feature.title, body: feature.how }] : [];
  }
  return tourStops(request.tour)
    .filter((stop) => !stop.optional || findTarget(stop.anchors) !== null)
    .map((stop) => ({ target: stop, title: stop.title, body: stop.body, legend: stop.legend }));
}

const viewSize = (): Size => ({ width: window.innerWidth, height: window.innerHeight });

/** Whether a bar is held over the page right now: fixed, or sticky and at its resting place.
 *  (On a phone the header and the tab bar scroll away with the page.) */
function isHeld(bar: HTMLElement): boolean {
  const style = window.getComputedStyle(bar);
  if (style.position === 'fixed') return true;
  if (style.position !== 'sticky') return false;
  return Math.abs(bar.getBoundingClientRect().top - (parseFloat(style.top) || 0)) < 1.5;
}

/** The bars that can cover the page: the header, the phone's tab bar and the phone's dock. */
function bars(): HTMLElement[] {
  const found = [
    document.querySelector<HTMLElement>('header'),
    findAnchor('workspace-tabs'),
    findAnchor('transport'),
  ];
  return found.filter((bar): bar is HTMLElement => bar !== null);
}

/** Whether the control is part of a bar, which is never scrolled to or clipped. */
function isInBar(element: HTMLElement): boolean {
  return bars().some((bar) => bar.contains(element));
}

/** The band of the screen the bars leave clear right now, where a control can be seen. */
function clearBand(): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (const bar of bars()) {
    if (!isHeld(bar)) continue;
    const rect = bar.getBoundingClientRect();
    // A bar in the upper half covers the top of the page, one in the lower half the bottom
    if (rect.top + rect.height / 2 < window.innerHeight / 2) top = Math.max(top, rect.bottom);
    else bottom = Math.min(bottom, rect.top);
  }
  return { top, bottom };
}

function bringIntoView(element: HTMLElement) {
  if (!hasLayout()) return;
  const tall = element.getBoundingClientRect().height > window.innerHeight * 0.6;
  // 'instant': the timeline list scrolls smoothly by itself, and the ring is measured now
  element.scrollIntoView({
    block: tall ? 'start' : 'nearest',
    inline: 'nearest',
    behavior: 'instant',
  });
  if (isInBar(element)) return;
  // Twice: the first scroll can bring a sticky bar to rest over the control
  for (let pass = 0; pass < 2; pass += 1) {
    const rect = element.getBoundingClientRect();
    const delta = scrollIntoBand(
      { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      clearBand()
    );
    if (Math.abs(delta) < 1) return;
    window.scrollBy({ top: delta, behavior: 'instant' });
  }
}

function measure(element: HTMLElement): Box | null {
  const view = viewSize();
  let visible = visibleBox(element);
  if (visible && !isInBar(element)) {
    visible = intersect(visible, { left: 0, right: view.width, ...clearBand() });
  }
  return holeFor(visible, view);
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom);

export const GuideTour: React.FC<GuideTourProps> = ({
  request,
  activeTab,
  onSelectTab,
  isPlaying,
  onTogglePlay,
  onEnd,
}) => {
  const palette = useCommandPalette();
  const { toast } = useToast();
  const isTour = 'tour' in request;
  const [stops] = useState(() => stopsFor(request));
  const [index, setIndex] = useState(0);
  // The stop on show and its control; the index runs ahead of it while a stop is prepared
  const [shown, setShown] = useState<{ index: number; anchor: HTMLElement } | null>(null);
  const [hole, setHole] = useState<Box | null>(null);
  const [view, setView] = useState<Size>(viewSize);
  const [attempt, setAttempt] = useState(0);
  const direction = useRef<1 | -1>(1);
  const openedFor = useRef(-1);
  // Guards for steps that must happen once though an effect may run twice (React's strict
  // mode runs every effect twice in development)
  const openedAt = useRef(-1);
  const started = useRef(false);
  const ended = useRef(false);
  const hadHole = useRef(false);
  const latest = useRef({ onEnd, onSelectTab, onTogglePlay, isPlaying, palette, toast });
  latest.current = { onEnd, onSelectTab, onTogglePlay, isPlaying, palette, toast };

  // A tour stops the song and comes out of the fullscreen stage, which would cover it
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const now = latest.current;
    if (isTour && now.isPlaying) now.onTogglePlay();
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    } else if (document.querySelector('[data-guide="stage"][data-fullscreen="true"]')) {
      now.palette?.runCommand('stage-fullscreen');
    }
  }, [isTour]);

  // Prepare the stop: its tab, its collapsed control, then the control itself
  useLayoutEffect(() => {
    const now = latest.current;
    const stop = stops[index];
    if (!stop) {
      now.onEnd();
      return;
    }
    const { target } = stop;
    if (target.tab && target.tab !== activeTab) {
      // The panel is hidden until its tab is selected; this runs again once it is
      now.onSelectTab(target.tab);
      return;
    }
    // The opener was pressed on this pass: the control is there once that has rendered
    if (openedAt.current === attempt) return;
    if (target.open && openedFor.current !== index) {
      const opener = findAnchor(target.open);
      if (opener?.getAttribute('aria-expanded') === 'false') {
        openedFor.current = index;
        openedAt.current = attempt;
        opener.click();
        setAttempt((n) => n + 1);
        return;
      }
    }
    const anchor = findTarget(target.anchors);
    if (!anchor) {
      if (!isTour) {
        if (!ended.current) now.toast.info(target.missing ?? NOT_HERE);
        ended.current = true;
        now.onEnd();
        return;
      }
      // Pass over a stop this screen does not have, the way the tour was heading
      const next = index + direction.current;
      if (next < 0) {
        direction.current = 1;
        setIndex(shown?.index ?? index + 1);
      } else {
        setIndex(next);
      }
      return;
    }
    bringIntoView(anchor);
    hadHole.current = false;
    setShown({ index, anchor });
    // `shown` is this effect's own result, read only to step back to
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, index, activeTab, attempt, isTour]);

  // Keep the ring on the control as the page resizes or scrolls
  const anchor = shown?.anchor ?? null;
  useLayoutEffect(() => {
    if (!anchor) return;
    const update = () => {
      const next = measure(anchor);
      if (next) hadHole.current = true;
      else if (!isTour && hadHole.current) {
        // A single pointed-at control that has been scrolled away is done with
        latest.current.onEnd();
        return;
      }
      setHole((previous) => (sameBox(previous, next) ? previous : next));
      setView((previous) => {
        const size = viewSize();
        return previous.width === size.width && previous.height === size.height ? previous : size;
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(anchor);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      observer?.disconnect();
    };
  }, [anchor, isTour]);

  // A tour holds the page still; only the callout itself scrolls
  useEffect(() => {
    if (!isTour) return;
    const hold = (event: Event) => {
      const inCallout =
        event.target instanceof Element && event.target.closest('[data-guide-callout]');
      if (!inCallout) event.preventDefault();
    };
    window.addEventListener('wheel', hold, { passive: false });
    window.addEventListener('touchmove', hold, { passive: false });
    return () => {
      window.removeEventListener('wheel', hold);
      window.removeEventListener('touchmove', hold);
    };
  }, [isTour]);

  // A press on the pointed-at control goes through to it and ends the pointing
  useEffect(() => {
    if (isTour || !anchor) return;
    const onPress = (event: Event) => {
      if (event.target instanceof Node && anchor.contains(event.target)) latest.current.onEnd();
    };
    document.addEventListener('pointerdown', onPress, true);
    return () => document.removeEventListener('pointerdown', onPress, true);
  }, [anchor, isTour]);

  const step = useCallback(
    (by: 1 | -1) => {
      if (!shown) return;
      const next = shown.index + by;
      if (next < 0) return;
      direction.current = by;
      setIndex(next);
    },
    [shown]
  );
  const tour = useMemo(
    () =>
      isTour && shown
        ? {
            index: shown.index,
            total: stops.length,
            onBack: () => step(-1),
            onNext: () => step(1),
          }
        : undefined,
    [isTour, shown, stops.length, step]
  );

  const end = useCallback(
    (focusControl?: boolean) => {
      latest.current.onEnd();
      if (!focusControl || !anchor) return;
      const control = anchor.matches(FOCUSABLE_SELECTOR)
        ? anchor
        : anchor.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      focusQuietly(control);
    },
    [anchor]
  );

  if (!shown) return null;
  return <GuidePointer card={stops[shown.index]} hole={hole} view={view} tour={tour} onEnd={end} />;
};

export default GuideTour;

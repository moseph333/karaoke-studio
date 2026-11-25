/**
 * Guide Pointer
 *
 * What a guide stop looks like: the screen dimmed around one control, a ring on the control
 * and a callout that names it and says what it does. Flat like the rest of the app: four
 * plain rectangles make the dim, the ring is a 2px rule, and the callout is a bordered block
 * beside the control (a band across the top or bottom edge on a phone).
 *
 * Two kinds. A tour stop is a dialog: focus stays in the callout and the control cannot be
 * pressed. A single pointed-at control ("Show me") is not: the control can be pressed
 * through the hole, which is the point of showing it. `GuideTour` decides which and where.
 */

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {
  Activity,
  ChevronRight,
  Clock,
  FileText,
  Highlighter,
  Maximize,
  MoreHorizontal,
  Music2,
  Radio,
  Rewind,
  Undo2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { cn } from '../../utils/cn';
import { focusQuietly } from '../../utils/focusIntent';
import {
  DOCKED_BELOW,
  dimRects,
  dockEdge,
  placeCallout,
  type Box,
  type Size,
} from '../../utils/guidePlacement';
import type { LegendIcon, LegendRow } from '../../utils/guideStops';
import { Button } from '../ui/Button';
import { focusRing } from '../ui/variants';

const LEGEND_ICONS: Record<LegendIcon, LucideIcon> = {
  highlight: Highlighter,
  visualizer: Activity,
  chords: Music2,
  fullscreen: Maximize,
  undo: Undo2,
  offset: Clock,
  duet: Users,
  tap: Radio,
  lyrics: FileText,
  nudge: Rewind,
  more: MoreHorizontal,
  words: ChevronRight,
};

export interface GuideCard {
  title: string;
  body: string;
  legend?: LegendRow[];
}

export interface GuidePointerProps {
  card: GuideCard;
  /** The hole in the dim, in viewport pixels; null when there is nothing in view to ring. */
  hole: Box | null;
  view: Size;
  /** A tour's place ("3 of 11") and its steps; left out for a single control. */
  tour?: { index: number; total: number; onBack: () => void; onNext: () => void };
  /** Ends the guide. `focusControl` asks for focus to land on the pointed-at control. */
  onEnd: (focusControl?: boolean) => void;
}

const boxStyle = (box: Box): React.CSSProperties => ({
  left: box.left,
  top: box.top,
  width: box.right - box.left,
  height: box.bottom - box.top,
});

const textButton = cn(
  'inline-flex min-h-[44px] items-center px-1 text-sm font-semibold text-theme-text-muted underline underline-offset-4 hover:text-theme-text md:min-h-[32px]',
  focusRing
);

const Legend: React.FC<{ rows: LegendRow[] }> = ({ rows }) => (
  <ul className="divide-y divide-theme-border-subtle border-y border-theme-border-subtle">
    {rows.map(({ icon, name, text }) => {
      const Icon = LEGEND_ICONS[icon];
      return (
        <li key={name} className="flex items-start gap-2.5 py-1.5 text-sm">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-theme-text" aria-hidden="true" />
          <span className="min-w-0 text-theme-text-muted">
            <span className="font-semibold text-theme-text">{name}</span>: {text}
          </span>
        </li>
      );
    })}
  </ul>
);

interface CalloutProps extends Pick<GuidePointerProps, 'card' | 'tour' | 'onEnd'> {
  className: string;
  style?: React.CSSProperties;
  onSize: (size: Size) => void;
  /** Changes when the callout's size may have. */
  sizeKey: string;
}

/** What both kinds of callout say. */
const CalloutText: React.FC<{
  card: GuideCard;
  titleId: string;
  bodyId: string;
  count?: string;
}> = ({ card, titleId, bodyId, count }) => (
  <div aria-live="polite" aria-atomic="true" className="space-y-1.5">
    {count && <p className="text-sm tabular-nums text-theme-text-muted">{count}</p>}
    <h2 id={titleId} className="ks-display text-[28px] text-theme-text">
      {card.title}
    </h2>
    <p id={bodyId} className="text-pretty text-sm leading-relaxed text-theme-text">
      {card.body}
    </p>
  </div>
);

function useReportedSize(
  ref: React.RefObject<HTMLElement>,
  onSize: (size: Size) => void,
  key: string
) {
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) onSize({ width: rect.width, height: rect.height });
  }, [ref, onSize, key]);
}

/** A tour stop: a dialog that keeps focus and steps on with Next, Back and the arrow keys. */
const TourCallout: React.FC<CalloutProps & { tour: NonNullable<GuidePointerProps['tour']> }> = ({
  card,
  tour,
  onEnd,
  className,
  style,
  onSize,
  sizeKey,
}) => {
  const titleId = useId();
  const bodyId = useId();
  const nextRef = useRef<HTMLButtonElement>(null);
  const ref = useFocusTrap<HTMLDivElement>({
    isOpen: true,
    onClose: onEnd,
    initialFocusRef: nextRef,
  });
  useReportedSize(ref, onSize, sizeKey);
  const isLast = tour.index === tour.total - 1;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'ArrowRight') tour.onNext();
      else if (event.key === 'ArrowLeft') tour.onBack();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tour]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-guide-callout="tour"
      className={className}
      style={style}
    >
      <CalloutText
        card={card}
        titleId={titleId}
        bodyId={bodyId}
        count={`${tour.index + 1} of ${tour.total}`}
      />
      {card.legend && <Legend rows={card.legend} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={tour.onBack} disabled={tour.index === 0}>
          Back
        </Button>
        <Button ref={nextRef} size="sm" variant="primary" onClick={tour.onNext}>
          {isLast ? 'Done' : 'Next'}
        </Button>
        {!isLast && (
          <button type="button" onClick={() => onEnd()} className={cn(textButton, 'ml-auto')}>
            Skip
          </button>
        )}
      </div>
    </div>
  );
};

/** One pointed-at control: a note beside it, which leaves the keyboard and the control alone. */
const PointCallout: React.FC<CalloutProps> = ({
  card,
  onEnd,
  className,
  style,
  onSize,
  sizeKey,
}) => {
  const titleId = useId();
  const bodyId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useReportedSize(ref, onSize, sizeKey);

  useEffect(() => {
    focusQuietly(ref.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onEnd(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onEnd]);

  return (
    <div
      ref={ref}
      role="group"
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-guide-callout="point"
      // Focus that moves on into the page has left the note behind
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) onEnd();
      }}
      className={cn(className, 'focus:outline-none')}
      style={style}
    >
      <CalloutText card={card} titleId={titleId} bodyId={bodyId} />
      {card.legend && <Legend rows={card.legend} />}
      <div>
        <Button size="sm" onClick={() => onEnd(true)}>
          Got it
        </Button>
      </div>
    </div>
  );
};

export const GuidePointer: React.FC<GuidePointerProps> = ({ card, hole, view, tour, onEnd }) => {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const docked = view.width < DOCKED_BELOW;
  const edge = dockEdge(hole, view);
  const place = docked ? null : placeCallout(hole, size, view);

  const calloutClass = cn(
    'pointer-events-auto fixed flex flex-col gap-3 bg-theme-bg p-4 motion-safe:animate-fade-in',
    docked
      ? cn(
          'inset-x-0 max-h-[70vh] overflow-y-auto border-theme-border',
          edge === 'top'
            ? 'top-0 border-b-2 pt-[calc(1rem+env(safe-area-inset-top,0px))]'
            : 'bottom-0 border-t-2 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]'
        )
      : 'w-[360px] max-w-[calc(100vw-16px)] border-2 border-theme-border'
  );
  const calloutStyle = place ? { left: place.left, top: place.top } : undefined;
  const sizeKey = `${card.title}|${view.width}|${view.height}`;

  // The rule that joins the ring to a callout above or below it
  const joinX = hole && place ? Math.max(hole.left, place.left) + 16 : 0;
  const join =
    hole && place && (place.side === 'below' || place.side === 'above') && size.height > 0
      ? {
          left: joinX,
          top: place.side === 'below' ? hole.bottom : place.top + size.height,
          width: 2,
          height:
            place.side === 'below' ? place.top - hole.bottom : hole.top - place.top - size.height,
        }
      : null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[55]" data-testid="guide-pointer">
      {dimRects(hole, view).map((rect, i) => (
        <div
          key={i}
          aria-hidden="true"
          data-guide-dim=""
          // A tour is left with Skip or Escape; a single pointer goes away with a press beside it
          onPointerDown={tour ? undefined : () => onEnd()}
          className="pointer-events-auto fixed bg-theme-overlay/70"
          style={boxStyle(rect)}
        />
      ))}
      {hole && tour && (
        // A tour only shows: the control under the ring cannot be pressed
        <div aria-hidden="true" className="pointer-events-auto fixed" style={boxStyle(hole)} />
      )}
      {hole && (
        <div
          aria-hidden="true"
          data-guide-ring=""
          className="fixed border-2 border-theme-border"
          style={boxStyle(hole)}
        />
      )}
      {join && join.height > 0 && (
        <div aria-hidden="true" className="fixed bg-theme-border" style={join} />
      )}
      {tour ? (
        <TourCallout
          card={card}
          tour={tour}
          onEnd={onEnd}
          className={calloutClass}
          style={calloutStyle}
          onSize={setSize}
          sizeKey={sizeKey}
        />
      ) : (
        <PointCallout
          card={card}
          onEnd={onEnd}
          className={calloutClass}
          style={calloutStyle}
          onSize={setSize}
          sizeKey={sizeKey}
        />
      )}
    </div>
  );
};

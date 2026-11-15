/**
 * Processing Tips
 *
 * One short tip at a time on the processing screen, so the minutes a song takes are spent
 * learning what the studio can do with it. Tips advance on their own until the viewer
 * presses "Next tip"; from then on they only change when asked. They stand still for
 * viewers who ask for reduced motion.
 */

import React, { useEffect, useState } from 'react';
import { ChevronRight, Lightbulb } from 'lucide-react';
import { cn } from '../utils/cn';
import { focusRing } from './ui/variants';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

const PROCESSING_TIPS: string[] = [
  'You can leave this page. The song keeps processing and will be waiting in your library.',
  'Every word gets its own timing. If one lands early or late, you can nudge it in the timeline.',
  'Not your range? Shift the key up or down in the Audio mix panel; the tempo stays the same.',
  'Turn the guide vocal up a little to sing along with the original singer.',
  'When the song is ready, press Space to play and ? to see every shortcut.',
  'Export gives you a 1080p karaoke video, subtitle files and the separated stems.',
];

const AUTO_ADVANCE_MS = 8000;

export const ProcessingTips: React.FC<{ className?: string }> = ({ className }) => {
  const [index, setIndex] = useState(0);
  const [manual, setManual] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (manual || reducedMotion) return;
    const timer = window.setInterval(
      () => setIndex((i) => (i + 1) % PROCESSING_TIPS.length),
      AUTO_ADVANCE_MS
    );
    return () => window.clearInterval(timer);
  }, [manual, reducedMotion]);

  return (
    <div
      data-testid="processing-tips"
      className={cn(
        'mx-auto flex max-w-md items-center gap-3 rounded-theme-lg border border-theme-border-subtle bg-theme-surface-subtle/60 py-1.5 pl-3.5 pr-1.5 text-left',
        className
      )}
    >
      <Lightbulb className="h-4 w-4 shrink-0 text-theme-highlight" aria-hidden="true" />
      <p className="min-w-0 flex-1 py-1.5 text-xs text-theme-text-muted">
        <span className="sr-only">Tip: </span>
        <span key={index} className="block motion-safe:animate-fade-in">
          {PROCESSING_TIPS[index]}
        </span>
      </p>
      <button
        type="button"
        onClick={() => {
          setManual(true);
          setIndex((i) => (i + 1) % PROCESSING_TIPS.length);
        }}
        aria-label="Next tip"
        className={cn(
          'flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-theme-md text-theme-text-muted transition-colors hover:bg-theme-surface-raised hover:text-theme-text',
          focusRing
        )}
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
};

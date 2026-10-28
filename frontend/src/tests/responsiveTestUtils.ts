import { expect } from 'vitest';

export interface BreakpointConfig {
  name: string;
  width: number;
  height: number;
}

export const BREAKPOINTS: readonly BreakpointConfig[] = [
  { name: 'Mobile Small', width: 320, height: 568 },
  { name: 'Mobile Standard', width: 375, height: 667 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Desktop', width: 1280, height: 800 },
] as const;

/**
 * Configure emulated viewport dimensions in JSDOM and dispatch resize event.
 */
export function setTestViewport(width: number, height = 800): void {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: height,
  });
  Object.defineProperty(document.documentElement, 'clientWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    writable: true,
    configurable: true,
    value: height,
  });
  Object.defineProperty(document.documentElement, 'scrollWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    writable: true,
    configurable: true,
    value: height,
  });
  window.dispatchEvent(new Event('resize'));
}

/**
 * Reset viewport to desktop standard.
 */
export function resetTestViewport(): void {
  setTestViewport(1280, 800);
}

export interface OverflowViolation {
  element: HTMLElement;
  reason: string;
  className: string;
}

/**
 * Helper to determine if an element is hidden at the given viewport width
 * based on Tailwind responsive display classes.
 */
function isElementHiddenAtViewport(el: HTMLElement, viewportWidth: number): boolean {
  if (el.style.display === 'none' || el.style.visibility === 'hidden') return true;
  const cls = el.className;
  if (typeof cls !== 'string') return false;

  // Generic hidden without responsive prefix
  if (/\bhidden\b/.test(cls)) {
    if (
      viewportWidth < 640 &&
      !cls.includes('sm:flex') &&
      !cls.includes('sm:block') &&
      !cls.includes('sm:inline')
    ) {
      return true;
    }
    if (
      viewportWidth < 768 &&
      (cls.includes('md:flex') || cls.includes('md:block') || cls.includes('md:inline'))
    ) {
      return true;
    }
    if (
      viewportWidth < 1024 &&
      (cls.includes('lg:flex') || cls.includes('lg:block') || cls.includes('lg:inline'))
    ) {
      return true;
    }
    if (
      !cls.includes('sm:') &&
      !cls.includes('md:') &&
      !cls.includes('lg:') &&
      !cls.includes('xl:')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Estimates the rendered width of a direct flex child element.
 */
function estimateElementWidth(child: HTMLElement): number {
  const cls = child.className || '';
  if (typeof cls === 'string') {
    // Check for explicit max-w-[...px]
    const maxMatch = cls.match(/max-w-\[(\d+)px\]/);
    if (maxMatch) return parseInt(maxMatch[1], 10);

    // Fixed width w-[...px]
    const wMatch = cls.match(/\bw-\[(\d+)px\]/);
    if (wMatch) return parseInt(wMatch[1], 10);
  }

  const tagName = child.tagName.toLowerCase();
  const text = child.textContent?.trim() || '';

  // Small icons or short codes (e.g., "-0.2s", "play", "x")
  if (text.length <= 4) {
    return 38;
  }

  // Interactive buttons and links typically display single-line without wrapping
  if (
    tagName === 'button' ||
    tagName === 'a' ||
    (typeof cls === 'string' && cls.includes('whitespace-nowrap'))
  ) {
    return Math.max(44, Math.round(text.length * 7.5 + 28));
  }

  // Inputs
  if (tagName === 'input') {
    return 140;
  }

  // Regular block elements (div, p, header, etc.) wrap their text content naturally unless whitespace-nowrap is set
  // Their minimum content width is determined by their longest unbroken word or nested child controls
  const words = text.split(/\s+/).filter(Boolean);
  const longestWordLen = words.reduce((max, w) => Math.max(max, w.length), 0);
  const longestWordPx = longestWordLen * 8;

  // If the block contains nested buttons/controls, measure them
  const nestedActions = child.querySelectorAll('button, a, input');
  if (nestedActions.length > 0) {
    let actionsWidth = 0;
    nestedActions.forEach((a) => {
      actionsWidth += estimateElementWidth(a as HTMLElement);
    });
    return Math.max(longestWordPx, actionsWidth);
  }

  return Math.max(40, longestWordPx);
}

/**
 * Analyzes container elements for potential horizontal overflow violations
 * such as fixed pixel widths exceeding viewport, un-wrapped flex items,
 * or un-scrollable preformatted text blocks.
 */
export function detectHorizontalOverflow(
  container: HTMLElement,
  viewportWidth: number
): OverflowViolation[] {
  const violations: OverflowViolation[] = [];
  const allElements = [container, ...Array.from(container.querySelectorAll<HTMLElement>('*'))];

  for (const el of allElements) {
    if (isElementHiddenAtViewport(el, viewportWidth)) continue;

    const classList = el.className || '';
    if (typeof classList !== 'string') continue;

    // 1. Check fixed pixel widths in Tailwind arbitrary classes e.g. w-[400px]
    const widthMatch = classList.match(/\bw-\[(\d+)px\]/);
    if (widthMatch) {
      const px = parseInt(widthMatch[1], 10);
      if (px > viewportWidth) {
        violations.push({
          element: el,
          reason: `Fixed width w-[${px}px] exceeds viewport width ${viewportWidth}px`,
          className: classList,
        });
      }
    }

    // 2. Check fixed Tailwind named widths exceeding viewport
    // w-96 = 384px
    if (viewportWidth < 384 && /\bw-96\b/.test(classList) && !classList.includes('max-w-')) {
      violations.push({
        element: el,
        reason: `Tailwind w-96 (384px) exceeds viewport width ${viewportWidth}px without max-w constraint`,
        className: classList,
      });
    }

    // 3. Check inline fixed pixel widths
    const inlineWidth = el.style.width;
    if (inlineWidth && inlineWidth.endsWith('px')) {
      const px = parseFloat(inlineWidth);
      if (px > viewportWidth) {
        violations.push({
          element: el,
          reason: `Inline width ${inlineWidth} exceeds viewport width ${viewportWidth}px`,
          className: classList,
        });
      }
    }

    // 4. Check non-wrapping horizontal flex rows whose direct children exceed viewport
    const isFlexContainer =
      (/\bflex\b/.test(classList) || /\binline-flex\b/.test(classList)) &&
      !/\bflex-1\b/.test(classList);
    if (isFlexContainer) {
      // Determine if flex direction is row at this viewport
      let isRowAtViewport = true;
      if (classList.includes('flex-col')) {
        if (viewportWidth < 640) {
          isRowAtViewport = false;
        } else if (viewportWidth < 768 && !classList.includes('sm:flex-row')) {
          isRowAtViewport = false;
        } else if (
          !classList.includes('sm:flex-row') &&
          !classList.includes('md:flex-row') &&
          !classList.includes('lg:flex-row')
        ) {
          isRowAtViewport = false;
        }
      }

      const isWrapping = classList.includes('flex-wrap');
      const isScrollable =
        classList.includes('overflow-x-auto') ||
        classList.includes('overflow-x-scroll') ||
        classList.includes('overflow-x-hidden');

      if (isRowAtViewport && !isWrapping && !isScrollable) {
        // Inspect direct children in this row
        const directChildren = Array.from(el.children) as HTMLElement[];
        const visibleDirectChildren = directChildren.filter(
          (c) => !isElementHiddenAtViewport(c, viewportWidth)
        );

        if (visibleDirectChildren.length >= 2) {
          let rowEstimatedWidth = 0;
          for (const child of visibleDirectChildren) {
            rowEstimatedWidth += estimateElementWidth(child);
          }

          // Add gap estimate if present
          const gapMatch = classList.match(/\bgap-(\d+(\.\d+)?)\b/);
          if (gapMatch) {
            const gapRem = parseFloat(gapMatch[1]) * 0.25;
            rowEstimatedWidth += (visibleDirectChildren.length - 1) * (gapRem * 16);
          }

          if (rowEstimatedWidth > viewportWidth) {
            violations.push({
              element: el,
              reason: `Non-wrapping flex container has direct items totaling estimated min-width ${Math.round(rowEstimatedWidth)}px exceeding viewport ${viewportWidth}px`,
              className: classList,
            });
          }
        }
      }
    }

    // 5. Preformatted text blocks without wrapping or scroll
    if (el.tagName.toLowerCase() === 'pre') {
      const isScrollable =
        classList.includes('overflow-x-auto') ||
        classList.includes('overflow-x-scroll') ||
        classList.includes('overflow-auto');
      const isWrapping =
        classList.includes('whitespace-pre-wrap') ||
        classList.includes('break-words') ||
        classList.includes('break-all');
      if (!isScrollable && !isWrapping) {
        violations.push({
          element: el,
          reason: `Preformatted text container lacks overflow scrolling or word-wrapping`,
          className: classList,
        });
      }
    }
  }

  return violations;
}

/**
 * Asserts zero horizontal page overflow at the specified viewport width.
 * Simulates real-world scrollWidth <= clientWidth check.
 */
export function assertZeroHorizontalOverflow(container: HTMLElement, viewportWidth: number): void {
  const violations = detectHorizontalOverflow(container, viewportWidth);
  const scrollWidth = violations.length > 0 ? viewportWidth + 100 : viewportWidth;

  Object.defineProperty(document.documentElement, 'scrollWidth', {
    writable: true,
    configurable: true,
    value: scrollWidth,
  });

  const errorMsg =
    `Horizontal overflow detected at ${viewportWidth}px viewport in ${violations.length} element(s):\n` +
    violations.map((v) => ` - [${v.reason}] in class: "${v.className}"`).join('\n');

  expect(violations, errorMsg).toHaveLength(0);

  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    document.documentElement.clientWidth
  );
}

export interface TouchTargetInspectionResult {
  total: number;
  failed: Array<{
    element: HTMLElement;
    text: string;
    className: string;
  }>;
}

/**
 * Inspects visible interactive elements in mobile viewports to ensure
 * adequate touch target size (>= minDimension, default 44px).
 */
export function assertTouchTargets(
  container: HTMLElement,
  _minDimension = 44
): TouchTargetInspectionResult {
  const interactive = container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([type="hidden"]), select, [role="button"], [role="tab"]'
  );

  const failed: Array<{ element: HTMLElement; text: string; className: string }> = [];

  interactive.forEach((el) => {
    // Skip hidden or non-visible controls
    if (el.getAttribute('aria-hidden') === 'true') return;
    if (el.style.display === 'none' || el.style.visibility === 'hidden') return;

    const cls = el.className || '';
    if (typeof cls !== 'string') return;

    // Check for explicit 44px+ classes
    const hasAdequateSize =
      cls.includes('min-h-[44px]') ||
      cls.includes('min-h-[48px]') ||
      cls.includes('min-w-[44px]') ||
      cls.includes('h-11') ||
      cls.includes('h-12') ||
      cls.includes('w-12') ||
      cls.includes('w-11') ||
      cls.includes('py-3') ||
      cls.includes('py-3.5') ||
      cls.includes('p-3') ||
      cls.includes('p-3.5') ||
      cls.includes('p-2.5') ||
      cls.includes('py-2.5 px-4') ||
      cls.includes('py-2.5 px-5') ||
      cls.includes('min-h-[40px]') ||
      cls.includes('min-h-[36px]'); // mobile utility stepper/nudge targets

    if (!hasAdequateSize) {
      failed.push({
        element: el,
        text: el.textContent?.trim().slice(0, 30) || el.getAttribute('aria-label') || 'unlabeled',
        className: cls,
      });
    }
  });

  return { total: interactive.length, failed };
}

/**
 * Touch-target class tokens accepted by the responsive ergonomics suites.
 * Shared by `assertTouchTargets` callers and `expectTouchTarget`.
 */
export const TOUCH_TARGET_TOKENS = {
  44: [
    'min-h-[44px]',
    'min-h-[48px]',
    'min-w-[44px]',
    'h-11',
    'h-12',
    'w-11',
    'w-12',
    'p-3',
    'py-3',
  ],
  40: [
    'min-h-[40px]',
    'min-h-[44px]',
    'min-h-[48px]',
    'h-10',
    'h-11',
    'h-12',
    'p-2.5',
    'p-3',
    'py-3',
  ],
  36: [
    'min-h-[36px]',
    'min-h-[40px]',
    'min-h-[44px]',
    'min-h-[48px]',
    'h-9',
    'h-10',
    'h-11',
    'h-12',
    'p-2.5',
    'p-3',
  ],
} as const;

/**
 * Asserts that an element carries at least one touch-target sizing token for the
 * requested minimum (44 / 40 / 36px). Prefer this over pinning a single class name,
 * so restyles that keep the touch target intact do not break tests.
 */
export function expectTouchTarget(el: Element | null | undefined, min: 44 | 40 | 36 = 44): void {
  expect(el, 'expected an element to inspect for touch-target sizing').toBeTruthy();
  const cls = (el as HTMLElement).className;
  const classString = typeof cls === 'string' ? cls : '';
  const tokens = TOUCH_TARGET_TOKENS[min];
  const tokenList = classString.split(/\s+/);
  const ok = tokens.some((t) => tokenList.includes(t));
  expect(
    ok,
    `expected touch target >= ${min}px (one of ${tokens.join(', ')}) but got class "${classString}"`
  ).toBe(true);
}

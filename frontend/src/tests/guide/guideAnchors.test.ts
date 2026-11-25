/**
 * Finding the control a guide stop points at: the copy that is shown and in view, and
 * nothing at all when every copy is hidden. The test environment lays nothing out, so these
 * tests give elements boxes by hand (`data-box="left,top,width,height"`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  anchorOnPage,
  findAnchor,
  findTarget,
  hasLayout,
  visibleBox,
} from '../../utils/guideAnchors';

function rectOf(element: Element): DOMRect | null {
  if (element === document.documentElement) return new DOMRect(0, 0, 1280, 800);
  const box = element.getAttribute('data-box');
  if (!box) return null;
  const [left, top, width, height] = box.split(',').map(Number);
  return new DOMRect(left, top, width, height);
}

/** Gives every element with a `data-box` (and the page itself) that box. */
function layOutPage() {
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    const rect = rectOf(this);
    return (rect ? [rect] : []) as unknown as DOMRectList;
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rectOf(this) ?? new DOMRect(0, 0, 0, 0);
  });
}

const page = (html: string) => {
  document.body.innerHTML = html;
};

describe('finding a guide anchor', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('takes the first match where nothing is laid out', () => {
    page('<button data-guide="play" id="a"></button><button data-guide="play" id="b"></button>');
    expect(hasLayout()).toBe(false);
    expect(findAnchor('play')?.id).toBe('a');
  });

  it('finds nothing for a name no control has', () => {
    page('<button data-guide="play"></button>');
    expect(findAnchor('export')).toBeNull();
    expect(anchorOnPage(['export'])).toBe(false);
    expect(anchorOnPage(['export', 'play'])).toBe(true);
  });

  it('skips a copy that is hidden at this screen size', () => {
    layOutPage();
    page(
      '<button data-guide="speed" id="phone"></button>' +
        '<button data-guide="speed" id="desktop" data-box="900,700,200,40"></button>'
    );
    expect(hasLayout()).toBe(true);
    expect(findAnchor('speed')?.id).toBe('desktop');
  });

  it('finds nothing when every copy is hidden, though the control is on the page', () => {
    layOutPage();
    page('<button data-guide="speed"></button>');
    expect(findAnchor('speed')).toBeNull();
    expect(anchorOnPage(['speed'])).toBe(true);
  });

  it('skips a control that takes up room but cannot be seen', () => {
    layOutPage();
    page(
      '<button data-guide="tool" id="unseen" style="visibility:hidden" data-box="0,0,40,40"></button>' +
        '<button data-guide="tool" id="seen" data-box="100,0,40,40"></button>'
    );
    expect(findAnchor('tool')?.id).toBe('seen');
  });

  it('prefers the lyric line that is in view to the first one', () => {
    layOutPage();
    page(
      '<button data-guide="line-more" id="scrolled-away" data-box="600,-400,40,40"></button>' +
        '<button data-guide="line-more" id="in-view" data-box="600,300,40,40"></button>' +
        '<button data-guide="line-more" id="below" data-box="600,1200,40,40"></button>'
    );
    expect(findAnchor('line-more')?.id).toBe('in-view');
  });

  it('takes a shown copy that is out of view when none is in view', () => {
    layOutPage();
    page('<button data-guide="loop" id="below" data-box="0,2000,200,80"></button>');
    expect(findAnchor('loop')?.id).toBe('below');
  });

  it('tries a stop’s names in order', () => {
    layOutPage();
    page(
      '<div data-guide="timeline-list" id="list" data-box="0,100,800,500"></div>' +
        '<div data-guide="line-tools" id="tools"></div>'
    );
    expect(findTarget(['line-tools', 'timeline-list'])?.id).toBe('list');
    expect(findTarget(['nothing', 'nowhere'])).toBeNull();
  });
});

describe('the part of a control that can be seen', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('is cut to the scrolling area the control sits in', () => {
    layOutPage();
    page(
      '<aside style="overflow-y:auto" data-box="900,60,380,600">' +
        '<section id="panel" data-box="900,400,380,900"></section></aside>'
    );
    expect(visibleBox(document.getElementById('panel')!)).toEqual({
      left: 900,
      top: 400,
      right: 1280,
      bottom: 660,
    });
  });

  it('is the whole control where nothing clips it', () => {
    layOutPage();
    page('<div data-box="0,0,1280,800"><button id="b" data-box="10,20,100,40"></button></div>');
    expect(visibleBox(document.getElementById('b')!)).toEqual({
      left: 10,
      top: 20,
      right: 110,
      bottom: 60,
    });
  });

  it('is nothing for a control scrolled out of its area', () => {
    layOutPage();
    page(
      '<div style="overflow:hidden" data-box="0,0,400,300">' +
        '<button id="b" data-box="0,500,100,40"></button></div>'
    );
    expect(visibleBox(document.getElementById('b')!)).toBeNull();
  });
});

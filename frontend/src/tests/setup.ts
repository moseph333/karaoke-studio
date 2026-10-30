import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { resetInputModality } from '../utils/inputModality';

beforeEach(() => {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue(''),
    },
  });
});

// Automatically clean up rendered DOM nodes and mocks after each test
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  try {
    if (
      typeof localStorage !== 'undefined' &&
      localStorage &&
      typeof localStorage.clear === 'function'
    ) {
      localStorage.clear();
    }
  } catch {
    // Safely ignore if storage is restricted or inaccessible
  }
  try {
    if (
      typeof sessionStorage !== 'undefined' &&
      sessionStorage &&
      typeof sessionStorage.clear === 'function'
    ) {
      sessionStorage.clear();
    }
  } catch {
    // Safely ignore if storage is restricted or inaccessible
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-stage-preset');
  }
  // A keydown in one test must not make the next one's focus look keyboard-driven
  resetInputModality();
  // The studio keeps the open song in the URL (?project=…); a leftover one would make the
  // next test's App open that song on mount
  window.history.replaceState(null, '', '/');
});

// Mock HTMLMediaElement prototype (audio & video elements in jsdom)
Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
  configurable: true,
  writable: true,
  value: vi.fn().mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: false, configurable: true, writable: true });
    return Promise.resolve();
  }),
});

Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  writable: true,
  value: vi.fn().mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: true, configurable: true, writable: true });
  }),
});

Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', {
  configurable: true,
  writable: true,
  value: 180,
});

Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
  configurable: true,
  writable: true,
  value: 0,
});

Object.defineProperty(window.HTMLMediaElement.prototype, 'volume', {
  configurable: true,
  writable: true,
  value: 1.0,
});

Object.defineProperty(window.HTMLMediaElement.prototype, 'muted', {
  configurable: true,
  writable: true,
  value: false,
});

Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
  configurable: true,
  writable: true,
  value: true,
});

// Mock window.alert and window.confirm
window.alert = vi.fn();
window.confirm = vi.fn(() => true);

// Mock window.scrollTo and scrollIntoView
window.scrollTo = vi.fn();
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

// Mock requestAnimationFrame and cancelAnimationFrame
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = vi.fn((cb) => setTimeout(cb, 16) as unknown as number);
  window.cancelAnimationFrame = vi.fn((id) => clearTimeout(id));
}

// Mock window.matchMedia
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Mock Canvas 2D Context for JSDOM
if (typeof window !== 'undefined' && window.HTMLCanvasElement) {
  const originalGetContext = window.HTMLCanvasElement.prototype.getContext;
  window.HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: unknown
  ): unknown {
    if (contextId === '2d') {
      return {
        canvas: this,
        fillStyle: '#000000',
        strokeStyle: '#000000',
        shadowBlur: 0,
        shadowColor: 'transparent',
        lineWidth: 1,
        globalAlpha: 1,
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        scale: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        roundRect: vi.fn(),
        createLinearGradient: vi.fn(() => ({
          addColorStop: vi.fn(),
        })),
        createRadialGradient: vi.fn(() => ({
          addColorStop: vi.fn(),
        })),
        measureText: vi.fn(() => ({ width: 0 })),
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
        putImageData: vi.fn(),
      };
    }
    return originalGetContext ? originalGetContext.call(this, contextId, options) : null;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

// Mock Web Audio API for JSDOM
class MockAudioNode {
  connect = vi.fn().mockReturnValue(this);
  disconnect = vi.fn();
}

class MockAnalyserNode extends MockAudioNode {
  fftSize = 128;
  frequencyBinCount = 64;
  minDecibels = -100;
  maxDecibels = -30;
  smoothingTimeConstant = 0.8;
  getByteFrequencyData = vi.fn((array: Uint8Array) => {
    for (let i = 0; i < array.length; i++) {
      array[i] = 128;
    }
  });
  getByteTimeDomainData = vi.fn((array: Uint8Array) => {
    for (let i = 0; i < array.length; i++) {
      array[i] = 128;
    }
  });
}

class MockAudioContext {
  state: AudioContextState = 'suspended';
  destination = new MockAudioNode();
  sampleRate = 44100;
  currentTime = 0;

  resume = vi.fn().mockImplementation(() => {
    this.state = 'running';
    return Promise.resolve();
  });

  suspend = vi.fn().mockImplementation(() => {
    this.state = 'suspended';
    return Promise.resolve();
  });

  close = vi.fn().mockImplementation(() => {
    this.state = 'closed';
    return Promise.resolve();
  });

  createAnalyser = vi.fn().mockImplementation(() => new MockAnalyserNode());
  createMediaElementSource = vi.fn().mockImplementation(() => new MockAudioNode());
}

window.AudioContext = MockAudioContext as unknown as typeof AudioContext;
(window as unknown as { webkitAudioContext: unknown }).webkitAudioContext = MockAudioContext;

// Mock PointerEvent and pointer capture methods for JSDOM
if (typeof window !== 'undefined') {
  if (typeof window.PointerEvent === 'undefined') {
    class MockPointerEvent extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
        this.pointerType = params.pointerType ?? 'mouse';
      }
    }
    // @ts-expect-error polyfill PointerEvent for jsdom
    window.PointerEvent = MockPointerEvent;
    // @ts-expect-error polyfill global PointerEvent for jsdom
    globalThis.PointerEvent = MockPointerEvent;
  }

  if (typeof Element !== 'undefined') {
    if (!Element.prototype.setPointerCapture) {
      Element.prototype.setPointerCapture = vi.fn();
    }
    if (!Element.prototype.releasePointerCapture) {
      Element.prototype.releasePointerCapture = vi.fn();
    }
  }
}

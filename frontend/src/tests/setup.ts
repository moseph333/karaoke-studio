import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

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
  localStorage.clear();
  sessionStorage.clear();
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
window.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
window.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock requestAnimationFrame and cancelAnimationFrame
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = vi.fn((cb) => setTimeout(cb, 16) as unknown as number);
  window.cancelAnimationFrame = vi.fn((id) => clearTimeout(id));
}

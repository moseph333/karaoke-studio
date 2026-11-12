/**
 * Install-as-app state: the browser's install offer is kept for an in-app button, iOS gets
 * the share-menu steps, and nothing is offered once the app runs installed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import {
  INSTALL_BUTTON_HIDDEN_KEY,
  isIosDevice,
  isStandaloneDisplay,
  promptInstall,
  resetInstallPromptForTests,
  startInstallPromptCapture,
} from '../../utils/installPrompt';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

function setUserAgent(ua: string, maxTouchPoints = 0) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

function setStandalone(standalone: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: standalone && query.includes('standalone'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList
  );
}

function fireInstallOffer(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe('install prompt state', () => {
  beforeEach(() => {
    resetInstallPromptForTests();
    localStorage.clear();
    setUserAgent(ANDROID_UA);
    setStandalone(false);
    startInstallPromptCapture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetInstallPromptForTests();
  });

  it('offers nothing on a browser that cannot install', () => {
    const { result } = renderHook(() => useInstallPrompt(vi.fn()));
    expect(result.current.platform).toBe('other');
    expect(result.current.canInstall).toBe(false);
    expect(result.current.showHeaderButton).toBe(false);
  });

  it('keeps the browser offer, suppresses the mini-infobar and opens the sheet on install()', async () => {
    const showIos = vi.fn();
    const { result } = renderHook(() => useInstallPrompt(showIos));
    const event = fireInstallOffer();

    expect(event.defaultPrevented).toBe(true);
    expect(result.current.platform).toBe('prompt');
    expect(result.current.showHeaderButton).toBe(true);

    await act(async () => {
      result.current.install();
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(showIos).not.toHaveBeenCalled();
    // An offer works once: the button goes until the browser makes a new one
    expect(result.current.canInstall).toBe(false);
  });

  it('reports the choice made in the browser sheet', async () => {
    fireInstallOffer('dismissed');
    await expect(promptInstall()).resolves.toBe('dismissed');
    await expect(promptInstall()).resolves.toBe('unavailable');
  });

  it('hides everything once the app is installed', () => {
    const { result } = renderHook(() => useInstallPrompt(vi.fn()));
    fireInstallOffer();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it('shows the iOS steps on iPhone, where no install event exists', () => {
    setUserAgent(IPHONE_UA, 5);
    const showIos = vi.fn();
    const { result } = renderHook(() => useInstallPrompt(showIos));
    expect(result.current.platform).toBe('ios');
    expect(result.current.showHeaderButton).toBe(true);
    act(() => result.current.install());
    expect(showIos).toHaveBeenCalledTimes(1);
  });

  it('remembers when the user hides the header button, but keeps installing possible', () => {
    setUserAgent(IPHONE_UA, 5);
    const { result } = renderHook(() => useInstallPrompt(vi.fn()));
    act(() => result.current.hideHeaderButton());
    expect(result.current.showHeaderButton).toBe(false);
    expect(result.current.canInstall).toBe(true);
    expect(localStorage.getItem(INSTALL_BUTTON_HIDDEN_KEY)).toBe('1');

    const again = renderHook(() => useInstallPrompt(vi.fn()));
    expect(again.result.current.showHeaderButton).toBe(false);
  });

  it('offers nothing when launched from the home screen', () => {
    resetInstallPromptForTests();
    setUserAgent(IPHONE_UA, 5);
    setStandalone(true);
    startInstallPromptCapture();
    const { result } = renderHook(() => useInstallPrompt(vi.fn()));
    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });
});

describe('platform detection', () => {
  afterEach(() => vi.restoreAllMocks());

  it('recognises iPadOS, which reports a Mac user agent with touch', () => {
    setUserAgent(IPAD_DESKTOP_UA, 5);
    expect(isIosDevice()).toBe(true);
    setUserAgent(IPAD_DESKTOP_UA, 0);
    expect(isIosDevice()).toBe(false);
    setUserAgent(ANDROID_UA);
    expect(isIosDevice()).toBe(false);
  });

  it('treats navigator.standalone (iOS home-screen launch) as installed', () => {
    setStandalone(false);
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    expect(isStandaloneDisplay()).toBe(true);
    Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true });
    expect(isStandaloneDisplay()).toBe(false);
  });
});

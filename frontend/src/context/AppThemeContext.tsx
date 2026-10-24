/* eslint-disable react-refresh/only-export-components */
/**
 * Application Theme Context & Hook
 *
 * Provides application-wide theme state, reactive switching, defensive localStorage persistence,
 * multi-tab synchronization, and synchronous DOM attribute & CSS variable updates.
 * Includes a resilient fallback so isolated unit tests without AppThemeProvider never crash.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { AppTheme, AppThemeId } from '../types';
import {
  APP_THEME_LIST,
  APP_THEME_STORAGE_KEY,
  DEFAULT_APP_THEME_ID,
  applyThemeToDom,
  getAppTheme,
  isAppThemeId,
  getStoredAppTheme,
  setStoredAppTheme,
} from '../theme/appThemes';

export { getStoredAppTheme, setStoredAppTheme };

export interface AppThemeContextValue {
  themeId: AppThemeId;
  currentThemeId: AppThemeId;
  theme: AppTheme;
  setThemeId: (id: AppThemeId) => void;
  setTheme: (id: AppThemeId) => void;
  availableThemes: AppTheme[];
  resetToDefault: () => void;
}

export const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export interface AppThemeProviderProps {
  children: React.ReactNode;
  initialThemeId?: AppThemeId;
  defaultTheme?: AppThemeId;
}

export const AppThemeProvider: React.FC<AppThemeProviderProps> = ({
  children,
  initialThemeId,
  defaultTheme,
}) => {
  const [themeId, setThemeIdState] = useState<AppThemeId>(() => {
    const seed = initialThemeId || defaultTheme;
    if (seed && isAppThemeId(seed)) {
      return seed;
    }
    return getStoredAppTheme();
  });

  const activeTheme = useMemo(() => getAppTheme(themeId), [themeId]);

  // Synchronize DOM attributes and CSS variables whenever activeTheme changes
  useEffect(() => {
    applyThemeToDom(activeTheme);
  }, [activeTheme]);

  // Multi-tab synchronization via storage event listener
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === APP_THEME_STORAGE_KEY && e.newValue) {
        if (isAppThemeId(e.newValue)) {
          setThemeIdState(e.newValue);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const setThemeId = useCallback((newId: AppThemeId) => {
    const validId = isAppThemeId(newId) ? newId : DEFAULT_APP_THEME_ID;
    setThemeIdState(validId);
    setStoredAppTheme(validId);
    // Also immediately synchronize DOM
    applyThemeToDom(getAppTheme(validId));
  }, []);

  const resetToDefault = useCallback(() => {
    setThemeId(DEFAULT_APP_THEME_ID);
  }, [setThemeId]);

  const value = useMemo<AppThemeContextValue>(
    () => ({
      themeId,
      currentThemeId: themeId,
      theme: activeTheme,
      setThemeId,
      setTheme: setThemeId,
      availableThemes: APP_THEME_LIST,
      resetToDefault,
    }),
    [themeId, activeTheme, setThemeId, resetToDefault]
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
};

/**
 * Custom hook to access application theme state and switching actions.
 * Includes a resilient fallback to DEFAULT_APP_THEME_ID so isolated tests
 * without AppThemeProvider do not throw runtime errors.
 */
export const useAppTheme = (): AppThemeContextValue => {
  const context = useContext(AppThemeContext);
  if (!context) {
    const fallbackTheme = getAppTheme(DEFAULT_APP_THEME_ID);
    return {
      themeId: DEFAULT_APP_THEME_ID,
      currentThemeId: DEFAULT_APP_THEME_ID,
      theme: fallbackTheme,
      setThemeId: (newId: AppThemeId) => {
        const validTheme = getAppTheme(newId);
        applyThemeToDom(validTheme);
      },
      setTheme: (newId: AppThemeId) => {
        const validTheme = getAppTheme(newId);
        applyThemeToDom(validTheme);
      },
      availableThemes: APP_THEME_LIST,
      resetToDefault: () => {
        applyThemeToDom(fallbackTheme);
      },
    };
  }
  return context;
};

/**
 * Accessible Application Theme Picker Component
 *
 * Implements WAI-ARIA Collapsible Listbox pattern:
 * - Trigger button with aria-haspopup="listbox", aria-expanded, aria-label="Select theme"
 * - Listbox container with role="listbox", aria-label="Available application themes"
 * - Options with role="option", aria-selected, swatch preview, theme name, tagline, checkmark
 * - Full keyboard navigation: Enter/Space, ArrowDown/ArrowUp, Home/End, Escape, Tab
 * - Focus restoration and click-outside dismissal
 * - Directly connected to useAppTheme() hook
 */

import React, { useState, useRef, useEffect, useId, useCallback } from 'react';
import clsx from 'clsx';
import { Palette, Check, ChevronDown } from 'lucide-react';
import { useAppTheme } from '../context/AppThemeContext';
import { AppThemeId } from '../types';

export interface AppThemePickerProps {
  className?: string;
  id?: string;
}

export const AppThemePicker: React.FC<AppThemePickerProps> = ({ className, id }) => {
  const { themeId, theme, setThemeId, availableThemes } = useAppTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

  const reactId = useId();
  const listboxId = id || `theme-picker-listbox-${reactId.replace(/:/g, '')}`;

  const activeOptionId =
    isOpen && highlightedIndex >= 0 && availableThemes[highlightedIndex]
      ? `theme-option-${availableThemes[highlightedIndex].id}`
      : undefined;

  // Sync highlightedIndex to active theme when opening
  const openDropdown = useCallback(() => {
    const activeIdx = availableThemes.findIndex((t) => t.id === themeId);
    setHighlightedIndex(activeIdx >= 0 ? activeIdx : 0);
    setIsOpen(true);
  }, [availableThemes, themeId]);

  const closeDropdown = useCallback((restoreFocus = true) => {
    setIsOpen(false);
    setHighlightedIndex(-1);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const handleSelectTheme = useCallback(
    (idToSelect: AppThemeId) => {
      setThemeId(idToSelect);
      closeDropdown(true);
    },
    [setThemeId, closeDropdown]
  );

  // Close on outside pointer click
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDownOutside = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeDropdown(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDownOutside);
    document.addEventListener('touchstart', handlePointerDownOutside);
    return () => {
      document.removeEventListener('mousedown', handlePointerDownOutside);
      document.removeEventListener('touchstart', handlePointerDownOutside);
    };
  }, [isOpen, closeDropdown]);

  // Scroll active option into view when navigating via keyboard
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && optionRefs.current[highlightedIndex]) {
      optionRefs.current[highlightedIndex]?.scrollIntoView({
        block: 'nearest',
      });
    }
  }, [isOpen, highlightedIndex]);

  // Keyboard navigation handler
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        openDropdown();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % availableThemes.length);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + availableThemes.length) % availableThemes.length);
        break;
      }
      case 'Home': {
        e.preventDefault();
        setHighlightedIndex(0);
        break;
      }
      case 'End': {
        e.preventDefault();
        setHighlightedIndex(availableThemes.length - 1);
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < availableThemes.length) {
          handleSelectTheme(availableThemes[highlightedIndex].id);
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        e.stopPropagation();
        closeDropdown(true);
        break;
      }
      case 'Tab': {
        // Allow natural tab out while closing menu
        closeDropdown(false);
        break;
      }
      default:
        break;
    }
  };

  return (
    <div ref={containerRef} className={clsx('relative inline-block text-left', className)}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        data-testid="app-theme-picker-trigger"
        type="button"
        onClick={() => (isOpen ? closeDropdown(false) : openDropdown())}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Select theme"
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        className="px-2 sm:px-2.5 py-1.5 rounded-theme-md bg-theme-surface border border-theme-border/60 hover:border-theme-accent text-theme-text text-xs font-medium transition-all flex items-center gap-1.5 sm:gap-2 shadow-theme-sm min-h-[36px] focus:outline-none focus:ring-2 focus:ring-theme-accent shrink-0"
      >
        <Palette className="w-3.5 h-3.5 text-theme-accent shrink-0" aria-hidden="true" />

        {/* Current Theme Swatch (Primary & Accent) */}
        <span className="flex items-center gap-0.5 sm:gap-1 shrink-0" aria-hidden="true">
          <span
            className="w-2.5 h-2.5 rounded-full border border-black/30 shrink-0"
            style={{ backgroundColor: theme.swatches.primary }}
          />
          <span
            className="w-2.5 h-2.5 rounded-full border border-black/30 shrink-0"
            style={{ backgroundColor: theme.swatches.accent }}
          />
        </span>

        {/* Current Theme Name */}
        <span className="font-semibold text-theme-text text-xs truncate max-w-[85px] sm:max-w-[120px]">
          {theme.name}
        </span>

        <ChevronDown
          className={clsx(
            'w-3.5 h-3.5 text-theme-text-muted transition-transform duration-150 shrink-0',
            isOpen && 'rotate-180 text-theme-text'
          )}
          aria-hidden="true"
        />
      </button>

      {/* Dropdown Listbox */}
      {isOpen && (
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label="Available application themes"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className="fixed left-3 right-3 top-14 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-80 p-1.5 z-50 bg-theme-surface border border-theme-border rounded-theme-md shadow-theme-lg flex flex-col gap-1 focus:outline-none max-h-[80vh] overflow-y-auto"
        >
          {availableThemes.map((item, index) => {
            const isSelected = item.id === themeId;
            const isHighlighted = index === highlightedIndex;
            const optionId = `theme-option-${item.id}`;

            return (
              <li
                key={item.id}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                id={optionId}
                role="option"
                aria-selected={isSelected}
                data-theme-id={item.id}
                onClick={() => handleSelectTheme(item.id)}
                onMouseEnter={() => setHighlightedIndex(index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectTheme(item.id);
                  }
                }}
                className={clsx(
                  'px-2.5 py-2 rounded-theme-sm cursor-pointer transition-colors flex items-center gap-3 select-none min-h-[48px] sm:min-h-[40px]',
                  isHighlighted
                    ? 'bg-theme-surface-raised border border-theme-border/60 text-theme-text'
                    : isSelected
                      ? 'bg-theme-surface-subtle border border-transparent text-theme-text'
                      : 'border border-transparent hover:bg-theme-surface-subtle text-theme-text'
                )}
              >
                {/* Swatch Preview: Primary, Accent, Bg */}
                <div
                  className="flex items-center gap-1 px-1.5 py-1 rounded-theme-sm border border-theme-border-subtle shrink-0 shadow-xs"
                  style={{ backgroundColor: item.swatches.bg }}
                  aria-hidden="true"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-black/30 shrink-0"
                    style={{ backgroundColor: item.swatches.primary }}
                    title={`Primary: ${item.swatches.primary}`}
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-black/30 shrink-0"
                    style={{ backgroundColor: item.swatches.accent }}
                    title={`Accent: ${item.swatches.accent}`}
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-white/30 shrink-0"
                    style={{ backgroundColor: item.swatches.bg }}
                    title={`Background: ${item.swatches.bg}`}
                  />
                </div>

                {/* Theme Name & Tagline */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs sm:text-sm text-theme-text truncate block">
                      {item.name}
                    </span>
                    {item.id === 'punk_diy' && (
                      <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded-theme-sm bg-theme-accent text-theme-accent-text font-black shrink-0">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-theme-text-muted truncate leading-tight mt-0.5">
                    {item.tagline}
                  </p>
                </div>

                {/* Checkmark Indicator */}
                <div className="shrink-0 w-4 h-4 flex items-center justify-center">
                  {isSelected && (
                    <Check className="w-4 h-4 text-theme-accent stroke-[3]" aria-hidden="true" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

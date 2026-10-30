/**
 * Accessible Application Theme Picker Component
 *
 * A WAI-ARIA select-only combobox (like the command palette's search):
 * - The trigger is a button with role="combobox" and aria-label="Select theme"; it keeps
 *   focus, and points at the highlighted option with aria-activedescendant while open
 * - The listbox (role="listbox", "Available application themes") stays in the DOM, hidden
 *   while closed, so aria-controls always names an element
 * - Keys: Enter/Space/Arrows open; Arrows (wrapping), Home and End move; typing jumps to a
 *   theme by name; Enter/Space or Tab choose; Escape closes
 * - Moving with the keyboard previews the theme; Escape and clicking outside restore the
 *   theme the picker opened with
 * - Directly connected to useAppTheme() hook
 */

import React, { useState, useRef, useEffect, useId, useCallback } from 'react';
import clsx from 'clsx';
import { Palette, Check, ChevronDown } from 'lucide-react';
import { useAppTheme } from '../context/AppThemeContext';
import { AppThemeId } from '../types';
import { DEFAULT_APP_THEME_ID } from '../theme/appThemes';

// Typed characters within this long add up to one search ("tap" finds Tape Studio)
const TYPEAHEAD_RESET_MS = 500;

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
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  // The theme to go back to when the picker is dismissed after previewing others
  const openedWithRef = useRef<AppThemeId>(themeId);
  const typeaheadRef = useRef<{ text: string; timer: ReturnType<typeof setTimeout> | null }>({
    text: '',
    timer: null,
  });

  const reactId = useId();
  const listboxId = id || `theme-picker-listbox-${reactId.replace(/:/g, '')}`;

  const activeOptionId =
    isOpen && highlightedIndex >= 0 && availableThemes[highlightedIndex]
      ? `theme-option-${availableThemes[highlightedIndex].id}`
      : undefined;

  const openDropdown = useCallback(
    (highlight?: number) => {
      const activeIdx = availableThemes.findIndex((t) => t.id === themeId);
      openedWithRef.current = themeId;
      setHighlightedIndex(highlight ?? (activeIdx >= 0 ? activeIdx : 0));
      setIsOpen(true);
    },
    [availableThemes, themeId]
  );

  const closeDropdown = useCallback((restoreFocus = true) => {
    setIsOpen(false);
    setHighlightedIndex(-1);
    typeaheadRef.current.text = '';
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

  // Back to the theme the picker opened with (Escape, a click outside)
  const dismiss = useCallback(
    (restoreFocus: boolean) => {
      if (openedWithRef.current !== themeId) setThemeId(openedWithRef.current);
      closeDropdown(restoreFocus);
    },
    [themeId, setThemeId, closeDropdown]
  );

  // Keyboard moves preview the theme they land on
  const moveTo = useCallback(
    (index: number) => {
      const target = availableThemes[index];
      if (!target) return;
      setHighlightedIndex(index);
      if (target.id !== themeId) setThemeId(target.id);
    },
    [availableThemes, themeId, setThemeId]
  );

  // Close (restoring the opening theme) on outside pointer click
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDownOutside = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        dismiss(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDownOutside);
    document.addEventListener('touchstart', handlePointerDownOutside);
    return () => {
      document.removeEventListener('mousedown', handlePointerDownOutside);
      document.removeEventListener('touchstart', handlePointerDownOutside);
    };
  }, [isOpen, dismiss]);

  // Scroll active option into view when navigating via keyboard
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && optionRefs.current[highlightedIndex]) {
      optionRefs.current[highlightedIndex]?.scrollIntoView({
        block: 'nearest',
      });
    }
  }, [isOpen, highlightedIndex]);

  useEffect(() => {
    const typeahead = typeaheadRef.current;
    return () => {
      if (typeahead.timer) clearTimeout(typeahead.timer);
    };
  }, []);

  /** The next theme whose name starts with what was typed, from the highlighted one on. */
  const findTyped = (char: string): number => {
    const typeahead = typeaheadRef.current;
    if (typeahead.timer) clearTimeout(typeahead.timer);
    typeahead.timer = setTimeout(() => {
      typeahead.text = '';
      typeahead.timer = null;
    }, TYPEAHEAD_RESET_MS);
    typeahead.text += char.toLowerCase();
    // Repeating one letter cycles through the themes starting with it
    const repeated = [...typeahead.text].every((c) => c === typeahead.text[0]);
    const search = repeated ? typeahead.text[0] : typeahead.text;
    const start = isOpen ? highlightedIndex : availableThemes.findIndex((t) => t.id === themeId);
    const count = availableThemes.length;
    for (let step = repeated ? 1 : 0; step <= count; step++) {
      const index = (start + step + count) % count;
      if (availableThemes[index].name.toLowerCase().startsWith(search)) return index;
    }
    return -1;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const isTypeahead =
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      (e.key !== ' ' || typeaheadRef.current.text !== '');
    if (isTypeahead) {
      e.preventDefault();
      const match = findTyped(e.key);
      if (match < 0) return;
      if (!isOpen) openDropdown(match);
      moveTo(match);
      return;
    }

    if (!isOpen) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        openDropdown();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const index = e.key === 'Home' ? 0 : availableThemes.length - 1;
        openDropdown(index);
        moveTo(index);
      }
      return;
    }

    const count = availableThemes.length;
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        moveTo((highlightedIndex + 1) % count);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        moveTo((highlightedIndex - 1 + count) % count);
        break;
      }
      case 'Home': {
        e.preventDefault();
        moveTo(0);
        break;
      }
      case 'End': {
        e.preventDefault();
        moveTo(count - 1);
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < count) {
          handleSelectTheme(availableThemes[highlightedIndex].id);
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        e.stopPropagation();
        dismiss(true);
        break;
      }
      case 'Tab': {
        // Keeps the theme the keyboard moved to, and lets focus move on
        closeDropdown(false);
        break;
      }
      default:
        break;
    }
  };

  return (
    <div ref={containerRef} className={clsx('relative inline-block text-left', className)}>
      {/* Trigger: a select-only combobox */}
      <button
        ref={triggerRef}
        data-testid="app-theme-picker-trigger"
        type="button"
        role="combobox"
        onClick={() => (isOpen ? closeDropdown(false) : openDropdown())}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Select theme"
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        className="px-2 sm:px-2.5 py-1.5 rounded-theme-md bg-theme-surface border border-theme-border/60 hover:border-theme-accent text-theme-text text-xs font-medium transition-all flex items-center gap-1.5 sm:gap-2 shadow-theme-sm min-h-[44px] md:min-h-[36px] focus:outline-none focus:ring-2 focus:ring-theme-accent shrink-0"
      >
        <Palette className="w-3.5 h-3.5 text-theme-accent shrink-0" aria-hidden="true" />

        {/* Current Theme Swatch (Primary & Accent) */}
        <span
          className="flex items-center gap-0.5 sm:gap-1 shrink-0"
          aria-hidden="true"
          data-swatch
        >
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
        <span className="hidden sm:inline font-semibold text-theme-text text-xs truncate max-w-[120px]">
          {theme.name}
        </span>

        <ChevronDown
          className={clsx(
            'hidden sm:block w-3.5 h-3.5 text-theme-text-muted transition-transform duration-150 shrink-0',
            isOpen && 'rotate-180 text-theme-text'
          )}
          aria-hidden="true"
        />
      </button>

      {/* Listbox: always in the DOM, hidden while closed */}
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Available application themes"
        tabIndex={-1}
        hidden={!isOpen}
        onKeyDown={handleKeyDown}
        className="fixed left-3 right-3 top-14 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-80 p-1.5 z-50 bg-theme-surface border border-theme-border rounded-theme-md shadow-theme-lg flex flex-col gap-1 focus:outline-none max-h-[80vh] overflow-y-auto [&[hidden]]:hidden"
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
              // Focus stays on the combobox
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelectTheme(item.id)}
              onMouseEnter={() => setHighlightedIndex(index)}
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
                data-swatch
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
                  {item.id === DEFAULT_APP_THEME_ID && (
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
    </div>
  );
};

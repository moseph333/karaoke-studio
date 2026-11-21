import React, { useCallback, useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';
import { focusRing } from './variants';

const PANEL_STORAGE_PREFIX = 'karaoke_panel_collapsed_';

function readCollapsed(storageKey: string | undefined, fallback: boolean): boolean {
  if (!storageKey) return fallback;
  try {
    const raw = window.localStorage.getItem(PANEL_STORAGE_PREFIX + storageKey);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    // Storage unavailable (private mode / restricted)
  }
  return fallback;
}

export interface PanelProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title?: React.ReactNode;
  titleId?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  headingLevel?: 2 | 3 | 4;
  padding?: 'none' | 'sm' | 'md';
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** Persist collapsed state under this localStorage key. */
  storageKey?: string;
  bodyClassName?: string;
  as?: 'section' | 'div' | 'aside';
}

export const Panel: React.FC<PanelProps> = ({
  title,
  titleId,
  description,
  actions,
  headingLevel = 3,
  padding = 'md',
  collapsible = false,
  defaultCollapsed = false,
  storageKey,
  bodyClassName,
  as = 'section',
  className,
  children,
  ...rest
}) => {
  const autoId = useId().replace(/:/g, '');
  const headingId = titleId ?? `panel-title-${autoId}`;
  const bodyId = `panel-body-${autoId}`;
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    collapsible ? readCollapsed(storageKey, defaultCollapsed) : false
  );

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      if (storageKey) {
        try {
          window.localStorage.setItem(PANEL_STORAGE_PREFIX + storageKey, String(next));
        } catch {
          // ignore persistence failures
        }
      }
      return next;
    });
  }, [storageKey]);

  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const Tag = as;
  // A section sits under a rule and shares the page's margins: it has no box of its own,
  // so only vertical room is added
  const bodyPadding =
    padding === 'none' ? '' : title ? (padding === 'sm' ? 'pb-3' : 'pb-5') : 'py-4';

  const headingContent = (
    <span className="min-w-0">
      <Heading
        id={headingId}
        className="ks-display truncate text-[28px] font-black text-theme-text"
      >
        {title}
      </Heading>
      {description && (
        <span className="mt-0.5 block text-sm text-theme-text-muted">{description}</span>
      )}
    </span>
  );

  return (
    <Tag
      aria-labelledby={title ? headingId : undefined}
      className={cn('border-t-2 border-theme-border', className)}
      {...rest}
    >
      {title && (
        <div className={cn('flex items-center justify-between gap-3 pt-3', !collapsed && 'pb-3')}>
          {collapsible ? (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={!collapsed}
              aria-controls={bodyId}
              className={cn(
                'group -m-1 flex min-h-[44px] md:min-h-[36px] min-w-0 flex-1 items-center justify-between gap-2 p-1 text-left',
                focusRing
              )}
            >
              {headingContent}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'h-4 w-4 shrink-0 text-theme-text-muted transition-transform duration-200 group-hover:text-theme-text',
                  collapsed && '-rotate-90'
                )}
              />
            </button>
          ) : (
            headingContent
          )}
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      )}
      <div id={bodyId} hidden={collapsed} className={cn(bodyPadding, bodyClassName)}>
        {children}
      </div>
    </Tag>
  );
};

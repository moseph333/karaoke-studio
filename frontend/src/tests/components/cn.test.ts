import { describe, it, expect } from 'vitest';
import { cn } from '../../utils/cn';

describe('cn() class composition', () => {
  it('keeps custom border width and border color utilities side by side', () => {
    const result = cn('border-theme border-theme-border');
    expect(result.split(' ')).toEqual(
      expect.arrayContaining(['border-theme', 'border-theme-border'])
    );
  });

  it('keeps responsive touch-target variants and dedupes plain conflicts', () => {
    expect(cn('min-h-[44px] md:min-h-[36px]')).toBe('min-h-[44px] md:min-h-[36px]');
    expect(cn('px-3 px-4')).toBe('px-4');
  });

  it('distinguishes theme text colors from font sizes', () => {
    const result = cn('text-sm text-theme-text-muted');
    expect(result.split(' ')).toEqual(expect.arrayContaining(['text-sm', 'text-theme-text-muted']));
  });

  it('dedupes theme font families', () => {
    expect(cn('font-theme-body font-theme-heading')).toBe('font-theme-heading');
  });

  it('supports conditional class lists', () => {
    expect(cn('a', false && 'b', null, undefined, { c: true, d: false })).toBe('a c');
  });
});

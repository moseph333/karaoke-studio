/** @type {import('tailwindcss').Config} */
import containerQueries from '@tailwindcss/container-queries';

// Theme colors resolve through space-separated RGB channel variables so Tailwind
// opacity modifiers (e.g. `bg-theme-accent/20`) generate valid CSS.
const channel = (name) => `rgb(var(--theme-${name}-rgb) / <alpha-value>)`;

const THEME_COLOR_TOKENS = [
  'bg',
  'surface',
  'surface-subtle',
  'surface-raised',
  'border',
  'border-subtle',
  'text',
  'text-muted',
  'text-inverse',
  'accent',
  'accent-hover',
  'accent-text',
  'secondary',
  'highlight',
  'sung',
  'unsung',
  'success',
  'warning',
  'danger',
  'info',
  'focus',
  'overlay',
];

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      screens: {
        // Desktop viewports tall enough for the single-screen studio layout
        studio: { raw: '(min-width: 768px) and (min-height: 640px)' },
      },
      colors: {
        theme: Object.fromEntries(THEME_COLOR_TOKENS.map((token) => [token, channel(token)])),
      },
      backgroundImage: {
        'gradient-accent': 'var(--theme-gradient-accent)',
        'gradient-stage': 'var(--theme-gradient-stage)',
      },
      borderRadius: {
        'theme-sm': 'var(--theme-radius-sm)',
        'theme-md': 'var(--theme-radius-md)',
        'theme-lg': 'var(--theme-radius-lg)',
        'theme-xl': 'var(--theme-radius-xl)',
        'theme-pill': 'var(--theme-radius-pill)',
      },
      boxShadow: {
        'theme-sm': 'var(--theme-shadow-sm)',
        'theme-md': 'var(--theme-shadow-md)',
        'theme-lg': 'var(--theme-shadow-lg)',
        'theme-glow': 'var(--theme-shadow-glow)',
      },
      borderWidth: {
        // Plain `border` / `border-t` / `divide-y` follow the active theme's stroke weight.
        DEFAULT: 'var(--theme-border-width, 1px)',
        theme: 'var(--theme-border-width)',
        'theme-thick': 'var(--theme-border-width-thick)',
      },
      fontFamily: {
        display: ['var(--theme-font-display)', 'sans-serif'],
        heading: ['var(--theme-font-heading)', 'sans-serif'],
        body: ['var(--theme-font-body)', 'sans-serif'],
        mono: ['var(--theme-font-mono)', 'monospace'],
        karaoke: ['var(--theme-font-karaoke)', 'sans-serif'],
        'theme-heading': ['var(--theme-font-heading)', 'sans-serif'],
        'theme-body': ['var(--theme-font-body)', 'sans-serif'],
      },
      keyframes: {
        'dialog-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.985)' },
          to: { opacity: '1', transform: 'none' },
        },
        'sheet-in': {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        // Content arriving on a screen (hero, library cards)
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'none' },
        },
        // Home screen lyric preview: a word filling with the sung colour, left to right
        'word-sweep': {
          from: { clipPath: 'inset(0 100% 0 0)' },
          to: { clipPath: 'inset(0 0 0 0)' },
        },
        eq: {
          from: { transform: 'scaleY(0.3)' },
          to: { transform: 'scaleY(1)' },
        },
        'aurora-drift': {
          from: { transform: 'translate3d(-4%, -3%, 0) scale(1)' },
          to: { transform: 'translate3d(4%, 3%, 0) scale(1.12)' },
        },
      },
      animation: {
        'dialog-in': 'dialog-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'sheet-in': 'sheet-in 240ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'fade-in': 'fade-in 160ms ease-out',
        'slide-down': 'slide-down 160ms ease-out',
        'rise-in': 'rise-in 480ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards',
        'word-sweep': 'word-sweep 400ms linear both',
        eq: 'eq 800ms ease-in-out infinite alternate',
        'aurora-drift': 'aurora-drift 14s ease-in-out infinite alternate',
      },
    },
  },
  plugins: [containerQueries],
};

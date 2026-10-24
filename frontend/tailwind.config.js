/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Preserved legacy tokens for backward compatibility
        studio: {
          bg: "#0d0f17",
          card: "#161926",
          border: "#262b40",
          accent: "#06b6d4",
          sung: "#facc15",
          highlight: "#38bdf8",
        },
        // Application-wide theme engine semantic tokens
        theme: {
          bg: "var(--theme-bg)",
          surface: "var(--theme-surface)",
          "surface-subtle": "var(--theme-surface-subtle)",
          "surface-raised": "var(--theme-surface-raised)",
          border: "var(--theme-border)",
          "border-subtle": "var(--theme-border-subtle)",
          text: "var(--theme-text)",
          "text-muted": "var(--theme-text-muted)",
          "text-inverse": "var(--theme-text-inverse)",
          accent: "var(--theme-accent)",
          "accent-hover": "var(--theme-accent-hover)",
          "accent-text": "var(--theme-accent-text)",
          secondary: "var(--theme-secondary)",
          highlight: "var(--theme-highlight)",
          sung: "var(--theme-sung)",
          unsung: "var(--theme-unsung)",
        },
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
        'theme': 'var(--theme-border-width)',
        'theme-thick': 'var(--theme-border-width-thick)',
      },
      fontFamily: {
        'heading': ['var(--theme-font-heading)', 'sans-serif'],
        'body': ['var(--theme-font-body)', 'sans-serif'],
        'mono': ['var(--theme-font-mono)', 'monospace'],
        'karaoke': ['var(--theme-font-karaoke)', 'sans-serif'],
        'theme-heading': ['var(--theme-font-heading)', 'sans-serif'],
        'theme-body': ['var(--theme-font-body)', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

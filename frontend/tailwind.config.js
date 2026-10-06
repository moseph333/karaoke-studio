/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        studio: {
          bg: "#0d0f17",
          card: "#161926",
          border: "#262b40",
          accent: "#06b6d4",
          sung: "#facc15",
          highlight: "#38bdf8",
        }
      }
    },
  },
  plugins: [],
}

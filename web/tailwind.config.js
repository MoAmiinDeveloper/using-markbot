/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        brand: {
          50: '#eef4ff', 100: '#dae6ff', 200: '#bdd3ff', 300: '#90b6ff', 400: '#5c8dfd',
          500: '#3b6af8', 600: '#254bed', 700: '#1d39d9', 800: '#1e31b0', 900: '#1e2f8b', 950: '#171f54',
        },
        ink: {
          950: '#07090e', 900: '#0b0e15', 850: '#10141d', 800: '#151a25', 750: '#1b2130', 700: '#252c3d',
        },
      },
      boxShadow: {
        panel: '0 10px 40px -12px rgb(0 0 0 / 0.35), 0 2px 8px -2px rgb(0 0 0 / 0.15)',
        soft: '0 1px 2px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.08)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in-right': { from: { opacity: '0', transform: 'translateX(16px)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in-left': { from: { opacity: '0', transform: 'translateX(-16px)' }, to: { opacity: '1', transform: 'none' } },
        pulse_ring: { '0%': { transform: 'scale(0.8)', opacity: '0.7' }, '100%': { transform: 'scale(2.2)', opacity: '0' } },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-up': 'slide-up 200ms ease-out',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(.2,.8,.2,1)',
        'slide-in-left': 'slide-in-left 220ms cubic-bezier(.2,.8,.2,1)',
        'pulse-ring': 'pulse_ring 1.6s cubic-bezier(.2,.6,.4,1) infinite',
      },
    },
  },
  plugins: [],
}

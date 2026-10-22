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
          // Somtel gold (primary #FFD700)
          50: '#fffbe5', 100: '#fff5bf', 200: '#ffec85', 300: '#ffe24d', 400: '#ffdb1f',
          500: '#ffd700', 600: '#e6c200', 700: '#b89b00', 800: '#8a7400', 900: '#5c4d00', 950: '#332b00',
        },
        navy: {
          // Somtel navy (secondary #222D5D = 700)
          50: '#eef0f8', 100: '#d9ddef', 200: '#b5bce0', 300: '#8a95c9', 400: '#5f6dae',
          500: '#414f8f', 600: '#2f3c75', 700: '#222d5d', 800: '#1b2449', 900: '#141b37', 950: '#0c1124',
        },
        ink: {
          // dark-mode surfaces, tinted with the brand navy
          950: '#070a17', 900: '#0b1022', 850: '#10162c', 800: '#141b36', 750: '#1a2241', 700: '#232c52',
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

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // One accent, used for "this is the system's own reasoning". Everything
        // else is slate, so the explanation UI reads as data rather than decoration.
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d4d9e2',
          300: '#aeb7c8',
          400: '#8290a9',
          500: '#61708c',
          600: '#4c5972',
          700: '#3e485c',
          800: '#353d4e',
          900: '#1e2430',
          950: '#12161e',
        },
        accent: {
          50: '#eef4ff',
          100: '#dae6ff',
          200: '#bdd3ff',
          300: '#90b6ff',
          400: '#5b8dff',
          500: '#3565f5',
          600: '#2148e2',
          700: '#1c39b6',
          800: '#1c3392',
          900: '#1c2e74',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.25s ease-out',
        'slide-in': 'slide-in 0.22s ease-out',
      },
    },
  },
  plugins: [],
}

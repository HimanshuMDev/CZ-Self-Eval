/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background:     '#F5F5F7',
        surface:        '#FFFFFF',
        primary:        '#F97316',
        'primary-dark': '#EA580C',
        'primary-light':'#FFF7ED',
        secondary:      '#10B981',
        accent:         '#F59E0B',
        border:         '#E2E8F0',
        muted:          '#94A3B8',
      },
      fontFamily: {
        sans: ['"Inter"', '"Outfit"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'card':    '0 1px 4px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-md': '0 4px 16px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.04)',
        'card-lg': '0 8px 32px rgba(0,0,0,0.08), 0 4px 8px rgba(0,0,0,0.04)',
        'orange':  '0 4px 14px rgba(249,115,22,0.22)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 0.18s ease-out',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0', transform: 'translateY(4px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}

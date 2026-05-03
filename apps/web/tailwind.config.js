/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Dark platform palette ─────────────────────────────────────────
        // Gray remapped dark-first: gray-900 = near-white text, gray-50 = near bg
        gray: {
          50:  '#0c0c18',
          100: '#11111e',
          200: '#18182a',
          300: '#22223a',
          400: '#4a4a6a',
          500: '#6a6a90',
          600: '#9090b4',
          700: '#b0b0cc',
          800: '#ccccdf',
          900: '#eeeef8',
        },
        // Violet — primary accent
        violet: {
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
        },
        sky: { 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7' },
        green:   { 50:'#052e16', 100:'#14532d', 400:'#4ade80', 500:'#22c55e', 600:'#16a34a', 700:'#15803d' },
        red:     { 50:'#2d0a0a', 100:'#450a0a', 400:'#f87171', 500:'#ef4444', 600:'#dc2626', 700:'#b91c1c' },
        yellow:  { 50:'#1c1500', 100:'#2d2000', 400:'#facc15', 500:'#eab308', 600:'#ca8a04', 700:'#a16207' },
        amber:   { 50:'#1c1200', 100:'#2d1f00', 200:'#3d2800', 400:'#fbbf24', 500:'#f59e0b', 600:'#d97706' },
        emerald: { 400:'#34d399', 500:'#10b981', 600:'#059669' },
      },
      backgroundImage: {
        'glow-violet': 'radial-gradient(ellipse 80% 50% at 50% -5%, rgba(124,58,237,0.20), transparent)',
        'glow-indigo':  'radial-gradient(ellipse 60% 40% at 85% 115%, rgba(99,102,241,0.10), transparent)',
        'glass-shine':  'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 100%)',
      },
      boxShadow: {
        glass:       '0 4px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
        'glass-lg':  '0 8px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
        'glow-violet':'0 0 24px rgba(124,58,237,0.40)',
        'glow-sm':    '0 0 10px rgba(124,58,237,0.22)',
      },
      animation: {
        'fade-in': 'fadeIn 0.18s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

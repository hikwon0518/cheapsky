import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Light palette (Cheapsky Light v5, 2026-04-19). globals.css 의 CSS 변수와 동일.
        page: '#fafaf9',
        card: '#ffffff',
        hero: '#ffffff',
        filter: '#ffffff',
        surface: '#ffffff',
        'surface-2': '#f6f6f4',
        'surface-3': '#efeee9',
        ink: {
          DEFAULT: '#0b0b0c',
          2: '#2a2a2c',
          3: '#5c5c5f',
          4: '#8a8a8d',
          5: '#b4b2ac',
        },
        line: {
          DEFAULT: '#ececE7',
          2: '#dedcd6',
        },
        'border-subtle': '#ececE7',
        accent: '#0a66ff',
        low: {
          DEFAULT: '#0b7a3b',
          soft: '#e8f2ea',
          line: '#cfe4d4',
        },
        hot: {
          DEFAULT: '#b8330e',
          soft: '#fbe7df',
          line: '#f0c6b4',
        },
        warn: {
          DEFAULT: '#a55509',
          soft: '#faead3',
          line: '#efd3a7',
        },
        up: {
          DEFAULT: '#9a1b1b',
          soft: '#fbe3e3',
          line: '#efc7c7',
        },
      },
      fontFamily: {
        pretendard: ['Pretendard Variable', 'Pretendard', 'system-ui', 'sans-serif'],
        inter: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 220ms ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(2px)' },
          '100%': { opacity: '1', transform: 'none' },
        },
      },
    },
  },
  plugins: [],
};

export default config;

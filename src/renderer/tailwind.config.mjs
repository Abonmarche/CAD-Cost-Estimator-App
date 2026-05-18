import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Tailwind resolves `content` globs against process.cwd(), which under
// electron-vite is the repo root (not the renderer root). Anchor the
// globs to this config file's directory so the build is invariant to
// where it's invoked from. Forward-slash everything for fast-glob on
// Windows.
const here = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    `${here}/index.html`,
    `${here}/src/**/*.{ts,tsx}`,
  ],
  theme: {
    extend: {
      colors: {
        navy: '#0B2545',
        sapphire: '#13478B',
        charcoal: '#2C3E50',
        slate: {
          DEFAULT: '#7F8C8D',
          400: '#9AA5A7',
        },
        cloud: '#EBF0F6',
        light: '#F8F9FA',
        success: '#27AE60',
        danger: '#C0392B',
        amber: {
          DEFAULT: '#E67E22',
          50: '#FFF4E6',
          100: '#FCE3C7',
          600: '#B05D11',
        },
        gold: '#F1C40F',
        brand: '#C40D3C',

        // Preset accent palette — used for the 4px left border on
        // library cards and pay item rows. Keys must match the
        // `accent` field in PRESETS.
        accent: {
          sky: '#38BDF8',
          amber: '#D97706',
          slate: '#94A3B8',
          rose: '#FB7185',
          charcoal: '#475569',
          zinc: '#A1A1AA',
          cloud: '#CBD5E1',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'DM Sans',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      backgroundImage: {
        'page-hero':
          'linear-gradient(180deg, #EBF0F6 0%, #F8F9FA 100%)',
      },
      boxShadow: {
        card: '0 1px 2px rgba(11, 37, 69, 0.04), 0 1px 3px rgba(11, 37, 69, 0.06)',
        elevated:
          '0 10px 30px rgba(11, 37, 69, 0.08), 0 2px 6px rgba(11, 37, 69, 0.05)',
      },
      keyframes: {
        rowFadeIn: {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        spin: {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        rowFadeIn: 'rowFadeIn 160ms ease-out',
        spin: 'spin 1s linear infinite',
      },
    },
  },
  plugins: [],
};

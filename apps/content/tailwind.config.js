import { createPreset } from 'fumadocs-ui/tailwind-plugin'
import theme from 'tailwindcss/defaultTheme'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './content/**/*.{md,mdx}',
    './mdx-components.{ts,tsx}',
    './node_modules/fumadocs-ui/dist/**/*.js',
  ],
  presets: [
    createPreset({
      preset: 'catppuccin',
      addGlobalColors: true,
    }),
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-geist-sans)', ...theme.fontFamily.sans],
        mono: ['var(--font-geist-mono)', ...theme.fontFamily.mono],
      },
    },
  },
}

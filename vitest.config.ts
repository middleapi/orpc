import process from 'node:process'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { loadEnv } from 'vite'
import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => ({
  test: {
    env: loadEnv(mode, process.cwd(), ''),
    projects: [
      {
        test: {
          globals: true,
          setupFiles: ['./vitest.javascript.ts'],
          include: ['**/*.test.ts'],
        },
      },
      {
        test: {
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./vitest.javascript.ts', './vitest.jsdom.ts'],
          include: [
            './packages/react/**/*.test.tsx',
            './packages/react-query/**/*.test.tsx',
            './packages/react-swr/**/*.test.tsx',
            './packages/tanstack-query/**/*.test.tsx',
            './packages/vue-colada/**/*.test.tsx',
            './packages/vue-query/**/*.test.tsx',
          ],
        },
      },
      {
        test: {
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./vitest.javascript.ts', './vitest.jsdom.ts'],
          include: [
            './packages/solid-query/**/*.test.tsx',
          ],
          deps: {
            inline: [/solid-js/, /@solidjs\/testing-library/],
          },
        },
        plugins: [solid()],
        resolve: {
          conditions: ['development', 'browser'],
        },
      },
      {
        test: {
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./vitest.javascript.ts', './vitest.jsdom.ts'],
          include: [
            './packages/svelte-query/**/*.test.tsx',
          ],
          deps: {
            inline: [/svelte/, /@testing-library\/svelte /],
          },
        },
        plugins: [svelte(), svelteTesting()],
        resolve: {
          conditions: ['development', 'browser'],
        },
      },
    ],
  },
}))

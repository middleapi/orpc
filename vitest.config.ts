import process from 'node:process'
import { loadEnv } from 'vite'
import { defaultExclude, defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => ({
  test: {
    env: loadEnv(mode, process.cwd(), ''),
    coverage: {
      include: ['packages/*/src/**'],
      exclude: ['**.bench.*', '**.test-d.*', '**.test.*', './packages/bun/**', './packages/cloudflare/**'],
    },
    projects: [
      {
        test: {
          globals: true,
          setupFiles: ['./vitest.javascript.ts'],
          include: ['**/*.test.ts'],
          exclude: [...defaultExclude, './packages/bun/**', './packages/cloudflare/**'],
        },
      },
      {
        test: {
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./vitest.javascript.ts', './vitest.jsdom.ts'],
          include: [
            './packages/next/**/*.test.tsx',
            './packages/tanstack-query/**/*.test.tsx',
            './packages/pinia-colada/**/*.test.tsx',
          ],
        },
      },
    ],
  },
}))

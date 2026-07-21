import process from 'node:process'
import codspeedPlugin from '@codspeed/vitest-plugin'
import { loadEnv } from 'vite'
import { defaultExclude, defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => ({
  test: {
    env: loadEnv(mode, process.cwd(), ''),
    coverage: {
      include: ['packages/*/src/**'],
      exclude: [
        '**.bench.*',
        '**.test-d.*',
        '**.test.*',
        './packages/bun/**',
        './packages/cloudflare/**',
      ],
    },
    projects: [
      {
        plugins: [codspeedPlugin()],
        test: {
          globals: true,
          exclude: ['**/**'],
          benchmark: {
            include: ['**/*.bench.ts'],
            exclude: [...defaultExclude, '**/.claude/**'],
          },
        },
      },
      {
        test: {
          globals: true,
          setupFiles: ['./vitest.javascript.ts'],
          include: ['**/*.test.ts'],
          exclude: [...defaultExclude, '**/.claude/**', './packages/bun/**', './packages/cloudflare/**'],
          benchmark: {
            exclude: ['**/**'],
          },
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
          benchmark: {
            exclude: ['**/**'],
          },
        },
      },
    ],
  },
}))

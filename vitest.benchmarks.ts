import codspeedPlugin from '@codspeed/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [codspeedPlugin()],
  test: {
    globals: true,
    include: ['packages/*/benches/**/*.bench.ts'],
  },
})

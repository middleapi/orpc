import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts', './src/plugins/index.ts', './src/adapters/*/index.ts'],
})

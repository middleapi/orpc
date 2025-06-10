import { defineConfig } from 'tsdown'

export default defineConfig({
  workspace: { include: ['packages/*'] },
  entry: ['./src/index.ts'],
  dts: true,
  fixedExtension: true,
})

import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    { input: 'dist/main.js', outDir: 'dist/unbuild', name: 'main' },
  ],
  failOnWarn: false,
  clean: false,
  rollup: {
    esbuild: {
      tsconfigRaw: {
        compilerOptions: {
          experimentalDecorators: true,
        },
      },
    },
  },
})

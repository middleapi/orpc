import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    { input: 'dist/src/main.js', name: 'main' },
  ],
  failOnWarn: false,
  clean: false,
})

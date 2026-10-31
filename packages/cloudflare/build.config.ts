import { defineBuildConfig } from 'obuild/config'
import { isTestFile, verifyDist } from '../../scripts/build-utils'

export default defineBuildConfig({
  entries: [
    {
      type: 'transform',
      input: './src',
      outDir: './dist',
      filter: file => !isTestFile(file),
    },
  ],
  hooks: {
    end: ctx => verifyDist(ctx, ['cloudflare:workers']),
  },
})

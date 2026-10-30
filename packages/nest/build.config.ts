import { defineBuildConfig } from 'obuild/config'
import { isTestFile, verifyDist } from '../../scripts/build-utils'

export default defineBuildConfig({
  entries: [
    {
      type: 'transform',
      input: './src',
      outDir: './dist',
      filter: file => !isTestFile(file),
      oxc: {
        decorator: {
          legacy: true,
        },
      },
    },
  ],
  hooks: {
    end: verifyDist,
  },
})

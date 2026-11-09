// Generates the document of the `router` the file of the first argument exports, see
// `generateWithin`
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { stringifyJSON } from '@orpc/shared'

import { OpenAPIGenerator } from '../src/openapi-generator'

const file = process.argv[2]!
const { router } = await import(pathToFileURL(file).href)

let result: object

try {
  result = { spec: await new OpenAPIGenerator().generate(router, { source: { file } }) }
} catch (error) {
  result = { error: (error as Error).message }
}

// the compiler process would keep it running
process.stdout.write(stringifyJSON(result) ?? '{}', () => process.exit(0))

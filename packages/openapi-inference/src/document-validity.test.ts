import type { OpenAPIVersion } from '@orpc/openapi'
import type { AnyRouter } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { validate } from '@scalar/openapi-parser'
import { Ajv2020 } from 'ajv/dist/2020.js'

import { router as bunRouter } from '../../../playgrounds/bun/src/routers/index'
import { builtinTypes } from '../tests/fixtures/app/src/builtin-types'
import { router as detailedRouter } from '../tests/fixtures/app/src/detailed'
import { router as headersRouter } from '../tests/fixtures/app/src/headers'
import { roundTwentySix } from '../tests/fixtures/app/src/round26'
import { roundSixtyEight } from '../tests/fixtures/app/src/round68'
import { roundSeventyNine } from '../tests/fixtures/app/src/round79'
import { router } from '../tests/fixtures/app/src/router'
import type { OpenAPIGeneratorOptions } from './openapi-generator'
import { OpenAPIGenerator } from './openapi-generator'

// the documents of the `app` fixture are generated from one compiler, started once
const projects = vi.hoisted(() => ({ close: () => {} }))
vi.mock('./project', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./project')>()
  const { shareProjects } = await import('../tests/shared-project')
  const shared = shareProjects(
    actual.openTypeScriptProject,
    new URL('../tests/fixtures/app/src/', import.meta.url),
  )
  projects.close = shared.close
  return { ...actual, openTypeScriptProject: shared.open }
})
afterAll(() => projects.close())

const fixture = (file: string) => new URL(`../tests/fixtures/app/src/${file}`, import.meta.url)

/**
 * Routers with built-ins, tuples, files, event streams, detailed inputs and outputs, headers,
 * parameters of any value, and a real application.
 */
const ROUTERS: [name: string, router: AnyRouter, file: URL, exportName: string][] = [
  ['router', router, fixture('router.ts'), 'router'],
  ['built-in types', builtinTypes, fixture('builtin-types.ts'), 'builtinTypes'],
  ['detailed', detailedRouter, fixture('detailed.ts'), 'router'],
  ['headers', headersRouter, fixture('headers.ts'), 'router'],
  ['deep views', roundTwentySix, fixture('round26.ts'), 'roundTwentySix'],
  ['loose parameters', roundSixtyEight, fixture('round68.ts'), 'roundSixtyEight'],
  ['detailed bodies', roundSeventyNine, fixture('round79.ts'), 'roundSeventyNine'],
  [
    'bun playground',
    bunRouter,
    new URL('../../../playgrounds/bun/src/routers/index.ts', import.meta.url),
    'router',
  ],
]

const VERSIONS: OpenAPIVersion[] = ['3.2.0', '3.1.1', '3.0.4']

const OPTIONS: [name: string, options: OpenAPIGeneratorOptions][] = [
  ['named defs', {}],
  ['recursive defs, with zod', { defs: 'recursive', converters: [new ZodToJsonSchemaConverter()] }],
]

const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false })

/**
 * The Schema Objects of a document: the components and the schemas of media types, parameters,
 * and headers (a property named `schema` of a Schema Object is a schema as well).
 */
function collectSchemas(doc: any): [pointer: string, schema: unknown][] {
  const schemas: [string, unknown][] = Object.entries(doc.components?.schemas ?? {}).map(
    ([name, schema]) => [`/components/schemas/${name}`, schema],
  )
  const walk = (value: unknown, pointer: string) => {
    if (typeof value !== 'object' || value === null) {
      return
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === 'schema' || key === 'itemSchema') {
        schemas.push([`${pointer}/${key}`, item])
      } else if (pointer !== '/components' || key !== 'schemas') {
        walk(item, `${pointer}/${key}`)
      }
    }
  }
  walk(doc, '')
  return schemas
}

/** The errors of a document, by `@scalar/openapi-parser` and the JSON Schema dialect of its version */
async function validateDocument(doc: unknown): Promise<string[]> {
  const result = await validate(JSON.parse(JSON.stringify(doc)))
  const errors = (result.errors ?? []).map(
    (e) => `${[e.path ?? []].flat().join('/')}: ${e.message}`,
  )

  // OpenAPI 3.1 and 3.2 Schema Objects are JSON Schema 2020-12, which the validator does not check
  // (3.0 Schema Objects are part of its OpenAPI 3.0 schema)
  if (!(doc as any).openapi.startsWith('3.0.')) {
    for (const [pointer, schema] of collectSchemas(doc)) {
      if (!ajv.validateSchema(schema as object)) {
        errors.push(`${pointer}: ${ajv.errorsText(ajv.errors)}`)
      }
    }

    const local = (schema: unknown) =>
      JSON.parse(JSON.stringify(schema).replaceAll('"#/components/schemas/', '"spec#/$defs/'))
    const compiler = new Ajv2020({ strict: false, logger: false })
    try {
      compiler.addSchema(local({ $id: 'spec', $defs: (doc as any).components?.schemas ?? {} }))
      for (const [, schema] of collectSchemas(doc)) {
        compiler.compile(local(schema))
      }
    } catch (error) {
      errors.push(`compile: ${(error as Error).message}`)
    }
  }

  return errors
}

describe('generated documents are valid OpenAPI documents', () => {
  describe.each(OPTIONS)('%s', (_, options) => {
    const generator = new OpenAPIGenerator(options)

    describe.each(ROUTERS)('%s', (_, router, file, exportName) => {
      it.each(VERSIONS)('in %s', async (version) => {
        const doc = await generator.generate(router, {
          version,
          source: { file, export: exportName },
        })

        expect(doc.openapi).toBe(version)
        expect(await validateDocument(doc)).toEqual([])
      })
    })
  })

  it.each([
    // 3.0 has no type arrays
    ['3.0.4', { type: ['string', 'null'] }],
    ['3.1.1', { type: 'nul' }],
    ['3.2.0', { minLength: 'one' }],
  ] as const)('rejects an invalid schema in %s', async (version, schema) => {
    const doc = {
      openapi: version,
      info: { title: 'API', version: '1.0.0' },
      paths: {
        '/planets': {
          get: {
            responses: {
              200: { description: 'OK', content: { 'application/json': { schema } } },
            },
          },
        },
      },
    }

    expect(await validateDocument(doc)).not.toEqual([])
  })
})

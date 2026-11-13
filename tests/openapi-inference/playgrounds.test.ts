import { ProcedureContract } from '@orpc/contract'
import type { OpenAPIGeneratorOptions } from '@orpc/experimental-openapi-inference'
import { OpenAPIGenerator } from '@orpc/experimental-openapi-inference'
import type { OpenAPIVersion } from '@orpc/openapi'
import { OpenAPIGenerator as BaseOpenAPIGenerator } from '@orpc/openapi'
import { walkProcedureContractsAsync } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { validate } from '@scalar/openapi-parser'
import { Ajv2020 } from 'ajv/dist/2020.js'

import { router as bunRouter } from '../../playgrounds/bun/src/routers/index'
import { router as cloudflareRouter } from '../../playgrounds/cloudflare/worker/routers/index'
import { contract as nestContract } from '../../playgrounds/nest/src/contracts/index'

const PLAYGROUNDS = [
  ['bun', bunRouter, '../../playgrounds/bun/src/routers/index.ts', 'router'],
  [
    'cloudflare',
    cloudflareRouter,
    '../../playgrounds/cloudflare/worker/routers/index.ts',
    'router',
  ],
  // contract-first, in a Node project without the DOM library (zod's `File` extends the Node one)
  ['nest', nestContract, '../../playgrounds/nest/src/contracts/index.ts', 'contract'],
] as const

/**
 * Real routers (the playgrounds, with `@/` paths, zod, files, errors, and event streams):
 * with every runtime schema removed, inference must produce the same operations as the zod schemas.
 * Only what exists at runtime alone differs, like `format: uuid` or `minLength`.
 */
describe.each(PLAYGROUNDS)('%s playground', async (_, router, file, exportName) => {
  const fromZod = await new BaseOpenAPIGenerator({
    converters: [new ZodToJsonSchemaConverter()],
  }).generate(router)

  const withoutSchemas: Record<string, any> = {}
  await walkProcedureContractsAsync(router, (contract, path) => {
    const def = contract['~orpc']
    let target = withoutSchemas
    for (const segment of path.slice(0, -1)) {
      target = target[segment] ??= {}
    }
    target[path.at(-1)!] = new ProcedureContract({
      ...def,
      inputSchemas: undefined,
      outputSchemas: undefined,
      errorMap: Object.fromEntries(
        Object.entries(def.errorMap).map(([code, config]) => [
          code,
          { ...(config as object), data: undefined },
        ]),
      ),
    })
  })

  const fromTypes = await new OpenAPIGenerator().generate(withoutSchemas, {
    source: { file: new URL(file, import.meta.url), export: exportName },
  })

  const resolve = (doc: any, schema: any) =>
    schema.$ref ? doc.components.schemas[schema.$ref.split('/').at(-1)] : schema

  const shape = (doc: any) =>
    Object.fromEntries(
      Object.entries(doc.paths).flatMap(([path, item]: [string, any]) =>
        Object.entries(item).map(([method, operation]: [string, any]) => [
          `${method.toUpperCase()} ${path}`,
          {
            parameters: (operation.parameters ?? []).map((p: any) => [
              p.in,
              p.name,
              p.required ?? false,
            ]),
            requestBody: operation.requestBody && {
              required: operation.requestBody.required ?? false,
              contentTypes: Object.keys(operation.requestBody.content),
              properties: Object.keys(
                resolve(doc, Object.values<any>(operation.requestBody.content)[0].schema)
                  .properties ?? {},
              ),
            },
            responses: Object.fromEntries(
              Object.entries(operation.responses).map(([status, response]: [string, any]) => [
                status,
                Object.keys(response.content ?? {}),
              ]),
            ),
          },
        ]),
      ),
    )

  it('documents the same operations as the zod schemas', () => {
    expect(shape(fromTypes)).toEqual(shape(fromZod))
  })

  it('infers the same response bodies, without the runtime-only constraints', () => {
    const planet = (doc: any) =>
      doc.paths['/planets'].get.responses['200'].content['application/json'].schema

    const strip = (schema: any): any =>
      JSON.parse(
        JSON.stringify(schema, (key, value) =>
          ['format', 'pattern', 'additionalProperties'].includes(key) ? undefined : value,
        ),
      )

    const zodItem = resolve(fromZod, planet(fromZod).items)
    const typesItem = resolve(fromTypes, planet(fromTypes).items)

    expect(strip(typesItem)).toEqual(strip(zodItem))
  })
})

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

describe.each(OPTIONS)('the documents of the bun playground, with %s', (_, options) => {
  const generator = new OpenAPIGenerator(options)

  it.each(VERSIONS)('are valid OpenAPI documents in %s', async (version) => {
    const doc = await generator.generate(bunRouter, {
      version,
      source: { file: new URL(PLAYGROUNDS[0][2], import.meta.url), export: 'router' },
    })

    expect(doc.openapi).toBe(version)
    expect(await validateDocument(doc)).toEqual([])
  })
})

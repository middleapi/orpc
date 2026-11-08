import { ProcedureContract } from '@orpc/contract'
import { OpenAPIGenerator } from '@orpc/openapi'
import { walkProcedureContractsAsync } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'

import { router as bunRouter } from '../../../playgrounds/bun/src/routers/index.ts'
import { router as cloudflareRouter } from '../../../playgrounds/cloudflare/worker/routers/index.ts'
import { contract as nestContract } from '../../../playgrounds/nest/src/contracts/index.ts'
import { TypeScriptOpenAPIGenerator } from './openapi-generator.ts'

const PLAYGROUNDS = [
  ['bun', bunRouter, '../../../playgrounds/bun/src/routers/index.ts', 'router'],
  [
    'cloudflare',
    cloudflareRouter,
    '../../../playgrounds/cloudflare/worker/routers/index.ts',
    'router',
  ],
  // contract-first, in a Node project without the DOM library (zod's `File` extends the Node one)
  ['nest', nestContract, '../../../playgrounds/nest/src/contracts/index.ts', 'contract'],
] as const

/**
 * Real routers (the playgrounds, with `@/` paths, zod, files, errors, and event streams):
 * with every runtime schema removed, inference must produce the same operations as the zod schemas.
 * Only what exists at runtime alone differs, like `format: uuid` or `minLength`.
 */
describe.each(PLAYGROUNDS)('%s playground', async (_, router, file, exportName) => {
  const fromZod = await new OpenAPIGenerator({
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

  const fromTypes = await new TypeScriptOpenAPIGenerator().generate(withoutSchemas, {
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

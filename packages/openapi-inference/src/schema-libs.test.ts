import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { OpenAPIHandler, OpenAPILink } from '@orpc/openapi/fetch'
import { call } from '@orpc/server'
import { Ajv2020 } from 'ajv/dist/2020.js'

import { router, samples } from '../tests/fixtures/app/src/schema-libs'
import { OpenAPIGenerator } from './openapi-generator'

/**
 * Types of Zod, Valibot, and ArkType schemas used without their converters (`z.infer`,
 * `v.InferInput`, `T['infer']`): what handlers return and clients send match the schemas.
 */
describe('types of schema libraries', async () => {
  const spec: any = JSON.parse(
    JSON.stringify(
      await new OpenAPIGenerator().generate(router, {
        source: { file: new URL('../tests/fixtures/app/src/schema-libs.ts', import.meta.url) },
      }),
    ),
  )
  const local = (schema: unknown) =>
    JSON.parse(JSON.stringify(schema).replaceAll('#/components/schemas/', 'spec#/$defs/'))
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  ajv.addSchema(local({ $id: 'spec', $defs: spec.components?.schemas ?? {} }))
  const errors = (schema: unknown, value: unknown) => {
    const validate = ajv.compile(local(schema))
    return validate(value) ? [] : [value, validate.errors]
  }

  const serializer = new OpenAPIJsonSerializer()
  const handler = new OpenAPIHandler(router)
  let sent: Request | undefined
  const link = new OpenAPILink(router, {
    origin: 'http://localhost',
    url: '/',
    fetch: async (request, init) => {
      sent = new Request(request, init)
      return (await handler.handle(sent.clone())).response!
    },
  })

  const operation = (path: string) => spec.paths[`/${path}`].post

  it.each(Object.keys(samples))('%s', async (name) => {
    const { schema, sample } = samples[name]!
    const parsed = ((await schema['~standard'].validate(sample())) as any).value
    const procedures: any = name.split('/').reduce((r: any, key) => r[key], router)

    const output = await call(procedures.output, undefined)
    const { content } = operation(`${name}/output`).responses['200']
    if (output instanceof Blob) {
      expect(content['*/*']).toBeDefined()
    } else {
      const json = JSON.parse(JSON.stringify(serializer.serializeJson(output).json) ?? 'null')
      expect(errors(content['application/json'].schema, json)).toEqual([])
    }

    for (const [path, value] of [
      ['input', sample()],
      ['parsed', parsed],
    ] as const) {
      await expect(link.call([...name.split('/'), path], value, { context: {} })).resolves.toBe(1)
      const body = operation(`${name}/${path}`).requestBody.content
      if (value instanceof Blob) {
        expect(body['*/*']).toBeDefined()
      } else {
        expect(errors(body['application/json'].schema, await sent!.json())).toEqual([])
      }
    }
  })

  const output = (path: string) =>
    operation(`${path}/output`).responses['200'].content['application/json'].schema
  const input = (path: string) =>
    operation(`${path}/input`).requestBody.content['application/json'].schema

  it('documents inputs before and outputs after transforms and defaults', () => {
    expect(input('zod/transforms').properties).toMatchObject({
      transform: { type: 'string' },
      preprocess: {},
      coerce: {},
      stringbool: { type: 'string' },
    })
    expect(output('zod/transforms').properties).toMatchObject({
      transform: { type: 'number' },
      coerce: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
      stringbool: { type: 'boolean' },
      codec: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
    })
    expect(input('zod/modifiers').required).not.toContain('default')
    expect(output('zod/modifiers').required).toContain('default')
    expect(input('arktype/morphs').properties.number).toEqual({ type: 'string' })
    expect(output('arktype/morphs').properties.number).toEqual({ type: 'number' })
  })

  it('leaves out what JSON drops and the keys of brands', () => {
    expect(output('zod/natives').required).not.toContain('symbol')
    expect(output('zod/natives').required).not.toContain('undefined')
    expect(output('arktype/brandedObject')).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    })
  })
})

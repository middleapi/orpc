import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { OpenAPIHandler, OpenAPILink } from '@orpc/openapi/fetch'
import { call } from '@orpc/server'
import { Ajv } from 'ajv'
import { Ajv2020 } from 'ajv/dist/2020.js'

import { router, sent } from '../tests/fixtures/app/src/effect-types'
import { OpenAPIGenerator } from './openapi-generator'

const cases = Object.entries(router).flatMap(([group, procedures]) =>
  Object.keys(procedures).map((name) => `${group}/${name}`),
)

/**
 * Types of Effect schemas used without a converter (`S['Type']` returned, `S['Encoded']` sent)
 * and Effect data types: what handlers return and clients send match the documents.
 */
describe.each(['3.2.0', '3.0.4'] as const)('effect types in OpenAPI %s', async (version) => {
  const spec: any = JSON.parse(
    JSON.stringify(
      await new OpenAPIGenerator().generate(router, {
        source: { file: new URL('../tests/fixtures/app/src/effect-types.ts', import.meta.url) },
        version,
      }),
    ),
  )
  const local = (schema: unknown) =>
    JSON.parse(JSON.stringify(schema).replaceAll('#/components/schemas/', 'spec#/$defs/'))
  // Ajv reads `nullable` of OpenAPI 3.0
  const ajv =
    version === '3.0.4'
      ? new Ajv({ strict: false, allErrors: true })
      : new Ajv2020({ strict: false, allErrors: true })
  ajv.addSchema(local({ $id: 'spec', $defs: spec.components?.schemas ?? {} }))
  // `@orpc/openapi` documents no content for any value
  const errors = (content: any, value: unknown) => {
    if (!content) {
      return []
    }
    const validate = ajv.compile(local(content['application/json'].schema))
    return validate(value) ? [] : [value, validate.errors]
  }

  const serializer = new OpenAPIJsonSerializer()
  const handler = new OpenAPIHandler(router)
  let body: unknown
  const link = new OpenAPILink(router, {
    origin: 'http://localhost',
    url: '/',
    fetch: async (request, init) => {
      const handled = new Request(request, init)
      body = await handled.clone().json()
      return (await handler.handle(handled)).response!
    },
  })
  const operation = (path: string) => spec.paths[`/${path}`].post

  it.each(cases)('%s', async (name) => {
    const procedures: any = name.split('/').reduce((r: any, key) => r[key], router)

    const output = await call(procedures.output, undefined)
    const json = JSON.parse(JSON.stringify(serializer.serializeJson(output).json) ?? 'null')
    const content = operation(`${name}/output`).responses['200'].content
    expect(errors(Object.keys(content).length ? content : undefined, json)).toEqual([])

    const input = sent.get(procedures.input)!()
    await expect(link.call([...name.split('/'), 'input'], input, { context: {} })).resolves.toBe(1)
    expect(errors(operation(`${name}/input`).requestBody?.content, body)).toEqual([])
  })

  const output = (path: string) =>
    operation(`${path}/output`).responses['200'].content['application/json'].schema
  const input = (path: string) =>
    operation(`${path}/input`).requestBody.content['application/json'].schema

  it('documents schema classes by their fields, encoded in inputs', () => {
    expect(spec.components.schemas.Person).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        born: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
      },
      required: ['name', 'born'],
    })
    expect(input('schema/person').properties.born).toEqual({ type: 'string' })
    expect(output('schema/transformations').properties.number).toEqual({ type: 'number' })
    expect(input('schema/transformations').properties.number).toEqual({ type: 'string' })
  })

  it('leaves out Effect brands, and documents values of Effect data types as any value', () => {
    expect(output('schema/brand').properties.account).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    })
    // written by the `toJSON` of their prototypes
    for (const key of ['some', 'none', 'fromNullOr']) {
      expect(output('schema/options').properties[key]).toEqual({})
    }
    expect(output('schema/redacted').properties.redacted).toEqual({})
    expect(output('data/result').properties.success).toEqual({})
    expect(operation('data/chunk/output').responses['200'].content).toEqual({})
    // `OptionFromNullOr` is sent encoded
    expect(input('schema/options').properties.fromNullOr).toEqual(
      version === '3.0.4'
        ? { type: 'string', nullable: true }
        : { anyOf: [{ type: 'string' }, { type: 'null' }] },
    )
  })
})

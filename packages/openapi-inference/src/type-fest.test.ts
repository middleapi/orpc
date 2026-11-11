import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { OpenAPIHandler, OpenAPILink } from '@orpc/openapi/fetch'
import { call } from '@orpc/server'
import { Ajv2020 } from 'ajv/dist/2020.js'

import { typeFest } from '../tests/fixtures/app/src/type-fest'
import { OpenAPIGenerator } from './openapi-generator'

/**
 * Runs a sample of each type-fest type applying to data, and validates its serialized output and
 * the input a client sends of it against the generated schemas.
 */
describe('type-fest types', async () => {
  const spec = await new OpenAPIGenerator().generate(typeFest, {
    source: {
      file: new URL('../tests/fixtures/app/src/type-fest.ts', import.meta.url),
      export: 'typeFest',
    },
  })

  const toSpecRefs = (schema: unknown): any =>
    JSON.parse(JSON.stringify(schema).replaceAll('#/components/schemas/', 'spec#/$defs/'))
  const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false })
  ajv.addSchema(toSpecRefs({ $id: 'spec', $defs: spec.components?.schemas ?? {} }))
  const validate = (schema: unknown, value: unknown) => {
    const check = ajv.compile(toSpecRefs(schema))
    return check(value) ? [] : check.errors
  }

  const operation = (name: string, slot: 'output' | 'input') =>
    (spec.paths as any)[`/${name}/${slot}`].post
  const serializer = new OpenAPIJsonSerializer()
  const handler = new OpenAPIHandler(typeFest)
  let sent = ''
  const link = new OpenAPILink(typeFest, {
    origin: 'http://localhost',
    url: '/',
    fetch: async (request, init) => {
      const handled = new Request(request, init)
      sent = await handled.clone().text()
      return (await handler.handle(handled)).response!
    },
  })

  it.each(Object.keys(typeFest).filter((name) => name !== 'EmptyObject'))('%s', async (name) => {
    const sample = (typeFest as any)[name]
    const value = await call(sample.output, undefined)
    const output = JSON.parse(JSON.stringify(serializer.serializeJson(value).json) ?? 'null')
    const responseSchema = operation(name, 'output').responses['200'].content['application/json']
      .schema

    expect(validate(responseSchema, output)).toEqual([])

    await expect(link.call([name, 'input'], value, { context: {} })).resolves.toBe(1)
    const requestSchema = operation(name, 'input').requestBody.content['application/json'].schema

    expect(validate(requestSchema, JSON.parse(sent))).toEqual([])
  })

  it('documents EmptyObject, which any value satisfies, as any value', () => {
    expect(operation('EmptyObject', 'output').responses['200'].content).toEqual({})
    expect(operation('EmptyObject', 'input').requestBody).toBeUndefined()
  })
})

import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { OpenAPIHandler, OpenAPILink } from '@orpc/openapi/fetch'
import { call } from '@orpc/server'
import { Ajv2020 } from 'ajv/dist/2020.js'

import { builtinTypes } from '../tests/fixtures/app/src/builtin-types'
import { OpenAPIGenerator } from './openapi-generator'

/**
 * Runs a sample of each built-in utility type and type operator applying to data, and validates
 * its serialized output and the input a client sends of it against the generated schemas.
 */
describe('built-in types', async () => {
  const spec = await new OpenAPIGenerator().generate(builtinTypes, {
    source: {
      file: new URL('../tests/fixtures/app/src/builtin-types.ts', import.meta.url),
      export: 'builtinTypes',
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
  const handler = new OpenAPIHandler(builtinTypes)
  let sent = ''
  const link = new OpenAPILink(builtinTypes, {
    origin: 'http://localhost',
    url: '/',
    fetch: async (request, init) => {
      const handled = new Request(request, init)
      sent = await handled.clone().text()
      return (await handler.handle(handled)).response!
    },
  })

  it.each(Object.keys(builtinTypes))('%s', async (name) => {
    const sample = (builtinTypes as any)[name]
    const value = await call(sample.output, undefined)
    const output = JSON.parse(JSON.stringify(serializer.serializeJson(value).json) ?? 'null')
    const responseSchema = operation(name, 'output').responses['200'].content['application/json']
      .schema

    expect(validate(responseSchema, output)).toEqual([])

    // a promise is an output only
    if (sample.input) {
      await expect(link.call([name, 'input'], value, { context: {} })).resolves.toBe(1)
      const requestSchema = operation(name, 'input').requestBody.content['application/json'].schema

      expect(validate(requestSchema, JSON.parse(sent))).toEqual([])
    }
  })
})

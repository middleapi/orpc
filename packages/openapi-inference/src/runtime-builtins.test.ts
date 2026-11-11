import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { OpenAPIHandler, OpenAPILink } from '@orpc/openapi/fetch'
import { call } from '@orpc/server'
import { Ajv2020 } from 'ajv/dist/2020.js'

import { runtimeBuiltins } from '../tests/fixtures/runtime/src/runtime-builtins'
import { OpenAPIGenerator } from './openapi-generator'

/**
 * Sends a value of each Node.js and DOM built-in type as oRPC does, as an output and as the input
 * a client sends, and validates it against the generated schemas of its media type.
 */
describe('runtime built-ins', async () => {
  const spec = await new OpenAPIGenerator().generate(runtimeBuiltins, {
    source: {
      file: new URL('../tests/fixtures/runtime/src/runtime-builtins.ts', import.meta.url),
      export: 'runtimeBuiltins',
    },
  })

  const toSpecRefs = (schema: unknown): any =>
    JSON.parse(JSON.stringify(schema).replaceAll('#/components/schemas/', 'spec#/$defs/'))
  const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false })
  ajv.addSchema(toSpecRefs({ $id: 'spec', $defs: spec.components?.schemas ?? {} }))
  const serializer = new OpenAPIJsonSerializer()

  /** Validates a message sent of a value against the documented content of its media type */
  const expectDocumented = (content: any, message: Request | Response, value: unknown) => {
    const mediaType = message.headers.get('content-type')?.split(';')[0]
    const { json, blobs } = serializer.serializeJson(value)

    // a whole body of these is sent as is, documented as binary data
    if (
      json instanceof Blob ||
      json instanceof ReadableStream ||
      json instanceof FormData ||
      json instanceof URLSearchParams
    ) {
      expect((content[mediaType!] ?? content['*/*']).schema).toMatchObject({
        type: 'string',
        contentMediaType: expect.any(String),
      })
      return
    }

    // blobs are sent as the parts of a form
    expect(mediaType).toBe(blobs?.length ? 'multipart/form-data' : 'application/json')
    const written = JSON.parse(
      JSON.stringify(json, (_, v: unknown) => (v instanceof Blob ? '' : v)) ?? 'null',
    )
    const validate = ajv.compile(toSpecRefs(content[mediaType!].schema))

    expect(validate(written) ? [] : validate.errors).toEqual([])
  }

  const operation = (name: string, slot: 'output' | 'input') =>
    (spec.paths as any)[`/${name}/${slot}`].post
  const handler = new OpenAPIHandler(runtimeBuiltins)
  let sent: Request | undefined
  const link = new OpenAPILink(runtimeBuiltins, {
    origin: 'http://localhost',
    url: '/',
    fetch: async (request, init) => {
      sent = new Request(request, init)
      return (await handler.handle(sent.clone())).response!
    },
  })

  it.each(Object.keys(runtimeBuiltins))('%s', async (name) => {
    const sample = (runtimeBuiltins as any)[name]
    const { response } = await handler.handle(
      new Request(`http://localhost/${name}/output`, { method: 'POST' }),
    )

    expect(response!.status).toBe(200)
    expectDocumented(
      operation(name, 'output').responses['200'].content,
      response!,
      await call(sample.output, undefined),
    )

    const value = await call(sample.output, undefined)
    await expect(link.call([name, 'input'], value, { context: {} })).resolves.toBe(1)

    expectDocumented(operation(name, 'input').requestBody.content, sent!, value)
  })
})

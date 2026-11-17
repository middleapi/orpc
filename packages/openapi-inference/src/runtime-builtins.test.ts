import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { OpenAPIHandler, OpenAPILink } from '@orpc/openapi/fetch'
import { call } from '@orpc/server'
import { Ajv2020 } from 'ajv/dist/2020.js'

import { bodylessBuiltins } from '../tests/fixtures/runtime/src/bodyless-builtins'
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

/**
 * A client sends the input of a GET or HEAD request in the query string, so a whole input of these
 * built-ins is documented by its fields, as parameters, not as binary data of a request body.
 */
describe.each(['3.2.0', '3.0.4'] as const)('bodyless built-in inputs in OpenAPI %s', (version) => {
  const generate = () =>
    new OpenAPIGenerator().generate(bodylessBuiltins, {
      source: {
        file: new URL('../tests/fixtures/runtime/src/bodyless-builtins.ts', import.meta.url),
        export: 'bodylessBuiltins',
      },
      version,
    })

  it('documents parameters, and binary data only for a request body', async () => {
    const paths: any = (await generate()).paths
    const size = [expect.objectContaining({ in: 'query', name: 'size' })]

    for (const path of ['/search', '/readonly-search', '/optional-search']) {
      expect(paths[path].get.requestBody).toBeUndefined()
      expect(paths[path].get.parameters).toEqual(size)
    }
    expect(paths['/stream'].get.parameters).toEqual([
      expect.objectContaining({ in: 'query', name: 'locked' }),
    ])
    expect(paths['/form'].get).not.toHaveProperty('requestBody')
    expect(paths['/head-form'].head).not.toHaveProperty('requestBody')
    expect(JSON.stringify(paths['/search'])).not.toMatch(/contentMediaType|binary/u)

    expect(
      paths['/post-search'].post.requestBody.content['application/x-www-form-urlencoded'].schema,
    ).toEqual(
      version === '3.0.4'
        ? { type: 'string', format: 'binary' }
        : { type: 'string', contentMediaType: 'application/x-www-form-urlencoded' },
    )
  })

  it('matches what a client sends', async () => {
    const handler = new OpenAPIHandler(bodylessBuiltins)
    let sent: Request | undefined
    const link = new OpenAPILink(bodylessBuiltins, {
      origin: 'http://localhost',
      url: '/',
      fetch: async (request, init) => {
        sent = new Request(request, init)
        return (await handler.handle(sent.clone())).response!
      },
    })

    await expect(
      link.call(['searchParams'], new URLSearchParams('a=1'), { context: {} }),
    ).resolves.toBe(1)
    expect(sent!.method).toBe('GET')
    expect(sent!.headers.get('content-type')).toBeNull()
  })
})

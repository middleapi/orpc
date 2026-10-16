import { SmartCoercionHandlerPlugin } from '@orpc/json-schema'
import { openapi, OpenAPIGenerator } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { os } from '@orpc/server'
import { Schema } from 'effect'
import { EffectSchemaToJsonSchemaConverter } from './converter'
import { toStandardSchema } from './schema'

/**
 * Clients are generated from the spec, so it must describe exactly what the server accepts and returns.
 */
describe('effectSchemaToJsonSchemaConverter with OpenAPIGenerator and OpenAPIHandler', () => {
  const converter = new EffectSchemaToJsonSchemaConverter()

  const Profile = toStandardSchema(Schema.Struct({ name: Schema.String, nickname: Schema.optional(Schema.String) }))
  const Measurement = toStandardSchema(Schema.Struct({ value: Schema.Number }))
  const Upload = toStandardSchema(Schema.Struct({ file: Schema.File }))
  const Event = toStandardSchema(Schema.Struct({
    at: Schema.Date,
    big: Schema.BigInt,
    tags: Schema.ReadonlySet(Schema.String),
  }))

  const router = {
    profile: os
      .meta(openapi({ method: 'POST', path: '/profile' }))
      .input(Profile)
      .output(Profile)
      .handler(({ input }) => input),
    measure: os
      .meta(openapi({ method: 'POST', path: '/measure' }))
      .input(Measurement)
      .output(Measurement)
      .handler(({ input }) => input),
    upload: os
      .meta(openapi({ method: 'POST', path: '/upload' }))
      .input(Upload)
      .handler(async ({ input }) => ({ name: input.file.name, text: await input.file.text() })),
    event: os
      .meta(openapi({ method: 'POST', path: '/event' }))
      .input(Event)
      .output(Event)
      .handler(({ input }) => input),
  }

  const handler = new OpenAPIHandler(router, {
    plugins: [new SmartCoercionHandlerPlugin({ converters: [converter] })],
  })

  async function post(path: string, body: unknown) {
    const { response } = await handler.handle(new Request(`http://localhost${path}`, {
      method: 'POST',
      ...body instanceof FormData
        ? { body }
        : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } },
    }))

    return { status: response?.status, body: await response?.json() }
  }

  async function generate() {
    return new OpenAPIGenerator({ converters: [converter] }).generate(router) as Promise<any>
  }

  it('describes optional fields without null, as the server rejects null', async () => {
    const spec = await generate()
    const profile = {
      type: 'object',
      properties: { name: { type: 'string' }, nickname: { type: 'string' } },
      required: ['name'],
      additionalProperties: true,
    }

    expect(spec.paths['/profile'].post.requestBody.content['application/json'].schema).toEqual(profile)
    expect(spec.paths['/profile'].post.responses['200'].content['application/json'].schema).toEqual(profile)

    await expect(post('/profile', { name: 'Earth' })).resolves.toEqual({ status: 200, body: { name: 'Earth' } })
    await expect(post('/profile', { name: 'Earth', nickname: 'Terra' })).resolves.toEqual({ status: 200, body: { name: 'Earth', nickname: 'Terra' } })
    await expect(post('/profile', { name: 'Earth', nickname: null })).resolves.toMatchObject({ status: 400 })
  })

  it('describes numbers without NaN and Infinity strings, as the server rejects them', async () => {
    const spec = await generate()
    const measurement = { type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: true }

    expect(spec.paths['/measure'].post.requestBody.content['application/json'].schema).toEqual(measurement)
    expect(spec.paths['/measure'].post.responses['200'].content['application/json'].schema).toEqual(measurement)

    await expect(post('/measure', { value: 1.5 })).resolves.toEqual({ status: 200, body: { value: 1.5 } })

    for (const value of ['NaN', 'Infinity', '-Infinity']) {
      await expect(post('/measure', { value })).resolves.toMatchObject({ status: 400 })
    }
  })

  it('describes files as multipart binaries, as the server accepts uploaded files', async () => {
    const spec = await generate()

    expect(spec.paths['/upload'].post.requestBody.content).toEqual({
      'multipart/form-data': {
        schema: {
          type: 'object',
          properties: { file: { type: 'string', format: 'binary', contentEncoding: 'binary' } },
          required: ['file'],
          additionalProperties: true,
        },
      },
    })

    const form = new FormData()
    form.set('file', new File(['hello'], 'hello.txt', { type: 'text/plain' }))

    await expect(post('/upload', form)).resolves.toEqual({ status: 200, body: { name: 'hello.txt', text: 'hello' } })
  })

  it('describes native types so smart coercion can restore them', async () => {
    const spec = await generate()
    const event = {
      type: 'object',
      properties: {
        at: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
        big: { 'type': 'string', 'pattern': '^-?[0-9]+$', 'x-native-type': 'bigint' },
        tags: { 'type': 'array', 'uniqueItems': true, 'items': { type: 'string' }, 'x-native-type': 'set' },
      },
      required: ['at', 'big', 'tags'],
      additionalProperties: true,
    }

    expect(spec.paths['/event'].post.requestBody.content['application/json'].schema).toEqual(event)
    expect(spec.paths['/event'].post.responses['200'].content['application/json'].schema).toEqual(event)

    const body = { at: '2024-01-01T00:00:00.000Z', big: '123', tags: ['a', 'b'] }

    await expect(post('/event', body)).resolves.toEqual({ status: 200, body })
  })
})

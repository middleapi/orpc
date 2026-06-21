import { ORPCError } from '@orpc/client'
import { openapi, OpenAPISerializer } from '@orpc/openapi'
import { os } from '@orpc/server'
import { sleep } from '@standardserver/shared'
import { z } from 'zod'
import { Person } from '../rpc/__shared__/client-server'
import { createHonoFetchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createNodeHttpClientServerTest } from './__shared__/client-server.node-http'

describe.each([
  ['hono-fetch', createHonoFetchClientServerTest],
  ['node-http', createNodeHttpClientServerTest],
])('openapi v2 data transfer: %s', async (_name, createClientServer) => {
  const date = new Date('2024-01-02T03:04:05.000Z')
  const blob = new Blob(['hello'], { type: 'text/plain' })
  const customSerializer = new OpenAPISerializer({
    handlers: {
      person: {
        condition: value => value instanceof Person,
        serialize: value => ({
          __person__: {
            name: value.name,
            age: value.age,
          },
        }),
      },
    },
  })

  const router = {
    get: os
      .input(z.any())
      .meta(openapi({
        method: 'GET',
        path: '/items/{id}',
        queryStyles: {
          keyword: 'primitive',
          tags: 'array',
          meta: 'json',
        },
      }))
      .handler(({ input, lastEventId }) => ({ input, lastEventId })),
    post: os
      .input(z.any())
      .meta(openapi({
        method: 'POST',
        path: '/items',
      }))
      .handler(({ input }) => input),
    upload: os
      .input(z.any())
      .meta(openapi({
        method: 'POST',
        path: '/upload',
      }))
      .handler(({ input }) => input),
    detailed: os
      .$context<{ userId: string }>()
      .input(z.any())
      .meta(openapi({
        method: 'POST',
        path: '/articles/{id}/{tags}',
        inputStructure: 'detailed',
        outputStructure: 'detailed',
        successStatus: 201,
        paramsStyles: {
          tags: 'comma-delimited-array',
        },
        queryStyles: {
          meta: 'json',
        },
      }))
      .handler(({ input, context, signal }) => ({
        status: 202,
        headers: {
          'x-user-id': context.userId,
          'x-aborted': String(signal?.aborted),
        },
        body: input,
      })),
    error: os
      .input(z.any())
      .meta(openapi({
        method: 'GET',
        path: '/errors/{id}',
      }))
      .handler(() => {
        throw new ORPCError('NOT_FOUND', {
          message: 'Missing item',
          data: { id: 'missing-item' },
        })
      }),
    customSerializer: os.input(z.any()).handler(({ input }) => ({ client: input, server: new Person('server', 12) })),
  }

  const client = createClientServer(router, {
    context: { userId: 'u_123' },
  })

  it('supports compact GET input with path params, styled query, and lastEventId', async () => {
    await expect(client.get({
      id: '42',
      keyword: 1,
      tags: ['red', 'blue'],
      meta: { enabled: true },
      filter: { published: true },
    }, {
      lastEventId: '__EVENT_123__',
    })).resolves.toEqual({
      input: {
        id: '42',
        keyword: '1',
        tags: ['red', 'blue'],
        meta: { enabled: true },
        filter: { published: 'true' },
      },
      lastEventId: '__EVENT_123__',
    })
  })

  it('supports compact POST JSON bodies', async () => {
    await expect(client.post({
      count: 1n,
      when: date,
      nested: {
        flag: true,
      },
    })).resolves.toEqual({
      count: '1',
      when: date.toISOString(),
      nested: {
        flag: true,
      },
    })
  })

  it('supports compact POST multipart bodies', async () => {
    const result = await client.upload({
      title: 'hello',
      nested: {
        when: date,
      },
      file: blob,
    })

    expect(result.title).toBe('hello')
    expect(result.nested).toEqual({ when: date.toISOString() })
    expect(result.file).toBeInstanceOf(File)
    expect(result.file.type).toBe('text/plain')
    await expect(result.file.text()).resolves.toBe('hello')
  })

  it('supports custom serializer', async () => {
    const customClient = createClientServer(router, {
      serializer: customSerializer,
    })
    const person = new Person('Alice', 30)

    await expect(customClient.customSerializer(person)).resolves.toEqual({
      client: {
        __person__: {
          age: 30,
          name: 'Alice',
        },
      },
      server: {
        __person__: {
          age: 12,
          name: 'server',
        },
      },
    })
  })

  it('supports event iterator and transfers events in parallel', async () => {
    const stream = (async function* () {
      yield 'order 1'
      await sleep(200)
      yield { order: 2 }
      await sleep(200)
      yield { when: date }
      await sleep(200)
      return { completeAt: date }
    }())

    let startTime = Date.now()
    const result = await client.post(stream) as AsyncIteratorObject<unknown>
    expect(Date.now() - startTime).toBeLessThan(100)

    startTime = Date.now()
    await expect(result.next()).resolves.toEqual({ value: 'order 1', done: false })
    expect(Date.now() - startTime).toBeLessThan(100)

    startTime = Date.now()
    await expect(result.next()).resolves.toEqual({ value: { order: 2 }, done: false })
    expect(Date.now() - startTime).toBeLessThan(250)

    startTime = Date.now()
    await expect(result.next()).resolves.toEqual({
      value: { when: date.toISOString() },
      done: false,
    })
    expect(Date.now() - startTime).toBeLessThan(250)

    startTime = Date.now()
    await expect(result.next()).resolves.toEqual({
      value: { completeAt: date.toISOString() },
      done: true,
    })
    expect(Date.now() - startTime).toBeLessThan(250)
  })

  it('supports octet stream and transfers octets in parallel', async () => {
    const stream = new ReadableStream<string>({
      async start(controller) {
        controller.enqueue('order 1')
        await sleep(200)
        controller.enqueue('order 2')
        await sleep(200)
        controller.enqueue('order 3')
        controller.close()
      },
    }).pipeThrough(new TextEncoderStream())

    let startTime = Date.now()
    const result = await client.post(stream) as ReadableStream<Uint8Array>
    expect(Date.now() - startTime).toBeLessThan(100)

    const reader = result.getReader()

    startTime = Date.now()
    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(first.value).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(first.value)).toBe('order 1')
    expect(Date.now() - startTime).toBeLessThan(100)

    startTime = Date.now()
    const second = await reader.read()
    expect(second.done).toBe(false)
    expect(second.value).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(second.value)).toBe('order 2')
    expect(Date.now() - startTime).toBeLessThan(250)

    startTime = Date.now()
    const third = await reader.read()
    expect(third.done).toBe(false)
    expect(third.value).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(third.value)).toBe('order 3')
    expect(Date.now() - startTime).toBeLessThan(250)

    startTime = Date.now()
    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
    expect(Date.now() - startTime).toBeLessThan(100)
  })

  it('supports detailed input and detailed output', async () => {
    const result = await client.detailed({
      params: {
        id: '24',
        tags: ['alpha', 'beta'],
      },
      query: {
        meta: { draft: true },
        plain: { page: 2 },
      },
      headers: {
        'x-trace-id': 'trace-1',
      },
      body: {
        title: 'Hello',
        published: true,
      },
    })

    expect(result.status).toBe(202)
    expect(result.headers['x-user-id']).toBe('u_123')
    expect(result.headers['x-aborted']).toBe('false')
    expect(result.body).toEqual({
      params: {
        id: '24',
        tags: ['alpha', 'beta'],
      },
      query: {
        meta: { draft: true },
        plain: { page: '2' },
      },
      headers: expect.objectContaining({
        'x-trace-id': 'trace-1',
      }),
      body: {
        title: 'Hello',
        published: true,
      },
    })
  })

  it('propagates ORPC errors through OpenAPI responses', async () => {
    await expect(client.error({
      id: '42',
    })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Missing item',
      data: { id: 'missing-item' },
    })
  })
})

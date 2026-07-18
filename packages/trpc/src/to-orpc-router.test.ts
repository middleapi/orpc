import { getOpenAPIMeta, OpenAPIGenerator } from '@orpc/openapi'
import { call, createRouterClient, getEventMeta, Lazy, ORPCError, Procedure, unlazy } from '@orpc/server'
import { isAsyncIteratorObject } from '@orpc/shared'
import { lazy, tracked, TRPCError } from '@trpc/server'
import * as z from 'zod'
import { inputSchema, outputSchema, t, trpcRouter } from '../tests/shared'
import { toORPCRouter } from './to-orpc-router'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('toORPCRouter', async () => {
  const orpcRouter = toORPCRouter(trpcRouter)

  it('shape', async () => {
    expect(orpcRouter.ping).toBeInstanceOf(Procedure)
    expect(orpcRouter.throw).toBeInstanceOf(Procedure)
    expect(orpcRouter.nested.ping).toBeInstanceOf(Procedure)

    const unlazy1 = await unlazy(orpcRouter.lazy as any)
    const unlazy2 = await unlazy(unlazy1.default.lazy)

    expect(orpcRouter.lazy).toBeInstanceOf(Lazy)
    expect(unlazy1.default.subscribe).toBeInstanceOf(Procedure)
    expect(unlazy1.default.lazy).toBeInstanceOf(Lazy)
    expect(unlazy2.default.throw).toBeInstanceOf(Procedure)

    // accessible lazy router
    expect(await unlazy(orpcRouter.lazy.subscribe as any)).toEqual({ default: expect.any(Procedure) })
    expect(await unlazy(orpcRouter.lazy.lazy.throw as any)).toEqual({ default: expect.any(Procedure) })
  })

  it('with input/output schema and validation happen inside handler only', async () => {
    expect((orpcRouter as any).ping['~orpc'].inputSchemas[0]['~standard'].vendor).toBe('zod')
    expect((orpcRouter as any).ping['~orpc'].inputSchemas[0]._def).toBe(inputSchema._def)
    expect((orpcRouter as any).ping['~orpc'].disableInputValidation).toBe(true)

    expect((orpcRouter as any).ping['~orpc'].outputSchemas[0]['~standard'].vendor).toBe('zod')
    expect((orpcRouter as any).ping['~orpc'].outputSchemas[0]._def).toBe(outputSchema._def)
    expect((orpcRouter as any).ping['~orpc'].disableOutputValidation).toBe(true)

    const withoutHandlerProcedure = new Procedure({
      ...(orpcRouter as any).ping['~orpc'],
      handler: async ({ input }: any) => input,
    })

    await expect(call(withoutHandlerProcedure as any, 'invalid')).resolves.toEqual('invalid') // validation not happen at oRPC level
    await expect(call((orpcRouter as any).ping, 'invalid')).rejects.toThrow('Invalid input') // validation happen at tRPC level
  })

  it('openapi spec generation', async () => {
    const trpcRouter = t.router({
      planet: {
        find: t.procedure
          .meta({ '~openapi': { method: 'GET', path: '/planets/{id}', summary: 'Find a planet' } })
          .input(z.object({ id: z.string() }))
          .output(z.object({ name: z.string() }))
          .query(() => ({ name: 'Earth' })),

        create: t.procedure
          .input(z.object({ name: z.string() }))
          .mutation(({ input }) => input),
      },
    })

    const generator = new OpenAPIGenerator({
      converters: [{
        condition: schema => schema?.['~standard'].vendor === 'zod',
        async convert(schema, direction) {
          const jsonSchema = z.toJSONSchema(schema as any, { io: direction })
          const output = await schema?.['~standard'].validate(undefined)
          return [jsonSchema as any, !output?.issues]
        },
      }],
    })

    const spec = await generator.generate(toORPCRouter(trpcRouter))

    expect(spec.paths?.['/planets/{id}']?.get).toMatchObject({
      summary: 'Find a planet',
      operationId: 'planet.find',
    })

    expect(spec.paths?.['/planet/create']?.post).toMatchObject({
      operationId: 'planet.create',
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { name: { type: 'string' } },
            },
          },
        },
      },
    })
  })

  it('meta', async () => {
    expect(orpcRouter.ping['~orpc'].meta).toEqual({ meta1: 'test' })
    expect(orpcRouter.nested.ping['~orpc'].meta).toEqual({ '~openapi': { path: '/nested/ping', description: 'Nested ping procedure' } })
    expect(getOpenAPIMeta(orpcRouter.nested.ping)).toEqual({ path: '/nested/ping', description: 'Nested ping procedure' })
  })

  it('mapMeta option', async () => {
    const trpcRouter = t.router({
      ping: t.procedure
        .meta({ meta1: 'test' } as any)
        .query(() => 'pong'),

      lazy: lazy(() => Promise.resolve({ default: t.router({
        pong: t.procedure
          .meta({ route: { path: '/pong' } } as any)
          .query(() => 'pong'),
      }) })),
    })

    const orpcRouter = toORPCRouter(trpcRouter, {
      mapMeta: meta => ({ ...meta, '~openapi': meta.route }),
    })

    expect(orpcRouter.ping['~orpc'].meta).toEqual({ 'meta1': 'test', '~openapi': undefined })

    // options should propagate through lazy routers
    const { default: pong } = await unlazy((orpcRouter.lazy as any).pong)
    expect(pong['~orpc'].meta).toEqual({ 'route': { path: '/pong' }, '~openapi': { path: '/pong' } })
    expect(getOpenAPIMeta(pong)).toEqual({ path: '/pong' })
  })

  describe('calls', () => {
    it('on success', async () => {
      const result = await call(orpcRouter.ping, { input: 1234 }, { context: { a: 'test' } })
      expect(result).toEqual({ output: '1234' })
    })

    it('async iterator', async () => {
      const result = await call(orpcRouter.subscribe, { u: 'u' }, { context: { a: 'test' } })
      expect(result).toSatisfy(isAsyncIteratorObject)
      expect(await (result as any).next()).toEqual({ done: false, value: 'pong' })
    })

    it('error', async () => {
      await expect(
        call(orpcRouter.throw, { b: 42, c: 'test' }, { context: { a: 'test' } }),
      ).rejects.toSatisfy((err: any) => {
        return err instanceof ORPCError && err.code === 'PARSE_ERROR' && err.message === 'throw'
      })

      await expect(
        call(orpcRouter.ping, { input: 'invalid' } as any, { context: { a: 'test' } }),
      ).rejects.toSatisfy((err: any) => {
        expect(err).toBeInstanceOf(ORPCError)
        expect(err.cause).toBeInstanceOf(TRPCError)
        expect(err.cause.cause).toBeInstanceOf(z.ZodError)

        return true
      })
    })

    it('deep lazy', async () => {
      const client = createRouterClient(orpcRouter, {
        context: { a: 'test' },
      })

      await expect(
        client.lazy.subscribe(),
      ).resolves.toSatisfy(isAsyncIteratorObject)

      await expect(
        client.lazy.lazy.throw({ input: 1234 }),
      ).rejects.toSatisfy((err: any) => {
        return err instanceof ORPCError && err.message === 'lazy.lazy.throw'
      })
    })
  })

  describe('event iterators', () => {
    it('subscribe & tracked', async () => {
      const output = await call(orpcRouter.subscribe, { u: '2' }, { lastEventId: 'id-1', context: { a: 'test' } }) as any
      expect(output).toSatisfy(isAsyncIteratorObject)
      await expect(output.next()).resolves.toEqual({ done: false, value: 'pong' })
      await expect(output.next()).resolves.toSatisfy((result) => {
        expect(result.done).toEqual(false)
        expect(result.value).toEqual({ id: 'id-1', data: { order: 1 } })
        expect(getEventMeta(result.value)).toEqual({ id: 'id-1' })

        return true
      })
      await expect(output.next()).resolves.toSatisfy((result) => {
        expect(result.done).toEqual(false)
        expect(result.value).toEqual({ id: 'id-2', data: { order: 2 } })
        expect(getEventMeta(result.value)).toEqual({ id: 'id-2' })

        return true
      })
      await expect(output.next()).resolves.toEqual({ done: true, value: undefined })
    })

    it('lastEventId', async () => {
      const trackedSubscription = vi.fn(async function* () {
        yield { order: 1 }
        yield tracked('id-2', { order: 2 })
      })

      const trpcRouter = t.router({
        tracked: t.procedure
          .input(z.any())
          .subscription(trackedSubscription),
      })

      const orpcRouter = toORPCRouter(trpcRouter)

      await call(orpcRouter.tracked, { u: 'u' }, { lastEventId: 'id-1', context: { a: 'test' } })
      expect(trackedSubscription).toHaveBeenNthCalledWith(1, expect.objectContaining({
        input: { u: 'u', lastEventId: 'id-1' },
      }))

      await call(orpcRouter.tracked, undefined, { lastEventId: 'id-2', context: { a: 'test' } })
      expect(trackedSubscription).toHaveBeenNthCalledWith(2, expect.objectContaining({
        input: { lastEventId: 'id-2' },
      }))

      await call(orpcRouter.tracked, 1234, { lastEventId: 'id-3', context: { a: 'test' } })
      expect(trackedSubscription).toHaveBeenNthCalledWith(3, expect.objectContaining({
        input: 1234,
      }))
    })

    it('works with AsyncIterable & cleanup', async () => {
      let cleanupCalled = false

      const trackedSubscription = vi.fn(async () => {
        return {
          async* [Symbol.asyncIterator]() {
            try {
              yield { order: 1 }
              yield tracked('id-2', { order: 2 })
            }
            finally {
              cleanupCalled = true
            }
          },
        }
      })

      const trpcRouter = t.router({
        tracked: t.procedure
          .input(z.any())
          .subscription(trackedSubscription),
      })

      const orpcRouter = toORPCRouter(trpcRouter)

      const output = await call(orpcRouter.tracked, { u: 'u' }, { lastEventId: 'id-1', context: { a: 'test' } })

      await expect(output.next()).resolves.toEqual({ done: false, value: { order: 1 } })
      await expect(output.return?.()).resolves.toEqual({ done: true, value: undefined })
      expect(cleanupCalled).toBe(true)
    })
  })
})

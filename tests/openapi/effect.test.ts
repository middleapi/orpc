import type { WithEffectContext } from '@orpc/experimental-effect'
import { ORPCError } from '@orpc/client'
import { EffectSchemaToJsonSchemaConverter, middlewareGen } from '@orpc/experimental-effect'
import { SmartCoercionHandlerPlugin } from '@orpc/json-schema'
import { openapi, OpenAPIGenerator } from '@orpc/openapi'
import { os } from '@orpc/server'
import { promiseWithResolvers } from '@orpc/shared'
import { Context, Effect, Exit, Schema } from 'effect'
import { createHonoFetchClientServerTest } from './__shared__/client-server.hono-fetch'
import { createNodeHttpClientServerTest } from './__shared__/client-server.node-http'
import '@orpc/experimental-effect/extensions/effect'
import '@orpc/experimental-effect/extensions/input-output'

class PlanetStore extends Context.Service<
  PlanetStore,
  {
    readonly list: Effect.Effect<ReadonlyArray<{ readonly id: string, readonly name: string }>>
  }
>()('PlanetStore') {}

const effectContext = Context.make(PlanetStore, {
  list: Effect.succeed([
    { id: 'mercury', name: 'Mercury' },
    { id: 'venus', name: 'Venus' },
    { id: 'earth', name: 'Earth' },
  ]),
})

const PlanetSchema = Schema.Struct({ id: Schema.String, name: Schema.String })

const acquired = vi.fn<(signal: AbortSignal | undefined) => void>()
const released = vi.fn<(interrupted: boolean) => void>()
let releaseEvents = promiseWithResolvers<void>()

beforeEach(() => {
  vi.clearAllMocks()
  releaseEvents = promiseWithResolvers<void>()
})

const base = os.$context<WithEffectContext<PlanetStore>>()

const router = {
  list: base
    .meta(openapi({ method: 'GET', path: '/planets' }))
    .input(Schema.Struct({ limit: Schema.NumberFromString }))
    .output(Schema.Array(PlanetSchema))
    .effect(function* (_, input) {
      const store = yield* PlanetStore
      const planets = yield* store.list
      return planets.slice(0, input.limit)
    }),
  search: base
    .meta(openapi({ method: 'GET', path: '/search' }))
    .input(Schema.Struct({ limit: Schema.Number, exact: Schema.Boolean }))
    .effect(function* (_, input) {
      return input
    }),
  find: base
    .meta(openapi({ method: 'GET', path: '/planets/{id}' }))
    .errors({
      NOT_FOUND: {
        data: Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String })),
      },
    })
    .input(Schema.Struct({ id: Schema.String }))
    .output(PlanetSchema)
    .effect(function* ({ errors }, input) {
      const store = yield* PlanetStore
      const planets = yield* store.list
      const planet = planets.find(planet => planet.id === input.id)

      if (!planet) {
        return yield* Effect.fail(errors.NOT_FOUND({ message: `Planet ${input.id} not found`, data: { id: input.id } }))
      }

      return planet
    }),
  create: base
    .meta(openapi({ method: 'POST', path: '/planets', successStatus: 201 }))
    .use(middlewareGen(function* ({ next }) {
      return yield* next({ context: { createdBy: 'middleware' } })
    }))
    .input(Schema.Struct({ name: Schema.String }))
    .output(Schema.Struct({ name: Schema.String, createdBy: Schema.String }))
    .effect(function* ({ context }, input) {
      return { name: input.name, createdBy: context.createdBy }
    }),
  events: base
    .meta(openapi({ method: 'GET', path: '/events' }))
    .effect(function* () {
      const store = yield* PlanetStore
      const [first] = yield* store.list

      return (async function* () {
        yield first
        await releaseEvents.promise
        yield { id: 'second' }
        return { done: true }
      }())
    }),
  sleep: base
    .meta(openapi({ method: 'POST', path: '/sleep' }))
    .effect(function* ({ signal }) {
      return yield* Effect.acquireUseRelease(
        Effect.sync(() => acquired(signal)),
        () => Effect.never,
        (_, exit) => Effect.sync(() => released(Exit.hasInterrupts(exit))),
      )
    }),
  conflict: base
    .meta(openapi({ method: 'POST', path: '/conflict' }))
    .effect(function* () {
      return yield* Effect.fail(new ORPCError('CONFLICT', { message: 'Already exists' }))
    }),
}

describe.each([
  ['hono-fetch', createHonoFetchClientServerTest],
  ['node-http', createNodeHttpClientServerTest],
])('effect procedures over openapi: %s', (_name, createClientServer) => {
  const client = createClientServer(router, {
    context: { 'effect/context': effectContext },
    plugins: [
      new SmartCoercionHandlerPlugin({
        converters: [new EffectSchemaToJsonSchemaConverter()],
      }),
    ],
  })

  describe('data transfer', () => {
    it('decodes query input with effect schema transformations', async () => {
      await expect(client.list({ limit: '2' })).resolves.toEqual([
        { id: 'mercury', name: 'Mercury' },
        { id: 'venus', name: 'Venus' },
      ])
    })

    it('smart-coerces query input against the effect schema json schema', async () => {
      await expect(client.search({ limit: 3, exact: true })).resolves.toEqual({ limit: 3, exact: true })
    })

    it('supports path params', async () => {
      await expect(client.find({ id: 'earth' })).resolves.toEqual({ id: 'earth', name: 'Earth' })
    })

    it('supports JSON bodies through effectful middleware', async () => {
      await expect(client.create({ name: 'Mars' })).resolves.toEqual({ name: 'Mars', createdBy: 'middleware' })
    })

    it('streams AsyncIteratorObject outputs returned by effects', async () => {
      // The source holds everything after its first event until the test releases it, so a transport
      // that buffered the stream would hang here instead of resolving.
      const iterator = await client.events()

      await expect(iterator.next()).resolves.toEqual({ value: { id: 'mercury', name: 'Mercury' }, done: false })

      releaseEvents.resolve()
      await expect(iterator.next()).resolves.toEqual({ value: { id: 'second' }, done: false })
      await expect(iterator.next()).resolves.toEqual({ value: { done: true }, done: true })
    })
  })

  describe('cancel and abort', () => {
    it('interrupts the handler fiber and runs its finalizers when the client aborts', async () => {
      const controller = new AbortController()

      const promise = expect(client.sleep(undefined, { signal: controller.signal })).rejects.toThrowError('abort')

      await vi.waitFor(() => expect(acquired).toHaveBeenCalledTimes(1))
      const signal = acquired.mock.calls[0]![0]!
      expect(signal.aborted).toBe(false)
      expect(released).not.toHaveBeenCalled()

      controller.abort()
      await promise

      await vi.waitFor(() => expect(released).toHaveBeenCalledTimes(1))
      expect(released).toHaveBeenCalledWith(true)
      expect(signal.aborted).toBe(true)
    })
  })

  describe('errors', () => {
    it('delivers `yield* Effect.fail(errors.X())` as a defined error', async () => {
      const error = await client.find({ id: 'pluto' }).catch(e => e)

      expect(error).toBeInstanceOf(ORPCError)
      expect(error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Planet pluto not found',
        data: { id: 'pluto' },
        defined: true,
      })
    })

    it('delivers undeclared ORPCError failures as-is with defined=false', async () => {
      const error = await client.conflict().catch(e => e)

      expect(error).toBeInstanceOf(ORPCError)
      expect(error).toMatchObject({
        code: 'CONFLICT',
        message: 'Already exists',
        defined: false,
      })
    })

    it('rejects input that fails effect schema validation with BAD_REQUEST', async () => {
      await expect(client.create({ name: 123 } as any)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Input validation failed',
        data: {
          issues: expect.arrayContaining([
            expect.objectContaining({ path: ['name'] }),
          ]),
        },
      })
    })
  })
})

describe('openapi generation with EffectSchemaToJsonSchemaConverter', () => {
  const generator = new OpenAPIGenerator({
    converters: [new EffectSchemaToJsonSchemaConverter()],
  })

  it('describes query params from the encoded side of effect schema inputs', async () => {
    const spec = await generator.generate(router)

    expect(spec.paths?.['/planets']?.get).toMatchObject({
      operationId: 'list',
      parameters: [
        expect.objectContaining({ in: 'query', name: 'limit', required: true, schema: { type: 'string' } }),
      ],
      responses: {
        200: {
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { id: { type: 'string' }, name: { type: 'string' } },
                  required: ['id', 'name'],
                },
              },
            },
          },
        },
      },
    })
  })

  it('describes path params, request bodies, and success statuses', async () => {
    const spec = await generator.generate(router)

    expect(spec.paths?.['/planets/{id}']?.get).toMatchObject({
      operationId: 'find',
      parameters: [
        expect.objectContaining({ in: 'path', name: 'id', required: true, schema: { type: 'string' } }),
      ],
    })

    expect(spec.paths?.['/planets']?.post).toMatchObject({
      operationId: 'create',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          },
        },
      },
      responses: {
        201: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string' }, createdBy: { type: 'string' } },
                required: ['name', 'createdBy'],
              },
            },
          },
        },
      },
    })
  })

  it('describes defined errors with effect schema data', async () => {
    const spec = await generator.generate(router)

    expect(spec.paths?.['/planets/{id}']?.get?.responses?.['404']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            oneOf: expect.arrayContaining([{ $ref: '#/components/schemas/NotFound' }]),
          },
        },
      },
    })

    expect(spec.components?.schemas?.NotFound).toMatchObject({
      type: 'object',
      properties: {
        defined: { const: true },
        code: { const: 'NOT_FOUND' },
        data: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      required: ['defined', 'code', 'message', 'data'],
    })
  })
})

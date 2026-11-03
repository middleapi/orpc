import type { AnyMetaPlugin, ErrorMap } from '@orpc/contract'
import type { AnyFunction } from '@orpc/shared'
import type { AnyMiddleware } from './middleware'
import * as ContractModule from '@orpc/contract'
import { getOwn, toArray } from '@orpc/shared'
import { z } from 'zod'
import { Builder, os } from './builder'
import * as LazyModule from './lazy'
import * as MiddlewareDecoratedModule from './middleware-decorated'
import { Procedure } from './procedure'
import * as ProcedureDecoratedModule from './procedure-decorated'
import { createRouterClient } from './router-client'
import * as RouterUtilsModule from './router-utils'

const resolveMetaPluginsSpy = vi.spyOn(ContractModule, 'resolveMetaPlugins')
const mergeErrorMapSpy = vi.spyOn(ContractModule, 'mergeErrorMap')
const augmentRouterSpy = vi.spyOn(RouterUtilsModule, 'augmentRouter')
const decorateMiddlewareSpy = vi.spyOn(MiddlewareDecoratedModule, 'decorateMiddleware')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('builder', () => {
  const builder = Builder.create()
  builder['~orpc'] = {
    errorMap: {
      BASE: { status: 400 },
    },
    inputSchemas: [
      z.object({ init: z.string() }),
    ],
    outputSchemas: [
      z.object({ init: z.string() }),
    ],
    meta: {
      base: true,
    },
    metaPlugins: [
      {
        name: 'test',
        init: m => m,
      },
    ],
    orderedMiddlewares: [
      { middleware: vi.fn() as AnyFunction, inputSchemasLengthAtUse: 0, outputSchemasLengthAtUse: 0 },
    ],
    disableInputValidation: false,
    disableOutputValidation: false,
  }

  const metaPlugin: AnyMetaPlugin = {
    name: 'test',
    init: m => ({ ...m, metaPlugin: true }),
  }

  it('create', () => {
    expect(os).toBeInstanceOf(Builder)
    expect(os['~orpc']).toEqual({
      errorMap: {},
      meta: {},
      orderedMiddlewares: [],
    })
  })

  it('$context', () => {
    expect(builder.$context()).toBe(builder)
  })

  it('$config', () => {
    const applied = builder.$config({
      disableOutputValidation: undefined,
    })

    expect(applied).toBeInstanceOf(Builder)
    expect(applied).not.toBe(builder)

    expect(applied['~orpc']).toEqual({
      ...builder['~orpc'],
      disableOutputValidation: undefined,
    })
  })

  it('.meta', () => {
    const applied = builder.meta(metaPlugin)
    expect(applied).toBeInstanceOf(Builder)
    expect(applied).not.toBe(builder)

    expect(resolveMetaPluginsSpy).toHaveBeenCalledOnce()
    expect(resolveMetaPluginsSpy).toHaveBeenCalledWith(
      builder['~orpc'].meta,
      builder['~orpc'].metaPlugins,
      [metaPlugin],
    )

    expect(applied['~orpc']).toEqual({
      ...builder['~orpc'],
      meta: resolveMetaPluginsSpy.mock.results[0]?.value[0],
      metaPlugins: resolveMetaPluginsSpy.mock.results[0]?.value[1],
    })
  })

  describe('.errors', () => {
    it('without meta plugins', () => {
      const errors = {
        OVERRIDE: { message: 'override' },
      } satisfies ErrorMap

      const applied = builder.errors(errors)
      expect(applied).toBeInstanceOf(Builder)
      expect(applied).not.toBe(builder)

      expect(mergeErrorMapSpy).toHaveBeenCalledOnce()
      expect(mergeErrorMapSpy).toHaveBeenCalledWith(
        builder['~orpc'].errorMap,
        errors,
      )

      expect(applied['~orpc']).toEqual({
        ...builder['~orpc'],
        errorMap: mergeErrorMapSpy.mock.results[0]?.value,
      })
    })

    it('with meta plugins', () => {
      const errors = {
        OVERRIDE: { message: 'override' },
      } satisfies ErrorMap

      ContractModule.setHiddenMetaPlugins(errors, [metaPlugin])

      const applied = builder.errors(errors)
      expect(applied).toBeInstanceOf(Builder)
      expect(applied).not.toBe(builder)

      expect(mergeErrorMapSpy).toHaveBeenCalledOnce()
      expect(mergeErrorMapSpy).toHaveBeenCalledWith(
        builder['~orpc'].errorMap,
        errors,
      )

      expect(resolveMetaPluginsSpy).toHaveBeenCalledOnce()
      expect(resolveMetaPluginsSpy).toHaveBeenCalledWith(
        builder['~orpc'].meta,
        builder['~orpc'].metaPlugins,
        [metaPlugin],
      )

      expect(applied['~orpc']).toEqual({
        ...builder['~orpc'],
        errorMap: mergeErrorMapSpy.mock.results[0]?.value,
        meta: resolveMetaPluginsSpy.mock.results[0]?.value[0],
        metaPlugins: resolveMetaPluginsSpy.mock.results[0]?.value[1],
      })
    })
  })

  describe('.use', () => {
    it('without meta plugins', () => {
      const middleware = vi.fn()
      const applied = builder.use(middleware)
      expect(applied).toBeInstanceOf(Builder)
      expect(applied).not.toBe(builder)

      expect(mergeErrorMapSpy).toHaveBeenCalledOnce()
      expect(mergeErrorMapSpy).toHaveBeenCalledWith(
        {},
        builder['~orpc'].errorMap,
      )

      expect(applied['~orpc']).toEqual({
        ...builder['~orpc'],
        errorMap: mergeErrorMapSpy.mock.results[0]?.value,
        orderedMiddlewares: [
          ...builder['~orpc'].orderedMiddlewares,
          {
            middleware,
            inputSchemasLengthAtUse: builder['~orpc'].inputSchemas!.length,
            outputSchemasLengthAtUse: builder['~orpc'].outputSchemas!.length,
          },
        ],
      })
    })

    it('with middleware error map', () => {
      const middleware: any = vi.fn()
      middleware['~orpc'] = { errorMap: { MID: { status: 400 } } }
      const applied = builder.use(middleware)

      expect(mergeErrorMapSpy).toHaveBeenCalledOnce()
      expect(mergeErrorMapSpy).toHaveBeenCalledWith(
        middleware['~orpc'].errorMap,
        builder['~orpc'].errorMap,
      )
    })

    it('with meta plugins', () => {
      const middleware: any = vi.fn()
      middleware['~orpc'] = { metaPlugins: [metaPlugin] }

      const applied = builder.use(middleware)
      expect(applied).toBeInstanceOf(Builder)
      expect(applied).not.toBe(builder)

      expect(resolveMetaPluginsSpy).toHaveBeenCalledOnce()
      expect(resolveMetaPluginsSpy).toHaveBeenCalledWith(
        builder['~orpc'].meta,
        builder['~orpc'].metaPlugins,
        [metaPlugin],
      )

      expect(applied['~orpc']).toEqual({
        ...builder['~orpc'],
        errorMap: mergeErrorMapSpy.mock.results[0]?.value,
        meta: resolveMetaPluginsSpy.mock.results[0]?.value[0],
        metaPlugins: resolveMetaPluginsSpy.mock.results[0]?.value[1],
        orderedMiddlewares: [
          ...builder['~orpc'].orderedMiddlewares,
          {
            middleware,
            inputSchemasLengthAtUse: builder['~orpc'].inputSchemas!.length,
            outputSchemasLengthAtUse: builder['~orpc'].outputSchemas!.length,
          },
        ],
      })
    })
  })

  describe('.middleware', () => {
    it('without previous middleware', () => {
      const b = Builder.create()
      const middleware = vi.fn()
      const decorated = { use: vi.fn().mockReturnThis() }
      decorateMiddlewareSpy.mockReturnValue(decorated as any)

      const applied = b.middleware(middleware)
      expect(applied).toBe(decorated)
      expect(applied['~orpc']).toEqual({
        errorMap: b['~orpc'].errorMap,
        metaPlugins: toArray(b['~orpc'].metaPlugins),
      })

      expect(decorateMiddlewareSpy).toHaveBeenCalledWith(middleware)
      expect(decorated.use).not.toHaveBeenCalled()
    })

    it('with previous middleware', () => {
      const middleware = vi.fn()
      const result = { use: vi.fn() }
      const decorated = { use: vi.fn().mockReturnValue(result) }
      decorateMiddlewareSpy.mockReturnValue(decorated as any)

      const applied = builder.middleware(middleware)
      expect(applied).toBe(result)
      expect(applied['~orpc']).toEqual({
        errorMap: builder['~orpc'].errorMap,
        metaPlugins: builder['~orpc'].metaPlugins,
      })

      expect(decorateMiddlewareSpy).toHaveBeenCalledWith(builder['~orpc'].orderedMiddlewares[0]!.middleware)
      expect(decorated.use).toHaveBeenCalledWith(middleware)
    })

    it('with meta plugins', () => {
      const middleware: AnyMiddleware = vi.fn() as any
      const midMetaPlugin: AnyMetaPlugin = { name: 'test', init: m => m }
      middleware['~orpc'] = {
        metaPlugins: [midMetaPlugin],
      }
      const decorated = { use: vi.fn().mockReturnThis() }
      decorateMiddlewareSpy.mockReturnValue(decorated as any)

      const applied = builder.middleware(middleware)
      expect(applied).toBe(decorated)
      expect(applied['~orpc']).toEqual({
        errorMap: builder['~orpc'].errorMap,
        metaPlugins: [...builder['~orpc'].metaPlugins!, midMetaPlugin],
      })
    })
  })

  describe('.input', () => {
    it('without meta plugins', () => {
      const schema = z.object({ input: z.string() })
      const applied = builder.input(schema)
      expect(applied).toBeInstanceOf(Builder)
      expect(applied).not.toBe(builder)

      expect(applied['~orpc']).toEqual({
        ...builder['~orpc'],
        inputSchemas: [...builder['~orpc'].inputSchemas!, schema],
      })
    })

    it('with meta plugins', () => {
      const schema = z.object({ input: z.string() })
      ContractModule.setHiddenMetaPlugins(schema, [metaPlugin])

      const applied = builder.input(schema)
      expect(applied).toBeInstanceOf(Builder)
      expect(applied).not.toBe(builder)

      expect(resolveMetaPluginsSpy).toHaveBeenCalledOnce()
      expect(resolveMetaPluginsSpy).toHaveBeenCalledWith(
        builder['~orpc'].meta,
        builder['~orpc'].metaPlugins,
        [metaPlugin],
      )

      expect(applied['~orpc']).toEqual({
        ...builder['~orpc'],
        meta: resolveMetaPluginsSpy.mock.results[0]?.value[0],
        metaPlugins: resolveMetaPluginsSpy.mock.results[0]?.value[1],
        inputSchemas: [...builder['~orpc'].inputSchemas!, schema],
      })
    })
  })

  describe('.output', () => {
    it('without meta plugins', () => {
      const schema = z.object({ output: z.string() })
      const applied = builder.output(schema)
      expect(applied).toBeInstanceOf(Builder)
      expect(applied).not.toBe(builder)
      expect(applied['~orpc']).toEqual({
        ...builder['~orpc'],
        outputSchemas: [...builder['~orpc'].outputSchemas!, schema],
      })
    })

    it('with meta plugins', () => {
      const schema = z.object({ output: z.string() })
      ContractModule.setHiddenMetaPlugins(schema, [metaPlugin])

      const applied = builder.output(schema)
      expect(applied).toBeInstanceOf(Builder)
      expect(applied).not.toBe(builder)

      expect(resolveMetaPluginsSpy).toHaveBeenCalledOnce()
      expect(resolveMetaPluginsSpy).toHaveBeenCalledWith(
        builder['~orpc'].meta,
        builder['~orpc'].metaPlugins,
        [metaPlugin],
      )

      expect(applied['~orpc']).toEqual({
        ...builder['~orpc'],
        meta: resolveMetaPluginsSpy.mock.results[0]?.value[0],
        metaPlugins: resolveMetaPluginsSpy.mock.results[0]?.value[1],
        outputSchemas: [...builder['~orpc'].outputSchemas!, schema],
      })
    })
  })

  describe('.handler', () => {
    it('without meta plugins', () => {
      const handler = vi.fn()
      const applied = builder.handler(handler)
      expect(applied).toBeInstanceOf(ProcedureDecoratedModule.DecoratedProcedure)
      expect(applied['~orpc']).toEqual({
        ...builder['~orpc'],
        handler,
      })
    })

    it('with meta plugins', () => {
      const handler = vi.fn()
      ContractModule.setHiddenMetaPlugins(handler, [metaPlugin])

      const applied = builder.handler(handler)
      expect(applied).toBeInstanceOf(ProcedureDecoratedModule.DecoratedProcedure)

      expect(resolveMetaPluginsSpy).toHaveBeenCalledOnce()
      expect(resolveMetaPluginsSpy).toHaveBeenCalledWith(
        builder['~orpc'].meta,
        builder['~orpc'].metaPlugins,
        [metaPlugin],
      )

      expect(applied['~orpc']).toEqual({
        ...builder['~orpc'],
        meta: resolveMetaPluginsSpy.mock.results[0]?.value[0],
        metaPlugins: resolveMetaPluginsSpy.mock.results[0]?.value[1],
        handler,
      })
    })
  })

  it('.router', () => {
    const router = { ping: builder.handler(vi.fn()) }
    const applied = builder.router(router)
    expect(applied).toBe(augmentRouterSpy.mock.results[0]?.value)
    expect(augmentRouterSpy).toHaveBeenCalledOnce()
    expect(augmentRouterSpy).toHaveBeenCalledWith(router, {
      ...builder['~orpc'],
      middlewares: builder['~orpc'].orderedMiddlewares.map((m: any) => m.middleware),
    })
  })

  it('.lazy', async () => {
    const router = { ping: builder.handler(vi.fn()) }
    const loader = async () => ({ default: router })
    const applied = builder.lazy(loader)

    expect(applied).toBeInstanceOf(LazyModule.Lazy)
    expect(applied['~orpc'].meta).toEqual(builder['~orpc'].meta)
    expect(applied['~orpc'].metaPlugins).toEqual(builder['~orpc'].metaPlugins)

    const unlazied = await applied['~orpc'].loader()
    expect(unlazied.default).toBe(augmentRouterSpy.mock.results[0]?.value)
    expect(augmentRouterSpy).toHaveBeenCalledOnce()
    expect(augmentRouterSpy).toHaveBeenCalledWith(router, {
      ...builder['~orpc'],
      middlewares: builder['~orpc'].orderedMiddlewares.map((m: any) => m.middleware),
    })
  })
})

describe('regressions', () => {
  it('.router keeps a __proto__ key as an own route instead of re-parenting the router', () => {
    const proc = os.handler(() => 'ok')
    const result = os.router({ ['__proto__']: proc, other: proc }) as any

    expect(result).not.toBeInstanceOf(Procedure)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.keys(result)).toEqual(['__proto__', 'other'])
    expect(getOwn(result, '__proto__')).toBeInstanceOf(Procedure)
  })

  it('.lazy loads and augments the router once across server-side client calls', async () => {
    const loaded = { ping: os.handler(() => 'pong'), nested: { pong: os.handler(() => 'ping') } }
    const loader = vi.fn(async () => ({ default: loaded }))
    const router = os.router({ lazy: os.lazy(loader) })
    const client = createRouterClient(router)

    await expect(client.lazy.ping()).resolves.toBe('pong')
    await expect(client.lazy.ping()).resolves.toBe('pong')
    await expect(client.lazy.nested.pong()).resolves.toBe('ping')

    expect(loader).toHaveBeenCalledTimes(1)
    expect(augmentRouterSpy.mock.calls.filter(([router]) => router === loaded)).toHaveLength(1)

    // the router augmented by the outer `os.router` is resolved once too
    const { default: first } = await LazyModule.unlazy(router.lazy)
    const { default: second } = await LazyModule.unlazy(router.lazy)
    expect(second).toBe(first)
    expect(first.ping).not.toBe(loaded.ping)
  })

  it('.lazy retries a failed load', async () => {
    const router = { ping: os.handler(() => 'pong') }
    const loader = vi.fn(async () => ({ default: router }))
      .mockRejectedValueOnce(new Error('boom'))
    const client = createRouterClient({ lazy: os.lazy(loader) })

    await expect(client.lazy.ping()).rejects.toThrow('boom')
    await expect(client.lazy.ping()).resolves.toBe('pong')
    await expect(client.lazy.ping()).resolves.toBe('pong')
    expect(loader).toHaveBeenCalledTimes(2)
  })
})

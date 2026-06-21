import { oc } from '@orpc/contract'
import z from 'zod'
import { ImplementedProcedure, ProcedureImplementer } from './implementer-procedure'
import { createRouterImplementer } from './implementer-router'
import { Lazy } from './lazy'
import * as MiddlewareDecoratedModule from './middleware-decorated'
import * as RouterHiddenModule from './router-hidden'
import * as RouterUtilsModule from './router-utils'

const decorateMiddlewareSpy = vi.spyOn(MiddlewareDecoratedModule, 'decorateMiddleware')
const augmentImplementedRouterSpy = vi.spyOn(RouterUtilsModule, 'augmentImplementedRouter')
const withHiddenRouterContractSpy = vi.spyOn(RouterHiddenModule, 'withHiddenRouterContract')

const contract = {
  ping: oc.input(z.object({})).output(z.object({})).errors({ INTERNAL_SERVER_ERROR: {} }),
  nested: {
    pong: oc.input(z.object({ pong: z.string() })),
  },

  // there method ensure that implementer can handle case where procedure/router conflict with method name
  use: oc.output(z.string()),
  middleware: oc.output(z.boolean()),
  router: {
    router: oc.output(z.date()),
  },
  lazy: {
    lazy: oc.output(z.iso.date()),
  },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createRouterImplementer', () => {
  describe('without middlewares', () => {
    const implementer = createRouterImplementer(contract)

    describe('router level', () => {
      it('.use', () => {
        const middleware = vi.fn()
        const applied = implementer.use(middleware)

        expect(applied.ping['~orpc'].orderedMiddlewares).toEqual([{ middleware }])
      })

      it('.middleware', () => {
        const middleware = vi.fn()
        const decorated = implementer.middleware(middleware)

        expect(decorateMiddlewareSpy).toHaveBeenCalledTimes(1)
        expect(decorateMiddlewareSpy).toHaveBeenCalledWith(middleware)

        expect(decorated).toBe(decorateMiddlewareSpy.mock.results[0]!.value)
      })

      it('.router', () => {
        const router = { nested: {} } as any
        const applied = implementer.router(router)
        expect(withHiddenRouterContractSpy).toHaveBeenCalledTimes(1)
        expect(withHiddenRouterContractSpy).toHaveBeenCalledWith(router, contract)
        expect(applied).toBe(withHiddenRouterContractSpy.mock.results[0]!.value)
      })

      it('.lazy', () => {
        const loader = vi.fn()
        const lazy = implementer.lazy(loader)

        expect(lazy).toBeInstanceOf(Lazy)
        expect(lazy['~orpc'].loader).toBe(loader)
        expect(lazy['~orpc'].meta).toEqual({})
      })

      it('handles router with names that conflict with router methods', () => {
        const mid = vi.fn()
        const applied = implementer.router.use(mid)

        expect(applied.router.handler(vi.fn())['~orpc'].orderedMiddlewares).toEqual([{ middleware: mid }])
      })
    })

    describe('procedure level', () => {
      it('is a procedureImplementer', () => {
        expect(implementer.ping).toBeInstanceOf(ProcedureImplementer)
        expect(implementer.ping['~orpc']).toMatchObject(contract.ping['~orpc'])
        expect(implementer.ping['~orpc'].orderedMiddlewares).toEqual([])

        expect(implementer.nested.pong).toBeInstanceOf(ProcedureImplementer)
        expect(implementer.nested.pong['~orpc']).toMatchObject(contract.nested.pong['~orpc'])
        expect(implementer.nested.pong['~orpc'].orderedMiddlewares).toEqual([])
      })

      it('handles procedures with names that conflict with router methods', () => {
        // not be a ProcedureImplementer but all it's methods/properties should be ProcedureImplementer
        expect(implementer.use).not.toBeInstanceOf(ProcedureImplementer)

        const procedure = implementer.use.handler(vi.fn())
        expect(procedure).toBeInstanceOf(ImplementedProcedure)
        expect(procedure['~orpc']).toMatchObject(contract.use['~orpc'])
        expect(procedure['~orpc'].orderedMiddlewares).toEqual([])
        expect(procedure['~orpc'].handler).toBeTypeOf('function')
      })
    })
  })

  describe('with middlewares', () => {
    const mid = vi.fn()
    const implementer = createRouterImplementer(contract).use(mid)

    describe('router level', () => {
      it('.use', () => {
        const middleware = vi.fn()
        const applied = implementer.use(middleware)

        expect(applied.ping['~orpc'].orderedMiddlewares).toEqual([{ middleware: mid }, { middleware }])
      })

      it('.middleware', () => {
        const middleware = vi.fn()

        const decoratedMiddleware = { use: vi.fn().mockReturnValueOnce('__MOCKED__') }
        decorateMiddlewareSpy.mockReturnValue(decoratedMiddleware as any)

        const decorated = implementer.middleware(middleware)

        expect(decorateMiddlewareSpy).toHaveBeenCalledTimes(1)
        expect(decorateMiddlewareSpy).toHaveBeenCalledWith(mid)
        expect(decoratedMiddleware.use).toHaveBeenCalledTimes(1)
        expect(decoratedMiddleware.use).toHaveBeenCalledWith(middleware)

        expect(decorated).toBe('__MOCKED__')
      })

      it('.router', () => {
        const router = { nested: {} } as any
        const applied = implementer.router(router)

        expect(augmentImplementedRouterSpy).toHaveBeenCalledTimes(1)
        expect(augmentImplementedRouterSpy).toHaveBeenCalledWith(router, {
          middlewares: [mid],
        })

        expect(withHiddenRouterContractSpy).toHaveBeenCalledTimes(1)
        expect(withHiddenRouterContractSpy).toHaveBeenCalledWith(augmentImplementedRouterSpy.mock.results[0]!.value, contract)

        expect(applied).toBe(withHiddenRouterContractSpy.mock.results[0]!.value)
      })

      it('.lazy', async () => {
        const router = { nested: {} } as any
        const loader = () => Promise.resolve({ default: router })
        const lazy = implementer.lazy(loader)

        expect(lazy).toBeInstanceOf(Lazy)
        expect(lazy['~orpc'].loader).not.toBe(loader)
        expect(lazy['~orpc'].meta).toEqual({})

        const { default: applied } = await lazy['~orpc'].loader()

        expect(augmentImplementedRouterSpy).toHaveBeenCalledTimes(1)
        expect(augmentImplementedRouterSpy).toHaveBeenCalledWith(router, {
          middlewares: [mid],
        })

        expect(applied).toBe(augmentImplementedRouterSpy.mock.results[0]!.value)
      })

      it('handles router with names that conflict with router methods', () => {
        const middleware = vi.fn()
        const applied = implementer.router.use(middleware)

        expect(applied.router.handler(vi.fn())['~orpc'].orderedMiddlewares).toEqual([{ middleware: mid }, { middleware }])
      })
    })

    describe('procedure level', () => {
      it('is a procedureImplementer', () => {
        expect(implementer.ping).toBeInstanceOf(ProcedureImplementer)
        expect(implementer.ping['~orpc']).toMatchObject(contract.ping['~orpc'])
        expect(implementer.ping['~orpc'].orderedMiddlewares).toEqual([{ middleware: mid }])

        expect(implementer.nested.pong).toBeInstanceOf(ProcedureImplementer)
        expect(implementer.nested.pong['~orpc']).toMatchObject(contract.nested.pong['~orpc'])
        expect(implementer.nested.pong['~orpc'].orderedMiddlewares).toEqual([{ middleware: mid }])
      })

      it('handles procedures with names that conflict with router methods', () => {
        // not be a ProcedureImplementer but all it's methods/properties should be ProcedureImplementer
        expect(implementer.use).not.toBeInstanceOf(ProcedureImplementer)

        const procedure = implementer.use.handler(vi.fn())
        expect(procedure).toBeInstanceOf(ImplementedProcedure)
        expect(procedure['~orpc']).toMatchObject(contract.use['~orpc'])
        expect(procedure['~orpc'].orderedMiddlewares).toEqual([{ middleware: mid }])
        expect(procedure['~orpc'].handler).toBeTypeOf('function')
      })
    })
  })

  describe('edge case', () => {
    it('is procedure implementer if implementer for single procedure', () => {
      const implementer = createRouterImplementer(contract.ping)
      expect(implementer).toBeInstanceOf(ProcedureImplementer)
      expect(implementer['~orpc']).toMatchObject(contract.ping['~orpc'])
      expect(implementer['~orpc'].orderedMiddlewares).toEqual([])
    })
  })
})

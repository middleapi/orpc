import type { RouterContract } from '@orpc/contract'
import { oc, ProcedureContract } from '@orpc/contract'
import z from 'zod'
import { os } from './builder'
import { implement } from './implementer'
import { ImplementedProcedure, ProcedureImplementer } from './implementer-procedure'
import * as ImplementerRouter from './implementer-router'
import { Procedure } from './procedure'
import { getHiddenRouterContract } from './router-hidden'

const createRouterImplementerSpy = vi.spyOn(ImplementerRouter, 'createRouterImplementer')

const contract = {
  ping: oc.input(z.object({})).output(z.object({})).errors({ INTERNAL_SERVER_ERROR: {} }),
  nested: {
    pong: oc.input(z.string()),
  },

  // ensure can handle procedure/router with name that conflict with implementer methods
  $context: oc.output(z.boolean({})),
  $config: oc.output(z.boolean({})),
} satisfies RouterContract

beforeEach(() => {
  vi.clearAllMocks()
})

describe('implement', () => {
  const implementer = implement(contract, { disableInputValidation: false })

  it('crate with router implementer', () => {
    void implement(contract, { disableInputValidation: false })
    expect(createRouterImplementerSpy).toHaveBeenCalledTimes(1)
    expect(createRouterImplementerSpy).toHaveBeenCalledWith(contract, { disableInputValidation: false })
  })

  describe('.$context', () => {
    it('on conflict procedure name', () => {
      expect(implementer.$context()).toBe(implementer)
    })

    it('without conflict', () => {
      const contract2 = {
        ping: contract.ping,
      }

      const implementer = implement(contract2)
      expect(implementer.$context()).toBe(implementer)
    })
  })

  describe('.$config', () => {
    it('on conflict procedure name', () => {
      const applied = implementer.$config({ disableOutputValidation: true })
      expect(applied.ping['~orpc'].disableInputValidation).toBe(false)
      expect(applied.ping['~orpc'].disableOutputValidation).toBe(true)
    })

    it('without conflict', () => {
      const contract2 = {
        ping: contract.ping,
      }

      const implementer = implement(contract2, { disableInputValidation: false })
      const applied = implementer.$config({ disableOutputValidation: true })
      expect(applied.ping['~orpc'].disableInputValidation).toBe(false)
      expect(applied.ping['~orpc'].disableOutputValidation).toBe(true)
    })
  })

  it('router/procedure access', () => {
    expect(implementer.ping).toBeInstanceOf(ProcedureImplementer)
    expect(implementer.nested.pong).toBeInstanceOf(ProcedureImplementer)
  })

  it('can handle procedure/router with name that conflict with implementer methods', () => {
    const mid = vi.fn()

    expect(implementer.$context.use(mid)).toBeInstanceOf(ProcedureImplementer)
    expect(implementer.$context.use(mid)['~orpc']).toMatchObject(contract.$context['~orpc'])
    expect(implementer.$context.use(mid)['~orpc'].orderedMiddlewares).toEqual([expect.objectContaining({ middleware: mid })])

    expect(implementer.$context.handler(vi.fn())).toBeInstanceOf(ImplementedProcedure)
    expect(implementer.$context.handler(vi.fn())['~orpc']).toMatchObject(contract.$context['~orpc'])
  })

  it('support implement single procedure', () => {
    const implementer = implement(contract.ping)
    expect(implementer.$context()).toBe(implementer)

    const mid = vi.fn()
    expect(implementer.use(mid)).toBeInstanceOf(ProcedureImplementer)
    expect(implementer.use(mid)['~orpc']).toMatchObject(contract.ping['~orpc'])
    expect(implementer.use(mid)['~orpc'].orderedMiddlewares).toEqual([expect.objectContaining({ middleware: mid })])
  })

  describe('with a normal router as the contract', () => {
    const real = {
      ping: os.$config({ disableInputValidation: true }).input(z.string()).handler(() => 'REAL'),
      nested: { pong: os.handler(() => 'REAL') },
    }

    it('strips procedures down to plain contracts', () => {
      const impl = implement(real)
      const hidden = getHiddenRouterContract(impl.router({
        ping: impl.ping.handler(() => 'MOCK'),
        nested: { pong: impl.nested.pong.handler(() => 'MOCK') },
      })) as any

      for (const procedure of [hidden.ping, hidden.nested.pong]) {
        expect(procedure).toBeInstanceOf(ProcedureContract)
        expect(procedure).not.toBeInstanceOf(Procedure)
      }

      expect(hidden.ping['~orpc']).toEqual({
        inputSchemas: real.ping['~orpc'].inputSchemas,
        outputSchemas: real.ping['~orpc'].outputSchemas,
        metaPlugins: real.ping['~orpc'].metaPlugins,
        errorMap: real.ping['~orpc'].errorMap,
        meta: real.ping['~orpc'].meta,
      })
    })

    it('never leaks implementation details into the implementer', () => {
      const impl = implement(real, { disableInputValidation: false })

      expect(impl.ping['~orpc'].disableInputValidation).toBe(false)
      expect((impl.ping['~orpc'] as any).handler).toBeUndefined()
      expect(impl.$config({ disableOutputValidation: true }).ping['~orpc'].disableInputValidation).toBe(false)
    })
  })
})

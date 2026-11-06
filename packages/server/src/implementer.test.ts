import type { RouterContract } from '@orpc/contract'
import { oc } from '@orpc/contract'
import * as z from 'zod'

import { ImplementedProcedure, ProcedureImplementer } from './implementer-procedure.ts'
import * as ImplementerRouter from './implementer-router.ts'
import { implement } from './implementer.ts'

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
  const implementer = implement(contract, { validation: { input: true } })

  it('crate with router implementer', () => {
    void implement(contract, { validation: { input: true } })
    expect(createRouterImplementerSpy).toHaveBeenCalledTimes(1)
    expect(createRouterImplementerSpy).toHaveBeenCalledWith(contract, {
      validation: { input: true },
    })
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
      const applied = implementer.$config({ validation: { output: false } })
      expect(applied.ping['~orpc'].validation).toEqual({ input: true, output: false })
    })

    it('without conflict', () => {
      const contract2 = {
        ping: contract.ping,
      }

      const implementer = implement(contract2, { validation: { input: true } })
      const applied = implementer.$config({ validation: { output: false } })
      expect(applied.ping['~orpc'].validation).toEqual({ input: true, output: false })
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
    expect(implementer.$context.use(mid)['~orpc'].orderedMiddlewares).toEqual([
      expect.objectContaining({ middleware: mid }),
    ])

    expect(implementer.$context.handler(vi.fn())).toBeInstanceOf(ImplementedProcedure)
    expect(implementer.$context.handler(vi.fn())['~orpc']).toMatchObject(contract.$context['~orpc'])
  })

  it('support implement single procedure', () => {
    const implementer = implement(contract.ping)
    expect(implementer.$context()).toBe(implementer)

    const mid = vi.fn()
    expect(implementer.use(mid)).toBeInstanceOf(ProcedureImplementer)
    expect(implementer.use(mid)['~orpc']).toMatchObject(contract.ping['~orpc'])
    expect(implementer.use(mid)['~orpc'].orderedMiddlewares).toEqual([
      expect.objectContaining({ middleware: mid }),
    ])
  })
})

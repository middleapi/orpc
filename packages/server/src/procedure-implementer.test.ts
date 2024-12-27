import { ContractProcedure } from '@orpc/contract'
import { z } from 'zod'
import { isProcedure } from './procedure'
import { ProcedureImplementer } from './procedure-implementer'

describe('self chainable', () => {
  const schema = z.object({ val: z.string().transform(v => Number.parseInt(v)) })
  const implementer = new ProcedureImplementer<{ id?: string }, undefined, typeof schema, typeof schema>({
    contract: new ContractProcedure({
      InputSchema: schema,
      OutputSchema: schema,
    }),
  })

  it('use middleware', () => {
    const mid1 = vi.fn()
    const mid2 = vi.fn()
    const i = implementer.use(mid1).use(mid2)

    expect(i).not.toBe(implementer)
    expect(i).toBeInstanceOf(ProcedureImplementer)
    expect(i['~orpc'].middlewares).toEqual([mid1, mid2])
  })

  it('use middleware with map input', () => {
    const mid = vi.fn()
    const map = vi.fn()

    const i = implementer.use(mid, map)

    expect(i).not.toBe(implementer)
    expect(i).toBeInstanceOf(ProcedureImplementer)
    expect(i['~orpc'].middlewares).toEqual([expect.any(Function)])

    map.mockReturnValueOnce('__input__')
    mid.mockReturnValueOnce('__mid__')

    expect((i as any)['~orpc'].middlewares[0]('input')).toBe('__mid__')

    expect(map).toBeCalledTimes(1)
    expect(map).toBeCalledWith('input')

    expect(mid).toBeCalledTimes(1)
    expect(mid).toBeCalledWith('__input__')
  })
})

describe('to DecoratedProcedure', () => {
  const schema = z.object({ val: z.string().transform(v => Number.parseInt(v)) })

  const global_mid = vi.fn()
  const implementer = new ProcedureImplementer<{ id?: string } | undefined, { db: string }, typeof schema, typeof schema>({
    contract: new ContractProcedure({
      InputSchema: schema,
      OutputSchema: schema,
    }),
    middlewares: [global_mid],
  })

  it('handler', () => {
    const handler = vi.fn()
    const procedure = implementer.handler(handler)

    expect(procedure).toSatisfy(isProcedure)
    expect(procedure['~orpc'].handler).toBe(handler)
    expect(procedure['~orpc'].middlewares).toEqual([global_mid])
  })
})

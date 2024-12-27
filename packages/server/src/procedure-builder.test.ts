import { ContractProcedure } from '@orpc/contract'
import { z } from 'zod'
import { isProcedure } from './procedure'
import { ProcedureBuilder } from './procedure-builder'
import { ProcedureImplementer } from './procedure-implementer'

describe('self chainable', () => {
  const builder = new ProcedureBuilder<{ id?: string }, undefined, undefined, undefined>({
    contract: new ContractProcedure({
      InputSchema: undefined,
      OutputSchema: undefined,
    }),
    middlewares: [],
  })

  const schema = z.object({ id: z.string().transform(v => Number.parseInt(v)) })
  const example = { id: '1' }
  const out_example = { id: 1 }

  it('route', () => {
    const route = { method: 'GET', path: '/test', deprecated: true, description: 'des', summary: 'sum', tags: ['hi'] } as const
    const routed = builder.route(route)

    expect(routed).not.toBe(builder)
    expect(routed).toBeInstanceOf(ProcedureBuilder)
    expect(routed['~orpc'].contract['~orpc'].route).toBe(route)
  })

  it('input', () => {
    const input_ed = builder.input(schema, example)

    expect(input_ed).not.toBe(builder)
    expect(input_ed).toBeInstanceOf(ProcedureBuilder)
    expect(input_ed['~orpc'].contract['~orpc'].InputSchema).toBe(schema)
    expect(input_ed['~orpc'].contract['~orpc'].inputExample).toBe(example)
  })

  it('output', () => {
    const output_ed = builder.output(schema, out_example)

    expect(output_ed).not.toBe(builder)
    expect(output_ed).toBeInstanceOf(ProcedureBuilder)
    expect(output_ed['~orpc'].contract['~orpc'].OutputSchema).toBe(schema)
    expect(output_ed['~orpc'].contract['~orpc'].outputExample).toBe(out_example)
  })
})

describe('to ProcedureImplementer', () => {
  const schema = z.object({ id: z.string().transform(v => Number.parseInt(v)) })

  const global_mid = vi.fn()
  const builder = new ProcedureBuilder<{ id?: string } | undefined, undefined, typeof schema, typeof schema>({
    contract: new ContractProcedure({
      InputSchema: schema,
      OutputSchema: schema,
    }),
    middlewares: [global_mid],
  })

  it('use middleware', () => {
    const mid = vi.fn()

    const implementer = builder.use(mid)

    expect(implementer).toBeInstanceOf(ProcedureImplementer)
    expect(implementer['~orpc'].middlewares).toEqual([global_mid, mid])
  })

  it('use middleware with map input', () => {
    const mid = vi.fn()
    const map_input = vi.fn()

    const implementer = builder.use(mid, map_input)
    expect(implementer).toBeInstanceOf(ProcedureImplementer)
    expect(implementer['~orpc'].middlewares).toEqual([global_mid, expect.any(Function)])

    map_input.mockReturnValueOnce('__input__')
    mid.mockReturnValueOnce('__mid__')

    expect((implementer as any)['~orpc'].middlewares[1]('input')).toBe('__mid__')

    expect(map_input).toBeCalledTimes(1)
    expect(map_input).toBeCalledWith('input')

    expect(mid).toBeCalledTimes(1)
    expect(mid).toBeCalledWith('__input__')
  })
})

describe('to DecoratedProcedure', () => {
  const schema = z.object({ id: z.string().transform(v => Number.parseInt(v)) })

  const global_mid = vi.fn()
  const builder = new ProcedureBuilder<{ id?: string } | undefined, undefined, typeof schema, typeof schema>({
    contract: new ContractProcedure({
      InputSchema: schema,
      OutputSchema: schema,
    }),
    middlewares: [global_mid],
  })

  it('handler', () => {
    const handler = vi.fn()
    const procedure = builder.handler(handler)

    expect(procedure).toSatisfy(isProcedure)

    expect(procedure['~orpc'].handler).toBe(handler)
    expect(procedure['~orpc'].middlewares).toEqual([global_mid])
  })
})

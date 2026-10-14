import { oc } from '@orpc/contract'
import z from 'zod'
import { JsonSchemaCoercer } from './coercer'
import { SmartCoercionHandlerPlugin } from './smart-coercion-handler-plugin'

describe('smartCoercionHandlerPlugin', () => {
  it('prepends its interceptor and skips coercion when input schemas are missing', async () => {
    const existingInterceptor = vi.fn()
    const plugin = new SmartCoercionHandlerPlugin()

    const options = plugin.init({ clientInterceptors: [existingInterceptor] } as any)

    expect(options.clientInterceptors).toHaveLength(2)
    expect(options.clientInterceptors?.[1]).toBe(existingInterceptor)

    const next = vi.fn().mockResolvedValue('handled')

    await expect(options.clientInterceptors?.[0]?.({
      procedure: oc,
      input: { value: '1' },
      next,
    } as any)).resolves.toBe('handled')

    expect(next).toHaveBeenCalledOnce()
    expect(next).toHaveBeenCalledWith()
  })

  it('coerces input schemas and reuses converted schemas from the cache', async () => {
    const plugin = new SmartCoercionHandlerPlugin()

    const procedure = oc
      .input(z.looseObject({ number: z.number() }))
      .input(z.looseObject({ boolean: z.boolean() }))

    const options = plugin.init({} as any)
    const interceptor = options.clientInterceptors?.[0]
    const next = vi.fn().mockResolvedValue('handled')

    await expect(interceptor?.({
      procedure,
      input: { number: '123', boolean: 'true' },
      next,
    } as any)).resolves.toBe('handled')

    await expect(interceptor?.({
      procedure,
      input: { number: '456', boolean: 'off' },
      next,
    } as any)).resolves.toBe('handled')

    expect(next).toHaveBeenNthCalledWith(1, { procedure, input: { number: 123, boolean: true } })
    expect(next).toHaveBeenNthCalledWith(2, { procedure, input: { number: 456, boolean: false } })
  })

  it('passes the step budget to its coercer', async () => {
    // one step for the array and three per item: more than one step per value, but well within the default
    const procedure = oc.input(z.array(z.union([z.boolean(), z.number()])))
    const input = Array.from({ length: 200 }, (_, i) => String(i))
    const next = vi.fn().mockResolvedValue('handled')

    await new SmartCoercionHandlerPlugin({ maxStepsPerValue: 1 }).init({} as any).clientInterceptors![0]!({ procedure, input, next } as any)
    expect(next.mock.calls[0]![0].input).toBe(input)

    await new SmartCoercionHandlerPlugin().init({} as any).clientInterceptors![0]!({ procedure, input, next } as any)
    expect(next.mock.calls[1]![0].input).toEqual(Array.from({ length: 200 }, (_, i) => i))
  })

  it('coerces deep recursive unions in linear time and still coerces every leaf', async () => {
    const Node: z.ZodType<any> = z.lazy(() => z.union([
      z.object({ n: z.number(), children: z.array(Node) }),
      z.object({ s: z.string(), children: z.array(Node) }),
    ]))

    let input: any = { n: '1', children: [] }
    for (let i = 0; i < 14; i++) {
      input = { n: '1', children: [input] }
    }

    const interceptor = new SmartCoercionHandlerPlugin().init({} as any).clientInterceptors![0]!
    const next = vi.fn().mockResolvedValue('ok')
    const spy = vi.spyOn(JsonSchemaCoercer.prototype as any, 'coerceInternal')

    try {
      await interceptor({ procedure: oc.input(Node), input, next } as any)
      expect(spy.mock.calls.length).toBeLessThan(2_000) // before the fix: 229368
    }
    finally {
      spy.mockRestore()
    }

    let node = next.mock.calls[0]![0].input
    for (let i = 0; i <= 14; i++) {
      expect(node.n).toBe(1)
      node = node.children[0]
    }
  })
})

import * as z from 'zod/v4'
import {
  experimental_ZodSmartCoercionPlugin as ZodSmartCoercionPlugin,
} from './coercer'

it('zodSmartCoercionPlugin ignore non-zod schemas', async () => {
  const plugin = new ZodSmartCoercionPlugin()
  const options = {} as any
  plugin.init(options)

  const coerce = (schema: any, input: unknown) => {
    let coerced: unknown

    options.clientInterceptors[0]({
      procedure: {
        '~orpc': {
          inputSchema: schema,
        },
      },
      input,
      next: (options: any) => {
        coerced = typeof options === 'object' ? options.input : input
      },
    })

    return coerced
  }

  const val = { value: 123 }

  expect(coerce(z.object({}), val)).toEqual(val)
  expect(coerce(z.object({}), val)).not.toBe(val)

  const z3 = await import('zod/v3')
  expect(coerce(z3.object({}), val)).toBe(val)

  const v = await import('valibot')
  expect(coerce(v.object({}), val)).toBe(val)
})

it('zodSmartCoercionPlugin prevents prototype injection', () => {
  const plugin = new ZodSmartCoercionPlugin()
  const options = {} as any
  plugin.init(options)

  const coerce = (schema: any, input: unknown) => {
    let coerced: unknown

    options.clientInterceptors[0]({
      procedure: {
        '~orpc': {
          inputSchema: schema,
        },
      },
      input,
      next: (options: any) => {
        coerced = typeof options === 'object' ? options.input : input
      },
    })

    return coerced
  }

  // `__proto__` must stay a normal own property instead of replacing the prototype
  for (const schema of [z.object({ a: z.number() }), z.record(z.string(), z.string())]) {
    const coerced: any = coerce(schema, JSON.parse('{"a":"123","__proto__":{"polluted":"true"}}'))

    expect(Object.hasOwn(coerced, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(coerced, '__proto__')!.value).toEqual({ polluted: 'true' })
    expect(coerced.polluted).toBeUndefined()
    expect(({} as any).polluted).toBeUndefined()
  }

  // `Object.prototype` members must not be used as sub-schemas
  expect(coerce(z.object({ a: z.number() }), { a: '123', constructor: '456' })).toEqual({ a: 123, constructor: '456' })
  expect(coerce(z.object({ a: z.number() }), { a: '123', toString: '456' })).toEqual({ a: 123, toString: '456' })
  expect(coerce(z.object({ a: z.number() }).catchall(z.number()), { a: '123', constructor: '456' })).toEqual({ a: 123, constructor: 456 })
})

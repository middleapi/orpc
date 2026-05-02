import * as z from 'zod'
import { ZodToJsonSchemaConverter } from '../../zod/src/zod4'
import { SmartCoercionPlugin } from './smart-coercion-plugin'

describe('smartCoercionPlugin', () => {
  it('should coerce input based on schema', async () => {
    const plugin = new SmartCoercionPlugin({
      schemaConverters: [
        new ZodToJsonSchemaConverter(),
      ],
    })
    const options = {} as any
    plugin.init(options)

    const coerce = async (schema: any, originalInput: unknown) => {
      let coerced: unknown

      await options.clientInterceptors[0]({
        procedure: {
          '~orpc': {
            inputSchema: schema,
          },
        },
        input: originalInput,
        next: ({ input } = { input: originalInput }) => {
          coerced = input
        },
      })

      return coerced
    }

    expect(await coerce(undefined, { a: '123' })).toEqual({ a: '123' })
    expect(await coerce(z.object({ a: z.number() }), { a: '123' })).toEqual({ a: 123 })
    expect(await coerce(z.object({ a: z.boolean() }), { a: 'on' })).toEqual({ a: true })
  })
})

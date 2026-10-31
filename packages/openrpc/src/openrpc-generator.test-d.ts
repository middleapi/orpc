import type { AnyProcedureContract } from '@orpc/contract'
import type { AnyProcedure } from '@orpc/server'
import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { OpenRPCGenerator } from './openrpc-generator'

describe('openRPCGenerator.generate', () => {
  const generator = new OpenRPCGenerator({ converters: [], serializer: new OpenAPIJsonSerializer() })

  it('types the generate options', () => {
    generator.generate({}, {
      base: { info: { title: 'Planets', version: '1.0.0' }, servers: [{ url: 'https://example.com/rpc' }], methods: [] },
      errorCodeMap: { OUT_OF_STOCK: 1001 },
      filter: (procedure, path) => {
        expectTypeOf(procedure).toEqualTypeOf<AnyProcedureContract | AnyProcedure>()
        expectTypeOf(path).toEqualTypeOf<string[]>()
        return true
      },
    })

    // @ts-expect-error the openrpc field is not configurable
    generator.generate({}, { base: { openrpc: '1.3.2' } })
    // @ts-expect-error JSON-RPC error codes are numbers
    generator.generate({}, { errorCodeMap: { OUT_OF_STOCK: '1001' } })
  })
})

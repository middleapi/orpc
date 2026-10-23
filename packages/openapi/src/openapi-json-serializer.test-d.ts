import type { RPCJsonSerialization, RPCJsonSerializer } from '@orpc/client'
import type { Public } from '@orpc/shared'
import type { OpenAPIJsonSerialization, OpenAPIJsonSerializer } from './openapi-json-serializer'
import type { OpenAPISerializer } from './openapi-serializer'

describe('openAPIJsonSerializer', () => {
  it('is assignable to RPCJsonSerializer', () => {
    expectTypeOf<OpenAPIJsonSerializer>().toExtend<Public<RPCJsonSerializer>>()
    expectTypeOf<OpenAPISerializer>().toExtend<Public<RPCJsonSerializer>>()
  })

  it('serializes to and deserializes from the RPC JSON serialization shape', () => {
    expectTypeOf<OpenAPIJsonSerialization>().toExtend<RPCJsonSerialization>()
    expectTypeOf<RPCJsonSerialization>().toExtend<OpenAPIJsonSerialization>()
  })
})

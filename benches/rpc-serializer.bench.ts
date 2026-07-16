import { RPCJsonSerializer, RPCSerializer } from '@orpc/client'
import { bench } from 'vitest'
import { cases, handlers } from './__shared__/payloads'

const jsonSerializer = new RPCJsonSerializer({ handlers })
const serializer = new RPCSerializer({ handlers })

describe('rpc json serializer', () => {
  for (const [label, payload] of cases) {
    bench(label, () => {
      jsonSerializer.deserialize(
        jsonSerializer.serialize(payload),
      )
    })
  }
})

describe('rpc serializer', () => {
  for (const [label, payload] of cases) {
    bench(label, () => {
      serializer.deserialize(
        serializer.serialize(payload),
      )
    })
  }
})

import { OpenAPIJsonSerializer, OpenAPISerializer } from '@orpc/openapi'
import { bench } from 'vitest'
import { cases, handlers } from './__shared__/payloads'

const jsonSerializer = new OpenAPIJsonSerializer({ handlers })
const serializer = new OpenAPISerializer({ handlers })

describe('openapi json serializer', () => {
  for (const [label, payload] of cases) {
    bench(label, () => {
      jsonSerializer.deserialize(
        jsonSerializer.serialize(payload),
      )
    })
  }
})

describe('openapi serializer', () => {
  for (const [label, payload] of cases) {
    bench(label, () => {
      serializer.deserialize(
        serializer.serialize(payload),
      )
    })
  }
})

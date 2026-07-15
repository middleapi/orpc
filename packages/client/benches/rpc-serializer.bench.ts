import { bench, describe } from 'vitest'
import { RPCJsonSerializer } from '../src/rpc-json-serializer'
import { RPCSerializer } from '../src/rpc-serializer'

const jsonSerializer = new RPCJsonSerializer()
const serializer = new RPCSerializer()

/**
 * A representative RPC payload containing a mix of plain values and the special
 * types the serializer has dedicated handlers for (Date, BigInt, Set, Map,
 * URL, RegExp), nested in arrays and objects. This mirrors the kind of data
 * that flows through the client on every request/response.
 */
function createComplexPayload() {
  return {
    id: 42,
    name: 'orpc',
    active: true,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    largeInt: 9007199254740993n,
    tags: new Set(['a', 'b', 'c', 'd']),
    metadata: new Map<string, unknown>([
      ['version', '2.0.0'],
      ['count', 1234],
      ['nested', new Date('2023-06-15T12:30:00.000Z')],
    ]),
    homepage: new URL('https://orpc.dev/docs'),
    pattern: /^[a-z0-9-]+$/i,
    items: Array.from({ length: 50 }, (_, i) => ({
      index: i,
      value: `item-${i}`,
      ratio: i / 50,
      when: new Date(2024, 0, i + 1),
      big: BigInt(i) * 1000n,
    })),
    nested: {
      level1: {
        level2: {
          level3: {
            values: [1, 2, 3, 4, 5],
            flag: false,
            note: undefined,
          },
        },
      },
    },
  }
}

const complexPayload = createComplexPayload()
const serializedComplex = jsonSerializer.serialize(complexPayload)

const flatPayload = {
  ok: true,
  status: 200,
  message: 'hello world',
  count: 12345,
  ratio: 3.14159,
}
const serializedFlat = jsonSerializer.serialize(flatPayload)

describe('rPCJsonSerializer', () => {
  bench('serialize complex payload', () => {
    jsonSerializer.serialize(complexPayload)
  })

  bench('deserialize complex payload', () => {
    jsonSerializer.deserialize(structuredCloneable(serializedComplex))
  })

  bench('serialize flat payload', () => {
    jsonSerializer.serialize(flatPayload)
  })

  bench('deserialize flat payload', () => {
    jsonSerializer.deserialize(structuredCloneable(serializedFlat))
  })
})

describe('rPCSerializer', () => {
  bench('serialize + deserialize roundtrip', () => {
    const body = serializer.serialize(complexPayload)
    serializer.deserialize(body)
  })
})

/**
 * `deserialize` mutates the meta-referenced values in place, so give it a fresh
 * copy each iteration to keep the benchmark measuring the same work.
 */
function structuredCloneable<T>(value: T): T {
  return structuredClone(value)
}

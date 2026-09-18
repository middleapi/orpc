import { builtInRPCSupportDataTypes } from '../../../tests/rpc/__shared__/built-in-support-data-types'
import { RPCJsonSerializer } from './rpc-json-serializer'

class Person {
  constructor(
    public name: string,
    public date: Date,
  ) {}

  toJSON() {
    return {
      name: this.name,
      date: this.date,
    }
  }
}

class Person2 {
  constructor(
    public name: string,
    public data: any,
  ) { }

  toJSON() {
    return {
      name: this.name,
      data: this.data,
    }
  }
}

const customSupportedDataTypes: { name: string, value: unknown, expected: unknown }[] = [
  {
    name: 'person - 1',
    value: new Person('dinwwwh', new Date('2023-01-01')),
    expected: new Person('dinwwwh', new Date('2023-01-01')),
  },
  {
    name: 'person - 2',
    value: new Person2('dinwwwh - 2', [{ nested: new Date('2023-01-02') }, new URL('https://dinwwwh.com')]),
    expected: new Person2('dinwwwh - 2', [{ nested: new Date('2023-01-02') }, new URL('https://dinwwwh.com')]),
  },
  {
    name: 'should not resolve toJSON',
    value: { value: { toJSON: () => 'hello' } },
    expected: { value: { } },
  },
  {
    name: 'should resolve invalid toJSON',
    value: { value: { toJSON: 'hello' } },
    expected: { value: { toJSON: 'hello' } },
  },
]

/**
 * Simulates the real transport: json/meta/maps travel as JSON text,
 * blobs travel as separate binary parts.
 */
function roundTripThroughWire(serializer: RPCJsonSerializer, value: unknown): unknown {
  const { json, meta, maps, blobs } = serializer.serialize(value)
  const wire = JSON.parse(JSON.stringify({ json, meta, maps }))
  return serializer.deserialize({ ...wire, blobs })
}

describe.each([
  ...builtInRPCSupportDataTypes,
  ...customSupportedDataTypes,
])('rpcJsonSerializer: $name', ({ value, expected }) => {
  const serializer = new RPCJsonSerializer({
    handlers: {
      person: {
        condition: data => data instanceof Person,
        serialize: data => data.toJSON(),
        deserialize: data => new Person(data.name, data.date),
      },
      person2: {
        condition: data => data instanceof Person2,
        serialize: data => data.toJSON(),
        deserialize: data => new Person2(data.name, data.data),
      },
    },
  })

  function assert(value: unknown, expected: unknown) {
    expect(roundTripThroughWire(serializer, value)).toEqual(expected)
  }

  it('flat', () => {
    assert(value, expected)
  })

  it('nested object', () => {
    assert({
      data: value,
      nested: {
        data: value,
      },
    }, {
      data: expected,
      nested: {
        data: expected,
      },
    })
  })

  it('nested array', () => {
    assert([value, [value]], [expected, [expected]])
  })

  it('complex', () => {
    assert({
      'date': new Date('2023-01-01'),
      'url': new URL('https://dinwwwh.com'),
      '!@#$%^^&()[]>?<~_<:"~+!_': value,
      'list': [value],
      'map': new Map([[value, value]]),
      'set': new Set([value]),
      'nested': {
        nested: value,
      },
    }, {
      'date': new Date('2023-01-01'),
      'url': new URL('https://dinwwwh.com'),
      '!@#$%^^&()[]>?<~_<:"~+!_': expected,
      'list': [expected],
      'map': new Map([[expected, expected]]),
      'set': new Set([expected]),
      'nested': {
        nested: expected,
      },
    })
  })
})

describe('rpcJsonSerializer: wire format', () => {
  const serializer = new RPCJsonSerializer()

  it('produces plain JSON values plus meta describing how to restore them', () => {
    const { json, meta } = serializer.serialize({
      id: 7n,
      createdAt: new Date('2023-01-01T00:00:00.000Z'),
      tags: new Set(['a']),
      scores: new Map([['x', 1]]),
      homepage: new URL('https://orpc.dev'),
      missing: Number.NaN,
    })

    expect(json).toEqual({
      id: '7',
      createdAt: '2023-01-01T00:00:00.000Z',
      tags: ['a'],
      scores: [['x', 1]],
      homepage: 'https://orpc.dev/',
      missing: null,
    })

    expect(meta).toEqual(expect.arrayContaining([
      ['bigint', 'id'],
      ['date', 'createdAt'],
      ['set', 'tags'],
      ['map', 'scores'],
      ['url', 'homepage'],
      ['nan', 'missing'],
    ]))
    expect(meta).toHaveLength(6)
  })

  it('omits meta entirely for pure JSON payloads', () => {
    const serialized = serializer.serialize({ name: 'test', items: [1, 'two', true, null] })
    expect(serialized.meta).toBeUndefined()
    expect(serialized.maps).toBeUndefined()
    expect(serialized.blobs).toBeUndefined()
  })

  it('collects nested files into maps and blobs', () => {
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    const { maps, blobs } = serializer.serialize({ upload: { doc: file }, note: 'x' })

    expect(maps).toEqual([['upload', 'doc']])
    expect(blobs).toEqual([file])
  })
})

describe('rpcJsonSerializer: edge cases', () => {
  const serializer = new RPCJsonSerializer()

  it('round-trips undefined inside arrays', () => {
    expect(roundTripThroughWire(serializer, [undefined, 1, undefined])).toEqual([undefined, 1, undefined])
  })

  it('round-trips undefined inside sets and maps', () => {
    expect(roundTripThroughWire(serializer, new Set([undefined, 1]))).toEqual(new Set([undefined, 1]))
    expect(roundTripThroughWire(serializer, new Map([[undefined, undefined]]))).toEqual(new Map([[undefined, undefined]]))
  })

  it('omits undefined object properties by default', () => {
    const serialized = serializer.serialize({ a: 1, b: undefined })
    expect(serialized.json).toEqual({ a: 1 })
    expect(serialized.meta).toBeUndefined()
  })

  it('preserves undefined object properties when omitUndefinedProperties is false', () => {
    const custom = new RPCJsonSerializer({ omitUndefinedProperties: false })

    const serialized = custom.serialize({ a: 1, b: undefined })
    expect(serialized.json).toEqual({ a: 1, b: null })
    expect(serialized.meta).toEqual([['undefined', 'b']])

    expect(roundTripThroughWire(custom, { a: 1, b: undefined })).toEqual({ a: 1, b: undefined })
  })

  it('round-trips empty containers', () => {
    expect(roundTripThroughWire(serializer, {})).toEqual({})
    expect(roundTripThroughWire(serializer, [])).toEqual([])
    expect(roundTripThroughWire(serializer, new Set())).toEqual(new Set())
    expect(roundTripThroughWire(serializer, new Map())).toEqual(new Map())
    expect(roundTripThroughWire(serializer, '')).toBe('')
  })

  it('round-trips empty and numeric-looking object keys', () => {
    const value = { '': 'empty', '0': 'zero', '00': 'padded', 'ключ': 'unicode' }
    expect(roundTripThroughWire(serializer, value)).toEqual(value)
  })

  it('round-trips deeply nested structures', () => {
    let value: any = new Date('2023-01-01')
    let expected: any = new Date('2023-01-01')
    for (let i = 0; i < 100; i++) {
      value = { nested: value, list: [i] }
      expected = { nested: expected, list: [i] }
    }

    expect(roundTripThroughWire(serializer, value)).toEqual(expected)
  })

  it('passes through values no handler understands', () => {
    const symbol = Symbol('sym')
    expect(serializer.serialize(symbol).json).toBe(symbol)

    const fn = () => 'x'
    expect(serializer.serialize(fn).json).toBe(fn)
  })
})

describe('rpcJsonSerializer: custom handlers', () => {
  it('supports overriding default handlers', () => {
    const serializer = new RPCJsonSerializer({
      handlers: {
        date: {
          condition: data => data instanceof Date,
          serialize: (value: Date) => `___TEST___${value.getTime()}`,
          deserialize: (value: string) => new Date(Number(value.slice(10))),
        },
      },
    })

    const date = new Date('2023-01-01')
    const serialized = serializer.serialize({ value: date })
    expect(serialized.json).toEqual({ value: `___TEST___${date.getTime()}` })
    expect(serialized.meta).toEqual([['date', 'value']])

    expect(roundTripThroughWire(serializer, { value: date })).toEqual({ value: date })
  })

  it('supports disabling default handlers', () => {
    const serializer = new RPCJsonSerializer({
      handlers: {
        date: undefined,
      },
    })

    const date = new Date('2023-01-01')
    const serialized = serializer.serialize({ value: date, list: [undefined] })
    expect(serialized.json).toEqual({ value: date, list: [null] })
    expect(serialized.meta).toEqual([['undefined', 'list', 0]])
  })

  it('keeps serializing non-terminal handler results, so nested values are restored too', () => {
    const serializer = new RPCJsonSerializer({
      handlers: {
        person: {
          condition: data => data instanceof Person,
          serialize: (data: Person) => data.toJSON(),
          deserialize: data => new Person(data.name, data.date),
        },
      },
    })

    const person = new Person('dinwwwh', new Date('2023-01-01'))
    const restored = roundTripThroughWire(serializer, { person }) as any

    expect(restored.person).toBeInstanceOf(Person)
    expect(restored.person.date).toBeInstanceOf(Date)
    expect(restored.person).toEqual(person)
  })

  it('treats terminal handler results as final, without further serialization', () => {
    const serializer = new RPCJsonSerializer({
      handlers: {
        person: {
          condition: data => data instanceof Person,
          serialize: (data: Person) => data.toJSON(),
          deserialize: data => data,
          isTerminal: true,
        },
      },
    })

    const date = new Date('2023-01-01')
    const serialized = serializer.serialize({ person: new Person('dinwwwh', date) })

    // the nested Date stays untouched because the terminal result is not walked
    expect((serialized.json as any).person.date).toBe(date)
    expect(serialized.meta).toEqual([['person', 'person']])
  })

  it('keeps every built-in type working when any built-in handler is customized', () => {
    // customizing a built-in key switches to the generic handler scan; every default handler must still work there
    const serializer = new RPCJsonSerializer({
      handlers: {
        undefined: {
          condition: data => data === undefined,
          serialize: () => null,
          deserialize: () => undefined,
          isTerminal: true,
        },
      },
    })

    const value = {
      date: new Date('2023-01-01'),
      invalidDate: new Date('Invalid'),
      nan: Number.NaN,
      url: new URL('https://orpc.dev'),
      set: new Set([1, 2]),
      map: new Map([['a', 1]]),
      bigint: 123n,
      list: [undefined],
      plain: 'text',
    }

    expect(roundTripThroughWire(serializer, value)).toEqual(value)
  })

  it('collects blobs returned by terminal custom handlers', () => {
    class BlobContainer {
      constructor(public blob: Blob) {}
    }

    const serializer = new RPCJsonSerializer({
      handlers: {
        blobContainer: {
          condition: data => data instanceof BlobContainer,
          serialize: (data: BlobContainer) => data.blob,
          deserialize: (blob: Blob) => new BlobContainer(blob),
          isTerminal: true,
        },
      },
    })

    const blob = new Blob(['hello'], { type: 'text/plain' })
    const serialized = serializer.serialize({ file: new BlobContainer(blob) })

    expect(serialized.meta).toEqual([['blobContainer', 'file']])
    expect(serialized.maps).toEqual([['file']])
    expect(serialized.blobs).toEqual([blob])

    const deserialized = serializer.deserialize(serialized) as any
    expect(deserialized.file).toBeInstanceOf(BlobContainer)
    expect(deserialized.file.blob).toBe(blob)
  })
})

describe('rpcJsonSerializer: security', () => {
  const serializer = new RPCJsonSerializer()

  afterEach(() => {
    expect(({} as any).polluted).toBeUndefined()
    expect((Object.prototype as any).polluted).toBeUndefined()
  })

  it.each(['doesNotExist', '__proto__', 'constructor', 'prototype'])('throws when a meta or blob path references the non-own segment "%s"', (segment) => {
    const error = `Security error: Invalid serialized data. Segment "${segment}" does not exist.`

    expect(
      () => serializer.deserialize({ json: { o: {} }, meta: [['date', segment]] }),
    ).toThrow(error)

    expect(
      () => serializer.deserialize({ json: { o: {} }, meta: [['date', 'o', segment]] }),
    ).toThrow(error)

    expect(
      () => serializer.deserialize({ json: { o: {} }, meta: [['date', segment, 'o']] }),
    ).toThrow(error)

    expect(
      () => serializer.deserialize({ json: { o: {} }, blobs: [new Blob()], maps: [[segment]] }),
    ).toThrow(error)

    expect(
      () => serializer.deserialize({ json: { o: {} }, blobs: [new Blob()], maps: [['o', segment]] }),
    ).toThrow(error)

    expect(
      () => serializer.deserialize({ json: { o: {} }, blobs: [new Blob()], maps: [[segment, 'o']] }),
    ).toThrow(error)
  })

  it.each(['nonexistent', '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf'])('never resolves the meta type "%s" through the prototype chain', (type) => {
    expect(() => serializer.deserialize({ json: 1, meta: [[type]] })).toThrow()
  })

  it('throws instead of producing garbage for corrupted built-in payloads', () => {
    expect(() => serializer.deserialize({ json: 'not-a-bigint', meta: [['bigint']] })).toThrow()
    expect(() => serializer.deserialize({ json: 'not-an-array', meta: [['set']] })).toThrow('not a valid "set" payload')
    expect(() => serializer.deserialize({ json: 'not-an-array', meta: [['map']] })).toThrow('not a valid "map" payload')
    expect(() => serializer.deserialize({ json: 1, meta: [['url']] })).toThrow('not a valid "url" payload')
    expect(() => serializer.deserialize({ json: 1, meta: [['bigint']] })).toThrow('not a valid "bigint" payload')
    expect(() => serializer.deserialize({ json: 1, meta: [['date']] })).toThrow('not a valid "date" payload')
  })

  /* eslint-disable no-proto, no-restricted-properties */
  it('serializes own __proto__ keys as plain data', () => {
    // JSON.parse creates own __proto__ properties, exactly like a real request body
    const input = JSON.parse('{"__proto__": {"polluted": true}}')

    const restored = roundTripThroughWire(serializer, input) as any

    expect(Object.hasOwn(restored, '__proto__')).toBe(true)
    expect(restored.__proto__).toEqual({ polluted: true })
    expect(restored.polluted).toBeUndefined()
  })

  it('restores values behind own __proto__ keys without touching prototypes', () => {
    const restored = serializer.deserialize({
      json: JSON.parse('{"__proto__": {"when": "2023-01-01T00:00:00.000Z"}}'),
      meta: [['date', '__proto__', 'when']],
    }) as any

    expect(Object.hasOwn(restored, '__proto__')).toBe(true)
    expect(restored.__proto__.when).toBeInstanceOf(Date)
  })

  it('restores a value stored directly under an own __proto__ key', () => {
    const restored = serializer.deserialize({
      json: JSON.parse('{"__proto__": "2023-01-01T00:00:00.000Z"}'),
      meta: [['date', '__proto__']],
    }) as any

    expect(Object.hasOwn(restored, '__proto__')).toBe(true)
    expect(restored.__proto__).toBeInstanceOf(Date)
  })

  it('walks an own constructor/prototype chain without reaching the real Object.prototype', () => {
    const blob = new Blob(['x'])

    const restored = serializer.deserialize({
      json: JSON.parse('{"constructor": {"prototype": {"when": "2023-01-01T00:00:00.000Z", "polluted": null}}}'),
      meta: [['date', 'constructor', 'prototype', 'when']],
      maps: [['constructor', 'prototype', 'polluted']],
      blobs: [blob],
    }) as any

    expect(restored.constructor.prototype.when).toBeInstanceOf(Date)
    expect(restored.constructor.prototype.polluted).toBe(blob)
  })

  it('restores a blob stored directly under an own __proto__ key', () => {
    const blob = new Blob(['x'])

    const restored = serializer.deserialize({
      json: JSON.parse('{"__proto__": null}'),
      maps: [['__proto__']],
      blobs: [blob],
    }) as any

    expect(Object.hasOwn(restored, '__proto__')).toBe(true)
    expect(restored.__proto__).toBe(blob)
    expect(Object.getPrototypeOf(restored)).toBe(Object.prototype)
  })
  /* eslint-enable no-proto, no-restricted-properties */

  describe('keeps deserialization work linear in the body size', () => {
    /**
     * A `meta` array may name the same path many times. Rebuilding the value once per entry
     * would cost (elements x meta entries) while the body only grows with (elements + meta
     * entries), so a small request could block the event loop for seconds.
     */
    it.each([
      ['set', [1, 2, 3]],
      ['map', [['a', 1], ['b', 2]]],
      ['url', 'https://orpc.dev/'],
      ['bigint', '7'],
      ['date', '2023-01-01T00:00:00.000Z'],
    ])('rejects a repeated "%s" entry for the same path', (type, json) => {
      expect(() => serializer.deserialize({ json, meta: [[type]] })).not.toThrow()
      expect(
        () => serializer.deserialize({ json, meta: [[type], [type]] }),
      ).toThrow(`not a valid "${type}" payload`)
    })

    it('stays fast for a payload built to repeat conversions', () => {
      const json = Array.from({ length: 80_000 }, (_, i) => i)
      const meta = Array.from({ length: 16_000 }, () => ['set'] as [string])

      const started = performance.now()
      expect(() => serializer.deserialize({ json, meta })).toThrow('not a valid "set" payload')
      expect(performance.now() - started).toBeLessThan(1000)
    })
  })

  it('still applies two meta entries that legitimately share one path', () => {
    /**
     * A non-terminal handler whose `serialize` returns a built-in container makes the
     * serializer emit both entries at the same path, so rejecting repeated paths outright
     * would break this. The shape assertions bound the work instead.
     */
    class Tags {
      constructor(public items: string[]) {}
    }

    const custom = new RPCJsonSerializer({
      handlers: {
        tags: {
          condition: (v: unknown) => v instanceof Tags,
          serialize: (v: Tags) => new Set(v.items),
          deserialize: (v: Set<string>) => new Tags([...v]),
        },
      },
    })

    expect(custom.serialize({ a: new Tags(['x', 'y']) }).meta).toEqual([['set', 'a'], ['tags', 'a']])

    const restored = roundTripThroughWire(custom, { a: new Tags(['x', 'y']) }) as any
    expect(restored.a).toBeInstanceOf(Tags)
    expect(restored.a.items).toEqual(['x', 'y'])
  })

  it('does not rebuild a RegExp from serialized input', () => {
    // Compiling an attacker-supplied pattern is expensive, and every later use of the
    // compiled matcher is attacker-controlled too, so `regexp` is opt-in.
    expect(() => serializer.deserialize({ json: '/^a$/i', meta: [['regexp']] })).toThrow()
    expect(serializer.serialize(/^a$/i).meta).toBeUndefined()
  })
})

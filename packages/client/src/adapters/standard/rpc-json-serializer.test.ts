import { supportedDataTypes } from '../../../tests/shared'
import { STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES, StandardRPCJsonSerializer } from './rpc-json-serializer'

/**
 * `vi.spyOn(globalThis, 'RegExp')` swaps the global, so `instanceof RegExp` must use the original.
 */
const OriginalRegExp = RegExp

afterEach(() => {
  vi.restoreAllMocks()
})

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
    value: new Person('Dinh Le', new Date('2023-01-01')),
    expected: new Person('Dinh Le', new Date('2023-01-01')),
  },
  {
    name: 'person - 2',
    value: new Person2('Dinh Le - 2', [{ nested: new Date('2023-01-02') }, /uic/gi]),
    expected: new Person2('Dinh Le - 2', [{ nested: new Date('2023-01-02') }, /uic/gi]),
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

describe.each([
  ...supportedDataTypes,
  ...customSupportedDataTypes,
])('standardRPCJsonSerializer: $name', ({ value, expected }) => {
  const serializer = new StandardRPCJsonSerializer({
    customJsonSerializers: [
      {
        type: 20,
        condition: data => data instanceof Person,
        serialize: data => data.toJSON(),
        deserialize: data => new Person(data.name, data.date),
      },
      {
        type: 21,
        condition: data => data instanceof Person2,
        serialize: data => data.toJSON(),
        deserialize: data => new Person2(data.name, data.data),
      },
    ],
  })

  function assert(value: unknown, expected: unknown) {
    const [json, meta, maps, blobs] = serializer.serialize(value)

    const result = JSON.parse(JSON.stringify({ json, meta, maps }))

    const deserialized = serializer.deserialize(
      result.json,
      result.meta,
      result.maps,
      (i: number) => blobs[i]!,
    )
    expect(deserialized).toEqual(expected)
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
      'regexp': /uic/gi,
      'url': new URL('https://orpc.dev'),
      '!@#$%^^&()[]>?<~_<:"~+!_': value,
      'list': [value],
      'map': new Map([[value, value]]),
      'set': new Set([value]),
      'nested': {
        nested: value,
      },
    }, {
      'date': new Date('2023-01-01'),
      'regexp': /uic/gi,
      'url': new URL('https://orpc.dev'),
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

describe('standardRPCJsonSerializer: undefined in arrays produces JSON-safe output', () => {
  const serializer = new StandardRPCJsonSerializer()

  it('serialize uses null as placeholder for undefined array elements', () => {
    const [json] = serializer.serialize([undefined, 'a', undefined])
    expect(json).toEqual([null, 'a', null])
  })

  it('round-trips undefined array elements through JSON.parse(JSON.stringify(...))', () => {
    const [json, meta, maps, blobs] = serializer.serialize([undefined, 'a', undefined])
    const result = JSON.parse(JSON.stringify({ json, meta, maps }))
    const deserialized = serializer.deserialize(result.json, result.meta, result.maps, (i: number) => blobs[i]!)
    expect(deserialized).toEqual([undefined, 'a', undefined])
  })

  it('round-trips nested undefined array elements (e.g. TanStack Query pageParams)', () => {
    const data = { pageParams: [undefined, 'cursor_abc'], pages: [{ items: [1, 2] }] }
    const [json, meta, maps, blobs] = serializer.serialize(data)
    const result = JSON.parse(JSON.stringify({ json, meta, maps }))
    const deserialized = serializer.deserialize(result.json, result.meta, result.maps, (i: number) => blobs[i]!)
    expect(deserialized).toEqual(data)
  })
})

describe('standardRPCJsonSerializer: custom serializers', () => {
  it('should throw when type is duplicated', () => {
    expect(() => {
      return new StandardRPCJsonSerializer({
        customJsonSerializers: [
          {
            type: 20,
            condition: data => data instanceof Person,
            serialize: data => data.toJSON(),
            deserialize: data => new Person(data.name, data.date),
          },
          {
            type: 20,
            condition: data => data instanceof Person,
            serialize: data => data.toJSON(),
            deserialize: data => new Person(data.name, data.date),
          },
        ],
      })
    }).toThrow('Custom serializer type must be unique.')
  })

  it.each(['nonExist', '__proto__', 'constructor', 'prototype'])('should throw when accessing non-existent path during deserialization: %s', (segment) => {
    const serializer = new StandardRPCJsonSerializer()

    expect(
      () => serializer.deserialize({ a: {} }, [[1, segment]]),
    ).toThrow(`Invalid RPC serialized data: segment "${segment}" does not exist.`)

    expect(
      () => serializer.deserialize({ a: {} }, [[1, 'a', segment]]),
    ).toThrow(`Invalid RPC serialized data: segment "${segment}" does not exist.`)

    expect(
      () => serializer.deserialize({ a: {} }, [[1, segment, 'role']]),
    ).toThrow(`Invalid RPC serialized data: segment "${segment}" does not exist.`)

    expect(
      () => serializer.deserialize({ a: {} }, [], [[segment]], () => new Blob([])),
    ).toThrow(`Invalid RPC serialized data: segment "${segment}" does not exist.`)

    expect(
      () => serializer.deserialize({ a: {} }, [], [['a', segment]], () => new Blob([])),
    ).toThrow(`Invalid RPC serialized data: segment "${segment}" does not exist.`)

    expect(
      () => serializer.deserialize({ a: {} }, [], [[segment, 'role']], () => new Blob([])),
    ).toThrow(`Invalid RPC serialized data: segment "${segment}" does not exist.`)
  })
})

describe('standardRPCJsonSerializer: deserialize', () => {
  const serializer = new StandardRPCJsonSerializer()

  it.each([
    ['json', { count: 10n, list: [{ tags: new Set(['a']), nested: [new Date('2023-01-01'), new URL('https://orpc.dev')] }] }],
    ['blobs', { files: [new Blob(['hello'])], map: new Map([[1n, new Set(['a'])]]) }],
  ])('does not mutate the input and can deserialize repeatedly: %s', (_, value) => {
    // https://github.com/middleapi/orpc/issues/2053
    const [json, meta, maps, blobs] = serializer.serialize(value)
    const snapshot = JSON.stringify({ json, meta, maps })

    const deserialize = () => blobs.length
      ? serializer.deserialize(json, meta, maps, i => blobs[i]!)
      : serializer.deserialize(json, meta)

    expect(deserialize()).toEqual(value)
    expect(deserialize()).toEqual(value)
    expect(JSON.stringify({ json, meta, maps })).toBe(snapshot)
  })
})

describe('standardRPCJsonSerializer: untrusted serialized values', () => {
  const serializer = new StandardRPCJsonSerializer()
  const { BIGINT, DATE, NAN, UNDEFINED, URL: URL_TYPE, REGEXP, SET, MAP } = STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES

  it.each([
    [BIGINT, 'bigint', 'a string', [null, 1, true, [], {}]],
    [DATE, 'date', 'a string or null', [1, true, [], {}]],
    [NAN, 'nan', 'null', ['text', 1, true, [], {}]],
    [UNDEFINED, 'undefined', 'null', ['text', 1, true, [], {}]],
    [URL_TYPE, 'url', 'a string', [null, 1, true, [], {}]],
    [REGEXP, 'regexp', 'a string', [null, 1, true, [], {}]],
    [SET, 'set', 'an array', [null, 'text', 1, true, {}]],
    [MAP, 'map', 'an array', [null, 'text', 1, true, {}]],
  ])('type %i (%s) rejects mistyped serialized values', (type, name, expected, rejected) => {
    for (const value of rejected) {
      expect(() => serializer.deserialize({ value }, [[type, 'value']]))
        .toThrow(`Invalid RPC serialized data: type ${type} (${name}) expects ${expected}.`)
    }
  })

  it('rejects regexp strings that are not in "/pattern/flags" form or carry invalid flags', () => {
    for (const value of ['uic', '/uic', 'uic/gi', '/uic/GI', '', '/uic/x', '/uic/gg', '/uic/uv']) {
      expect(() => serializer.deserialize({ value }, [[REGEXP, 'value']]))
        .toThrow(`Invalid RPC serialized data: type ${REGEXP} (regexp) expects a "/pattern/flags" string.`)
    }
  })

  it('does not compile regexp patterns until they are used', () => {
    const spy = vi.spyOn(globalThis, 'RegExp')
    const patterns = [
      // V8: unicode property escapes materialize code point sets while parsing
      ...Array.from({ length: 440 }, (_, i) => `/${'[\\p{RGI_Emoji}--\\q{x}]'.repeat(90)}${i}/v`),
      // JavaScriptCore: named capture groups parse quadratically, no flag needed
      `/${Array.from({ length: 20000 }, (_, j) => `(?<n${j}>a)`).join('')}/`,
    ]

    const start = performance.now()
    const result = serializer.deserialize(patterns, patterns.map((_, i) => [REGEXP, i])) as RegExp[]

    expect(performance.now() - start).toBeLessThan(200)
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('RGI_Emoji'), 'v')
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('(?<n0>'), '')
    expect(result[0]).toBeInstanceOf(OriginalRegExp)
    expect(result.at(-1)).toBeInstanceOf(OriginalRegExp)

    expect(result[0]!.flags).toBe('v')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('RGI_Emoji'), 'v')
  })

  it('does not compile a regexp when a later meta entry probes it', () => {
    const spy = vi.spyOn(globalThis, 'RegExp')
    const pattern = `/${'[\\p{RGI_Emoji}--\\q{x}]'.repeat(90)}/v`

    // unknown type: ignored before the path is walked
    expect(serializer.deserialize([pattern], [[REGEXP, 0], [999, 0, 'lastIndex']])).toHaveLength(1)
    // built-in type aimed at a property: the path walk refuses to enter the restored RegExp
    expect(() => serializer.deserialize([pattern], [[REGEXP, 0], [BIGINT, 0, 'lastIndex']]))
      .toThrow('Invalid RPC serialized data: segment "0" cannot be walked into.')
    expect(() => serializer.deserialize([pattern], [[REGEXP, 0], [999, 0, 'source']]))
      .not
      .toThrow()
    expect(() => serializer.deserialize([pattern], [[REGEXP, 0], [BIGINT, 0, 'source']]))
      .toThrow('Invalid RPC serialized data: segment "0" cannot be walked into.')

    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('RGI_Emoji'), 'v')
  })

  it('ignores unknown types without walking their path', () => {
    expect(() => serializer.deserialize({ a: 1 }, [[999, 'does', 'not', 'exist']])).not.toThrow()
  })

  it('defers regexp syntax errors to first use', () => {
    for (const flags of ['', 'gi', 'u', 'v', 'iv']) {
      const { value } = serializer.deserialize({ value: `/(/${flags}` }, [[REGEXP, 'value']]) as { value: RegExp }
      expect(value).toBeInstanceOf(RegExp)
      expect(() => value.test('')).toThrow(SyntaxError)
    }
  })

  it('bigint rejects non-canonical strings and more than 4300 digits', () => {
    expect(serializer.deserialize('9'.repeat(4300), [[BIGINT]])).toBe(BigInt('9'.repeat(4300)))

    for (const bad of ['9'.repeat(4301), '0x10', ' 1 ']) {
      expect(() => serializer.deserialize(bad, [[BIGINT]]))
        .toThrow(`Invalid RPC serialized data: type ${BIGINT} (bigint) expects a decimal integer string of at most 4300 digits.`)
    }
  })

  it('does not expand a string into a Set or Map of its characters', () => {
    expect(() => serializer.deserialize('x'.repeat(1000), [[SET]]))
      .toThrow(`Invalid RPC serialized data: type ${SET} (set) expects an array.`)
    expect(() => serializer.deserialize({ value: 'x'.repeat(1000) }, [[MAP, 'value']]))
      .toThrow(`Invalid RPC serialized data: type ${MAP} (map) expects an array.`)
  })

  it('rejects a value already restored by an earlier meta entry', () => {
    expect(() => serializer.deserialize({ value: '1' }, [[BIGINT, 'value'], [URL_TYPE, 'value']]))
      .toThrow(`Invalid RPC serialized data: type ${URL_TYPE} (url) expects a string.`)

    const json = Array.from({ length: 1000 }, (_, i) => i)
    expect(() => serializer.deserialize(json, Array.from({ length: 1000 }, () => [SET])))
      .toThrow(`Invalid RPC serialized data: type ${SET} (set) expects an array.`)
    expect(() => serializer.deserialize(json.map(i => [i, i]), Array.from({ length: 1000 }, () => [MAP])))
      .toThrow(`Invalid RPC serialized data: type ${MAP} (map) expects an array.`)
  })

  it('still restores well-formed built-in values', () => {
    expect(serializer.deserialize({ value: '1' }, [[BIGINT, 'value']])).toEqual({ value: 1n })
    expect(serializer.deserialize({ value: '2023-01-01T00:00:00.000Z' }, [[DATE, 'value']])).toEqual({ value: new Date('2023-01-01') })
    expect((serializer.deserialize({ value: null }, [[DATE, 'value']]) as any).value.getTime()).toBeNaN()
    expect(serializer.deserialize({ value: null }, [[NAN, 'value']])).toEqual({ value: Number.NaN })
    expect(serializer.deserialize([null], [[UNDEFINED, 0]])).toEqual([undefined])
    expect(serializer.deserialize({ value: 'https://orpc.dev/' }, [[URL_TYPE, 'value']])).toEqual({ value: new URL('https://orpc.dev') })
    expect(serializer.deserialize({ value: '/uic/gi' }, [[REGEXP, 'value']])).toEqual({ value: /uic/gi })
    expect(serializer.deserialize({ value: [1, 2] }, [[SET, 'value']])).toEqual({ value: new Set([1, 2]) })
    expect(serializer.deserialize({ value: [[1, 2]] }, [[MAP, 'value']])).toEqual({ value: new Map([[1, 2]]) })
  })

  it('rejects blob entries that are not a Blob', () => {
    for (const value of [4294967295, '4294967295', null, undefined, {}, []]) {
      expect(() => serializer.deserialize([null], [], [[0]], () => value as any))
        .toThrow('Invalid RPC serialized data: blob 0 is not a Blob.')
    }

    const blobs = [new Blob([])]
    expect(() => serializer.deserialize([null, null], [], [[0], [1]], i => blobs[i]!))
      .toThrow('Invalid RPC serialized data: blob 1 is not a Blob.')
  })

  it('ignores unknown meta types so subscribers without a custom serializer still receive plain data', () => {
    expect(serializer.deserialize({ value: { name: 'Alice' } }, [[100, 'value']])).toEqual({ value: { name: 'Alice' } })
  })

  it('lets a custom serializer replace a built-in type without running the built-in restore', () => {
    const dateSerializer = new StandardRPCJsonSerializer({
      customJsonSerializers: [{
        type: DATE,
        condition: data => data instanceof Date,
        serialize: (data: Date) => data.getTime(),
        deserialize: (data: any) => {
          if (typeof data !== 'number') {
            throw new TypeError('expected a timestamp')
          }

          return new Date(data)
        },
      }],
    })

    const date = new Date('2023-01-01')
    const [json, meta] = dateSerializer.serialize({ date })
    expect(json).toEqual({ date: date.getTime() })
    expect(dateSerializer.deserialize(json, meta)).toEqual({ date })
    expect(() => dateSerializer.deserialize({ date: '2023-01-01' }, [[DATE, 'date']])).toThrow('expected a timestamp')
  })
})

describe('standardRPCJsonSerializer: meta cannot descend into restored values', () => {
  const { BIGINT, DATE, URL: URL_TYPE, SET } = STANDARD_RPC_JSON_SERIALIZER_BUILT_IN_TYPES
  const HUMAN = 20
  const IDENTITY = 21
  const LIST = 22
  const BYTES = 23
  const DOUBLE = 24

  class Human {
    constructor(public name: string, public age: number) {}
  }

  const serializer = new StandardRPCJsonSerializer({
    customJsonSerializers: [
      {
        type: HUMAN,
        condition: data => data instanceof Human,
        serialize: (data: Human) => ({ name: data.name, age: data.age }),
        deserialize: (data: any) => {
          if (typeof data?.name !== 'string' || typeof data?.age !== 'number')
            throw new TypeError('invalid human')
          return new Human(data.name, data.age)
        },
      },
      { // returns the very object it validated
        type: IDENTITY,
        condition: () => false,
        serialize: data => data,
        deserialize: (data: any) => {
          if (typeof data?.name !== 'string')
            throw new TypeError('invalid')
          return data
        },
      },
      { // returns the very array it validated
        type: LIST,
        condition: () => false,
        serialize: data => data,
        deserialize: (data: any) => {
          if (!Array.isArray(data) || !data.every(item => typeof item === 'string'))
            throw new TypeError('invalid list')
          return data
        },
      },
      { // returns the very non-JSON value it validated
        type: BYTES,
        condition: () => false,
        serialize: data => data,
        deserialize: (data: any) => {
          if (!(data instanceof Uint8Array) || data.some(b => b > 9))
            throw new TypeError('invalid bytes')
          return data
        },
      },
      {
        type: DOUBLE,
        condition: () => false,
        serialize: data => data,
        deserialize: (data: any) => data * 2 + 100,
      },
    ],
  })

  it('rejects a meta path that descends into a custom serializer result', () => {
    expect(() => serializer.deserialize({ p: { name: 'http://evil/', age: 1 } }, [[HUMAN, 'p'], [URL_TYPE, 'p', 'name']]))
      .toThrow('Invalid RPC serialized data: segment "p" cannot be walked into.')
    expect(() => serializer.deserialize({ p: { name: '123', age: 1 } }, [[HUMAN, 'p'], [BIGINT, 'p', 'name']]))
      .toThrow('Invalid RPC serialized data: segment "p" cannot be walked into.')
  })

  it('rejects descent into a root-level custom serializer result', () => {
    expect(() => serializer.deserialize({ name: '123', age: 1 }, [[HUMAN], [BIGINT, 'name']]))
      .toThrow('Invalid RPC serialized data: segment "json" cannot be walked into.')
  })

  it('rejects descent when entries share a path prefix with earlier ones', () => {
    const json = { p: { name: 'http://evil/', age: 1, at: null }, q: '2020-01-01T00:00:00.000Z' }

    expect(() => serializer.deserialize(json, [[DATE, 'p', 'at'], [HUMAN, 'p'], [URL_TYPE, 'p', 'name']]))
      .toThrow('Invalid RPC serialized data: segment "p" cannot be walked into.')
    expect(() => serializer.deserialize(json, [[HUMAN, 'p'], [DATE, 'q'], [URL_TYPE, 'p', 'name']]))
      .toThrow('Invalid RPC serialized data: segment "p" cannot be walked into.')
    expect(() => serializer.deserialize({ a: { b: { name: '1', c: null } } }, [[DATE, 'a', 'b', 'c'], [IDENTITY, 'a', 'b'], [BIGINT, 'a', 'b', 'name']]))
      .toThrow('Invalid RPC serialized data: segment "b" cannot be walked into.')
  })

  it('treats numeric and string segments as the same position', () => {
    expect(() => serializer.deserialize([{ name: '123', age: 1 }], [[HUMAN, 0], [BIGINT, '0', 'name']]))
      .toThrow('Invalid RPC serialized data: segment "0" cannot be walked into.')
  })

  it('rejects descent even when the custom serializer returned the validated object itself', () => {
    expect(() => serializer.deserialize({ p: { name: '1' } }, [[IDENTITY, 'p'], [BIGINT, 'p', 'name']]))
      .toThrow('Invalid RPC serialized data: segment "p" cannot be walked into.')
    expect(() => serializer.deserialize({ l: ['1'] }, [[LIST, 'l'], [BIGINT, 'l', 0]]))
      .toThrow('Invalid RPC serialized data: segment "l" cannot be walked into.')
  })

  it('rejects descent into a non-JSON value the custom serializer returned as is', () => {
    // structured clone transports (e.g. MessagePort with experimental_transfer) can deliver non-JSON values
    const bytes = new Uint8Array([1])

    expect(() => serializer.deserialize({ b: bytes }, [[BYTES, 'b'], [DOUBLE, 'b', 0]]))
      .toThrow('Invalid RPC serialized data: segment "b" cannot be walked into.')
    // structured clone also keeps shared references, so the same value can sit at another path
    expect(() => serializer.deserialize({ b: bytes, c: bytes }, [[BYTES, 'b'], [DOUBLE, 'c', 0]]))
      .toThrow('Invalid RPC serialized data: segment "c" cannot be walked into.')
    expect(bytes[0]).toBe(1)
  })

  it('does not let a payload mutate a shared instance returned by a custom serializer', () => {
    const CURRENCIES: Record<string, { code: string, symbol: string }> = { USD: { code: 'USD', symbol: '$' } }
    const currencySerializer = new StandardRPCJsonSerializer({
      customJsonSerializers: [{
        type: 20,
        condition: () => false,
        serialize: (data: any) => data.code,
        deserialize: (code: any) => {
          if (typeof code !== 'string' || !Object.hasOwn(CURRENCIES, code))
            throw new TypeError('invalid currency')
          return CURRENCIES[code]
        },
      }],
    })

    expect(() => currencySerializer.deserialize({ c: 'USD' }, [[20, 'c'], [DATE, 'c', 'symbol']]))
      .toThrow('Invalid RPC serialized data: segment "c" cannot be walked into.')
    expect(CURRENCIES.USD!.symbol).toBe('$')
  })

  it('rejects descent into primitives instead of failing with a raw TypeError', () => {
    for (const a of [1, 'text', true, null]) {
      expect(() => serializer.deserialize({ a }, [[DATE, 'a', 'x']]))
        .toThrow('Invalid RPC serialized data: segment "a" cannot be walked into.')
      expect(() => serializer.deserialize({ a }, [], [['a', 'x']], () => new Blob([])))
        .toThrow('Invalid RPC serialized data: segment "a" cannot be walked into.')
    }
  })

  it('rejects descent into built-in results and blobs', () => {
    expect(() => serializer.deserialize({ a: ['2020-01-01T00:00:00.000Z'] }, [[SET, 'a'], [DATE, 'a', 0]]))
      .toThrow('Invalid RPC serialized data: segment "a" cannot be walked into.')
    expect(() => serializer.deserialize({ a: {} }, [[DATE, 'a', 'x']], [['a']], () => new Blob([])))
      .toThrow('Invalid RPC serialized data: segment "a" cannot be walked into.')
    expect(() => serializer.deserialize({ a: { x: null } }, [], [['a'], ['a', 'x']], () => new Blob([])))
      .toThrow('Invalid RPC serialized data: segment "a" cannot be walked into.')
  })

  it('still stacks custom serializers on the same position, governed by their own type checks', () => {
    expect(serializer.deserialize({ p: { name: 'x', age: 1 } }, [[IDENTITY, 'p'], [HUMAN, 'p']]))
      .toEqual({ p: new Human('x', 1) })
  })

  it('still round-trips nested custom and built-in values (children-first order)', () => {
    const value = {
      p: new Human('x', 1),
      s: new Set([new Date(0), new Human('y', 2)]),
      m: new Map<unknown, unknown>([[1n, new Set([undefined])], ['k', [new Human('z', 3)]]]),
    }
    const [json, meta] = serializer.serialize(value)
    const wire = JSON.parse(JSON.stringify({ json, meta }))

    expect(serializer.deserialize(json, meta)).toEqual(value)
    expect(serializer.deserialize(wire.json, wire.meta)).toEqual(value)
  })

  it('still round-trips blobs nested in custom and built-in values', () => {
    const blob = new Blob(['x'])
    const boxSerializer = new StandardRPCJsonSerializer({
      customJsonSerializers: [{
        type: 20,
        condition: data => data instanceof Human,
        serialize: (data: Human) => ({ name: data.name, age: data.age, attachments: new Set([blob]) }),
        deserialize: (data: any) => new Human(data.name, data.attachments.size),
      }],
    })

    const deserialize = (value: unknown) => {
      const [json, meta, maps, blobs] = boxSerializer.serialize(value)
      return boxSerializer.deserialize(json, meta, maps, i => blobs[i]!)
    }

    expect(deserialize({ root: blob, nested: new Set([blob]), p: new Human('x', 0) }))
      .toEqual({ root: blob, nested: new Set([blob]), p: new Human('x', 1) })
    expect(deserialize(blob)).toBe(blob)
  })
})

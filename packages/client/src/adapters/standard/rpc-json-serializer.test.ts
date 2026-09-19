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
      () => serializer.deserialize({ a: 1 }, [[1, segment]]),
    ).toThrow(`Invalid RPC serialized data: segment "${segment}" does not exist.`)

    expect(
      () => serializer.deserialize({ a: 1 }, [[1, 'a', segment]]),
    ).toThrow(`Invalid RPC serialized data: segment "${segment}" does not exist.`)

    expect(
      () => serializer.deserialize({ a: 1 }, [[1, segment, 'role']]),
    ).toThrow(`Invalid RPC serialized data: segment "${segment}" does not exist.`)

    expect(
      () => serializer.deserialize({ a: 1 }, [], [[segment]], () => new Blob([])),
    ).toThrow(`Invalid RPC serialized data: segment "${segment}" does not exist.`)

    expect(
      () => serializer.deserialize({ a: 1 }, [], [['a', segment]], () => new Blob([])),
    ).toThrow(`Invalid RPC serialized data: segment "${segment}" does not exist.`)

    expect(
      () => serializer.deserialize({ a: 1 }, [], [[segment, 'role']], () => new Blob([])),
    ).toThrow(`Invalid RPC serialized data: segment "${segment}" does not exist.`)
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
    // built-in type aimed at a property: the lazy RegExp owns nothing, so the path walk fails first
    expect(() => serializer.deserialize([pattern], [[REGEXP, 0], [BIGINT, 0, 'lastIndex']]))
      .toThrow('Invalid RPC serialized data: segment "lastIndex" does not exist.')
    expect(() => serializer.deserialize([pattern], [[REGEXP, 0], [999, 0, 'source']]))
      .not
      .toThrow()
    expect(() => serializer.deserialize([pattern], [[REGEXP, 0], [BIGINT, 0, 'source']]))
      .toThrow('Invalid RPC serialized data: segment "source" does not exist.')

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

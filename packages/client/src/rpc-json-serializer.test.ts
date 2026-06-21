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
    value: new Person('unnoq', new Date('2023-01-01')),
    expected: new Person('unnoq', new Date('2023-01-01')),
  },
  {
    name: 'person - 2',
    value: new Person2('unnoq - 2', [{ nested: new Date('2023-01-02') }, /uic/gi]),
    expected: new Person2('unnoq - 2', [{ nested: new Date('2023-01-02') }, /uic/gi]),
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
    const { json, meta, maps, blobs } = serializer.serialize(value)

    const result = JSON.parse(JSON.stringify({ json, meta, maps }))

    const deserialized = serializer.deserialize({ ...result, blobs })
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
      'url': new URL('https://unnoq.com'),
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
      'url': new URL('https://unnoq.com'),
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

describe('rpcJsonSerializer', () => {
  it('support override default handlers', () => {
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
  })

  it('disable default handlers', () => {
    const serializer = new RPCJsonSerializer({
      handlers: {
        date: undefined,
      },
    })

    const date = new Date('2023-01-01')
    const serialized = serializer.serialize({ value: date })
    expect(serialized.json).toEqual({ value: date })
    expect(serialized.meta).toEqual(undefined)
  })

  it('can disable omit undefined properties', () => {
    const serializer = new RPCJsonSerializer({
      omitUndefinedProperties: false,
    })

    const serialized = serializer.serialize({ a: 1, b: undefined })
    expect(serialized.json).toEqual({ a: 1, b: null })
    expect(serialized.meta).toEqual([['undefined', 'b']])
  })

  it.each(['doesNotExist', '__proto__', 'constructor'])('should throw on deserialization if path does not exist to avoid prototype pollution', (segment) => {
    const serializer = new RPCJsonSerializer()

    expect(
      () => serializer.deserialize({
        json: { o: {} },
        meta: [['date', segment]],
      }),
    ).toThrow(`Security error: Invalid serialized data. Segment "${segment}" does not exist.`)

    expect(
      () => serializer.deserialize({
        json: { o: {} },
        meta: [['date', 'o', segment]],
      }),
    ).toThrow(`Security error: Invalid serialized data. Segment "${segment}" does not exist.`)

    expect(
      () => serializer.deserialize({
        json: { o: {} },
        meta: [['date', segment, 'o']],
      }),
    ).toThrow(`Security error: Invalid serialized data. Segment "${segment}" does not exist.`)

    expect(
      () => serializer.deserialize({
        json: { o: {} },
        blobs: [new Blob()],
        maps: [[segment]],
      }),
    ).toThrow(`Security error: Invalid serialized data. Segment "${segment}" does not exist.`)

    expect(
      () => serializer.deserialize({
        json: { o: {} },
        blobs: [new Blob()],
        maps: [['o', segment]],
      }),
    ).toThrow(`Security error: Invalid serialized data. Segment "${segment}" does not exist.`)

    expect(
      () => serializer.deserialize({
        json: { o: {} },
        blobs: [new Blob()],
        maps: [[segment, 'o']],
      }),
    ).toThrow(`Security error: Invalid serialized data. Segment "${segment}" does not exist.`)
  })
})

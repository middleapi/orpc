import { supportedDataTypes } from '../../../tests/shared'
import { StandardRPCJsonSerializer } from './rpc-json-serializer'

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

  it.each(['nonExist', '__proto__', 'constructor'])('should throw when accessing non-existent path during deserialization: %s', (segment) => {
    const serializer = new StandardRPCJsonSerializer()

    expect(
      () => serializer.deserialize({ a: 1 }, [[1, segment]]),
    ).toThrow(`Security error: accessing non-existent path during deserialization. Path segment: ${segment}`)

    expect(
      () => serializer.deserialize({ a: 1 }, [[1, 'a', segment]]),
    ).toThrow(`Security error: accessing non-existent path during deserialization. Path segment: ${segment}`)

    expect(
      () => serializer.deserialize({ a: 1 }, [[1, segment, 'role']]),
    ).toThrow(`Security error: accessing non-existent path during deserialization. Path segment: ${segment}`)

    expect(
      () => serializer.deserialize({ a: 1 }, [], [[segment]], () => new Blob([])),
    ).toThrow(`Security error: accessing non-existent path during deserialization. Path segment: ${segment}`)

    expect(
      () => serializer.deserialize({ a: 1 }, [], [['a', segment]], () => new Blob([])),
    ).toThrow(`Security error: accessing non-existent path during deserialization. Path segment: ${segment}`)

    expect(
      () => serializer.deserialize({ a: 1 }, [], [[segment, 'role']], () => new Blob([])),
    ).toThrow(`Security error: accessing non-existent path during deserialization. Path segment: ${segment}`)
  })
})

import { StandardOpenAPIJsonSerializer } from './openapi-json-serializer'

type TestCase = {
  data: unknown
  expected?: unknown
}

enum Test {
  A = 1,
  B = 2,
  C = 'C',
  D = 'D',
}

const builtInCases: TestCase[] = [
  {
    data: Test.B,
    expected: Test.B,
  },
  {
    data: 'some-string',
    expected: 'some-string',
  },
  {
    data: 123,
    expected: 123,
  },
  {
    data: Number.NaN,
    expected: null,
  },
  {
    data: true,
    expected: true,
  },
  {
    data: false,
    expected: false,
  },
  {
    data: null,
    expected: null,
  },
  //   {
  //     data: undefined,
  //     expected: expect.toSatisfy(v => v === null || v === undefined), CANNOT ASSERT UNDEFINED IN OBJECT?
  //   },
  {
    data: new Date('2023-01-01'),
    expected: new Date('2023-01-01').toISOString(),
  },
  {
    data: new Date('Invalid'),
    expected: null,
  },
  {
    data: 99999999999999999999999999999n,
    expected: '99999999999999999999999999999',
  },
  {
    data: /npa|npb/,
    expected: '/npa|npb/',
  },
  {
    data: /uic/gi,
    expected: '/uic/gi',
  },
  {
    data: new URL('https://orpc.dev'),
    expected: new URL('https://orpc.dev').href,
  },
  {
    data: { a: 1, b: 2, c: 3 },
    expected: { a: 1, b: 2, c: 3 },
  },
  {
    data: [1, 2, 3],
    expected: [1, 2, 3],
  },
  {
    data: new Map([[1, 2], [3, 4]]),
    expected: [[1, 2], [3, 4]],
  },
  {
    data: new Set([1, 2, 3]),
    expected: [1, 2, 3],
  },
  {
    data: new Blob(['blob'], { type: 'text/plain' }),
    expected: expect.toSatisfy((file: any) => {
      expect(file).toBeInstanceOf(Blob)
      expect(file.type).toBe('text/plain')
      expect(file.size).toBe(4)

      return true
    }),
  },
  {
    data: new File(['"name"'], 'file.json', { type: 'application/json' }),
    expected: expect.toSatisfy((file: any) => {
      expect(file).toBeInstanceOf(File)
      expect(file.name).toBe('file.json')
      expect(file.type).toBe('application/json')
      expect(file.size).toBe(6)

      return true
    }),
  },
]

class Person {
  constructor(
    public name: string,
    public date: Date,
  ) { }

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

const customSupportedDataTypes: TestCase[] = [
  {
    data: new Person('Dinh Le', new Date('2023-01-01')),
    expected: { name: 'Dinh Le', date: '2023-01-01T00:00:00.000Z' },
  },
  {
    data: new Person2('Dinh Le - 2', [{ nested: new Date('2023-01-02') }, /uic/gi]),
    expected: { name: 'Dinh Le - 2', data: [{ nested: '2023-01-02T00:00:00.000Z' }, '/uic/gi'] },
  },
  {
    data: { value: { toJSON: () => 'hello' } },
    expected: { value: { } },
  },
  {
    data: { value: { toJSON: 'hello' } },
    expected: { value: { toJSON: 'hello' } },
  },
]

describe.each<TestCase>([
  ...builtInCases,
  ...customSupportedDataTypes,
])('serialize %p', ({ data, expected = data }) => {
  const serializer = new StandardOpenAPIJsonSerializer({
    customJsonSerializers: [
      {
        condition: data => data instanceof Person,
        serialize: data => data.toJSON(),
      },
      {
        condition: data => data instanceof Person2,
        serialize: data => data.toJSON(),
      },
    ],
  })

  it('flat', () => {
    const [json, hasBlob] = serializer.serialize(data)

    expect(json).toEqual(expected)
    expect(hasBlob).toBe(data instanceof Blob)
  })

  it('object', () => {
    const [json, hasBlob] = serializer.serialize({ value: data })

    expect(json).toEqual({ value: expected })
    expect(hasBlob).toBe(data instanceof Blob)
  })

  it('array', () => {
    const [json, hasBlob] = serializer.serialize([data])

    expect(json).toEqual([expected])
    expect(hasBlob).toBe(data instanceof Blob)
  })

  it('set', () => {
    const [json, hasBlob] = serializer.serialize(new Set([data]))

    expect(json).toEqual([expected])
    expect(hasBlob).toBe(data instanceof Blob)
  })

  it('map', () => {
    const [json, hasBlob] = serializer.serialize(new Map([[data, data]]))

    expect(json).toEqual([[expected, expected]])
    expect(hasBlob).toBe(data instanceof Blob)
  })

  it('complex', () => {
    const [json, hasBlob] = serializer.serialize({
      'date': new Date('2023-01-01'),
      'regexp': /uic/gi,
      'url': new URL('https://orpc.dev'),
      '!@#$%^^&()[]>?<~_<:"~+!_': data,
      'list': [data],
      'map': new Map([[data, data]]),
      'set': new Set([data]),
      'nested': {
        nested: data,
      },
    })

    expect(json).toEqual({
      'date': new Date('2023-01-01').toISOString(),
      'regexp': (/uic/gi).toString(),
      'url': new URL('https://orpc.dev').href,
      '!@#$%^^&()[]>?<~_<:"~+!_': expected,
      'list': [expected],
      'map': [[expected, expected]],
      'set': [expected],
      'nested': {
        nested: expected,
      },
    })

    expect(hasBlob).toBe(data instanceof Blob)
  })
})

describe('serialize undefined', () => {
  const serializer = new StandardOpenAPIJsonSerializer()

  it('in object', () => {
    const [json, hasBlob] = serializer.serialize({ value: undefined })

    expect(json).toEqual({ value: undefined })
    expect(hasBlob).toBe(false)
  })

  it('in array', () => {
    const [json, hasBlob] = serializer.serialize([undefined])

    expect(json).toEqual([null])
    expect(hasBlob).toBe(false)
  })
})

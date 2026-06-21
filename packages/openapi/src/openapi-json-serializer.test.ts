import { OpenAPIJsonSerializer } from './openapi-json-serializer'

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

describe('openAPIJsonSerializer', () => {
  const serializer = new OpenAPIJsonSerializer()

  describe('serialize', () => {
    it('passes through primitives unchanged', () => {
      expect(serializer.serialize(1).json).toBe(1)
      expect(serializer.serialize('hello').json).toBe('hello')
      expect(serializer.serialize(true).json).toBe(true)
      expect(serializer.serialize(null).json).toBe(null)
    })

    it('serializes nested undefined values to null', () => {
      expect(serializer.serialize([undefined]).json).toEqual([null])
    })

    it('serializes NaN to null', () => {
      expect(serializer.serialize(Number.NaN).json).toBeNull()
    })

    it('serializes Date to ISO string', () => {
      expect(serializer.serialize(new Date('2023-01-01')).json).toBe('2023-01-01T00:00:00.000Z')
    })

    it('serializes invalid Date to null', () => {
      expect(serializer.serialize(new Date('invalid')).json).toBeNull()
    })

    it('serializes bigint to string', () => {
      expect(serializer.serialize(42n).json).toBe('42')
    })

    it('serializes URL to string', () => {
      expect(serializer.serialize(new URL('https://unnoq.com')).json).toBe('https://unnoq.com/')
    })

    it('serializes RegExp to string', () => {
      expect(serializer.serialize(/uic/gi).json).toBe('/uic/gi')
    })

    it('serializes Set to array', () => {
      expect(serializer.serialize(new Set([1, 2, 3])).json).toEqual([1, 2, 3])
    })

    it('serializes Map to entries array', () => {
      expect(serializer.serialize(new Map([['a', 1]])).json).toEqual([['a', 1]])
    })

    it('serializes nested objects', () => {
      expect(serializer.serialize({
        date: new Date('2023-01-01'),
        count: 1n,
        flag: true,
      }).json).toEqual({
        date: '2023-01-01T00:00:00.000Z',
        count: '1',
        flag: true,
      })
    })

    it('serializes nested arrays', () => {
      expect(serializer.serialize([new Date('2023-01-01'), 42n]).json).toEqual([
        '2023-01-01T00:00:00.000Z',
        '42',
      ])
    })

    it('omits undefined object properties by default', () => {
      expect(serializer.serialize({ a: 1, b: undefined }).json).not.toHaveProperty('b')
    })

    it('skips toJSON methods', () => {
      expect(serializer.serialize({ value: { toJSON: () => 'hello' } }).json).toEqual({ value: {} })
    })

    it('keeps non-function toJSON properties', () => {
      expect(serializer.serialize({ value: { toJSON: 'hello' } }).json).toEqual({ value: { toJSON: 'hello' } })
    })

    it('collects blobs and maps', () => {
      const blob = new Blob(['hello'])
      const { maps, blobs } = serializer.serialize({ file: blob })
      expect(blobs).toEqual([blob])
      expect(maps).toEqual([['file']])
    })
  })

  describe('deserialize', () => {
    it('restores blobs at mapped paths', () => {
      const blob = new Blob(['hello'])
      const result = serializer.deserialize({ json: { file: null }, maps: [['file']], blobs: [blob] })
      expect((result as any).file).toBe(blob)
    })

    it('returns json as-is when no blobs', () => {
      const json = { a: 1, b: '2023-01-01T00:00:00.000Z' }
      expect(serializer.deserialize({ json })).toEqual(json)
    })

    it.each(['doesNotExist', '__proto__', 'constructor'])('throws on invalid segment "%s" to prevent prototype pollution', (segment) => {
      expect(
        () => serializer.deserialize({ json: { o: {} }, blobs: [new Blob()], maps: [[segment]] }),
      ).toThrowError(`Security error: Invalid serialized data. Segment "${segment}" does not exist.`)

      expect(
        () => serializer.deserialize({ json: { o: {} }, blobs: [new Blob()], maps: [['o', segment]] }),
      ).toThrowError(`Security error: Invalid serialized data. Segment "${segment}" does not exist.`)

      expect(
        () => serializer.deserialize({ json: { o: {} }, blobs: [new Blob()], maps: [[segment, 'o']] }),
      ).toThrowError(`Security error: Invalid serialized data. Segment "${segment}" does not exist.`)
    })
  })

  describe('options', () => {
    it('supports overriding default handlers', () => {
      const custom = new OpenAPIJsonSerializer({
        handlers: {
          date: {
            condition: data => data instanceof Date,
            serialize: (value: Date) => `___TEST___${value.getTime()}`,
          },
        },
      })

      const date = new Date('2023-01-01')
      expect(custom.serialize({ value: date }).json).toEqual({ value: `___TEST___${date.getTime()}` })
    })

    it('supports disabling default handlers', () => {
      const custom = new OpenAPIJsonSerializer({ handlers: { date: undefined } })
      const date = new Date('2023-01-01')
      expect(custom.serialize({ value: date }).json).toEqual({ value: date })
    })

    it('supports custom handlers', () => {
      const custom = new OpenAPIJsonSerializer({
        handlers: {
          person: {
            condition: data => data instanceof Person,
            serialize: (data: Person) => data.toJSON(),
          },
        },
      })

      expect(custom.serialize(new Person('unnoq', new Date('2023-01-01'))).json).toEqual({
        name: 'unnoq',
        date: '2023-01-01T00:00:00.000Z',
      })
    })

    it('can disable omitting undefined properties', () => {
      const custom = new OpenAPIJsonSerializer({ omitUndefinedProperties: false })
      expect(custom.serialize({ a: 1, b: undefined }).json).toEqual({ a: 1, b: null })
    })
  })
})

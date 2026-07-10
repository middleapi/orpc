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
    it('passes through primitives unchanged', async () => {
      expect((await serializer.serialize(1)).json).toBe(1)
      expect((await serializer.serialize('hello')).json).toBe('hello')
      expect((await serializer.serialize(true)).json).toBe(true)
      expect((await serializer.serialize(null)).json).toBe(null)
    })

    it('serializes nested undefined values to null', async () => {
      expect((await serializer.serialize([undefined])).json).toEqual([null])
    })

    it('serializes NaN to null', async () => {
      expect((await serializer.serialize(Number.NaN)).json).toBeNull()
    })

    it('serializes Date to ISO string', async () => {
      expect((await serializer.serialize(new Date('2023-01-01'))).json).toBe('2023-01-01T00:00:00.000Z')
    })

    it('serializes invalid Date to null', async () => {
      expect((await serializer.serialize(new Date('invalid'))).json).toBeNull()
    })

    it('serializes bigint to string', async () => {
      expect((await serializer.serialize(42n)).json).toBe('42')
    })

    it('serializes URL to string', async () => {
      expect((await serializer.serialize(new URL('https://dinwwwh.com'))).json).toBe('https://dinwwwh.com/')
    })

    it('serializes RegExp to string', async () => {
      expect((await serializer.serialize(/uic/gi)).json).toBe('/uic/gi')
    })

    it('serializes Set to array', async () => {
      expect((await serializer.serialize(new Set([1, 2, 3]))).json).toEqual([1, 2, 3])
    })

    it('serializes Map to entries array', async () => {
      expect((await serializer.serialize(new Map([['a', 1]]))).json).toEqual([['a', 1]])
    })

    it('serializes nested objects', async () => {
      expect((await serializer.serialize({
        date: new Date('2023-01-01'),
        count: 1n,
        flag: true,
      })).json).toEqual({
        date: '2023-01-01T00:00:00.000Z',
        count: '1',
        flag: true,
      })
    })

    it('serializes nested arrays', async () => {
      expect((await serializer.serialize([new Date('2023-01-01'), 42n])).json).toEqual([
        '2023-01-01T00:00:00.000Z',
        '42',
      ])
    })

    it('omits undefined object properties by default', async () => {
      expect((await serializer.serialize({ a: 1, b: undefined })).json).not.toHaveProperty('b')
    })

    it('skips toJSON methods', async () => {
      expect((await serializer.serialize({ value: { toJSON: () => 'hello' } })).json).toEqual({ value: {} })
    })

    it('keeps non-function toJSON properties', async () => {
      expect((await serializer.serialize({ value: { toJSON: 'hello' } })).json).toEqual({ value: { toJSON: 'hello' } })
    })

    it('collects blobs and maps', async () => {
      const blob = new Blob(['hello'])
      const { maps, blobs } = await serializer.serialize({ file: blob })
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
      ).toThrow(`Security error: Invalid serialized data. Segment "${segment}" does not exist.`)

      expect(
        () => serializer.deserialize({ json: { o: {} }, blobs: [new Blob()], maps: [['o', segment]] }),
      ).toThrow(`Security error: Invalid serialized data. Segment "${segment}" does not exist.`)

      expect(
        () => serializer.deserialize({ json: { o: {} }, blobs: [new Blob()], maps: [[segment, 'o']] }),
      ).toThrow(`Security error: Invalid serialized data. Segment "${segment}" does not exist.`)
    })
  })

  describe('options', () => {
    it('supports overriding default handlers', async () => {
      const custom = new OpenAPIJsonSerializer({
        handlers: {
          date: {
            condition: data => data instanceof Date,
            serialize: (value: Date) => `___TEST___${value.getTime()}`,
          },
        },
      })

      const date = new Date('2023-01-01')
      expect((await custom.serialize({ value: date })).json).toEqual({ value: `___TEST___${date.getTime()}` })
    })

    it('supports disabling default handlers', async () => {
      const custom = new OpenAPIJsonSerializer({ handlers: { date: undefined } })
      const date = new Date('2023-01-01')
      expect((await custom.serialize({ value: date })).json).toEqual({ value: date })
    })

    it('supports custom handlers', async () => {
      const custom = new OpenAPIJsonSerializer({
        handlers: {
          person: {
            condition: data => data instanceof Person,
            serialize: (data: Person) => data.toJSON(),
          },
        },
      })

      expect((await custom.serialize(new Person('dinwwwh', new Date('2023-01-01')))).json).toEqual({
        name: 'dinwwwh',
        date: '2023-01-01T00:00:00.000Z',
      })
    })

    it('can disable omitting undefined properties', async () => {
      const custom = new OpenAPIJsonSerializer({ omitUndefinedProperties: false })
      expect((await custom.serialize({ a: 1, b: undefined })).json).toEqual({ a: 1, b: null })
    })
  })
})

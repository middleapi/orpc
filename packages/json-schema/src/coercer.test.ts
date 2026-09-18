import type { JsonSchema } from './types'
import { JsonSchemaCoercer } from './coercer'

const coercer = new JsonSchemaCoercer()

/**
 * Coerces like the smart coercion plugins do, from the `[jsonSchema, optional]`
 * pair a `JsonSchemaConverter` returns.
 */
function coerce(schema: JsonSchema | Record<string, unknown>, value: unknown, optional: boolean = false): unknown {
  return coercer.coerce([schema as JsonSchema, optional], value)
}

/**
 * Native type schemas as `ZodToJsonSchemaConverter` emits them, so the tests stay tied to
 * payloads that really reach the plugins. `url` comes from custom converters,
 * because no built-in converter maps a validator to it yet.
 */
const DATE_SCHEMA = { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' }
const BIGINT_SCHEMA = { 'type': 'string', 'pattern': '^-?[0-9]+$', 'x-native-type': 'bigint' }
const URL_SCHEMA = { 'type': 'string', 'format': 'uri', 'x-native-type': 'url' }

function setSchema(items: Record<string, unknown>) {
  return { 'type': 'array', 'uniqueItems': true, items, 'x-native-type': 'set' }
}

function mapSchema(key: Record<string, unknown>, value: Record<string, unknown>) {
  return {
    'type': 'array',
    'items': { type: 'array', prefixItems: [key, value], minItems: 2, maxItems: 2 },
    'x-native-type': 'map',
  }
}

describe('jsonSchemaCoercer', () => {
  describe('booleans', () => {
    it('accepts the boolean spellings browsers and CLIs send', () => {
      expect(coerce({ type: 'boolean' }, 'true')).toBe(true)
      expect(coerce({ type: 'boolean' }, 'TRUE')).toBe(true)
      expect(coerce({ type: 'boolean' }, 'on')).toBe(true)
      expect(coerce({ type: 'boolean' }, 'On')).toBe(true)
      expect(coerce({ type: 'boolean' }, 'false')).toBe(false)
      expect(coerce({ type: 'boolean' }, 'off')).toBe(false)
      expect(coerce({ type: 'boolean' }, 'OFF')).toBe(false)
      expect(coerce({ type: 'boolean' }, true)).toBe(true)

      // anything else keeps its original value so validation can report it
      expect(coerce({ type: 'boolean' }, 'yes')).toBe('yes')
      expect(coerce({ type: 'boolean' }, '1')).toBe('1')
      expect(coerce({ type: 'boolean' }, '')).toBe('')
      expect(coerce({ type: 'boolean' }, 1)).toBe(1)
    })
  })

  describe('numbers', () => {
    it('coerces numeric strings only when the number is exact', () => {
      expect(coerce({ type: 'number' }, '123')).toBe(123)
      expect(coerce({ type: 'number' }, '3.14')).toBe(3.14)
      expect(coerce({ type: 'number' }, '-0.5')).toBe(-0.5)
      expect(coerce({ type: 'number' }, 123)).toBe(123)

      expect(coerce({ type: 'number' }, '')).toBe('')
      expect(coerce({ type: 'number' }, 'abc')).toBe('abc')
      expect(coerce({ type: 'number' }, '12px')).toBe('12px')
      expect(coerce({ type: 'number' }, '0x10')).toBe('0x10')
      expect(coerce({ type: 'number' }, '007')).toBe('007')
      expect(coerce({ type: 'number' }, ' 123 ')).toBe(' 123 ')
      expect(coerce({ type: 'number' }, 'NaN')).toBe('NaN')
      expect(coerce({ type: 'number' }, 'Infinity')).toBe('Infinity')
      expect(coerce({ type: 'number' }, [])).toEqual([])

      // scientific notation is not a plain numeric string
      expect(coerce({ type: 'number' }, '1e3')).toBe('1e3')

      // beyond the safe integer range digits would get lost
      expect(coerce({ type: 'number' }, '12345678901234567890')).toBe('12345678901234567890')
      expect(coerce({ type: 'number' }, '-12345678901234567890')).toBe('-12345678901234567890')
      expect(coerce({ type: 'number' }, '9'.repeat(400))).toBe('9'.repeat(400))
    })

    it('coerces integer strings and refuses fractional or lossy ones', () => {
      // z.int() emits { type: 'integer', minimum, maximum }
      expect(coerce({ type: 'integer' }, '42')).toBe(42)
      expect(coerce({ type: 'integer' }, '-7')).toBe(-7)

      expect(coerce({ type: 'integer' }, '1e3')).toBe('1e3')
      expect(coerce({ type: 'integer' }, '')).toBe('')
      expect(coerce({ type: 'integer' }, '4.5')).toBe('4.5')
      expect(coerce({ type: 'integer' }, '0x10')).toBe('0x10')
      expect(coerce({ type: 'integer' }, 'abc')).toBe('abc')
      expect(coerce({ type: 'integer' }, [])).toEqual([])

      // beyond the safe integer range digits would get lost
      expect(coerce({ type: 'integer' }, '12345678901234567890')).toBe('12345678901234567890')

      // an already numeric value is never rewritten
      expect(coerce({ type: 'integer' }, 4.5)).toBe(4.5)
    })
  })

  describe('strings and null', () => {
    it('never rewrites a value into a string or into null', () => {
      expect(coerce({ type: 'string' }, 'abc')).toBe('abc')
      expect(coerce({ type: 'string' }, 123)).toBe(123)
      expect(coerce({ type: 'null' }, null)).toBeNull()
      expect(coerce({ type: 'null' }, 'null')).toBe('null')
    })
  })

  describe('dates', () => {
    it('coerces ISO date and datetime strings', () => {
      expect(coerce(DATE_SCHEMA, '2023-10-01')).toEqual(new Date('2023-10-01'))
      expect(coerce(DATE_SCHEMA, '2020-01-01T06:15')).toEqual(new Date('2020-01-01T06:15'))
      expect(coerce(DATE_SCHEMA, '2020-01-01T06:15Z')).toEqual(new Date('2020-01-01T06:15Z'))
      expect(coerce(DATE_SCHEMA, '2020-01-01T06:15:00Z')).toEqual(new Date('2020-01-01T06:15:00Z'))
      expect(coerce(DATE_SCHEMA, '2020-01-01T06:15:00.123Z')).toEqual(new Date('2020-01-01T06:15:00.123Z'))
      expect(coerce(DATE_SCHEMA, '2020-01-01 06:15')).toEqual(new Date('2020-01-01 06:15'))

      // the expanded year form `toISOString` emits outside 0000-9999
      expect(coerce(DATE_SCHEMA, '+010000-01-01T00:00:00.000Z')).toEqual(new Date('+010000-01-01T00:00:00.000Z'))
    })

    it('coerces datetimes carrying a UTC offset in either direction', () => {
      expect(coerce(DATE_SCHEMA, '2020-01-01T06:15:00+07:00')).toEqual(new Date('2020-01-01T06:15:00+07:00'))
      expect(coerce(DATE_SCHEMA, '2020-01-01T06:15:00-07:00')).toEqual(new Date('2020-01-01T06:15:00-07:00'))
      expect(coerce(DATE_SCHEMA, '2020-01-01T06:15:00-0700')).toEqual(new Date('2020-01-01T06:15:00-0700'))
    })

    it('leaves ambiguous or impossible dates untouched', () => {
      // month/day order depends on the runtime, so it is never guessed
      expect(coerce(DATE_SCHEMA, '12-25-2020')).toBe('12-25-2020')
      expect(coerce(DATE_SCHEMA, '01/02/2020')).toBe('01/02/2020')
      expect(coerce(DATE_SCHEMA, 'yesterday')).toBe('yesterday')
      expect(coerce(DATE_SCHEMA, '2018-06-')).toBe('2018-06-')

      // right shape, not a real instant
      expect(coerce(DATE_SCHEMA, '2020-13-45')).toBe('2020-13-45')
      expect(coerce(DATE_SCHEMA, '2020-01-01T99:99Z')).toBe('2020-01-01T99:99Z')

      // epoch numbers are ambiguous (seconds or milliseconds)
      expect(coerce(DATE_SCHEMA, 1700000000000)).toBe(1700000000000)
      expect(coerce(DATE_SCHEMA, [])).toEqual([])
    })

    it('keeps a value that is already a Date', () => {
      const date = new Date('2020-01-01T00:00:00.000Z')
      expect(coerce(DATE_SCHEMA, date)).toBe(date)
    })
  })

  describe('bigints', () => {
    it('coerces bigints from integer strings and whole numbers', () => {
      expect(coerce(BIGINT_SCHEMA, '9007199254740993')).toBe(9007199254740993n)
      expect(coerce(BIGINT_SCHEMA, '-42')).toBe(-42n)
      expect(coerce(BIGINT_SCHEMA, 42)).toBe(42n)
      expect(coerce(BIGINT_SCHEMA, 42n)).toBe(42n)
    })

    it('leaves values a bigint cannot represent unambiguously untouched', () => {
      expect(coerce(BIGINT_SCHEMA, 'invalid')).toBe('invalid')
      expect(coerce(BIGINT_SCHEMA, '4.5')).toBe('4.5')
      expect(coerce(BIGINT_SCHEMA, 4.5)).toBe(4.5)
      expect(coerce(BIGINT_SCHEMA, Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
      expect(coerce(BIGINT_SCHEMA, true)).toBe(true)
      expect(coerce(BIGINT_SCHEMA, [])).toEqual([])

      // `BigInt()` accepts these, but they are not plain integer strings
      expect(coerce(BIGINT_SCHEMA, '')).toBe('')
      expect(coerce(BIGINT_SCHEMA, '  ')).toBe('  ')
      expect(coerce(BIGINT_SCHEMA, '0x10')).toBe('0x10')
    })
  })

  describe('urls', () => {
    it('coerces url strings', () => {
      expect(coerce(URL_SCHEMA, 'https://example.com')).toEqual(new URL('https://example.com'))
      expect(coerce(URL_SCHEMA, 'invalid')).toBe('invalid')
      expect(coerce(URL_SCHEMA, [])).toEqual([])

      const url = new URL('https://example.com')
      expect(coerce(URL_SCHEMA, url)).toBe(url)
    })
  })

  describe('sets and maps', () => {
    it('coerces a unique array into a Set, after coercing its items', () => {
      // z.set(z.number())
      expect(coerce(setSchema({ type: 'number' }), ['1', '2', '3'])).toEqual(new Set([1, 2, 3]))
      expect(coerce(setSchema({ type: 'string' }), [])).toEqual(new Set())
    })

    it('leaves an array with duplicates untouched, because a Set would drop data', () => {
      expect(coerce(setSchema({ type: 'number' }), ['1', '2', '2'])).toEqual([1, 2, 2])
    })

    it('leaves non arrays untouched for a Set', () => {
      expect(coerce(setSchema({ type: 'string' }), 'a')).toBe('a')
      expect(coerce(setSchema({ type: 'string' }), {})).toEqual({})

      const set = new Set(['a'])
      expect(coerce(setSchema({ type: 'string' }), set)).toBe(set)
    })

    it('coerces an array of key/value pairs into a Map', () => {
      // z.map(z.number(), z.boolean())
      const schema = mapSchema({ type: 'number' }, { type: 'boolean' })

      expect(coerce(schema, [['1', 'true'], ['2', 'off']])).toEqual(new Map<unknown, unknown>([[1, true], [2, false]]))
      expect(coerce(schema, [])).toEqual(new Map())
    })

    it('leaves entries that are not unique pairs untouched for a Map', () => {
      const schema = mapSchema({ type: 'number' }, { type: 'boolean' })

      // duplicated key
      expect(coerce(schema, [['1', 'true'], ['1', 'off']])).toEqual([[1, true], [1, false]])
      // not a pair
      expect(coerce(schema, [['1', 'true'], ['2']])).toEqual([[1, true], [2]])
      expect(coerce(schema, ['1'])).toEqual(['1'])
      expect(coerce(schema, {})).toEqual({})

      const map = new Map([[1, true]])
      expect(coerce(schema, map)).toBe(map)
    })
  })

  describe('enums and literals', () => {
    it('coerces enum members', () => {
      // z.enum(['pending', 'done'])
      expect(coerce({ type: 'string', enum: ['pending', 'done'] }, 'done')).toBe('done')
      // z.enum({ Low: 1, High: 2 })
      expect(coerce({ type: 'number', enum: [1, 2] }, '2')).toBe(2)

      expect(coerce({ enum: [123, '234', true] }, 123)).toBe(123)
      expect(coerce({ enum: [123, '234', true] }, '234')).toBe('234')
      expect(coerce({ enum: [123, '234', true] }, '123')).toBe(123)
      expect(coerce({ enum: [123, '234', true] }, 'on')).toBe(true)
      expect(coerce({ enum: [123, '234', true] }, 'off')).toBe('off')
      expect(coerce({ enum: [123, '234', true] }, ['on'])).toEqual(['on'])
    })

    it('coerces literals', () => {
      // z.literal(true)
      expect(coerce({ type: 'boolean', const: true }, 'on')).toBe(true)
      expect(coerce({ const: true }, 'off')).toBe('off')
      expect(coerce({ const: true }, ['on'])).toEqual(['on'])
    })
  })

  describe('tuples', () => {
    it('coerces tuples, with or without a rest schema', () => {
      // z.tuple([z.number(), z.boolean()])
      expect(coerce({ type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }] }, ['1', 'on'])).toEqual([1, true])
      // z.tuple([z.number()], z.boolean())
      expect(coerce({ type: 'array', prefixItems: [{ type: 'number' }], items: { type: 'boolean' } }, ['1', 'on', 'off'])).toEqual([1, true, false])
      // draft-07 tuple form
      expect(coerce({ type: 'array', items: [{ type: 'number' }, { type: 'boolean' }], additionalItems: { type: 'number' } }, ['1', 'on', '2'])).toEqual([1, true, 2])
    })

    it('leaves items no schema describes untouched', () => {
      expect(coerce({ type: 'array', prefixItems: [{ type: 'number' }] }, ['1', '2'])).toEqual([1, '2'])
      expect(coerce({ type: 'array', items: [{ type: 'number' }] }, ['1', '2'])).toEqual([1, '2'])
      expect(coerce({ type: 'array' }, ['1'])).toEqual(['1'])
    })

    it('coerces what it can when a tuple is too short', () => {
      expect(coerce({ type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }] }, ['1'])).toEqual([1])
    })

    it('leaves non arrays untouched', () => {
      expect(coerce({ type: 'array', items: { type: 'number' } }, '1')).toBe('1')
      expect(coerce({ type: 'array', items: { type: 'number' } }, { 0: '1' })).toEqual({ 0: '1' })
    })
  })

  describe('objects and records', () => {
    it('coerces a search query where every value arrives as a string', () => {
      // z.object({ page: z.int(), perPage: z.int().optional(), q: z.string(), archived: z.boolean() })
      const schema = {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          perPage: { type: 'integer' },
          q: { type: 'string' },
          archived: { type: 'boolean' },
        },
        required: ['page', 'q', 'archived'],
      }

      expect(coerce(schema, { page: '2', perPage: '25', q: '123', archived: 'on' })).toEqual({
        page: 2,
        perPage: 25,
        q: '123',
        archived: true,
      })
    })

    it('keeps a property that is explicitly undefined', () => {
      const schema = {
        type: 'object',
        properties: { page: { type: 'integer' }, q: { type: 'string' } },
        required: ['q'],
      }

      expect(coerce(schema, { page: undefined, q: '1' })).toEqual({ page: undefined, q: '1' })
      expect(coerce(schema, { page: '2', q: undefined })).toEqual({ page: 2, q: undefined })
    })

    it('coerces nested objects and arrays of objects', () => {
      // z.object({ filters: z.object({ since: z.date() }), items: z.array(z.object({ qty: z.int() })) })
      const schema = {
        type: 'object',
        properties: {
          filters: { type: 'object', properties: { since: DATE_SCHEMA }, required: ['since'] },
          items: { type: 'array', items: { type: 'object', properties: { qty: { type: 'integer' } }, required: ['qty'] } },
        },
        required: ['filters', 'items'],
      }

      expect(coerce(schema, { filters: { since: '2020-01-01' }, items: [{ qty: '1' }, { qty: '2' }] })).toEqual({
        filters: { since: new Date('2020-01-01') },
        items: [{ qty: 1 }, { qty: 2 }],
      })
    })

    it('coerces record values through additionalProperties and patternProperties', () => {
      // z.record(z.string(), z.number())
      expect(coerce({ type: 'object', additionalProperties: { type: 'number' } }, { a: '1', b: '2' }))
        .toEqual({ a: 1, b: 2 })

      const schema = {
        type: 'object',
        properties: { total: { type: 'integer' } },
        patternProperties: { '^at': DATE_SCHEMA },
        additionalProperties: { type: 'number' },
      }

      expect(coerce(schema, { total: '3', atCreated: '2020-01-01', atUpdated: '2020-01-02', ratio: '0.5' })).toEqual({
        total: 3,
        atCreated: new Date('2020-01-01'),
        atUpdated: new Date('2020-01-02'),
        ratio: 0.5,
      })
    })

    it('leaves keys no schema describes untouched', () => {
      // z.strictObject({ page: z.int() }) emits additionalProperties: false
      expect(coerce({ type: 'object', properties: { page: { type: 'integer' } }, additionalProperties: false }, { page: '2', extra: '3' }))
        .toEqual({ page: 2, extra: '3' })

      expect(coerce({ type: 'object', properties: { page: { type: 'integer' } } }, { page: '2', extra: '3' }))
        .toEqual({ page: 2, extra: '3' })
    })

    it('turns an array into an object with numeric keys, for bracket notation', () => {
      expect(coerce({ type: 'object', properties: { 0: { type: 'number' }, 1: { type: 'boolean' } } }, ['123', 'true']))
        .toEqual({ 0: 123, 1: true })
    })

    it('keeps special keys such as __proto__ as own properties', () => {
      const value = JSON.parse('{"__proto__": {"nested": "1"}, "count": "2"}')

      const coerced = coerce({
        type: 'object',
        properties: { count: { type: 'integer' } },
        additionalProperties: { type: 'object', properties: { nested: { type: 'integer' } } },
      }, value) as Record<string, unknown>

      expect(Object.keys(coerced)).toEqual(['__proto__', 'count'])
      expect(coerced.count).toBe(2)
      expect(Object.getOwnPropertyDescriptor(coerced, '__proto__')?.value).toEqual({ nested: 1 })
      expect((coerced as any).nested).toBeUndefined()
      expect(({} as any).nested).toBeUndefined()
    })

    it('leaves non objects untouched', () => {
      expect(coerce({ type: 'object', properties: { page: { type: 'integer' } } }, 'nope')).toBe('nope')
    })
  })

  describe('unions', () => {
    it('prefers the branch that needs no conversion', () => {
      // z.union([z.number(), z.string()]): a string already satisfies the union
      expect(coerce({ anyOf: [{ type: 'number' }, { type: 'string' }] }, '123')).toBe('123')
      expect(coerce({ anyOf: [{ type: 'string' }, { type: 'number' }] }, '123')).toBe('123')
      // z.union([z.number(), z.boolean()]): only one branch can accept 'true'
      expect(coerce({ anyOf: [{ type: 'number' }, { type: 'boolean' }] }, 'true')).toBe(true)
      expect(coerce({ anyOf: [{ type: 'number' }, { type: 'boolean' }] }, '123')).toBe(123)
    })

    it('handles nullable and nullish schemas', () => {
      // z.date().nullable()
      const schema = { anyOf: [DATE_SCHEMA, { type: 'null' }] }

      expect(coerce(schema, '2020-01-01')).toEqual(new Date('2020-01-01'))
      expect(coerce(schema, null)).toBeNull()
      expect(coerce(schema, 'nope')).toBe('nope')

      // z.number().nullish()
      expect(coerce({ anyOf: [{ type: 'number' }, { type: 'null' }] }, undefined, true)).toBeUndefined()
    })

    it('handles the nullable form', () => {
      expect(coerce({ type: ['integer', 'null'] }, '5')).toBe(5)
      expect(coerce({ type: ['integer', 'null'] }, null)).toBeNull()
      expect(coerce({ type: ['boolean', 'null'] }, 'on')).toBe(true)
      expect(coerce({ type: ['integer', 'null'] }, 'nope')).toBe('nope')
    })

    it('picks the object branch whose required keys are present', () => {
      // z.union([z.object({ mode: z.string(), count: z.int() }), z.object({ count: z.number() })])
      const schema = {
        anyOf: [
          { type: 'object', properties: { mode: { type: 'string' }, count: { type: 'integer' } }, required: ['mode', 'count'] },
          { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] },
        ],
      }

      expect(coerce(schema, { mode: 'fast', count: '2' })).toEqual({ mode: 'fast', count: 2 })
      expect(coerce(schema, { count: '1.5' })).toEqual({ count: 1.5 })
    })

    it('picks the tuple branch that describes every item', () => {
      const schema = {
        anyOf: [
          { type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }, { type: 'boolean' }], items: { type: 'number' } },
          { type: 'array', prefixItems: [{ type: 'number' }], items: { type: 'number' } },
        ],
      }

      expect(coerce(schema, ['1', 'true', 'true', '2'])).toEqual([1, true, true, 2])
      expect(coerce(schema, ['1', '2'])).toEqual([1, 2])
    })

    it('picks the branch matching the discriminator of a discriminated union', () => {
      // z.discriminatedUnion('type', [...]) emits oneOf with a const discriminator
      const schema = {
        oneOf: [
          {
            type: 'object',
            properties: { type: { type: 'string', const: 'text' }, length: { type: 'integer' } },
            required: ['type', 'length'],
          },
          {
            type: 'object',
            properties: { type: { type: 'string', const: 'image' }, width: { type: 'integer' }, lossless: { type: 'boolean' } },
            required: ['type', 'width'],
          },
        ],
      }

      expect(coerce(schema, { type: 'text', length: '12' })).toEqual({ type: 'text', length: 12 })
      expect(coerce(schema, { type: 'image', width: '800', lossless: 'off' })).toEqual({ type: 'image', width: 800, lossless: false })
      expect(coerce(schema, { type: 'video', width: '800' })).toEqual({ type: 'video', width: '800' })

      // extra keys do not disqualify the discriminator branch, validators usually strip them
      expect(coerce(schema, { type: 'text', length: '12', tracking: 'xyz' })).toEqual({ type: 'text', length: 12, tracking: 'xyz' })
    })

    it('prefers the branch that describes every key', () => {
      const partial = { type: 'object', properties: { a: { type: 'number' } } }
      const full = { type: 'object', properties: { a: { type: 'number' }, b: { type: 'boolean' } } }

      expect(coerce({ anyOf: [partial, full] }, { a: '1', b: 'on' })).toEqual({ a: 1, b: true })
      expect(coerce({ anyOf: [full, partial] }, { a: '1', b: 'on' })).toEqual({ a: 1, b: true })
    })

    it('prefers an untouched match over a fuller match that converts', () => {
      const schema = {
        anyOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { a: { type: 'number' }, b: { type: 'string' } } },
        ],
      }

      const value = { a: '1', b: 'x' }
      expect(coerce(schema, value)).toBe(value)
    })

    it('honours a branch that excludes values with not', () => {
      const schema = {
        oneOf: [
          { type: 'number', not: { const: 1 } },
          { 'type': 'number', 'x-native-type': 'bigint', 'not': { const: 2n } },
        ],
      }

      expect(coerce(schema, '1')).toBe(1n)
      expect(coerce(schema, '2')).toBe(2)
      expect(coerce(schema, '3')).toBe(3)
    })

    it('leaves the value untouched when no branch matches', () => {
      expect(coerce({ anyOf: [{ type: 'number' }, { type: 'boolean' }] }, 'invalid')).toBe('invalid')
    })

    it('does not let a matching branch mask a keyword that already failed', () => {
      // `type` and `anyOf` both apply to the same value, and a string can never satisfy `type: 'null'`,
      // so the first branch must lose to the one that can really accept the value
      const schema = {
        anyOf: [
          { type: 'null', anyOf: [{ type: 'string' }] },
          { type: 'boolean' },
        ],
      }

      expect(coerce(schema, 'true')).toBe(true)
    })
  })

  describe('intersections', () => {
    it('applies every member of an intersection', () => {
      // z.intersection(z.object({ a: z.number() }), z.object({ b: z.boolean() }))
      const schema = {
        allOf: [
          { type: 'object', properties: { a: { type: 'number' } } },
          { type: 'object', properties: { b: { type: 'boolean' } } },
        ],
      }

      expect(coerce(schema, { a: '123', b: 'on', c: '789' })).toEqual({ a: 123, b: true, c: '789' })
      expect(coerce(schema, { a: '123' })).toEqual({ a: 123 })
      expect(coerce(schema, { b: 'off' })).toEqual({ b: false })
      expect(coerce(schema, 'invalid')).toBe('invalid')
    })
  })

  describe('$ref', () => {
    it('follows a $ref into $defs', () => {
      const schema = {
        $defs: { Timestamps: { type: 'array', items: DATE_SCHEMA } },
        type: 'object',
        properties: { seenAt: { $ref: '#/$defs/Timestamps' } },
        required: ['seenAt'],
      }

      expect(coerce(schema, { seenAt: ['2020-01-01', '2020-01-02'] })).toEqual({
        seenAt: [new Date('2020-01-01'), new Date('2020-01-02')],
      })
    })

    it('follows a chain of $refs', () => {
      const schema = {
        $defs: {
          Page: { $ref: '#/$defs/PageBase' },
          PageBase: { type: 'object', properties: { limit: { type: 'integer' } }, required: ['limit'] },
        },
        $ref: '#/$defs/Page',
      }

      expect(coerce(schema, { limit: '10' })).toEqual({ limit: 10 })
    })

    it('follows a $ref with escaped characters in its pointer', () => {
      const schema = {
        $defs: { 'user/id': { type: 'integer' } },
        $ref: '#/$defs/user~1id',
      }

      expect(coerce(schema, '7')).toBe(7)
    })

    it('coerces a recursive schema at every depth', () => {
      // z.object({ name: z.string(), get children() { return z.array(Category) } })
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          visits: { type: 'integer' },
          children: { type: 'array', items: { $ref: '#' } },
        },
        required: ['name', 'children'],
      }

      expect(coerce(schema, {
        name: 'root',
        visits: '1',
        children: [
          { name: 'a', visits: '2', children: [] },
          { name: 'b', visits: '3', children: [{ name: 'c', visits: '4', children: [] }] },
        ],
      })).toEqual({
        name: 'root',
        visits: 1,
        children: [
          { name: 'a', visits: 2, children: [] },
          { name: 'b', visits: 3, children: [{ name: 'c', visits: 4, children: [] }] },
        ],
      })
    })

    it('coerces a recursive schema declared through $defs', () => {
      const schema: JsonSchema = {
        $defs: {
          get Node() {
            return schema
          },
        },
        type: 'object',
        properties: {
          visits: { type: 'integer' },
          next: { $ref: '#/$defs/Node' },
        },
      }

      expect(coerce(schema, { visits: '1', next: { visits: '2', next: { visits: '3' } } }))
        .toEqual({ visits: 1, next: { visits: 2, next: { visits: 3 } } })
    })
  })

  describe('invalid and unusual schemas', () => {
    it('ignores an unresolvable $ref', () => {
      expect(coerce({ $ref: '#/$defs/Missing' }, { a: true })).toEqual({ a: true })
      expect(coerce({ $ref: 'https://example.com/schema.json' }, { a: true })).toEqual({ a: true })
      expect(coerce({ $ref: '#/$defs/Missing', type: 'integer' }, '1')).toBe(1)
    })

    it('does not resolve a $ref into prototype members', () => {
      expect(coerce({ $ref: '#/constructor' }, '1')).toBe('1')
      expect(coerce({ $ref: '#/__proto__', type: 'integer' }, '1')).toBe(1)
    })

    it('stops instead of looping on a $ref cycle', () => {
      expect(coerce({ $ref: '#' }, { a: '1' })).toEqual({ a: '1' })

      expect(coerce({
        $defs: { Loop: { allOf: [{ $ref: '#/$defs/Loop' }, { type: 'object', properties: { a: { type: 'integer' } } }] } },
        $ref: '#/$defs/Loop',
      }, { a: '1' })).toEqual({ a: 1 })

      expect(coerce({
        $defs: { A: { $ref: '#/$defs/B' }, B: { $ref: '#/$defs/A' } },
        $ref: '#/$defs/A',
      }, { a: '1' })).toEqual({ a: '1' })
    })

    it('ignores a type it does not know', () => {
      expect(coerce({ type: 'float' }, '1.5')).toBe('1.5')
      expect(coerce({ type: 'String' }, 123)).toBe(123)
      expect(coerce({ type: 'datetime' }, '2020-01-01')).toBe('2020-01-01')
    })

    it('ignores x-native-type values it does not know', () => {
      expect(coerce({ 'type': 'string', 'x-native-type': 'temporal' }, '2020-01-01')).toBe('2020-01-01')
      expect(coerce({ 'type': 'number', 'x-native-type': 42 }, '1')).toBe(1)
    })

    it('leaves values untouched for schemas without a coercible type', () => {
      expect(coerce(true, '123')).toBe('123')
      expect(coerce(false, '123')).toBe('123')
      expect(coerce({}, '123')).toBe('123')
      expect(coerce({ description: 'anything goes' }, '123')).toBe('123')
      expect(coerce({ not: {} }, '123')).toBe('123')
      expect(coerce({ type: 'number', not: { type: 'string' } }, '123')).toBe(123)
    })

    it('handles empty enums and unions', () => {
      expect(coerce({ enum: [] }, 'anything')).toBe('anything')
      expect(coerce({ anyOf: [] }, '123')).toBe('123')
      expect(coerce({ oneOf: [] }, '123')).toBe('123')
    })

    it('skips an invalid patternProperties pattern without breaking the other keys', () => {
      const schema = {
        type: 'object',
        properties: { total: { type: 'integer' } },
        patternProperties: { '(unclosed': { type: 'number' }, '^n': { type: 'number' } },
      }

      expect(coerce(schema, { total: '3', n1: '1', other: 'x' })).toEqual({ total: 3, n1: 1, other: 'x' })
    })

    it('accepts boolean schemas for properties and items', () => {
      const value = { free: ['anything', 1], never: 'kept' }

      expect(coerce({
        type: 'object',
        properties: { free: { type: 'array', items: true }, never: false },
      }, value)).toBe(value)

      const record = { a: 'kept' }
      expect(coerce({ type: 'object', additionalProperties: true }, record)).toBe(record)
    })

    it('tolerates a tuple whose prefixItems is a single schema', () => {
      expect(coerce({ type: 'array', prefixItems: { type: 'number' } }, ['1', '2'])).toEqual([1, '2'])
    })

    it('tolerates an empty draft-07 tuple form', () => {
      expect(coerce({ type: 'array', items: [] }, ['1'])).toEqual(['1'])
    })
  })

  describe('untouched values', () => {
    it('skips a missing optional input entirely', () => {
      expect(coerce({ type: 'object', properties: { page: { type: 'integer' } } }, undefined, true)).toBeUndefined()
      expect(coerce({ type: 'integer' }, undefined, true)).toBeUndefined()

      // a required input still reaches validation untouched
      expect(coerce({ type: 'integer' }, undefined)).toBeUndefined()
      expect(coerce({ type: 'null' }, undefined)).toBeUndefined()
    })

    it('returns the very same value when nothing needs coercion', () => {
      const schema = {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          tags: { type: 'array', items: { type: 'string' } },
          nested: { type: 'object', properties: { flag: { type: 'boolean' } } },
        },
      }

      const value = { page: 2, tags: ['a', 'b'], nested: { flag: true } }

      const coerced = coerce(schema, value)

      expect(coerced).toBe(value)
    })
  })
})

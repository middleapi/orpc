import type { JsonSchema } from './types'
import { JsonSchemaCoercer } from './coercer'

describe('jsonSchemaCoercer', () => {
  const coercer = new JsonSchemaCoercer()

  it('do no thing with boolean/any schema', () => {
    expect(coercer.coerce([true, false], '123')).toEqual('123')
    expect(coercer.coerce([false, false], '123')).toEqual('123')
    expect(coercer.coerce([{}, false], '123')).toEqual('123')
    expect(coercer.coerce([{ not: {} }, false], '123')).toEqual('123')
  })

  it('do no thing with optional schema and undefined value', () => {
    expect(coercer.coerce([{ type: 'number' }, true], undefined)).toEqual(undefined)
    expect(coercer.coerce([{ type: 'array' }, true], undefined)).toEqual(undefined)
    expect(coercer.coerce([{ type: 'object' }, true], undefined)).toEqual(undefined)
  })

  it('can coerce primitive types', () => {
    expect(coercer.coerce([{ type: 'boolean' }, false], 'true')).toEqual(true)
    expect(coercer.coerce([{ type: 'boolean' }, false], 'false')).toEqual(false)
    expect(coercer.coerce([{ type: 'boolean' }, false], 'invalid')).toEqual('invalid')

    expect(coercer.coerce([{ type: 'number' }, false], '123.4')).toEqual(123.4)
    expect(coercer.coerce([{ type: 'number' }, false], 'invalid')).toEqual('invalid')

    expect(coercer.coerce([{ type: 'integer' }, false], '123')).toEqual(123)
    expect(coercer.coerce([{ type: 'integer' }, false], '123.4')).toEqual('123.4')
    expect(coercer.coerce([{ type: 'integer' }, false], 'invalid')).toEqual('invalid')
    expect(coercer.coerce([{ type: 'integer' }, false], [])).toEqual([])

    // -- no coercion
    expect(coercer.coerce([{ type: 'null' }, false], null)).toEqual(null)
    expect(coercer.coerce([{ type: 'null' }, false], undefined)).toEqual(undefined)
    expect(coercer.coerce([{ type: 'number' }, false], undefined)).toEqual(undefined)
    expect(coercer.coerce([{ type: 'boolean' }, false], undefined)).toEqual(undefined)
  })

  it('can coerce multiple types', () => {
    expect(coercer.coerce([{ type: ['boolean', 'null'] }, false], 'true')).toEqual(true)
    expect(coercer.coerce([{ type: ['number', 'boolean'] }, false], '123')).toEqual(123)
  })

  it('can coerce native types', () => {
    const date = new Date()
    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'date' } as any, false], date.toISOString())).toEqual(date)
    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'date' } as any, false], '1972-01-01')).toEqual(new Date('1972-01-01'))
    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'date' } as any, false], '2018-06-12T19:30')).toEqual(new Date('2018-06-12T19:30'))
    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'date' } as any, false], '2018-06-')).toEqual('2018-06-')
    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'date' } as any, false], 'Invalid Date')).toEqual('Invalid Date')
    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'date' } as any, false], [])).toEqual([])

    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'bigint' } as any, false], '123')).toEqual(123n)
    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'bigint' } as any, false], 123)).toEqual(123n)
    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'bigint' } as any, false], Infinity)).toEqual(Infinity)
    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'bigint' } as any, false], 'invalid')).toEqual('invalid')
    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'bigint' } as any, false], [])).toEqual([])

    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'url' } as any, false], 'https://example.com')).toEqual(new URL('https://example.com'))
    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'url' } as any, false], 'invalid')).toEqual('invalid')
    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'url' } as any, false], [])).toEqual([])

    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'regexp' } as any, false], '/abc/i')).toEqual(/abc/i)
    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'regexp' } as any, false], '/abc/invalid')).toEqual('/abc/invalid')
    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'regexp' } as any, false], 'invalid')).toEqual('invalid')
    expect(coercer.coerce([{ 'type': 'string', 'x-native-type': 'regexp' } as any, false], [])).toEqual([])

    expect(coercer.coerce(
      [{ 'type': 'array', 'items': { type: 'number' }, 'x-native-type': 'set' } as any, false],
      ['1', '2', '3', '4'],
    )).toEqual(new Set([1, 2, 3, 4]))

    expect(coercer.coerce(
      [{ 'type': 'array', 'items': { type: 'number' }, 'x-native-type': 'set' } as any, false],
      ['1', '2', '3', '4', '4'],
    )).toEqual([1, 2, 3, 4, 4])

    expect(coercer.coerce(
      [{ 'type': 'array', 'items': { type: 'number' }, 'x-native-type': 'set' } as any, false],
      {},
    )).toEqual({})

    expect(coercer.coerce(
      [{ 'type': 'array', 'items': { type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }] }, 'x-native-type': 'map' } as any, false],
      [['1', 'true'], ['2', 'false'], ['invalid', 'invalid']],
    )).toEqual(new Map([[1, true], [2, false], ['invalid', 'invalid']] as any))

    expect(coercer.coerce(
      [{ 'type': 'array', 'items': { type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }] }, 'x-native-type': 'map' } as any, false],
      ['1'],
    )).toEqual(['1'])

    expect(coercer.coerce(
      [{ 'type': 'array', 'items': { type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }] }, 'x-native-type': 'map' } as any, false],
      {},
    )).toEqual({})

    expect(coercer.coerce(
      [{ 'type': 'array', 'items': { type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }] }, 'x-native-type': 'map' } as any, false],
      [['1', 'true'], ['2', 'false'], ['1', 'false']],
    )).toEqual([[1, true], [2, false], [1, false]])
  })

  it('can coerce enum/const values', () => {
    expect(coercer.coerce([{ enum: [123, '234', true] }, false], 123)).toEqual(123)
    expect(coercer.coerce([{ enum: [123, '234', true] }, false], '234')).toEqual('234')
    expect(coercer.coerce([{ enum: [123, '234', true] }, false], '123')).toEqual(123)
    expect(coercer.coerce([{ enum: [123, '234', true] }, false], 'off')).toEqual('off')
    expect(coercer.coerce([{ enum: [123, '234', true] }, false], 'on')).toEqual(true)
    expect(coercer.coerce([{ enum: [123, '234', true] }, false], ['on'])).toEqual(['on'])

    expect(coercer.coerce([{ const: true }, false], 'off')).toEqual('off')
    expect(coercer.coerce([{ const: true }, false], 'on')).toEqual(true)
    expect(coercer.coerce([{ const: true }, false], ['on'])).toEqual(['on'])
  })

  it('can coerce arrays/tuples', () => {
    expect(
      coercer.coerce([{ type: 'array', items: { type: 'number' } }, false], ['1', '2', '3']),
    ).toEqual([1, 2, 3])
    expect(
      coercer.coerce([{ type: 'array', items: { type: 'string' } }, false], ['1', '2', '3']),
    ).toEqual(['1', '2', '3'])

    // draft-07
    expect(
      coercer.coerce(
        [{ type: 'array', items: [{ type: 'number' }, { type: 'boolean' }], additionalItems: { type: 'number' } } as any, false],
        ['1', 'true', '2', 'false'],
      ),
    ).toEqual([1, true, 2, 'false'])

    // draft-2020
    expect(
      coercer.coerce(
        [{ type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }], items: { type: 'number' } }, false],
        ['1', 'true', '2', 'false'],
      ),
    ).toEqual([1, true, 2, 'false'])

    expect(
      coercer.coerce(
        [{ type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }] }, false],
        ['1', 'true', '2', 'false'],
      ),
    ).toEqual([1, true, '2', 'false'])
  })

  it('can coerce objects', () => {
    expect(
      coercer.coerce(
        [{ type: 'object', properties: { a: { type: 'number' }, b: { type: 'boolean' } } }, false],
        { a: '123', b: 'true' },
      ),
    ).toEqual({ a: 123, b: true })

    expect(
      coercer.coerce(
        [{ type: 'object', properties: { a: { type: 'number' }, b: { type: 'boolean' } }, required: ['a'] }, false],
        { a: undefined, b: 'true' },
      ),
    ).toEqual({ a: undefined, b: true })

    expect(
      coercer.coerce(
        [{
          type: 'object',
          properties: { a: { type: 'number' } },
          patternProperties: { '^b': { 'type': 'string', 'x-native-type': 'bigint' } as any },
          additionalProperties: { type: 'boolean' },
        }, false],
        { a: '123', b: '123', b1: '123', c: 'false' },
      ),
    ).toEqual({ a: 123, b: 123n, b1: 123n, c: false })

    expect(
      coercer.coerce(
        [{ type: 'object', properties: { 0: { type: 'number' }, 1: { type: 'boolean' } } }, false],
        ['123', 'true'],
      ),
    ).toEqual({ 0: 123, 1: true })
  })

  it('can handle union types', () => {
    const schema = {
      anyOf: [
        { type: 'number' },
        { type: 'boolean' },
        { type: 'object', properties: { a: { type: 'number' } } },
        { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
      ],
    } as any

    expect(coercer.coerce([schema, false], 123)).toEqual(123)
    expect(coercer.coerce([schema, false], '123')).toEqual(123)
    expect(coercer.coerce([schema, false], true)).toEqual(true)
    expect(coercer.coerce([schema, false], 'true')).toEqual(true)
    expect(coercer.coerce([schema, false], { a: '123' })).toEqual({ a: 123 })
    expect(coercer.coerce([schema, false], { a: '123', b: undefined })).toEqual({ a: 123, b: undefined })
    expect(coercer.coerce([schema, false], { a: '123', b: '456' })).toEqual({ a: 123, b: 456 })
    expect(coercer.coerce([schema, false], 'invalid')).toEqual('invalid')

    const schema2 = {
      anyOf: [
        { type: 'object', properties: { a: { type: 'boolean' }, b: { type: 'number' } }, required: ['a', 'b'] },
        { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
      ],
    } as any

    expect(coercer.coerce([schema2, false], { a: 'true', b: '123' })).toEqual({ a: true, b: 123 })
    expect(coercer.coerce([schema2, false], { a: '123' })).toEqual({ a: 123 })

    const schema3 = {
      anyOf: [
        { type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }, { type: 'boolean' }], items: { type: 'number' } },
        { type: 'array', prefixItems: [{ type: 'number' }], items: { type: 'number' } },
      ],
    } as any

    expect(coercer.coerce([schema3, false], ['1', 'true', 'true', '2'])).toEqual([1, true, true, 2])
    expect(coercer.coerce([schema3, false], ['1', '2'])).toEqual([1, 2])

    const schema4 = {
      oneOf: [
        { type: 'number', not: { const: 1 } },
        { 'type': 'number', 'x-native-type': 'bigint', 'not': { const: 2n } },
      ],
    }

    expect(coercer.coerce([schema4, false], '1')).toEqual(1n)
    expect(coercer.coerce([schema4, false], '2')).toEqual(2)
    expect(coercer.coerce([schema4, false], '3')).toEqual(3)
  })

  it('can handle discriminated union types', () => {
    const schema = {
      anyOf: [
        { type: 'object', properties: { t: { const: 1 }, v: { type: 'number' } } },
        { type: 'object', properties: { t: { const: 2 }, v: { 'type': 'string', 'x-native-type': 'bigint' } } },
      ],
    } as any

    expect(coercer.coerce([schema, false], { t: '1', v: '123' })).toEqual({ t: 1, v: 123 })
    expect(coercer.coerce([schema, false], { t: '2', v: '123' })).toEqual({ t: 2, v: 123n })
  })

  it('can coerce intersection types', () => {
    const schema = {
      allOf: [
        { type: 'object', properties: { a: { type: 'number' } } },
        { type: 'object', properties: { b: { type: 'number' } } },
      ],
    } as any

    expect(coercer.coerce([schema, false], { a: '123', b: '456', c: '789' })).toEqual({ a: 123, b: 456, c: '789' })
    expect(coercer.coerce([schema, false], { a: '123' })).toEqual({ a: 123 })
    expect(coercer.coerce([schema, false], { b: '456' })).toEqual({ b: 456 })
    expect(coercer.coerce([schema, false], 'invalid')).toEqual('invalid')
  })

  it('can coerce complex structures', () => {
    const schema = {
      $defs: {
        ArrayOfDate: {
          type: 'array',
          items: { 'type': 'string', 'x-native-type': 'date' },
        },
      },
      type: 'object',
      properties: {
        a: { type: 'boolean' },
        b: { type: 'number' },
        c: {
          $ref: '#/$defs/ArrayOfDate',
        },
        d: {
          type: 'object',
          properties: {
            e: {
              'type': 'array',
              'items': { 'type': 'string', 'x-native-type': 'url' },
              'x-native-type': 'set',
            },
          },
        },
      },
      required: ['a'],
    }

    expect(coercer.coerce([schema, false], {
      a: 'true',
      b: '123',
      c: ['2020-01-01', '2020-01-02'],
      d: {
        e: ['https://example.com', 'https://example.org'],
      },
    })).toEqual({
      a: true,
      b: 123,
      c: [new Date('2020-01-01'), new Date('2020-01-02')],
      d: {
        e: new Set([new URL('https://example.com'), new URL('https://example.org')]),
      },
    })
  })

  it('can coerce recursive types', () => {
    const schema: JsonSchema = {
      $defs: {
        get Test() {
          return schema
        },
      },
      type: 'object',
      properties: {
        a: { type: 'boolean' },
        b: { $ref: '#/$defs/Test' },
      },
      required: ['a'],
    }

    expect(coercer.coerce([schema, false], {
      a: 'true',
      b: {
        a: 'off',
        b: {
          a: 'invalid',
          b: {
            a: 'true',
            b: 'invalid',
          },
        },
      },
    })).toEqual({
      a: true,
      b: {
        a: false,
        b: {
          a: 'invalid',
          b: {
            a: true,
            b: 'invalid',
          },
        },
      },
    })

    const schema2: JsonSchema = {
      type: 'object',
      properties: {
        a: { type: 'boolean' },
        b: { $ref: '#' },
      },
      required: ['a'],
    }

    expect(coercer.coerce([schema2, false], {
      a: 'true',
      b: {
        a: 'off',
        b: {
          a: 'invalid',
          b: {
            a: 'true',
            b: 'invalid',
          },
        },
      },
    })).toEqual({
      a: true,
      b: {
        a: false,
        b: {
          a: 'invalid',
          b: {
            a: true,
            b: 'invalid',
          },
        },
      },
    })
  })

  it('ignore unresolvable $ref', () => {
    const schema: JsonSchema = {
      $ref: '#/$defs/unExisted',
    }

    expect(coercer.coerce([schema, false], { a: true })).toEqual({
      a: true,
    })

    const schema2: JsonSchema = {
      $ref: 'canNotResolve',
    }
    expect(coercer.coerce([schema2, false], { a: true })).toEqual({
      a: true,
    })
  })
})

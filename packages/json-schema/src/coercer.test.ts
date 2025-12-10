/* eslint-disable prefer-regex-literals */
import { JsonSchemaCoercer } from './coercer'

describe('jsonSchemaCoercer', () => {
  const coercer = new JsonSchemaCoercer()

  it('do no thing with boolean/any schema', () => {
    expect(coercer.coerce(true, '123')).toEqual('123')
    expect(coercer.coerce(false, '123')).toEqual('123')
    expect(coercer.coerce({}, '123')).toEqual('123')
    expect(coercer.coerce({ not: {} }, '123')).toEqual('123')
  })

  it('can coerce primitive types', () => {
    expect(coercer.coerce({ type: 'boolean' }, 'true')).toEqual(true)
    expect(coercer.coerce({ type: 'boolean' }, 'false')).toEqual(false)
    expect(coercer.coerce({ type: 'boolean' }, 'invalid')).toEqual('invalid')

    expect(coercer.coerce({ type: 'number' }, '123.4')).toEqual(123.4)
    expect(coercer.coerce({ type: 'number' }, 'invalid')).toEqual('invalid')

    expect(coercer.coerce({ type: 'integer' }, '123')).toEqual(123)
    expect(coercer.coerce({ type: 'integer' }, '123.4')).toEqual('123.4')
    expect(coercer.coerce({ type: 'integer' }, 'invalid')).toEqual('invalid')

    // -- no coercion
    expect(coercer.coerce({ type: 'null' }, null)).toEqual(null)
    expect(coercer.coerce({ type: 'null' }, undefined)).toEqual(undefined)
    expect(coercer.coerce({ type: 'number' }, undefined)).toEqual(undefined)
    expect(coercer.coerce({ type: 'boolean' }, undefined)).toEqual(undefined)
  })

  it('can coerce multiple types', () => {
    // TODO
    // expect(coercer.coerce({ type: ['boolean', 'null'] }, 'true')).toEqual(true)
    expect(coercer.coerce({ type: ['number', 'boolean'] }, '123')).toEqual(123)
  })

  it('can coerce native types', () => {
    const date = new Date()
    expect(coercer.coerce({ 'type': 'string', 'x-native-type': 'date' } as any, date.toISOString())).toEqual(date)
    expect(coercer.coerce({ 'type': 'string', 'x-native-type': 'date' } as any, '1972-01-01')).toEqual(new Date('1972-01-01'))
    expect(coercer.coerce({ 'type': 'string', 'x-native-type': 'date' } as any, '2018-06-12T19:30')).toEqual(new Date('2018-06-12T19:30'))
    expect(coercer.coerce({ 'type': 'string', 'x-native-type': 'date' } as any, '2018-06-')).toEqual('2018-06-')
    expect(coercer.coerce({ 'type': 'string', 'x-native-type': 'date' } as any, 'Invalid Date')).toEqual('Invalid Date')

    expect(coercer.coerce({ 'type': 'string', 'x-native-type': 'bigint' } as any, '123')).toEqual(123n)
    expect(coercer.coerce({ 'type': 'string', 'x-native-type': 'bigint' } as any, 123)).toEqual(123n)
    expect(coercer.coerce({ 'type': 'string', 'x-native-type': 'bigint' } as any, Infinity)).toEqual(Infinity)
    expect(coercer.coerce({ 'type': 'string', 'x-native-type': 'bigint' } as any, 'invalid')).toEqual('invalid')

    expect(coercer.coerce({ 'type': 'string', 'x-native-type': 'url' } as any, 'https://example.com')).toEqual(new URL('https://example.com'))
    expect(coercer.coerce({ 'type': 'string', 'x-native-type': 'url' } as any, 'invalid')).toEqual('invalid')

    expect(coercer.coerce({ 'type': 'string', 'x-native-type': 'regexp' } as any, '/abc/i')).toEqual(new RegExp('abc', 'i'))
    expect(coercer.coerce({ 'type': 'string', 'x-native-type': 'regexp' } as any, '/abc/invalid')).toEqual('/abc/invalid')
    expect(coercer.coerce({ 'type': 'string', 'x-native-type': 'regexp' } as any, 'invalid')).toEqual('invalid')

    expect(coercer.coerce(
      { 'type': 'array', 'items': { type: 'number' }, 'x-native-type': 'set' } as any,
      ['1', '2', '3', '4'],
    )).toEqual(new Set([1, 2, 3, 4]))

    expect(coercer.coerce(
      { 'type': 'array', 'items': { type: 'number' }, 'x-native-type': 'set' } as any,
      ['1', '2', '3', '4', '4'],
    )).toEqual([1, 2, 3, 4, 4])

    expect(coercer.coerce(
      { 'type': 'array', 'items': { type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }] }, 'x-native-type': 'map' } as any,
      [['1', 'true'], ['2', 'false'], ['invalid', 'invalid']],
    )).toEqual(new Map([[1, true], [2, false], ['invalid', 'invalid']] as any))

    expect(coercer.coerce(
      { 'type': 'array', 'items': { type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }] }, 'x-native-type': 'map' } as any,
      ['1'],
    )).toEqual(['1'])

    expect(coercer.coerce(
      { 'type': 'array', 'items': { type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }] }, 'x-native-type': 'map' } as any,
      [['1', 'true'], ['2', 'false'], ['1', 'false']],
    )).toEqual([[1, true], [2, false], [1, false]])
  })

  it('can coerce enum/const values', () => {
    expect(coercer.coerce({ enum: [123, '234', true] }, 123)).toEqual(123)
    expect(coercer.coerce({ enum: [123, '234', true] }, '234')).toEqual('234')
    expect(coercer.coerce({ enum: [123, '234', true] }, '123')).toEqual(123)
    expect(coercer.coerce({ enum: [123, '234', true] }, 'off')).toEqual('off')
    expect(coercer.coerce({ enum: [123, '234', true] }, 'on')).toEqual(true)
    expect(coercer.coerce({ enum: [123, '234', true] }, ['on'])).toEqual(['on'])

    expect(coercer.coerce({ const: true }, 'off')).toEqual('off')
    expect(coercer.coerce({ const: true }, 'on')).toEqual(true)
    expect(coercer.coerce({ const: true }, ['on'])).toEqual(['on'])
  })

  it('can coerce arrays/tuples', () => {
    expect(
      coercer.coerce({ type: 'array', items: { type: 'number' } }, ['1', '2', '3']),
    ).toEqual([1, 2, 3])
    expect(
      coercer.coerce({ type: 'array', items: { type: 'string' } }, ['1', '2', '3']),
    ).toEqual(['1', '2', '3'])

    // draft-07
    expect(
      coercer.coerce(
        { type: 'array', items: [{ type: 'number' }, { type: 'boolean' }], additionalItems: { type: 'number' } },
        ['1', 'true', '2', 'false'],
      ),
    ).toEqual([1, true, 2, 'false'])

    // draft-2020
    expect(
      coercer.coerce(
        { type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }], items: { type: 'number' } },
        ['1', 'true', '2', 'false'],
      ),
    ).toEqual([1, true, 2, 'false'])

    expect(
      coercer.coerce(
        { type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }] },
        ['1', 'true', '2', 'false'],
      ),
    ).toEqual([1, true, '2', 'false'])
  })

  it('can coerce objects', () => {
    expect(
      coercer.coerce(
        { type: 'object', properties: { a: { type: 'number' }, b: { type: 'boolean' } } },
        { a: '123', b: 'true' },
      ),
    ).toEqual({ a: 123, b: true })

    expect(
      coercer.coerce(
        { type: 'object', properties: { a: { type: 'number' }, b: { type: 'boolean' } }, required: ['a'] },
        { a: undefined, b: 'true' },
      ),
    ).toEqual({ a: undefined, b: true })

    expect(
      coercer.coerce(
        {
          type: 'object',
          properties: { a: { type: 'number' } },
          patternProperties: { '^b': { 'type': 'string', 'x-native-type': 'bigint' } as any },
          additionalProperties: { type: 'boolean' },
        },
        { a: '123', b: '123', b1: '123', c: 'false' },
      ),
    ).toEqual({ a: 123, b: 123n, b1: 123n, c: false })

    expect(
      coercer.coerce(
        { type: 'object', properties: { 0: { type: 'number' }, 1: { type: 'boolean' } } },
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

    expect(coercer.coerce(schema, 123)).toEqual(123)
    expect(coercer.coerce(schema, '123')).toEqual(123)
    expect(coercer.coerce(schema, true)).toEqual(true)
    expect(coercer.coerce(schema, 'true')).toEqual(true)
    expect(coercer.coerce(schema, { a: '123' })).toEqual({ a: 123 })
    expect(coercer.coerce(schema, { a: '123', b: undefined })).toEqual({ a: 123, b: undefined })
    expect(coercer.coerce(schema, { a: '123', b: '456' })).toEqual({ a: 123, b: 456 })
    expect(coercer.coerce(schema, 'invalid')).toEqual('invalid')

    const schema2 = {
      anyOf: [
        { type: 'object', properties: { a: { type: 'boolean' }, b: { type: 'number' } }, required: ['a', 'b'] },
        { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
      ],
    } as any

    expect(coercer.coerce(schema2, { a: 'true', b: '123' })).toEqual({ a: true, b: 123 })
    expect(coercer.coerce(schema2, { a: '123' })).toEqual({ a: 123 })

    const schema3 = {
      anyOf: [
        { type: 'array', prefixItems: [{ type: 'number' }, { type: 'boolean' }, { type: 'boolean' }], items: { type: 'number' } },
        { type: 'array', prefixItems: [{ type: 'number' }], items: { type: 'number' } },
      ],
    } as any

    expect(coercer.coerce(schema3, ['1', 'true', 'true', '2'])).toEqual([1, true, true, 2])
    expect(coercer.coerce(schema3, ['1', '2'])).toEqual([1, 2])
  })

  it('can handle discriminated union types', () => {
    const schema = {
      anyOf: [
        { type: 'object', properties: { t: { const: 1 }, v: { type: 'number' } } },
        { type: 'object', properties: { t: { const: 2 }, v: { 'type': 'string', 'x-native-type': 'bigint' } } },
      ],
    } as any

    expect(coercer.coerce(schema, { t: '1', v: '123' })).toEqual({ t: 1, v: 123 })
    expect(coercer.coerce(schema, { t: '2', v: '123' })).toEqual({ t: 2, v: 123n })
  })

  it('can coerce intersection types', () => {
    const schema = {
      allOf: [
        { type: 'object', properties: { a: { type: 'number' } } },
        { type: 'object', properties: { b: { type: 'number' } } },
      ],
    } as any

    expect(coercer.coerce(schema, { a: '123', b: '456', c: '789' })).toEqual({ a: 123, b: 456, c: '789' })
    expect(coercer.coerce(schema, { a: '123' })).toEqual({ a: 123 })
    expect(coercer.coerce(schema, { b: '456' })).toEqual({ b: 456 })
    expect(coercer.coerce(schema, 'invalid')).toEqual('invalid')
  })

  it('can coerce recursive types', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'boolean' },
        b: { $ref: '#/components/schema/Test' },
      },
      required: ['a'],
    } as any

    expect(coercer.coerce(schema, {
      a: 'true',
      b: {
        a: 'off',
        b: {
          a: 'invalid',
          b: 'invalid',
        },
      },
    }, {
      components: {
        '#/components/schema/Test': schema,
      },
    })).toEqual({
      a: true,
      b: {
        a: false,
        b: {
          a: 'invalid',
          b: 'invalid',
        },
      },
    })
  })

  it('can coerce complex structures', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'boolean' },
        b: { type: 'number' },
        c: {
          type: 'array',
          items: { 'type': 'string', 'x-native-type': 'date' },
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

    expect(coercer.coerce(schema, {
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
})

import { maySendNothing, mayWriteNoHeader } from './schema-utils'

describe('maySendNothing', () => {
  const defs: Record<string, any> = {
    Tag: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    Loop: { type: 'object', properties: { self: { $ref: '#/$defs/Loop' } }, required: ['self'] },
  }
  const sendsNothing = (schema: any) => maySendNothing(schema, (name) => defs[name])

  it('holds for null, and empty arrays and objects bracket notation sends no entry for', () => {
    expect(sendsNothing({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toBe(true)
    expect(sendsNothing({ type: 'array', items: { type: 'string' } })).toBe(true)
    expect(sendsNothing({ type: 'object', properties: { a: { type: 'string' } } })).toBe(true)
    expect(sendsNothing({ enum: ['a', null] })).toBe(true)
    expect(sendsNothing({})).toBe(true)
  })

  it('does not hold for values sent as an entry, also through refs and required items', () => {
    expect(sendsNothing({ type: 'string' })).toBe(false)
    expect(sendsNothing({ $ref: '#/$defs/Tag' })).toBe(false)
    expect(sendsNothing({ type: 'array', prefixItems: [{ type: 'string' }], minItems: 1 })).toBe(
      false,
    )
    expect(sendsNothing({ allOf: [{ type: 'string' }, {}] })).toBe(false)
    // a cycle back to a def is written as the def is, by its other fields
    expect(sendsNothing({ $ref: '#/$defs/Loop' })).toBe(false)
    expect(sendsNothing({ not: {} })).toBe(false)
  })
})

describe('mayWriteNoHeader', () => {
  const defs: Record<string, any> = {
    Nullable: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    Name: { type: 'string' },
    Loop: { $ref: '#/$defs/Loop' },
  }
  const writesNoHeader = (schema: any) => mayWriteNoHeader(schema, (name) => defs[name])

  it('holds for null, and arrays that may be empty or hold only null, also through refs', () => {
    expect(writesNoHeader({ $ref: '#/$defs/Nullable' })).toBe(true)
    expect(writesNoHeader({ type: 'array', items: { type: 'string' } })).toBe(true)
    expect(writesNoHeader({ type: 'array', items: defs.Nullable, minItems: 1 })).toBe(true)
    expect(writesNoHeader({ enum: ['a', null] })).toBe(true)
    expect(writesNoHeader({ const: [null] })).toBe(true)
    expect(writesNoHeader({ const: [] })).toBe(true)
    expect(writesNoHeader({ allOf: [{}, { type: ['string', 'null'] }] })).toBe(true)
  })

  it('does not hold for values written on a line', () => {
    expect(writesNoHeader({ $ref: '#/$defs/Name' })).toBe(false)
    expect(writesNoHeader({ $ref: '#/$defs/Loop' })).toBe(false)
    expect(writesNoHeader({ $ref: '#/components/schemas/Name' })).toBe(false)
    expect(writesNoHeader({ type: 'object', properties: {} })).toBe(false)
    expect(writesNoHeader({ type: 'array', items: { type: 'string' }, minItems: 1 })).toBe(false)
    // a `Set` is written on one line, empty or not
    expect(writesNoHeader({ 'type': 'array', 'items': {}, 'x-native-type': 'set' })).toBe(false)
    expect(writesNoHeader({ const: 'a' })).toBe(false)
    expect(writesNoHeader({ allOf: [{ type: 'null' }, { type: 'string' }] })).toBe(false)
    expect(writesNoHeader({ not: {} })).toBe(false)
  })
})

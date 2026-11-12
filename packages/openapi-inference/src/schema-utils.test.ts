import { maySendNothing } from './schema-utils'

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

import {
  admitsNull,
  applyJSDoc,
  bigintSchema,
  collectDefRefs,
  maySendNothing,
  mayWriteNoHeader,
  objectMembers,
  setSchema,
  withDiscriminators,
  writtenForm,
} from './schema-utils'

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

describe('maySendNothing and mayWriteNoHeader edge cases', () => {
  const noDefs = () => undefined

  it('takes boolean schemas as they admit values', () => {
    expect(maySendNothing(true, noDefs)).toBe(true)
    expect(maySendNothing(false, noDefs)).toBe(false)
    expect(mayWriteNoHeader(false, noDefs)).toBe(false)
  })

  it('looks into oneOf, and into constants holding an empty array or object', () => {
    expect(maySendNothing({ oneOf: [{ type: 'string' }, { type: 'null' }] }, noDefs)).toBe(true)
    expect(maySendNothing({ oneOf: [{ type: 'string' }] }, noDefs)).toBe(false)
    expect(maySendNothing({ const: [] }, noDefs)).toBe(true)
    expect(maySendNothing({ const: {} }, noDefs)).toBe(true)
    expect(maySendNothing({ enum: [[1], { a: 1 }] }, noDefs)).toBe(false)
  })

  it('takes a required property or item without a schema as any value', () => {
    expect(maySendNothing({ type: 'object', required: ['a'] }, noDefs)).toBe(true)
    expect(mayWriteNoHeader({ type: 'array', minItems: 1 }, noDefs)).toBe(true)
  })
})

describe('collectDefRefs', () => {
  it('collects the local defs referred to, also into a def, and skips other refs', () => {
    expect(
      collectDefRefs({
        anyOf: [
          { $ref: '#/$defs/A' },
          { $ref: '#/$defs/B/properties/c' },
          { $ref: '#/components/schemas/C' },
          { $ref: 'https://example.com/schema.json' },
        ],
      }),
    ).toEqual(new Set(['A', 'B']))
  })
})

describe('withDiscriminators', () => {
  const defs: Record<string, any> = {
    Circle: {
      type: 'object',
      properties: { kind: { $ref: '#/$defs/CircleKind' } },
      required: ['kind'],
    },
    CircleKind: { $ref: '#/$defs/CircleKindValue' },
    CircleKindValue: { type: 'string', const: 'circle' },
    Square: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['square', 'box'] } },
      required: ['kind'],
    },
    Loop: {
      type: 'object',
      properties: { kind: { $ref: '#/$defs/LoopKind' } },
      required: ['kind'],
    },
    LoopKind: { $ref: '#/$defs/LoopKind' },
    Missing: {
      type: 'object',
      properties: { kind: { $ref: '#/$defs/Unknown' } },
      required: ['kind'],
    },
    Empty: {
      type: 'object',
      properties: { kind: { type: 'string', enum: [] } },
      required: ['kind'],
    },
  }
  const getDef = (name: string) => defs[name]
  const union = (...names: string[]) => ({
    anyOf: names.map((name) => ({ $ref: `#/$defs/${name}` })),
  })

  it('resolves the literals of the discriminator through refs to defs', () => {
    expect(withDiscriminators(union('Circle', 'Square'), getDef)).toEqual({
      oneOf: union('Circle', 'Square').anyOf,
      discriminator: {
        propertyName: 'kind',
        mapping: { circle: '#/$defs/Circle', square: '#/$defs/Square', box: '#/$defs/Square' },
      },
    })
  })

  it('leaves a union of one def, and literals it cannot resolve, as they are', () => {
    expect(withDiscriminators(union('Circle'), getDef)).toEqual(union('Circle'))
    // a ref cycle, a ref to a missing def, and an enum of no values
    expect(withDiscriminators(union('Square', 'Loop'), getDef)).toEqual(union('Square', 'Loop'))
    expect(withDiscriminators(union('Square', 'Missing'), getDef)).toEqual(
      union('Square', 'Missing'),
    )
    expect(withDiscriminators(union('Square', 'Empty'), getDef)).toEqual(union('Square', 'Empty'))
  })
})

describe('setSchema', () => {
  it('has unique items only when distinct items are written as distinct JSON', () => {
    expect(setSchema(bigintSchema(), true).uniqueItems).toBe(true)
    expect(setSchema({ anyOf: [{ type: 'string' }, { type: 'number' }] }, true).uniqueItems).toBe(
      true,
    )
    // any value, of which distinct ones may be written the same
    expect(setSchema(true, true).uniqueItems).toBeUndefined()
    expect(setSchema({ anyOf: [{ type: 'string' }, true] }, true).uniqueItems).toBeUndefined()
  })
})

describe('admitsNull', () => {
  it('holds for schemas admitting any value, and for null in a type array, const, or enum', () => {
    expect(admitsNull(true, undefined)).toBe(true)
    expect(admitsNull(false, undefined)).toBe(false)
    expect(admitsNull({ type: ['string', 'null'] }, undefined)).toBe(true)
    expect(admitsNull({ type: ['string', 'number'] }, undefined)).toBe(false)
    expect(admitsNull({ const: null }, undefined)).toBe(true)
    expect(admitsNull({ enum: ['a', null] }, undefined)).toBe(true)
    expect(admitsNull({ enum: ['a'] }, undefined)).toBe(false)
  })
})

describe('writtenForm and objectMembers', () => {
  it('leaves boolean schemas and unions of only written forms as they are', () => {
    expect(writtenForm(true)).toBe(true)

    const onlyWritten = {
      anyOf: [writtenForm({ type: 'string' }), writtenForm({ type: 'number' })],
    }
    expect(objectMembers(onlyWritten, () => undefined)).toBe(onlyWritten)
  })
})

describe('applyJSDoc', () => {
  const tag = (name: string, text?: string) => ({ name, text }) as any

  it('leaves boolean schemas as they are', () => {
    expect(applyJSDoc(true, 'A comment', [tag('minimum', '1')])).toBe(true)
  })

  it('ignores `@example` and `@default` tags without text', () => {
    expect(applyJSDoc({ type: 'string' }, '', [tag('example'), tag('default', ' ')])).toEqual({
      type: 'string',
    })
    expect(
      applyJSDoc({ type: 'string' }, '', [tag('example', '"a"'), tag('default', '"b"')]),
    ).toEqual({ type: 'string', examples: ['a'], default: 'b' })
  })
})

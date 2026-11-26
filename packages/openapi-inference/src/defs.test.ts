import type { JsonSchema } from '@orpc/json-schema'

import { releasedNames } from '../tests/fixtures/app/src/released-names'
import { DefNames, DefRegistry, toModeKey, toParameterKey } from './defs'
import { OpenAPIGenerator } from './openapi-generator'
import { toRef } from './schema-utils'

describe('def names', () => {
  it('keeps the name of a declared type that a released def was numbered with', async () => {
    const spec = await new OpenAPIGenerator().generate(releasedNames, {
      source: {
        file: new URL('../tests/fixtures/app/src/released-names.ts', import.meta.url),
        export: 'releasedNames',
      },
    })

    const ref = (name: string) => ({
      'application/json': { schema: { $ref: `#/components/schemas/${name}` } },
    })
    // the second `User` shares the def of the first, and frees the name `User2` it held
    expect(spec.paths?.['/a']?.post?.responses?.['200']).toMatchObject({ content: ref('User') })
    expect(spec.paths?.['/b']?.post?.responses?.['200']).toMatchObject({ content: ref('User') })
    expect(spec.paths?.['/c']?.post?.responses?.['200']).toMatchObject({ content: ref('User2') })
    expect(Object.keys(spec.components?.schemas ?? {})).toEqual(['User', 'User2'])
  })
})

describe('defRegistry', () => {
  const ref = (name: string) => ({ $ref: toRef(name) })

  it('names the def of a type converted under JSON.stringify as a parameter after both', () => {
    const names = new DefNames()
    const defs = new DefRegistry(names)

    const def = defs.create(toParameterKey(toModeKey(7, 'stringify')), 'Point')

    expect(def.name).toBe('PointJsonParam')
    // which drops `Param` when no other def has the name
    expect(names.numbered.get('PointJsonParam')).toBe('PointJson')
    expect(names.modes.get('PointJsonParam')).toBe('Point')
    expect(names.parameters.has('PointJsonParam')).toBe(true)
    // apart from the def of the value as a parameter, and of its def under `JSON.stringify`
    expect(defs.create(toParameterKey(7), 'Point').name).toBe('PointParam')
    expect(defs.create(toModeKey(7, 'stringify'), 'Point').name).toBe('PointJson')
  })

  it('keeps the name its type was given since, when it frees the name of a def', () => {
    const names = new DefNames()
    const inputs = new DefRegistry(names)
    const outputs = new DefRegistry(names)

    const input = inputs.create(1, 'User')
    input.schema = { type: 'string' }
    inputs.keepCreated()

    // the registry of outputs converts the type once more after a discarded conversion
    outputs.create(1, 'User').schema = { type: 'number' }
    outputs.discardCreated()
    const output = outputs.create(1, 'User')
    output.schema = { type: 'number' }
    expect(output.name).toBe('User2')

    expect(inputs.replaceIfUnreferenced(input, { type: 'string' })).toBe(true)
    expect(names.used.has('User')).toBe(false)
    expect(names.byKey.get(1)).toBe('User2')
  })

  it('discards a stable def that refers to a def discarded with it', () => {
    const defs = new DefRegistry(new DefNames())

    const holder = defs.create(1, 'Holder')
    holder.schema = { type: 'object', properties: { item: ref('Item') } }
    holder.stable = true
    const item = defs.create(2, 'Item')
    item.schema = { type: 'string' }
    const lone = defs.create(3, 'Lone')
    lone.schema = { type: 'number' }
    lone.stable = true

    defs.discardCreated(true)

    expect(defs.get(1)).toBeUndefined()
    expect(defs.get(2)).toBeUndefined()
    expect(defs.get(3)).toBe(lone)
  })

  describe('mapObjects', () => {
    const tag = (object: JsonSchema): JsonSchema =>
      typeof object === 'object' ? { ...object, title: 'T' } : object

    it('leaves boolean schemas, and refs to defs not converted yet or already followed', () => {
      const defs = new DefRegistry(new DefNames())
      defs.create(1, 'Pending')
      const node = defs.create(2, 'Node')
      node.schema = { anyOf: [{ type: 'string' }, ref('Node')] }

      expect(defs.mapObjects(true, () => false)).toBe(true)
      expect(defs.mapObjects(ref('Missing'), () => false)).toEqual(ref('Missing'))
      expect(defs.mapObjects(ref('Pending'), () => false)).toEqual(ref('Pending'))
      // the recursive ref is followed once
      expect(defs.mapObjects(ref('Node'), tag)).toEqual({
        anyOf: [{ type: 'string', title: 'T' }, ref('Node')],
        title: 'T',
      })
    })

    it('maps an object to a boolean schema, without mapping its members', () => {
      const defs = new DefRegistry(new DefNames())
      const map = vi.fn(() => false)

      expect(defs.mapObjects({ anyOf: [{ type: 'string' }, { type: 'number' }] }, map)).toBe(false)
      expect(map).toHaveBeenCalledTimes(1)
    })
  })

  describe('inlineRoot', () => {
    it('leaves out of a root sent field by field every field no value of which is written', () => {
      const defs = new DefRegistry(new DefNames())

      expect(
        defs.inlineRoot(
          {
            type: 'object',
            properties: { a: { not: {} }, b: { not: {} } },
            required: ['a'],
            additionalProperties: false,
          },
          [],
          [],
          true,
        ),
      ).toEqual({ type: 'object', additionalProperties: false })
    })

    it('leaves a boolean root as it is', () => {
      const defs = new DefRegistry(new DefNames())

      expect(defs.inlineRoot(true, ['query'], ['query'])).toBe(true)
      expect(defs.inlineRoot(false, ['query'], ['query'], true)).toBe(false)
    })
  })
})

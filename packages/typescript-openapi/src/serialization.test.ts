import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { call } from '@orpc/server'
import { Ajv2020 } from 'ajv/dist/2020.js'

import { router } from '../tests/fixtures/app/src/serialization.ts'
import { TypeScriptOpenAPIGenerator } from './openapi-generator.ts'

/**
 * Runs real handlers, serializes their output as oRPC sends it, and validates it
 * against the generated response schemas.
 */
describe('generated schemas match serialized outputs', async () => {
  const start = performance.now()
  const spec = await new TypeScriptOpenAPIGenerator().generate(router, {
    source: { file: new URL('../tests/fixtures/app/src/serialization.ts', import.meta.url) },
  })

  // mutually recursive models (`MutualA`..`MutualI`) inside class instances stay fast
  const generationTime = performance.now() - start

  const ajv = new Ajv2020({ strict: false, allErrors: true })
  ajv.addSchema(
    JSON.parse(
      JSON.stringify({ $id: 'spec', $defs: spec.components?.schemas ?? {} }).replaceAll(
        '#/components/schemas/',
        'spec#/$defs/',
      ),
    ),
  )

  const serializer = new OpenAPIJsonSerializer()

  const responseSchema = (path: string): any =>
    JSON.parse(
      JSON.stringify(
        (spec.paths as any)[path].post.responses['200'].content['application/json'].schema,
      ).replaceAll('#/components/schemas/', 'spec#/$defs/'),
    )

  const serialize = (value: unknown) =>
    JSON.parse(JSON.stringify(serializer.serializeJson(value).json) ?? 'null')

  it.each([
    ['post', undefined],
    ['posts', undefined],
    ['money', undefined],
    ['plain', undefined],
    ['literal', undefined],
    ['echo', { at: new Date(0), tags: ['a'] }],
    ['instant', undefined],
    ['receipt', undefined],
    ['frozen', undefined],
    ['assigned', undefined],
    ['readonlySession', undefined],
    ['pickedSession', undefined],
    ['omittedChannel', undefined],
    ['readonlyCounter', undefined],
    ['readonlyBag', undefined],
    ['spreadRoom', undefined],
    ['spreadSizeRoom', undefined],
    ['selfRoom', undefined],
    ['nestedPromise', undefined],
    ['selfOrNull', undefined],
    ['maybeDate', undefined],
    ['moneyOrNull', undefined],
    ['hidden', undefined],
    ['dict', undefined],
    ['literalToJSON', undefined],
    ['overrides', undefined],
    ['tree', undefined],
    ['trees', undefined],
    ['taggedModel', undefined],
    ['serializable', undefined],
    ['jsonifiable', undefined],
    ['fixedLength', undefined],
    ['brandedKeys', undefined],
    ['anything', undefined],
    ['libraryMapped', undefined],
    ['setRows', undefined],
    ['cycleClass', undefined],
    ['cyclePlain', undefined],
    ['ownToJSON', undefined],
    ['holdsOwnToJSON', undefined],
    ['extendsBuiltins', undefined],
    ['mutual', undefined],
    ['holdsMutual', undefined],
    ['protoKey', undefined],
    ['boxed', undefined],
    ['mixedFunctions', undefined],
    ['functionValues', undefined],
    ['holdsDropJSON', undefined],
    ['holdsBrandedJSON', undefined],
    ['setIndex', undefined],
    ['setOrFunction', undefined],
    ['walkedIntersections', undefined],
    ['toBranded', undefined],
    ['arrayToJSON', undefined],
    ['libraryClasses', undefined],
    ['droppedArrays', undefined],
    ['mixedSet', undefined],
  ] as const)('%s', async (name, input) => {
    const output = await call((router as any)[name], input)
    const json = serialize(output)
    const validate = ajv.compile(responseSchema(`/${name}`))

    expect(validate(json) ? [] : validate.errors).toEqual([])
  })

  it('keeps `__proto__` as an own key, describes boxed primitives, and drops functions in unions', () => {
    const schemas = spec.components?.schemas as any

    expect(Object.keys(schemas.ProtoKey.properties)).toEqual(['__proto__', 'name'])
    expect(schemas.ProtoKey.required).toEqual(['__proto__', 'name'])
    expect(schemas.Boxed).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'number' },
        ok: { type: 'boolean' },
      },
      required: ['name', 'count'],
    })
    expect(schemas.MixedFunctions).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'number' },
        list: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
      },
      required: ['list'],
    })
  })

  it('drops functions in record values and array items, and reads toJSON of intersections', () => {
    const schemas = spec.components?.schemas as any

    expect(schemas.FunctionValues.properties).toEqual({
      m: { type: 'object', additionalProperties: { type: 'string' } },
      nulls: { type: 'array', items: { type: 'null' } },
      undefineds: { type: 'array', items: { type: 'null' } },
    })
    expect(schemas.HoldsDropJSON.required).toEqual(['y'])
    expect(schemas.HoldsBrandedJSON.properties).toEqual({
      k: { type: 'string' },
      ks: { type: 'array', items: { type: 'string' } },
    })
  })

  it('converts unions with functions in class instances under JSON.stringify rules', () => {
    const schemas = spec.components?.schemas as any

    expect(schemas.SetIndex.additionalProperties).toEqual({
      anyOf: [{ type: 'number' }, { type: 'object' }],
    })
    expect(schemas.SetOrFunction.properties.tags).toEqual({ type: 'object' })
  })

  it('walks arrays with toJSON, and reads branded values toJSON returns', () => {
    const schemas = spec.components?.schemas as any
    expect(schemas.WalkedIntersections.required).toEqual(['list'])
    expect(schemas.WalkedIntersections.properties.list).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
    expect(schemas.ToBrandedDate).toEqual({
      type: 'object',
      description: 'A date with a brand, serialized as an empty object',
    })
    expect(schemas.ToBrandedItems).toEqual({ type: 'array', items: { type: 'number' } })
    // `JSON.stringify` calls `toJSON` of arrays in class instances
    expect(schemas.ArrayToJSONHolder.properties.list).toEqual({ type: 'number' })
  })

  it('reads toJSON of arrays in class instances, and iterated Set items', () => {
    const schemas = spec.components?.schemas as any
    expect(schemas.DroppedArrays).toEqual({
      type: 'object',
      properties: { maybe: { type: 'number' } },
    })
    expect(schemas.MixedSet.items).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }] })
  })

  it('describes classes libraries declare as interfaces with constructors as class instances', () => {
    const schema = (spec.paths as any)['/libraryClasses'].post.responses['200'].content[
      'application/json'
    ].schema

    expect(schema.properties).toEqual({
      typeError: { type: 'object' },
      params: { type: 'object' },
      response: { type: 'object' },
      zodError: { type: 'object' },
    })
  })

  it('describes class instances with JSON.stringify semantics', () => {
    expect(spec.components?.schemas?.Post).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
        tags: { type: 'object' },
        counts: { type: 'object' },
        createdAt: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
        author: { $ref: '#/components/schemas/Author' },
        nested: {
          type: 'object',
          properties: { labels: { type: 'object' } },
          required: ['labels'],
        },
      },
      required: ['id', 'tags', 'counts', 'createdAt', 'author', 'nested'],
    })

    // the plain object keeps the serializer's forms, and the shared model has one component
    expect((spec.components?.schemas?.Plain as any).properties.tags).toEqual({
      'type': 'array',
      'uniqueItems': true,
      'items': { type: 'string' },
      'x-native-type': 'set',
    })
    expect(
      Object.keys(spec.components?.schemas ?? {}).filter((n) => n.startsWith('Author')),
    ).toEqual(['Author'])
  })

  it('never emits a component that only refers to itself', () => {
    for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) {
      expect((schema as any).$ref).not.toBe(`#/components/schemas/${name}`)
    }
  })

  it('documents what toJSON returns, read by its own fields', () => {
    const schemas = spec.components?.schemas as any
    // `{ ...this, size: this.size }`
    expect(schemas.SpreadSizeRoom).toEqual({
      type: 'object',
      properties: {
        members: { type: 'object' },
        id: { type: 'string' },
        size: { type: 'number' },
      },
      required: ['members', 'id', 'size'],
    })
    // `toJSON(): this`
    expect(schemas.SelfRoom).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    })
    // `toJSON(): Money` is serialized by Money's fields, `toJSON(): Date` as `{}`
    expect(schemas.Receipt).toEqual({
      type: 'object',
      properties: { cents: { type: 'number' } },
      required: ['cents'],
    })
    expect(schemas.Instant).toEqual({ type: 'object' })
  })

  it('has one component per model, named after it', () => {
    const schemas = spec.components?.schemas ?? {}
    const names = Object.keys(schemas)

    // no numbered variant without its base, like `TaggedModel2` without `TaggedModel`
    for (const name of names) {
      const base = name.replace(/\d+$/u, '')
      if (base !== name) {
        expect(names).toContain(base)
      }
    }

    // no two identical components
    const bodies = names.map((name) => JSON.stringify(schemas[name]))
    expect(new Set(bodies).size).toBe(bodies.length)
  })

  it('does not depend on the order of procedures', async () => {
    const reversed = Object.fromEntries(Object.entries(router).toReversed())
    const other = await new TypeScriptOpenAPIGenerator().generate(reversed as typeof router, {
      source: { file: new URL('../tests/fixtures/app/src/serialization.ts', import.meta.url) },
    })

    expect(Object.keys(other.components?.schemas ?? {}).toSorted()).toEqual(
      Object.keys(spec.components?.schemas ?? {}).toSorted(),
    )
  })

  it('generates quickly', () => {
    expect(generationTime).toBeLessThan(10_000)
  })

  it('names the JSON.stringify form of a model apart from its serializer form', () => {
    const names = Object.keys(spec.components?.schemas ?? {})
    expect(names).toContain('CycleB')
    expect(names).toContain('CycleBJson')
    expect((spec.components?.schemas as any).CycleBJson.properties.tags).toEqual({ type: 'object' })
    expect((spec.components?.schemas as any).CycleB.properties.tags['x-native-type']).toBe('set')
  })
})

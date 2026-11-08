import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { call } from '@orpc/server'
import { Ajv2020 } from 'ajv/dist/2020.js'

import { router } from '../tests/fixtures/app/src/serialization.ts'
import { chain8, chain16 } from '../tests/fixtures/app/src/view-chains.ts'
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

  const deref = (schema: any): any =>
    schema?.$ref
      ? deref((spec.components?.schemas as any)[schema.$ref.replace('#/components/schemas/', '')])
      : schema

  const serialize = (value: unknown) =>
    JSON.parse(JSON.stringify(serializer.serializeJson(value).json) ?? 'null')

  const setArray = expect.objectContaining({ 'type': 'array', 'x-native-type': 'set' })
  // a `Set` in a view: of a plain object the serializer walks, or of an instance `JSON.stringify` writes
  const eitherSet = { anyOf: [setArray, { type: 'object' }] }

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
    ['brandedSets', undefined],
    ['partialMoney', undefined],
    ['mappedDates', undefined],
    ['partialPlain', undefined],
    ['optionalToJSONClass', undefined],
    ['readonlyBytes', undefined],
    ['wrappedOptionalToJSON', undefined],
    ['readonlyBinary', undefined],
    ['bytesAndBoxes', undefined],
    ['optionalToJSONViews', undefined],
    ['views', undefined],
    ['toJSONResults', undefined],
    ['builtinViews', undefined],
    ['moreViews', undefined],
    ['moreToJSON', undefined],
    ['roundTwentyThree', undefined],
    ['eitherForms', undefined],
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
    // arrays are not class instances, `JSON.stringify` writes the `Set` items of a class field as `{}`
    expect(schemas.HoldsBrandedSets.properties.sets).toEqual({
      $ref: '#/components/schemas/BrandedSetsJson',
    })
    expect(schemas.BrandedSetsJson).toEqual({
      type: 'array',
      items: { type: 'object' },
      description: 'Sets with a brand',
    })
    // `Partial<Money>` maps `toJSON` to an optional property, the instance still has it
    const money = (spec.paths as any)['/partialMoney'].post.responses['200'].content[
      'application/json'
    ].schema.properties.m
    // `{}` is a `Partial<Money>` too
    expect(deref(money).anyOf).toEqual([
      expect.objectContaining({ required: ['amount', 'currency'] }),
      expect.objectContaining({ type: 'object' }),
    ])
    // also behind `Readonly`, `Pick`, and intersections, whose fields are of an instance or a plain object
    const wrapped = (spec.paths as any)['/wrappedOptionalToJSON'].post.responses['200'].content[
      'application/json'
    ].schema.properties
    for (const key of ['frozen', 'picked', 'assigned']) {
      expect(deref(wrapped[key]).anyOf[0]).toEqual({ type: 'string' })
      expect(deref(wrapped[key]).anyOf[1].properties.tags).toEqual(eitherSet)
    }
    const binary = (spec.paths as any)['/readonlyBinary'].post.responses['200'].content[
      'application/json'
    ].schema.properties
    expect(binary).toEqual({ buffer: { type: 'object' }, view: { type: 'object' } })

    const bytes = { type: 'object', additionalProperties: { type: 'number' } }
    expect(schemas.PlainBytes).toEqual({
      ...bytes,
      description: 'Bytes without fields of their own',
    })
    expect(schemas.LabeledBytes).toEqual({
      ...bytes,
      properties: { label: { type: 'string' } },
      required: ['label'],
    })
    expect(schemas.Box_Uint8Array_ArrayBufferLike.properties.data).toEqual(bytes)

    // a `#private` member allows only instances, `Partial` allows plain objects too
    const views = (spec.paths as any)['/optionalToJSONViews'].post.responses['200'].content[
      'application/json'
    ].schema.properties
    expect(deref(views.plain).anyOf).toEqual([
      { type: 'string' },
      { type: 'object', properties: { tags: eitherSet } },
    ])
    expect(schemas.ExtendsPrivate.anyOf).toEqual([
      { type: 'string' },
      { type: 'object', properties: { tags: { type: 'object' } }, required: ['tags'] },
    ])

    // the fields of a class instance are written by `JSON.stringify`
    expect(schemas.OptionalToJSONClass.anyOf[1].properties.tags).toEqual({ type: 'object' })
    expect(schemas.ReadonlyBytesJSON).toEqual(bytes)

    // `JSON.stringify` does not call `toJSON` of the returned date again
    expect(schemas.ReadonlyDateJSON).toMatchObject({ type: 'object' })
    expect(schemas.PartialDateJSON).toMatchObject({ type: 'object' })
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

  it('describes the fields of views of classes in both forms, and toJSON results by their own fields', () => {
    const schemas = spec.components?.schemas as any
    const response = (path: string) =>
      (spec.paths as any)[path].post.responses['200'].content['application/json'].schema.properties

    // a view holds an instance (`JSON.stringify` writes a `Set` as `{}`) or a plain object
    const views = response('/views')
    expect(views.picked).toEqual({
      type: 'object',
      properties: { tags: eitherSet },
      required: ['tags'],
    })
    // a getter is no data of an instance, but of a plain object
    expect(views.frozenIntersection).toEqual({
      type: 'object',
      properties: {
        tags: eitherSet,
        name: { type: 'string' },
        label: { type: 'string' },
        extra: { type: 'string' },
      },
      required: ['tags', 'name', 'extra'],
    })
    // `private` allows only instances, and a mapped base drops `#private`
    expect(schemas.ExtendsTsPrivate.properties.tags).toEqual({ type: 'object' })
    expect(schemas.ExtendsPickedPrivate.properties.tags).toEqual(setArray)
    // keys of a class with values of their own are a plain object
    expect(schemas.Flags_TaggedView.properties.tags).toEqual(setArray)

    const results = response('/toJSONResults')
    expect(schemas.ReturnsLabeledBytes).toMatchObject({
      properties: { label: { type: 'string' } },
      additionalProperties: { type: 'number' },
    })
    expect(schemas.ReturnsLabeledDate).toMatchObject({ properties: { label: { type: 'string' } } })
    expect(results.maybe.items).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] })
    expect(results.fn).toEqual({ type: 'string' })
    // the key is dropped when `toJSON` returns the function
    expect(
      (spec.paths as any)['/toJSONResults'].post.responses['200'].content['application/json'].schema
        .required,
    ).not.toContain('fn')

    const builtins = response('/builtinViews')
    expect(builtins.error).toEqual({ type: 'object' })
    expect(builtins.regexp).toEqual({})
    expect(schemas.HoldsSettled.properties.settled.properties.value).toEqual({ type: 'object' })
  })

  it('reads toJSON of classes behind views, and of union members', () => {
    const schemas = spec.components?.schemas as any
    const response = (path: string) =>
      (spec.paths as any)[path].post.responses['200'].content['application/json'].schema
    const kind = {
      type: 'object',
      properties: { kind: { type: 'string', const: 'json' } },
      required: ['kind'],
    }

    const views = response('/moreViews').properties
    // `Readonly<C>` drops the private members, so a plain object is assignable too
    expect(views.privateView.properties.tags).toEqual(eitherSet)
    // an instance has the `toJSON` of its class, which a `Pick` leaves out
    expect(deref(views.pickedJSON).anyOf[0]).toEqual(kind)
    expect(deref(views.pickedJSONList.items).anyOf[0]).toEqual(kind)
    expect(deref(views.pickedDate).anyOf[1]).toEqual({
      type: 'object',
      properties: { label: { type: 'string' } },
      required: ['label'],
    })
    expect(schemas.Nullable_KindJSON.anyOf[0]).toEqual(kind)
    expect(schemas.OmittedKind.anyOf[0]).toEqual(kind)

    const results = response('/moreToJSON')
    expect(results.properties.mixed.items.anyOf).toContainEqual({ type: 'null' })
    expect(results.required).not.toContain('maybe')
    // a returned date subclass is written by its own fields, also through a view
    expect(schemas.ReturnsFrozenDate).toMatchObject({ properties: { label: { type: 'string' } } })
    expect(schemas.ReturnsAssignedDate).toMatchObject({
      properties: { label: { type: 'string' }, x: { type: 'string' } },
    })
  })

  it('reads views through aliases, intersections, and built-ins', () => {
    const schemas = spec.components?.schemas as any
    const response = (spec.paths as any)['/roundTwentyThree'].post.responses['200'].content[
      'application/json'
    ].schema
    const { properties } = response

    // the `toJSON` an intersection adds
    expect(deref(properties.assignedJSON).anyOf[0]).toEqual({ type: 'number' })
    // aliases of views of derived and generic classes
    expect(schemas.PickedDerived.anyOf[0]).toEqual({ type: 'string' })
    expect(schemas.OmittedBox.properties.tags).toEqual(eitherSet)
    expect(schemas.ExtendsPlain.properties.tags).toEqual(eitherSet)
    // a built-in behind a view, and fields added to a typed array
    expect(properties.readonlySet).toMatchObject({ 'x-native-type': 'set' })
    expect(properties.bytes).toEqual({
      type: 'object',
      properties: { x: { type: 'string' } },
      additionalProperties: { type: 'number' },
    })
    // views that may hold plain objects
    expect(properties.partialDate.anyOf[1]).toEqual({ type: 'object' })
    expect(properties.partialCounted.anyOf[1].properties.label).toEqual({ type: 'string' })
    // `toJSON` of the class behind `Omit` may return `undefined`
    expect(properties.omittedJSON.required).toBeUndefined()
  })

  it('names the form of a model written by either one apart', () => {
    const schemas = spec.components?.schemas as any
    const { properties } = (spec.paths as any)['/eitherForms'].post.responses['200'].content[
      'application/json'
    ].schema

    expect(properties.holder).toEqual({ $ref: '#/components/schemas/TagsHolder' })
    expect(schemas.TagsHolder.properties.tags).toEqual(setArray)
    // inside a view, a plain object may be walked by the serializer or written by `JSON.stringify`
    const plain = deref(properties.plain)
    expect(plain.properties.holder).toEqual({
      $ref: '#/components/schemas/TagsHolderAny',
    })
    expect(schemas.TagsHolderAny.properties.tags).toEqual(eitherSet)
    expect(plain.properties.list).toEqual({ type: 'array', items: eitherSet })
    // only the serializer writes a bigint
    expect(plain.properties.big).toMatchObject({ 'x-native-type': 'bigint' })
  })

  it('writes each view of a chain of views once', () => {
    const schemas = spec.components?.schemas as any
    // a view reaching other views is written once, as a component
    expect(
      Object.keys(schemas)
        .filter((name) => name.includes('Chain'))
        .toSorted(),
    ).toEqual(['Readonly_ChainA', 'Readonly_ChainB', 'Readonly_ChainC'])
    expect(schemas.Readonly_ChainA.properties.tags).toEqual(eitherSet)
    expect(JSON.stringify(schemas.Readonly_ChainA).length).toBeLessThan(1000)
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

  it('refers only to components it has', () => {
    const names = new Set(Object.keys(spec.components?.schemas ?? {}))
    const refs = [
      ...JSON.stringify(spec).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/gu),
    ].map((match) => match[1]!)

    expect(refs.filter((name) => !names.has(name))).toEqual([])
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

describe('chains of views of classes', async () => {
  const file = new URL('../tests/fixtures/app/src/view-chains.ts', import.meta.url)
  const generator = new TypeScriptOpenAPIGenerator()
  const specs = {
    8: await generator.generate(chain8, { source: { file, export: 'chain8' } }),
    16: await generator.generate(chain16, { source: { file, export: 'chain16' } }),
  }
  const routers = { 8: chain8, 16: chain16 }
  const serializer = new OpenAPIJsonSerializer()

  it.each([
    [8, 'chain'],
    [8, 'ring'],
    [16, 'chain'],
    [16, 'ring'],
  ] as const)('match serialized outputs (%s, %s)', async (k, name) => {
    const spec = specs[k]
    const ajv = new Ajv2020({ strict: false, allErrors: true })
    const json = JSON.stringify({
      $id: 'spec',
      $defs: spec.components?.schemas ?? {},
      ...(spec.paths as any)[`/${name}`].post.responses['200'].content['application/json'].schema,
    }).replaceAll('#/components/schemas/', '#/$defs/')
    const validate = ajv.compile(JSON.parse(json))
    const output = await call(routers[k][name], undefined)
    const serialized = JSON.parse(JSON.stringify(serializer.serializeJson(output).json))

    expect(validate(serialized) ? [] : validate.errors).toEqual([])
  })

  it('grow linearly with the length of the chain', () => {
    const size = (k: 8 | 16) => JSON.stringify(specs[k]).length
    expect(size(16) / size(8)).toBeLessThan(2.5)
  })

  it('write each view once, as fields of an instance or a plain object', () => {
    const view = (specs[16].paths as any)['/chain'].post.responses['200'].content[
      'application/json'
    ].schema.properties.view

    expect(view.properties.tags).toEqual({
      anyOf: [
        expect.objectContaining({ 'type': 'array', 'x-native-type': 'set' }),
        { type: 'object' },
      ],
    })
    // a getter is written for a plain object, not an instance
    expect(view.properties.label).toEqual({ type: 'string' })
    expect(view.required).toEqual(['tags', 'next'])
    expect(view.properties.next.anyOf[0].properties.next.anyOf[0].required).toEqual([
      'tags',
      'next',
    ])
  })
})

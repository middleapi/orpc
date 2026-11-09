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
    ['expandingViews', undefined],
    ['accessors', undefined],
    ['declaredToJSON', undefined],
    ['functionsAndToJSON', undefined],
    ['bigintsAndObjects', undefined],
    ['builtinViewsTwo', undefined],
    ['interfaceViews', undefined],
    ['typedArrayFields', undefined],
    ['alphaViews', undefined],
    ['alphaDeclared', undefined],
    ['holdsUnfolding', undefined],
    ['deepViews', undefined],
    ['genericAliasViews', undefined],
    ['boxedSubclassJSON', undefined],
    ['errorInterfaces', undefined],
    ['linkInterface', undefined],
    ['twoClassViews', undefined],
    ['brandedMapped', undefined],
    ['typedArrayViews', undefined],
    ['prioritizedView', undefined],
    ['priorities', undefined],
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
    // `private` allows only instances, and a mapped base drops `#private`, so an interface
    // extending it is a view of the class, holding an instance (with `toJSON`) or a plain object
    expect(schemas.ExtendsTsPrivate.properties.tags).toEqual({ type: 'object' })
    expect(schemas.ExtendsPickedPrivate).toEqual({
      anyOf: [
        { type: 'string' },
        { type: 'object', properties: { tags: eitherSet }, required: ['tags'] },
      ],
      description: 'Mapped views drop `#private` members, so plain objects are assignable',
    })
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

  it('cuts generics expanding through views, and leaves auto-accessors out of instances', () => {
    const schemas = spec.components?.schemas as any
    const { properties } = (spec.paths as any)['/expandingViews'].post.responses['200'].content[
      'application/json'
    ].schema

    // `Readonly<Growing<T[]>>` expands `Growing`, cut to `{}` after a few levels
    const third = (schema: any) =>
      schema.properties.next.anyOf[0].properties.next.anyOf[0].properties.next
    expect(third(properties.frozen)).toEqual({ anyOf: [{}, { type: 'null' }] })
    expect(third(schemas.Growing_string)).toEqual({ anyOf: [{}, { type: 'null' }] })
    expect(third(schemas.GrowingShape_string)).toEqual({ anyOf: [{}, { type: 'null' }] })

    // `accessor x` is a getter and setter on the prototype, which an instance does not write
    const accessors = (spec.paths as any)['/accessors'].post.responses['200'].content[
      'application/json'
    ].schema.properties
    const xy = {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['y'],
    }
    expect(accessors.frozen).toEqual(xy)
    expect(accessors.picked).toEqual(xy)
    expect(schemas.AccessorModel.properties).toEqual({ y: { type: 'number' } })
    expect(schemas.HoldsAccessor.properties.v.required).toEqual(['y'])
  })

  it('writes declared object types with toJSON by it or by their fields', () => {
    const schemas = spec.components?.schemas as any
    const response = (spec.paths as any)['/declaredToJSON'].post.responses['200'].content[
      'application/json'
    ].schema
    const { properties } = response
    const a = { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] }
    const point = { anyOf: [{ type: 'string' }, a] }

    // the serializer walks a plain object skipping `toJSON`, `JSON.stringify` calls it
    expect(schemas.PointJSON).toEqual(point)
    expect(schemas.PointAlias).toEqual({
      anyOf: [
        { type: 'string' },
        { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    })
    expect(properties.inline).toEqual(point)
    expect(schemas['Readonly-HoldsPointJSON'].properties.inner).toEqual({
      $ref: '#/components/schemas/PointJSON',
    })
    // a `toJSON` returning only `undefined` adds no branch, its key may be missing
    expect(schemas['Readonly-HoldsDroppingShape']).toEqual({
      type: 'object',
      properties: { d: { $ref: '#/components/schemas/DroppingShape' } },
    })
    expect(properties.picked).toEqual(a)
    expect(properties.pickedList.items).toEqual({ anyOf: [a, { type: 'null' }] })
    expect(schemas.HoldsPickedDrops).toEqual({ type: 'object', properties: { p: a } })
    expect(properties.frozenDrops).toEqual(a)
    expect(response.required).not.toContain('picked')
    expect(response.required).not.toContain('frozenDrops')
  })

  it('drops functions with properties, and reads the toJSON an intersection adds', () => {
    const schemas = spec.components?.schemas as any
    const { properties } = (spec.paths as any)['/functionsAndToJSON'].post.responses['200'].content[
      'application/json'
    ].schema

    expect(Object.keys(properties)).not.toContain('cb')
    expect(schemas.HoldsTaggedFunction.properties).toEqual({
      count: { type: 'number' },
      name: { type: 'string' },
    })
    expect(properties.list.items).toEqual({ type: 'null' })
    expect(properties.callables.items).toEqual({ type: 'null' })
    // an own `toJSON` shadows the class's, whatever the order of the intersection
    expect(properties.cents).toEqual({ type: 'number' })
    expect(properties.swapped).toEqual({ type: 'number' })
    expect(properties.kind).toEqual({
      anyOf: [
        { type: 'number' },
        { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
      ],
    })
  })

  it('names a model with bigints once, and describes object, and boxed toJSON results', () => {
    const schemas = spec.components?.schemas as any
    const { properties } = (spec.paths as any)['/bigintsAndObjects'].post.responses['200'].content[
      'application/json'
    ].schema

    // without a polyfilled `toJSON`, only the serializer writes a bigint, so a view adds no form
    expect(Object.keys(schemas)).not.toContain('HasBigintAny')
    expect(schemas['Readonly-HoldsHasBigint'].properties.h).toEqual({
      $ref: '#/components/schemas/HasBigint',
    })
    // `object` is also an array, a `Date`, or a `Map`
    expect(properties.list).toEqual({})
    expect(properties.date).toEqual({})
    expect(properties.map).toEqual({})
    expect(properties.boxed.properties).toEqual({
      s: { type: 'string' },
      n: { type: 'number' },
      b: { type: 'boolean' },
    })
  })

  it('describes chained views of built-ins and intersections with them in both forms', () => {
    const schemas = spec.components?.schemas as any
    const { properties } = (spec.paths as any)['/builtinViewsTwo'].post.responses['200'].content[
      'application/json'
    ].schema
    const uri = { 'type': 'string', 'format': 'uri', 'x-native-type': 'url' }
    const dateTime = { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' }
    const href = expect.objectContaining({ type: 'string' })

    expect(properties.partialFrozenDate).toEqual({ anyOf: [dateTime, { type: 'object' }] })
    expect(properties.frozenPickedURL).toEqual({
      anyOf: [uri, { type: 'object', properties: { href }, required: ['href'] }],
    })
    expect(properties.partialFrozenBytes).toEqual({
      type: 'object',
      additionalProperties: { type: 'number' },
    })
    // a plain object of a chained view of an array subclass holds its fields
    expect(schemas['Partial-Readonly-GammaRows'].anyOf[1]).toMatchObject({
      type: 'object',
      properties: { label: { type: 'string' } },
      additionalProperties: { $ref: '#/components/schemas/Gamma' },
    })
    // `JSON.stringify` writes a `Set` and a `Map` as `{}`, also through a view
    expect(schemas.HoldsBuiltinViews.properties.set).toEqual({ type: 'object' })
    expect(schemas.HoldsBuiltinViews.properties.map).toEqual({ type: 'object' })
    // an intersection with a view of a built-in may be a plain object of all its fields
    const urlWithX = {
      anyOf: [
        uri,
        { type: 'object', properties: { href, x: { type: 'number' } }, required: ['href', 'x'] },
      ],
    }
    expect(properties.url).toEqual(urlWithX)
    expect(schemas.HoldsBuiltinViews.properties.url).toEqual(urlWithX)
    expect(properties.date).toEqual({
      anyOf: [dateTime, { type: 'object', properties: { at: dateTime }, required: ['at'] }],
    })
    expect(properties.set.anyOf[1]).toEqual({
      type: 'object',
      properties: { size: { type: 'number' }, at: dateTime },
      required: ['at'],
    })
    expect(properties.rows.anyOf[1]).toMatchObject({
      properties: { label: { type: 'string' }, x: { type: 'string' } },
      required: ['x'],
    })
    // under `JSON.stringify`, a view of a date subclass is the date or a plain object
    const stamped = {
      anyOf: [
        dateTime,
        { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
      ],
    }
    expect(schemas.HoldsStampedView.properties.v).toEqual(stamped)
    expect(schemas.HoldsStampedView.properties.list.items).toEqual(stamped)
  })

  it('reads interfaces over views and other interfaces as views of the class', () => {
    const schemas = spec.components?.schemas as any

    for (const name of [
      'ExtendsTagger',
      'ExtendsExtendsTagger',
      'ExtendsFrozenTagger',
      'ExtendsPickedTagger',
      'ExtendsTaggerWithX',
      'PickTagger',
      'PickTagger_tags',
    ]) {
      expect(schemas[name].properties.tags).toEqual(eitherSet)
    }
    expect(schemas.ExtendsTaggerWithX.properties.y).toEqual(eitherSet)
    // a plain object without `toJSON` is written by its fields
    for (const name of ['ExtendsFrozenTaggerJSON', 'ExtendsExtendsTaggerJSON']) {
      expect(schemas[name].anyOf[0]).toEqual({
        type: 'object',
        properties: { j: { type: 'number' } },
        required: ['j'],
      })
      expect(schemas[name].anyOf[1].properties.tags).toEqual(eitherSet)
    }
  })

  it('writes fields added to typed arrays under JSON.stringify, also behind a view', () => {
    const schemas = spec.components?.schemas as any
    const { properties } = (spec.paths as any)['/typedArrayFields'].post.responses['200'].content[
      'application/json'
    ].schema
    const labeled = {
      type: 'object',
      properties: { label: { type: 'string' } },
      additionalProperties: { type: 'number' },
    }

    expect(schemas.BytesWithTags).toEqual({
      type: 'object',
      properties: { tags: { type: 'object' } },
      additionalProperties: { type: 'number' },
    })
    expect(schemas.BytesWithLabel).toEqual(labeled)
    expect(properties.frozen).toEqual(labeled)
  })

  it('keeps the names of declared types apart from the names of views', () => {
    const schemas = spec.components?.schemas as any

    expect(schemas.Readonly_AlphaModel.properties).toEqual({ declared: { type: 'string' } })
    expect(schemas.AlphaModel_View.properties).toEqual({ declared: { type: 'number' } })
    expect(
      (spec.paths as any)['/alphaViews'].post.responses['200'].content['application/json'].schema
        .properties,
    ).toEqual({
      frozen: { $ref: '#/components/schemas/Readonly-AlphaModel' },
      assigned: { $ref: '#/components/schemas/AlphaModel-View' },
    })
  })

  describe('round twenty-six', () => {
    const schemas = () => spec.components?.schemas as any
    const properties = (name: string) =>
      (spec.paths as any)[`/${name}`].post.responses['200'].content['application/json'].schema
        .properties
    const setOf = (items: object) => ({
      'type': 'array',
      'uniqueItems': true,
      items,
      'x-native-type': 'set',
    })
    const stringifiedSet = { type: 'object' }

    it('converts a type an expansion was cut at again when it is used directly in a class', () => {
      expect(schemas().HoldsUnfolding.properties).toEqual({
        a: { $ref: '#/components/schemas/Unfolding_Set_stringJson' },
        b: { $ref: '#/components/schemas/Unfolding_Set_string_ArrayArrayArrayJson' },
      })
      expect(schemas().Unfolding_Set_string_ArrayArrayArrayJson.properties.value).toEqual({
        type: 'array',
        items: { type: 'array', items: { type: 'array', items: stringifiedSet } },
      })
    })

    it('reads views through generic aliases of the class', () => {
      expect(schemas().PickLabel_string).toEqual({
        anyOf: [
          { type: 'string' },
          { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
        ],
      })
      expect(schemas().PickBagTags_number.properties.tags).toEqual({
        anyOf: [setOf({ type: 'number' }), stringifiedSet],
      })
      expect(schemas().OmitBagNothing_string.properties.tags).toEqual({
        anyOf: [setOf({ type: 'string' }), stringifiedSet],
      })
    })

    it('writes subclasses of boxed primitives toJSON returns as the primitive', () => {
      expect(properties('boxedSubclassJSON')).toEqual({
        s: {
          type: 'object',
          properties: { v: { type: 'string' } },
          required: ['v'],
        },
        n: {
          type: 'object',
          properties: { v: { type: 'number' } },
          required: ['v'],
        },
      })
    })

    it('does not require the members an interface inherits from a built-in class', () => {
      expect(schemas().CodedError.required).toEqual(['code'])
      expect(Object.keys(schemas().CodedError.properties)).toEqual([
        'code',
        'name',
        'message',
        'stack',
        'cause',
      ])
      expect(schemas().MaybeCodedError.required).toBeUndefined()
    })

    it('documents an interface extending a view of a built-in as the built-in or a plain object', () => {
      expect(schemas().LabeledLink).toEqual({
        anyOf: [
          { 'type': 'string', 'format': 'uri', 'x-native-type': 'url' },
          {
            type: 'object',
            properties: {
              label: { type: 'string' },
              href: expect.objectContaining({ type: 'string' }),
            },
            required: ['href'],
          },
        ],
      })
    })

    it('adds what toJSON of every class behind an interface returns, in any order', () => {
      const json = { type: 'object', properties: { j: { type: 'string' } }, required: ['j'] }

      expect(schemas().IdThenJSON).toEqual({
        anyOf: [
          json,
          {
            type: 'object',
            properties: { id: { type: 'number' }, v: { type: 'string' } },
            required: ['id', 'v'],
          },
        ],
      })
      expect(schemas().JSONThenId.anyOf[0]).toEqual(json)
    })

    it('converts mapped types over branded primitives as the primitive', () => {
      expect(properties('brandedMapped')).toEqual({
        id: { type: 'string' },
        partial: { type: 'string' },
        amount: { type: 'number' },
        flag: {
          anyOf: [
            { type: 'boolean', const: false },
            { type: 'boolean', const: true },
          ],
        },
        account: { $ref: '#/components/schemas/DeepFrozen_Account' },
      })
      expect(schemas().DeepFrozen_Account.properties).toEqual({
        id: { type: 'string' },
        balance: { type: 'number' },
        name: { type: 'string' },
      })
    })

    it('converts views of typed array subclasses as an instance or a plain object', () => {
      expect(properties('typedArrayViews')).toEqual({
        set: { type: 'object', properties: { s: eitherSet }, required: ['s'] },
        map: {
          type: 'object',
          properties: {
            d: {
              anyOf: [expect.objectContaining({ 'x-native-type': 'map' }), stringifiedSet],
            },
          },
          required: ['d'],
        },
        bigint: {
          type: 'object',
          properties: {
            v: {
              type: 'object',
              properties: { n: expect.objectContaining({ 'x-native-type': 'bigint' }) },
              required: ['n'],
            },
          },
          required: ['v'],
        },
        // an instance also writes the private field the view leaves out
        frozen: { type: 'object' },
        partial: { type: 'object' },
      })
    })

    it('keeps the def of a type next to a cut expansion', () => {
      expect(schemas().Priority).toEqual({ type: 'number', enum: [0, 1] })
      expect(schemas().Priority2).toBeUndefined()
      expect(schemas()['Readonly-Prioritized'].properties.priority).toEqual({
        $ref: '#/components/schemas/Priority',
      })
      expect(
        (spec.paths as any)['/priorities'].post.responses['200'].content['application/json'].schema,
      ).toEqual({ type: 'array', items: { $ref: '#/components/schemas/Priority' } })
    })
  })

  it('writes each view of a chain of views once', () => {
    const schemas = spec.components?.schemas as any
    // a view reaching other views is written once, as a component
    expect(
      Object.keys(schemas)
        .filter((name) => name.includes('Chain'))
        .toSorted(),
    ).toEqual(['Readonly-ChainA', 'Readonly-ChainB', 'Readonly-ChainC'])
    expect(schemas['Readonly-ChainA'].properties.tags).toEqual(eitherSet)
    expect(JSON.stringify(schemas['Readonly-ChainA']).length).toBeLessThan(1000)
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
    // a declared type keeps its name, whether a view of the same name comes first or not
    for (const name of ['Readonly_AlphaModel', 'AlphaModel_View', 'Readonly-AlphaModel']) {
      expect((other.components?.schemas as any)[name]).toEqual(
        (spec.components?.schemas as any)[name],
      )
    }
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

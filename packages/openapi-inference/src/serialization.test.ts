import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { call } from '@orpc/server'
import { Ajv2020 } from 'ajv/dist/2020.js'

import {
  longDeepChain,
  longerDeepChain,
  mixedDeepChain,
  shortDeepChain,
} from '../tests/fixtures/app/src/deep-view-chains'
import { conditionalRing, nullRing } from '../tests/fixtures/app/src/deep-view-rings'
import { router } from '../tests/fixtures/app/src/serialization'
import { chain8, chain16 } from '../tests/fixtures/app/src/view-chains'
import { OpenAPIGenerator } from './openapi-generator'

/**
 * Runs real handlers, serializes their output as oRPC sends it, and validates it
 * against the generated response schemas.
 */
describe('generated schemas match serialized outputs', async () => {
  const start = performance.now()
  const spec = await new OpenAPIGenerator().generate(router, {
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
    ['holdsLevels', undefined],
    ['errorFields', undefined],
    ['classOrder', undefined],
    ['maskedBrand', undefined],
    ['mask', undefined],
    ['deepClassViews', undefined],
    ['deepJSON', undefined],
    ['redeclaredErrors', undefined],
    ['deepBuiltins', undefined],
    ['builtinInterfaceViews', undefined],
    ['partialStr', undefined],
    ['typedLabel', undefined],
    ['optionalDeep', undefined],
    ['functionJSON', undefined],
    ['constructorJSON', undefined],
    ['functionJSONField', undefined],
    ['deepUnfolding', undefined],
    ['readonlyDeepUnfolding', undefined],
    ['partialDeepUnfolding', undefined],
    ['deepNest', undefined],
    ['maybeFunctionJSON', undefined],
    ['maybeFunctionJSONRoot', undefined],
    ['bufView', undefined],
    ['conditionalDeepViews', undefined],
    ['conditionalDeepJSON', undefined],
    ['functionViews', undefined],
    ['plainFunctionViews', undefined],
    ['functionViewRoot', undefined],
    ['functionRoot', undefined],
    ['errorIntersections', undefined],
    ['errorIntersectionRoot', undefined],
    ['widenedViews', undefined],
    ['ringSideA', undefined],
    ['ringSideB', undefined],
    ['brandedConditional', undefined],
    ['brandedConditionalRoot', undefined],
    ['simplified', undefined],
    ['simplifiedRoot', undefined],
    ['conditionalIntersections', undefined],
    ['conditionalIntersectionRoot', undefined],
    ['typeFestURLs', undefined],
    ['nestedFunctionViews', undefined],
    ['boxedFunctionView', undefined],
    ['conditionalParameterIntersections', undefined],
    ['conditionalParameterRoot', undefined],
    ['conditionalParameterOnlyRoot', undefined],
    ['conditionalMoneyRoot', undefined],
    ['conditionalExpressionRoot', undefined],
    ['narrowedBrands', undefined],
    ['narrowedBrandRoot', undefined],
    ['holderTimes', undefined],
    ['holderTimeRoot', undefined],
    ['widenedValues', undefined],
    ['widenedToJSON', undefined],
    ['mixinBuiltins', undefined],
    ['mixinSetRoot', undefined],
    ['arrayViews', undefined],
    ['deepOrViews', undefined],
    ['mutableDate', undefined],
    ['bigintArrays', undefined],
    ['maybeToJSON', undefined],
    ['restTupleViews', undefined],
    ['narrowedClass', undefined],
    ['frozenToJSON', undefined],
    ['frozenFieldRoot', undefined],
    ['pickedTuples', undefined],
    ['partialArrays', undefined],
    ['partialArrayRoot', undefined],
    ['toJSONUnions', undefined],
    ['toJSONUnionRoot', undefined],
    ['recordViews', undefined],
    ['recordViewRoot', undefined],
    ['widenedEnums', undefined],
    ['toJSONViews', undefined],
    ['frozenMethodRoot', undefined],
    ['widenedArrays', undefined],
    ['widenedArrayRoot', undefined],
    ['pickedArrays', undefined],
    ['pickedArrayRoot', undefined],
    ['omittedPrimitives', undefined],
    ['brandedViews', undefined],
    ['objectFields', undefined],
    ['plainBooleans', undefined],
    ['plainBooleanRoot', undefined],
    ['anyToJSON', undefined],
    ['overloadedToJSON', undefined],
    ['overloadedToJSONRoot', undefined],
    ['keylessViews', undefined],
    ['objectToJSON', undefined],
    ['objectToJSONRoot', undefined],
    ['omittedBrands', undefined],
    ['omittedBrandRoot', undefined],
    ['partialBrands', undefined],
    ['partialBrandRoot', undefined],
    ['keylessClassViews', undefined],
    ['symbolViews', undefined],
    ['brandedSymbols', undefined],
    ['expandingCycle', undefined],
    ['anyRecords', undefined],
    ['literalUnionViews', undefined],
    ['brandedLiteralViews', undefined],
    ['deepSymbolViews', undefined],
    ['omittedLengths', undefined],
    ['keylessIntersections', undefined],
    ['structuralTypes', undefined],
    ['arrayLikeRoot', undefined],
    ['writtenAlike', undefined],
    ['counted', undefined],
    ['looseCounted', undefined],
    ['deepFeed', undefined],
    ['partialFeed', undefined],
    ['nestedBoxes', undefined],
    ['lengthExtra', undefined],
    ['genericCycle', undefined],
    ['genericSelf', undefined],
    ['wrapCycle', undefined],
    ['growingPair', undefined],
    ['deepBoxes', undefined],
    ['viaBoxes', undefined],
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

    it('converts mapped types over branded primitives as the primitive, or a plain object of a partial one', () => {
      expect(properties('brandedMapped')).toEqual({
        id: { type: 'string' },
        // `{}` is a `Partial<AccountId>` too
        partial: {
          anyOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: {
                length: expect.objectContaining({ type: 'number' }),
                __brand: { type: 'string', const: 'AccountId' },
              },
              additionalProperties: { type: 'string' },
            },
          ],
        },
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

  describe('round twenty-seven', () => {
    const schemas = () => spec.components?.schemas as any
    const schemaOf = (name: string) =>
      (spec.paths as any)[`/${name}`].post.responses['200'].content['application/json'].schema
    const mapArray = expect.objectContaining({ 'type': 'array', 'x-native-type': 'map' })
    const eitherMap = { anyOf: [mapArray, { type: 'object' }] }
    const uri = { 'type': 'string', 'format': 'uri', 'x-native-type': 'url' }

    it('documents what toJSON of a function or a class constructor returns', () => {
      expect(schemaOf('functionJSON')).toEqual({ type: 'string' })
      expect(schemaOf('constructorJSON')).toEqual({ type: 'string' })
      expect(schemaOf('functionJSONField')).toEqual({
        type: 'object',
        properties: { f: { type: 'string' }, list: { type: 'array', items: { type: 'string' } } },
        required: ['f', 'list'],
      })
    })

    it('documents the fields of an interface extending a built-in class in both forms', () => {
      expect(schemas().SetError.properties.tags).toEqual(eitherSet)
      expect(schemas().SetError.required).toEqual(['tags'])
      expect(schemas().MapError.properties.m).toEqual(eitherMap)
      expect(schemas().MetaError.properties.meta.properties.tags).toEqual(eitherSet)
    })

    it('adds the built-in of every class behind an interface, in any order', () => {
      for (const name of ['IdTags', 'TagsId']) {
        expect(schemas()[name].anyOf[0]).toEqual(setArray)
        expect(schemas()[name].anyOf.at(-1)).toEqual(
          expect.objectContaining({ type: 'object', required: ['id', 'label'] }),
        )
      }
    })

    it('converts mapped types changing the values of a branded primitive as objects', () => {
      expect(schemaOf('mask')).toEqual({ $ref: '#/components/schemas/Mask_AccountId' })
      expect(schemas().Mask_AccountId).toEqual(
        expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({ __brand: { type: 'boolean', const: true } }),
        }),
      )
      expect(schemas().Mask_AccountId.required).toBeUndefined()
    })

    it('reads deep mapped types over a class as views of it', () => {
      const deepSet = { $ref: '#/components/schemas/DeepRO_Set_stringAny' }

      expect(schemas().DeepRO_Holder.properties).toEqual({
        tags: deepSet,
        map: { $ref: '#/components/schemas/DeepRO_Map_string_numberAny' },
        n: { type: 'number' },
      })
      const description = 'Read-only all the way down'
      expect(schemas().DeepRO_Set_stringAny).toEqual({ ...eitherSet, description })
      expect(schemas().DeepRO_Map_string_numberAny).toEqual({ ...eitherMap, description })
      expect(schemas().DeepRO_OuterHolder.properties).toEqual({
        inner: { $ref: '#/components/schemas/DeepRO_Holder' },
        tags: deepSet,
      })
      expect(schemas().DeepRO_WritesJ.anyOf).toEqual([
        { type: 'object', properties: { j: { type: 'string' } }, required: ['j'] },
        { type: 'object', properties: { v: { type: 'string' } }, required: ['v'] },
      ])
      const { properties } = schemaOf('deepClassViews')
      for (const name of ['readonlyDeep', 'partialDeep']) {
        expect(properties[name].properties.tags).toEqual(eitherSet)
        expect(properties[name].properties.map).toEqual(eitherMap)
      }
    })

    it('does not require members an interface redeclares over a built-in class', () => {
      for (const name of [
        'MsgError',
        'NameError',
        'StackError',
        'LiteralError',
        'AppErrMsg',
        'TypeErrMsg',
        'SizedParams',
        'ByteLen',
        'ReLast',
        'AbortMsg',
      ]) {
        expect(schemas()[name].required).toBeUndefined()
      }
      expect(schemas().ViaMsgError.required).toEqual(['code'])
      expect(schemas().LiteralError.properties.message).toEqual({ type: 'string', const: 'boom' })
    })

    it('converts deep mapped types over built-ins as the built-in', () => {
      const typedArray = { type: 'object', additionalProperties: { type: 'number' } }

      expect(schemas().DeepRO_RegExp).toEqual({ description: 'Read-only all the way down' })
      expect(schemas().DeepRO_Uint8Array_ArrayBufferLike).toEqual({
        ...typedArray,
        description: 'Read-only all the way down',
      })
      expect(schemas().DeepPartialOf_Uint8Array_ArrayBufferLike).toEqual({
        ...typedArray,
        description: 'Optional all the way down',
      })
      expect(schemas().DeepRO_URLSearchParams.required).toBeUndefined()
      expect(schemas().DeepRO_SizedSet.anyOf[0]).toEqual(setArray)
    })

    it('reads views of interfaces over built-ins like the interface', () => {
      const { properties } = schemaOf('builtinInterfaceViews')

      for (const name of ['readonlyLink', 'pickedLink', 'readonlyLinkX']) {
        expect(properties[name].anyOf[0]).toEqual(uri)
      }
      expect(properties.partialSized.anyOf[0]).toEqual(setArray)
      // a view of an interface over a class is a view of the class
      expect(properties.pickedStamp).toEqual({
        anyOf: [
          { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
          { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
        ],
      })
      expect(properties.readonlyCode.required).toBeUndefined()
      expect(properties.pickedCode).toEqual({
        type: 'object',
        properties: { message: { type: 'string' }, code: { type: 'number' } },
      })
    })

    it('documents the plain object of a view of a String subclass by its fields', () => {
      expect(schemaOf('partialStr').anyOf).toEqual([
        { type: 'string' },
        expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({ a: { type: 'number' } }),
        }),
      ])
    })

    it('writes the fields of an interface over a view of a typed array with its index keys', () => {
      expect(schemas().TypedLabel).toEqual({
        type: 'object',
        properties: { label: { type: 'string' } },
        required: ['label'],
        additionalProperties: { type: 'number' },
        description: 'Labeled bytes, or a plain object',
      })
    })

    it('keeps one def for a deep mapped type over optional and required fields', () => {
      const names = Object.keys(schemas())

      expect(schemas().DeepRO_OptionalMaps.properties).toEqual({
        a: { $ref: '#/components/schemas/DeepRO_Map_string_boolean' },
        b: { $ref: '#/components/schemas/DeepRO_Map_string_boolean' },
      })
      expect(names.filter((name) => name.startsWith('DeepRO_Map_string_boolean'))).toEqual([
        'DeepRO_Map_string_boolean',
      ])
      const dates = schemas().DeepRO_OptionalDates.properties
      expect(dates.a).toEqual(dates.b)
      expect(names.filter((name) => /^DeepRO\d*$/u.test(name))).toEqual(['DeepRO'])
      // no def is only a reference to another one
      for (const name of names) {
        expect(Object.keys(schemas()[name])).not.toEqual(['$ref'])
      }
    })

    it('names a type next to a cut expansion once, also converted again', () => {
      expect(schemas().LevelO.properties.u).toEqual({
        $ref: '#/components/schemas/Unfolding_number',
      })
      expect(Object.keys(schemas()).filter((name) => name.startsWith('Unfolding_number'))).toEqual([
        'Unfolding_number',
        'Unfolding_numberArray',
        'Unfolding_numberArrayArray',
      ])
    })

    it('cuts expanding generics under deep mapped types like the generics themselves', () => {
      const names = Object.keys(schemas())
      expect(names.filter((name) => name.startsWith('DeepFrozen_Unfolding'))).toEqual([
        'DeepFrozen_Unfolding_number',
        'DeepFrozen_Unfolding_numberArray',
        'DeepFrozen_Unfolding_numberArrayArray',
      ])
      // nested in a generic class, the growth of its argument is cut too
      expect(names.filter((name) => name.startsWith('DeepPartialOf_GrowingNest'))).toEqual([
        'DeepPartialOf_GrowingNest_number',
        'DeepPartialOf_GrowingNest_numberArray',
        'DeepPartialOf_GrowingNest_numberArrayArray',
      ])
      for (const name of ['readonlyDeepUnfolding', 'partialDeepUnfolding']) {
        expect(JSON.stringify(schemaOf(name)).length).toBeLessThan(1000)
      }
    })

    it('writes a function with an optional toJSON as its result or as nothing', () => {
      const description = 'A function JSON writes by its `toJSON` when it has one, else as nothing'
      const result = { type: 'string', description }

      expect(schemaOf('maybeFunctionJSON')).toEqual({
        type: 'object',
        properties: {
          f: result,
          g: result,
          list: { type: 'array', items: { anyOf: [result, { type: 'null' }] } },
        },
        required: ['list'],
      })
      expect(schemaOf('maybeFunctionJSONRoot')).toEqual(result)
    })

    it('writes an interface over a view of a typed array as bytes or a plain object', () => {
      expect(schemas().BufView).toEqual({
        anyOf: [
          {
            type: 'object',
            properties: { label: { type: 'string' } },
            required: ['label'],
            additionalProperties: { type: 'number' },
          },
          {
            type: 'object',
            properties: {
              label: { type: 'string' },
              buffer: expect.objectContaining({ type: 'object' }),
            },
            required: ['label', 'buffer'],
          },
        ],
        description: 'Bytes, or a plain object holding their buffer',
      })
    })

    it('reads conditional deep mapped types over a class as views of it', () => {
      const { properties } = schemaOf('conditionalDeepViews')
      const fields = { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] }

      // an instance is written by `toJSON`, a plain object by its fields
      expect(properties.json).toEqual({ anyOf: [{ type: 'string' }, fields] })
      expect(schemaOf('conditionalDeepJSON')).toEqual({ anyOf: [{ type: 'string' }, fields] })
      // an instance writes a `Set` as `{}`, a plain object as an array
      expect(properties.partial.properties.tags.anyOf.slice(0, 2)).toEqual([
        expect.objectContaining({ 'type': 'array', 'x-native-type': 'set' }),
        { type: 'object' },
      ])
      expect(properties.partial.properties.map.anyOf.slice(0, 2)).toEqual([
        expect.objectContaining({ 'type': 'array', 'x-native-type': 'map' }),
        { type: 'object' },
      ])
    })

    it('makes a mapped view of a function optional, which may hold the function', () => {
      const deep = 'Read-only all the way down'
      const tag = { type: 'object', properties: { tag: { type: 'string' } }, required: ['tag'] }
      const { properties, required } = schemaOf('functionViews')

      expect(required).toEqual(['deep', 'conditional', 'deepMaybe', 'list'])
      expect(schemas().DeepRO_WithCallback).toEqual({
        type: 'object',
        properties: { cb: { description: deep }, n: { type: 'number' } },
        required: ['n'],
        description: deep,
      })
      expect(properties.conditional.required).toEqual(['n'])
      // the function is written by its `toJSON`, a plain object by its fields
      expect(schemas().DeepRO_FnAndHolder.required).toEqual(['h'])
      expect(schemas().DeepRO_FnAndHolder.properties.f.anyOf[0]).toEqual({ type: 'string' })
      expect(properties.readonlyMaybe).toEqual({
        anyOf: [{ type: 'string' }, tag],
      })
      expect(properties.list).toEqual({
        type: 'array',
        items: { anyOf: [tag, { type: 'null' }] },
      })
    })
  })

  describe('round twenty-eight', () => {
    const schemas = () => spec.components?.schemas as any
    const schemaOf = (name: string) =>
      (spec.paths as any)[`/${name}`].post.responses['200'].content['application/json'].schema
    const mapArray = expect.objectContaining({ 'type': 'array', 'x-native-type': 'map' })
    const eitherMap = { anyOf: [mapArray, { type: 'object' }] }
    const errorFields = {
      name: { type: 'string' },
      message: { type: 'string' },
      stack: { type: 'string' },
      cause: {},
    }

    it('leaves the members an interface inherits from Error optional in intersections', () => {
      const { properties } = schemaOf('errorIntersections')
      const coded = {
        type: 'object',
        properties: { ...errorFields, code: { type: 'string' }, extra: { type: 'string' } },
        required: ['code'],
      }

      expect(schemas().CodedFailureExtra).toEqual({
        type: 'object',
        properties: {
          code: { type: 'number' },
          ...errorFields,
          extra: { type: 'number', const: 1 },
        },
        required: ['code', 'extra'],
        description: 'An error with a code and an extra field',
      })
      expect(properties.frozen.required).toEqual(['code', 'extra'])
      expect(properties.code).toEqual(coded)
      expect(properties.frozenCode).toEqual(coded)
      expect(properties.list.items).toEqual(coded)
      expect(properties.msg.required).toBeUndefined()
      expect(schemaOf('errorIntersectionRoot')).toEqual(coded)
    })

    it('reads mapped types widening each value with views of it as views', () => {
      expect(schemas().OrFrozen_Holder.properties).toEqual({
        tags: eitherSet,
        map: eitherMap,
        n: { type: 'number' },
      })
      expect(schemas().DeepOrSame_WritesW.anyOf).toEqual([
        { type: 'object', properties: { w: { type: 'string' } }, required: ['w'] },
        { type: 'object', properties: { v: { type: 'number' } }, required: ['v'] },
      ])
      expect(schemas().DeepOrSame_Set_stringAny).toEqual({
        ...eitherSet,
        description: 'Deep views of values, or the values',
      })
    })

    it('names the deep views of classes referring to each other after them', () => {
      expect(schemaOf('ringSideA')).toEqual({ $ref: '#/components/schemas/DeepSealed_RingSideA' })
      expect(schemaOf('ringSideB')).toEqual({ $ref: '#/components/schemas/DeepSealed_RingSideB' })
      expect(
        Object.keys(schemas())
          .filter((name) => name.startsWith('DeepSealed_Ring'))
          .toSorted(),
      ).toEqual(['DeepSealed_RingSideA', 'DeepSealed_RingSideB'])
    })

    it('reads conditional deep mapped types and Simplify over branded primitives as them', () => {
      const brands = {
        type: 'object',
        properties: { id: { type: 'string' }, n: { type: 'number' } },
        required: ['id', 'n'],
      }
      const { properties } = schemaOf('brandedConditional')

      expect(properties.deep).toEqual(brands)
      expect(properties.mutable).toEqual(brands)
      // or a plain object of some of their members
      expect(properties.partial.properties.id.anyOf[0]).toEqual({ type: 'string' })
      expect(properties.partial.properties.n.anyOf[0]).toEqual({ type: 'number' })
      expect(schemaOf('brandedConditionalRoot')).toEqual({ type: 'number' })
      expect(schemaOf('simplified')).toEqual({
        type: 'object',
        properties: {
          n: { type: 'number' },
          s: { type: 'string' },
          local: { type: 'number', description: "Each value, as type-fest's `Simplify`" },
        },
        required: ['n', 's', 'local'],
      })
      expect(schemaOf('simplifiedRoot')).toEqual({ type: 'number' })
    })

    it('reads conditional deep mapped types over intersections with a class or built-in as views', () => {
      const { properties } = schemaOf('conditionalIntersections')
      const description = 'Read-only all the way down, through a conditional type'
      const holder = {
        type: 'object',
        properties: {
          tags: {
            anyOf: [expect.objectContaining({ 'x-native-type': 'set' }), { type: 'object' }],
          },
          map: eitherMap,
          n: { type: 'number' },
          extra: { type: 'string' },
        },
        required: ['tags', 'map', 'n'],
      }

      expect(properties.holder).toEqual(holder)
      expect(schemaOf('conditionalIntersectionRoot')).toEqual(holder)
      expect(properties.date).toEqual({
        'type': 'string',
        'format': 'date-time',
        'x-native-type': 'date',
        description,
      })
      expect(properties.partialDate.anyOf).toEqual([
        { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
        { type: 'object', properties: { extra: { type: 'string' } } },
      ])
      expect(properties.url).toEqual({
        'type': 'string',
        'format': 'uri',
        'x-native-type': 'url',
        description,
      })
      expect(properties.set).toEqual(expect.objectContaining({ 'x-native-type': 'set' }))
    })

    it('reads a deep view whose values the source is assignable to as a view', () => {
      const { properties } = schemaOf('typeFestURLs')

      expect(properties.url.properties.s).toEqual(eitherSet)
      expect(properties.url.properties.u.anyOf[0]).toEqual({
        'type': 'string',
        'format': 'uri',
        'x-native-type': 'url',
      })
      expect(properties.params.properties.s).toEqual(eitherSet)
      expect(properties.params.properties.p).toEqual(eitherMap)
    })

    it('reads conditional deep views of classes with parameter properties or class expressions as views', () => {
      const { properties } = schemaOf('conditionalParameterIntersections')
      const tags = { tags: eitherSet }

      expect(properties.params).toEqual({
        type: 'object',
        properties: { extra: { type: 'string' }, ...tags, a: { type: 'number' } },
        required: ['tags', 'a'],
      })
      expect(properties.only).toEqual({ type: 'object', properties: tags, required: ['tags'] })
      expect(schemaOf('conditionalParameterOnlyRoot')).toEqual(properties.only)
      expect(properties.money.anyOf[0]).toEqual({
        type: 'object',
        properties: { amt: { type: 'number' }, cur: { type: 'string' } },
        required: ['amt', 'cur'],
      })
      expect(schemaOf('conditionalMoneyRoot')).toEqual(properties.money)
      expect(properties.box.properties.value).toEqual(eitherSet)
      expect(properties.expression).toEqual({
        type: 'object',
        properties: { extra: { type: 'string' }, ...tags },
        required: ['tags'],
      })
      expect(schemaOf('conditionalExpressionRoot')).toEqual(properties.expression)
    })

    it('makes a view of a view of a function optional', () => {
      expect(schemaOf('nestedFunctionViews').required).toEqual(['n'])
      expect(schemas().FnBox.required).toBeUndefined()
    })
  })

  describe('round twenty-nine', () => {
    const schemas = () => spec.components?.schemas as any
    const schemaOf = (name: string) =>
      (spec.paths as any)[`/${name}`].post.responses['200'].content['application/json'].schema
    const date = { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' }
    const stringSet = expect.objectContaining({ 'type': 'array', 'x-native-type': 'set' })
    const eitherStringSet = { anyOf: [stringSet, { type: 'object' }] }

    it('reads mapped types over brands narrowing members of a primitive as the primitive', () => {
      const deep = 'Read-only all the way down, through a conditional type'

      expect(schemaOf('narrowedBrands')).toEqual({
        type: 'object',
        properties: {
          deep: { type: 'string', description: deep },
          // the brand declaring the members leads back to the alias, and its comment
          simple: { type: 'string', description: 'A string of eight characters' },
          one: { type: 'number', description: 'A number whose value is one' },
          deepOne: { type: 'number', description: deep },
        },
        required: ['deep', 'simple', 'one', 'deepOne'],
      })
      expect(schemaOf('narrowedBrandRoot')).toEqual({
        type: 'string',
        description: 'A string of eight characters',
      })
    })

    it('writes the fields of a class intersected with a view of a built-in in both forms', () => {
      const holder = {
        type: 'object',
        properties: { tags: eitherStringSet, n: { type: 'number' } },
        required: ['tags', 'n'],
      }

      expect(schemas().HolderTime).toEqual({
        anyOf: [date, holder],
        description: 'A holder with the time of a date',
      })
      expect(schemas().HolderTimeView).toEqual({
        anyOf: [date, holder],
        description: 'A holder declared with the time of a date',
      })
      expect(schemaOf('holderTimes').properties.deep.anyOf[1].properties.tags.anyOf).toEqual([
        stringSet,
        { type: 'object' },
      ])
    })

    it('reads mapped types widening each value with other values as views', () => {
      const { properties } = schemaOf('widenedValues')

      expect(properties.str).toEqual({ type: 'string', description: 'Values, or strings' })
      expect(properties.list).toEqual({ type: 'string', description: 'Values, or lists of them' })
      expect(properties.date).toEqual({ ...date, description: 'Values, or lists of them' })
      expect(schemas().OrWrapped_TagsOnly.properties.tags.anyOf[0]).toEqual(eitherStringSet)
      expect(schemas().SetOrItems_TagsOnly.properties.tags.anyOf[1]).toEqual(eitherStringSet)
      // an instance is written by `toJSON`
      expect(schemas().OrList_WritesWord.anyOf[0]).toEqual({
        type: 'object',
        properties: { w: { type: 'string' } },
        required: ['w'],
      })
      // an instance does not write the members inherited from `Error`
      expect(schemas().SetOrItems_TaggedError.required).toEqual(['mtags'])
    })

    it('writes a view widening toJSON with a view of it by toJSON or by its fields', () => {
      const word = { type: 'object', properties: { w: { type: 'string' } }, required: ['w'] }
      const fields = { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] }

      expect(schemas().OrFrozen_WithWordJson).toEqual({
        anyOf: [word, fields],
        description: 'Values or read-only views of them',
      })
      expect(schemas().OrPartial_WithWordJson).toEqual({
        anyOf: [word, fields],
        description: 'Values, or partial views of them',
      })
    })

    it('reads classes extending a mixin applied to a built-in as built-in subclasses', () => {
      expect(schemas().TaggedSet).toEqual({
        'type': 'array',
        'uniqueItems': true,
        'items': { type: 'number' },
        'x-native-type': 'set',
      })
      expect(schemas().TaggedMap).toEqual({
        'type': 'array',
        'items': {
          type: 'array',
          prefixItems: [{ type: 'string' }, { type: 'boolean' }],
          maxItems: 2,
          minItems: 2,
        },
        'x-native-type': 'map',
      })
      expect(schemaOf('mixinSetRoot')).toEqual({ $ref: '#/components/schemas/TaggedSet' })
      expect(schemaOf('mixinBuiltins').properties.frozen.anyOf[0]).toEqual(schemas().TaggedSet)
    })

    it('reads views of intersections of arrays and tuples with objects as arrays', () => {
      expect(schemaOf('arrayViews').properties).toEqual({
        tuple: {
          type: 'array',
          prefixItems: [{ type: 'number' }, { anyOf: [{ type: 'string' }, { type: 'null' }] }],
          minItems: 1,
          maxItems: 2,
        },
        // the number index holds the items, `Partial` also admits a plain object
        partial: {
          anyOf: [
            { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'null' }] } },
            expect.objectContaining({ type: 'object' }),
          ],
        },
      })
    })

    it('reads conditional deep views over values widened with deep views as views', () => {
      const { properties } = schemaOf('deepOrViews')

      expect(properties.deep.properties.tags).toEqual({
        anyOf: [stringSet, { type: 'object' }],
      })
      expect(properties.nulls.properties.tags).toEqual({
        anyOf: [stringSet, { type: 'object' }, { type: 'null' }],
      })
      expect(properties.date).toEqual({
        ...date,
        description: 'Values or `null`, all the way down',
      })
      expect(schemaOf('mutableDate').properties.mutable).toEqual({
        ...date,
        description: 'Mutable all the way down, keeping functions',
      })
    })

    it('writes bigint typed arrays as what JSON.stringify can write', () => {
      const never = { type: 'object', additionalProperties: { not: {} } }

      expect(schemaOf('bigintArrays').properties).toEqual({ signed: never, unsigned: never })
    })
  })

  describe('round thirty', () => {
    const schemas = () => spec.components?.schemas as any
    const schemaOf = (name: string) =>
      (spec.paths as any)[`/${name}`].post.responses['200'].content['application/json'].schema
    const word = { type: 'object', properties: { w: { type: 'string' } }, required: ['w'] }

    it('writes an object whose toJSON may not be a function by toJSON or by its fields', () => {
      expect(schemas().StringOrToJSONJson.anyOf).toEqual([
        word,
        {
          type: 'object',
          properties: { a: { type: 'number' }, toJSON: { type: 'string' } },
          required: ['a'],
        },
      ])
      expect(schemas().NumberOrToJSONJson.anyOf[1].properties.toJSON).toEqual({ type: 'number' })
    })

    it('writes an object whose toJSON may be a view of the method by toJSON or by its fields', () => {
      const fields = {
        type: 'object',
        properties: { a: { type: 'number' }, toJSON: {} },
        required: ['a'],
      }

      // `Readonly<() => R>` is `{}`, which holds any value
      expect(schemas().FrozenJJson.anyOf).toEqual([word, fields])
      expect(schemas().FrozenField.anyOf).toEqual([word, fields])
      expect(schemas().DeepFrozenJJson.anyOf).toEqual([
        word,
        {
          ...fields,
          properties: {
            ...fields.properties,
            toJSON: { description: 'Read-only all the way down' },
          },
        },
      ])
      expect(schemas().OrFrozen_PlainJJson.anyOf).toEqual([
        { type: 'object', properties: { j: { type: 'string' } }, required: ['j'] },
        { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
      ])
    })

    it('writes array-like views of tuples leaving out an element as arrays of any value there', () => {
      expect(schemaOf('pickedTuples').properties).toEqual({
        inner: {
          type: 'array',
          prefixItems: [{ type: 'number' }, {}, { type: 'boolean' }],
          minItems: 3,
          maxItems: 3,
        },
        first: {
          type: 'array',
          prefixItems: [{ type: 'number' }, {}, {}],
          minItems: 3,
          maxItems: 3,
        },
        // the items after the elements are unknown
        rest: { type: 'array', prefixItems: [{ type: 'number' }] },
      })
    })

    it('writes views of rest tuples intersected with an object by their leading elements and items', () => {
      expect(schemaOf('restTupleViews').properties).toEqual({
        frozen: {
          type: 'array',
          prefixItems: [{ type: 'number' }],
          items: { anyOf: [{ type: 'string' }, { type: 'number' }] },
          minItems: 1,
        },
        partial: {
          anyOf: [
            {
              type: 'array',
              prefixItems: [{ anyOf: [{ type: 'number' }, { type: 'null' }] }],
              items: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] },
            },
            expect.objectContaining({ type: 'object' }),
          ],
        },
      })
    })

    it('reads views of a class intersected with a literal narrowing its member as views of the class', () => {
      const { properties } = schemaOf('narrowedClass')

      for (const view of [properties.deep, properties.simple]) {
        expect(view.properties.id).toEqual({ type: 'string', const: 'fixed' })
        expect(view.properties.tags.anyOf).toEqual([
          expect.objectContaining({ 'type': 'array', 'x-native-type': 'set' }),
          { type: 'object' },
        ])
      }
    })
  })

  describe('round thirty-one', () => {
    const schemas = () => spec.components?.schemas as any
    const schemaOf = (name: string) =>
      (spec.paths as any)[`/${name}`].post.responses['200'].content['application/json'].schema
    const word = { type: 'object', properties: { w: { type: 'string' } }, required: ['w'] }
    const nullable = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] })
    const strings = { type: 'array', items: { type: 'string' } }
    const tupleIndex = { anyOf: [{ type: 'string' }, { type: 'number' }] }

    it('writes array-like views with an optional length as arrays or plain objects', () => {
      const pair = {
        anyOf: [
          {
            type: 'array',
            prefixItems: [nullable('number'), nullable('string')],
            minItems: 2,
            maxItems: 2,
          },
          {
            type: 'object',
            properties: {
              0: { type: 'number' },
              1: { type: 'string' },
              extra: { type: 'string' },
              length: { type: 'number', const: 2 },
            },
            additionalProperties: tupleIndex,
          },
        ],
      }
      const { properties } = schemaOf('partialArrays')

      expect(schemaOf('partialArrayRoot')).toEqual(pair)
      expect(properties.empty).toEqual(pair)
      expect(properties.fixed.anyOf[1]).toEqual({
        type: 'object',
        properties: {
          0: { type: 'number' },
          1: { type: 'number' },
          length: { type: 'number', const: 2 },
        },
      })
      expect(properties.list.anyOf).toEqual([
        { type: 'array', items: nullable('number') },
        {
          type: 'object',
          properties: {
            length: expect.objectContaining({ type: 'number' }),
            x: { type: 'string' },
          },
          additionalProperties: { type: 'number' },
        },
      ])
      expect(properties.rest.anyOf[1]).toEqual({
        type: 'object',
        properties: {
          0: { type: 'number' },
          extra: { type: 'string' },
          length: { type: 'number' },
        },
        additionalProperties: tupleIndex,
      })
    })

    it('writes a toJSON that is one of several functions by what any of them returns', () => {
      const x = { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] }

      expect(schemas().TwoResults).toEqual({
        anyOf: [x, { type: 'number' }],
        description: 'A class whose `toJSON` is one of two functions',
      })
      expect(schemas().KeyedResult.anyOf).toEqual([
        { type: 'string' },
        { type: 'object', properties: { k: { type: 'string' } }, required: ['k'] },
      ])
      expect(schemas().TwoFunctionsJson.anyOf).toEqual([
        { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
        { type: 'object', properties: { y: { type: 'string' } }, required: ['y'] },
      ])
      expect(schemaOf('toJSONUnions').properties.frozen).toEqual({
        anyOf: [
          x,
          { type: 'number' },
          { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] },
        ],
      })
    })

    it('reads views of a class intersected with a record or an object literal type as views', () => {
      const { properties } = schemaOf('recordViews')

      for (const view of Object.values<any>(properties)) {
        expect(view.properties.tags.anyOf).toEqual([
          expect.objectContaining({ 'type': 'array', 'x-native-type': 'set' }),
          { type: 'object' },
        ])
        expect(view.required).toEqual(['tags', 'id', 'x'])
      }
      expect(schemaOf('recordViewRoot')).toEqual(properties.deepRecord)
    })

    it('reads mapped types widening an enum member to its primitive as views', () => {
      const tags = {
        anyOf: [
          {
            'type': 'array',
            'uniqueItems': true,
            'items': { type: 'string' },
            'x-native-type': 'set',
          },
          { type: 'object' },
        ],
      }

      expect(schemas().Widen_NumericKinded.properties).toEqual({ e: { type: 'number' }, tags })
      expect(schemas().Widen_TextKinded.properties).toEqual({ s: { type: 'string' }, tags })
    })

    it('calls a toJSON typed as a view of the method or as any function', () => {
      const fields = {
        type: 'object',
        properties: { a: { type: 'number' }, toJSON: {} },
        required: ['a'],
      }

      expect(schemas().OnlyFrozenJson.anyOf).toEqual([word, fields])
      expect(schemas().FrozenMethod.anyOf).toEqual([word, fields])
      expect(schemas().PartialMethod.anyOf).toEqual([word, fields])
      expect(schemas().StrOrFrozenJson.anyOf).toEqual([
        word,
        {
          ...fields,
          properties: { ...fields.properties, toJSON: { anyOf: [{ type: 'string' }, {}] } },
        },
      ])
      // `Function` may return anything, also `undefined`
      expect(schemas().AnyFunctionMethod).toEqual({
        description: 'A class whose `toJSON` is any function',
      })
      expect(schemaOf('toJSONViews').required).toEqual([
        'only',
        'str',
        'strValue',
        'frozen',
        'partial',
      ])
    })

    it('writes mapped types widening the length of an array as arrays or plain objects', () => {
      expect(schemas().OrString.anyOf).toEqual([
        strings,
        {
          type: 'object',
          properties: {
            length: expect.objectContaining({ anyOf: [{ type: 'string' }, { type: 'number' }] }),
            extra: { type: 'string' },
          },
          required: ['length'],
          additionalProperties: { type: 'string' },
        },
      ])
      expect(schemas().OrNull.anyOf[0]).toEqual({ type: 'array', items: nullable('string') })
      expect(schemas().OrList.anyOf[0]).toEqual({
        type: 'array',
        prefixItems: [
          { anyOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' } }] },
        ],
        minItems: 1,
        maxItems: 1,
      })
    })

    it('writes views of arrays leaving out length or slice as arrays or plain objects', () => {
      const { properties } = schemaOf('pickedArrays')
      const first = {
        type: 'array',
        prefixItems: [{ type: 'number' }, {}],
        minItems: 2,
        maxItems: 2,
      }

      expect(schemaOf('pickedArrayRoot')).toEqual({
        anyOf: [first, { type: 'object', properties: { 0: { type: 'number' } }, required: ['0'] }],
      })
      expect(properties.firstLength.anyOf[0]).toEqual(first)
      expect(properties.noSlice.anyOf[0]).toEqual({
        type: 'array',
        prefixItems: [{ type: 'number' }, { type: 'string' }],
        minItems: 2,
        maxItems: 2,
      })
      expect(properties.listNoSlice.anyOf[0]).toEqual(strings)
      expect(properties.listFirst.anyOf[0]).toEqual({
        type: 'array',
        prefixItems: [{ type: 'string' }],
      })
      expect(properties.map).toEqual({ anyOf: [{ type: 'array' }, { type: 'object' }] })
    })

    it('writes views of primitives through Omit or the number index as the primitive', () => {
      expect(schemaOf('omittedPrimitives').properties).toEqual({
        // also keeping every member, a plain object may have them (`{ valueOf: () => true }`)
        str: {
          anyOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: { length: expect.objectContaining({ type: 'number' }) },
              required: ['length'],
              additionalProperties: { type: 'string' },
            },
          ],
        },
        num: { anyOf: [{ type: 'number' }, { type: 'object' }] },
        bool: { anyOf: [{ type: 'boolean' }, { type: 'object' }] },
        // an array of strings has the number index too
        index: {
          anyOf: [
            { type: 'string' },
            { type: 'array', items: { type: 'string' } },
            { type: 'object', additionalProperties: { type: 'string' } },
          ],
        },
      })
    })

    it('writes views of branded primitives intersected with an object type as the primitive', () => {
      expect(schemaOf('brandedViews').properties).toEqual({
        tag: { type: 'string' },
        // a plain object of a partial one, too
        eight: {
          anyOf: [
            { type: 'string', description: 'A string of eight characters' },
            {
              type: 'object',
              properties: {
                length: expect.objectContaining({ type: 'number', const: 8 }),
                extra: { type: 'string' },
              },
              additionalProperties: { type: 'string' },
            },
          ],
        },
        one: { type: 'number', description: 'A number whose value is one' },
      })
    })

    it('leaves out fields of types holding functions', () => {
      expect(schemaOf('objectFields')).toEqual({
        type: 'object',
        properties: {
          obj: {},
          empty: {},
          boxed: {},
          list: { type: 'array', items: { anyOf: [{}, { type: 'null' }] } },
        },
        required: ['list'],
      })
    })
  })

  describe('round thirty-two', () => {
    const schemas = () => spec.components?.schemas as any
    const schemaOf = (name: string) =>
      (spec.paths as any)[`/${name}`].post.responses['200'].content['application/json'].schema

    it('writes views of primitives keeping every member as the primitive or a plain object', () => {
      const plain = { anyOf: [{ type: 'boolean' }, { type: 'object' }] }

      expect(schemas().PlainBoolean).toEqual({
        ...plain,
        description: 'A boolean view a plain object holding `valueOf` satisfies',
      })
      expect(schemaOf('plainBooleans').properties.picked).toEqual(plain)
      expect(deref(schemaOf('plainBooleans').properties.frozen).anyOf).toEqual(plain.anyOf)
    })

    it('writes a toJSON typed any or unknown as anything or the fields', () => {
      // a `toJSON` that is no function is written as a field
      const fields = {
        type: 'object',
        properties: { a: { type: 'number' }, toJSON: {} },
        required: ['a'],
      }

      expect(schemas().AnyJSONField.anyOf).toEqual([{}, fields])
      expect(schemas().UnknownJSONField.anyOf).toEqual([{}, fields])
    })

    it('writes an overloaded toJSON by what any of its signatures returns', () => {
      expect(schemas().OverloadedJSON.anyOf).toEqual([{ type: 'string' }, { type: 'number' }])
    })

    it('leaves out fields of mapped types without keys, which hold functions', () => {
      expect(schemaOf('keylessViews').required).toBeUndefined()
    })
  })

  describe('round thirty-three', () => {
    const schemas = () => spec.components?.schemas as any
    const schemaOf = (name: string) =>
      (spec.paths as any)[`/${name}`].post.responses['200'].content['application/json'].schema
    const length = expect.objectContaining({ type: 'number' })

    it('writes a toJSON typed object, {}, or Object as anything or the fields', () => {
      const fields = {
        type: 'object',
        properties: { a: { type: 'number' }, toJSON: {} },
        required: ['a'],
      }

      expect(schemas().ObjectJSON.anyOf).toEqual([{}, fields])
      expect(schemas().EmptyTypeJSON.anyOf).toEqual([{}, fields])
      expect(schemas().BoxedObjectJSON.anyOf).toEqual([{}, fields])
      expect(schemas().ObjectOrFunctionJSON.anyOf).toEqual([
        {},
        { type: 'object', properties: { w: { type: 'string' } }, required: ['w'] },
        fields,
      ])
    })

    it('writes views of branded primitives leaving members out as the primitive or a plain object', () => {
      const omitted = {
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: { length },
            required: ['length'],
            additionalProperties: { type: 'string' },
          },
        ],
      }
      // an array has a length too
      const picked = {
        anyOf: [
          { type: 'string' },
          { type: 'array', items: {} },
          { type: 'object', properties: { length }, required: ['length'] },
        ],
      }

      expect(schemaOf('omittedBrands').properties).toEqual({
        omit: omitted,
        pick: picked,
        picked,
        num: { anyOf: [{ type: 'number' }, { type: 'object' }] },
        list: { type: 'array', items: omitted },
      })
      expect(schemaOf('omittedBrandRoot')).toEqual(omitted)
    })

    it('writes partial views of branded primitives as the primitive or a plain object', () => {
      const partial = {
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: { length, __brand: { type: 'string', const: 'BrandedId' } },
            additionalProperties: { type: 'string' },
          },
        ],
      }

      expect(schemaOf('partialBrands').properties).toEqual({
        v: partial,
        x: {
          anyOf: [
            { type: 'string' },
            {
              ...partial.anyOf[1],
              properties: { ...partial.anyOf[1]!.properties, extra: { type: 'string' } },
            },
          ],
        },
        id: partial,
        list: { type: 'array', items: partial },
      })
      expect(schemaOf('partialBrandRoot')).toEqual(partial)
    })

    it('writes keyless views of classes as anything, which may be a function', () => {
      expect(schemaOf('keylessClassViews')).toEqual({
        type: 'object',
        properties: {
          picked: {},
          omitted: {},
          str: {},
          list: { type: 'array', items: { anyOf: [{}, { type: 'null' }] } },
        },
        required: ['list'],
      })
    })

    it('leaves out views of symbols and branded symbols, which may be symbols', () => {
      const description = expect.objectContaining({ type: 'string' })
      const symbolObject = { type: 'object', properties: { description } }

      expect(schemaOf('symbolViews')).toEqual({
        type: 'object',
        properties: {
          omit: symbolObject,
          // what has a `toString` method, also an array or a string
          pick: { anyOf: [{ type: 'array', items: {} }, { type: 'string' }, { type: 'object' }] },
          list: { type: 'array', items: { anyOf: [symbolObject, { type: 'null' }] } },
        },
        required: ['list'],
      })
      expect(schemaOf('brandedSymbols')).toEqual({
        type: 'object',
        properties: {
          r: {},
          x: {},
          omit: { anyOf: [{}, symbolObject] },
          list: { type: 'array', items: { type: 'null' } },
          views: { type: 'array', items: { anyOf: [{}, { type: 'null' }] } },
        },
        required: ['list', 'views'],
      })
    })
  })

  describe('round thirty-five', () => {
    const schemas = () => spec.components?.schemas as any
    const schemaOf = (name: string) =>
      (spec.paths as any)[`/${name}`].post.responses['200'].content['application/json'].schema
    const strings = { type: 'string' }
    const stringObject = {
      type: 'object',
      properties: { length: expect.objectContaining({ type: 'number' }) },
      required: ['length'],
      additionalProperties: strings,
    }

    it('cuts a cycle through a conditional deep mapped type where it expands again', () => {
      const a = { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] }
      const level = (f0: object) => ({
        type: 'object',
        properties: { f0: { anyOf: [f0, { type: 'null' }] }, f2: a },
        required: ['f0', 'f2'],
      })

      expect(schemas().ExpandingCycle).toEqual({
        ...level(level(level(level({})))),
        description: expect.any(String),
      })
    })

    it('writes an index signature of any like object, which may hold any value', () => {
      expect(schemaOf('anyRecords')).toEqual({
        type: 'object',
        properties: {
          list: {},
          date: {},
          url: {},
          set: {},
          partial: {},
          fn: {},
          record: {},
        },
      })
    })

    it('writes views of unions of literals, and views dropping a brand, as their primitive', () => {
      expect(schemaOf('literalUnionViews').properties).toEqual({
        shade: { anyOf: [strings, stringObject] },
        letters: { anyOf: [strings, stringObject] },
        template: { anyOf: [strings, stringObject] },
        rank: { anyOf: [{ type: 'number' }, { type: 'object' }] },
        digits: { anyOf: [{ type: 'number' }, { type: 'object' }] },
        flag: { anyOf: [{ type: 'boolean' }, { type: 'object' }] },
      })

      const anyKeys = { type: 'object', additionalProperties: strings }
      expect(schemaOf('brandedLiteralViews').properties).toEqual({
        literal: { anyOf: [strings, stringObject] },
        extended: {
          anyOf: [strings, { ...anyKeys, properties: { extra: strings } }],
        },
        template: { anyOf: [strings, anyKeys] },
        nested: { anyOf: [strings, anyKeys] },
      })
    })

    it('reads the branded primitive of a conditional deep mapped type by its brand', () => {
      const { properties, required } = schemaOf('deepSymbolViews')

      // symbols are left out
      expect(required).toEqual(['list', 'picked'])
      expect(properties.list).toEqual({ type: 'array', items: { anyOf: [{}, { type: 'null' }] } })
      expect(properties.simplified).toEqual({})
      expect(properties.picked).toEqual({
        anyOf: [
          strings,
          {
            type: 'object',
            properties: { __brand: { type: 'string', const: 'TextBrand' } },
            required: ['__brand'],
          },
        ],
      })
    })

    it('writes views of arrays leaving out the length as arrays too', () => {
      expect(schemaOf('omittedLengths').properties).toEqual({
        list: {
          anyOf: [
            { type: 'array', items: strings },
            { type: 'object', additionalProperties: strings },
          ],
        },
        readonly: {
          anyOf: [
            { type: 'array', items: strings },
            { type: 'object', additionalProperties: strings },
          ],
        },
        tuple: {
          anyOf: [
            {
              type: 'array',
              prefixItems: [{ type: 'number' }, strings],
              minItems: 2,
              maxItems: 2,
            },
            expect.objectContaining({ type: 'object', required: ['0', '1'] }),
          ],
        },
        maps: {
          anyOf: [
            { type: 'array', items: expect.objectContaining({ 'x-native-type': 'map' }) },
            expect.objectContaining({ type: 'object' }),
          ],
        },
      })
    })

    it('writes intersections of a keyless type and optional properties as any value', () => {
      const extra = { anyOf: [{}, { type: 'object', properties: { extra: strings } }] }

      // and leaves out the key of a function
      expect(schemaOf('keylessIntersections')).toEqual({
        type: 'object',
        properties: { list: extra, fn: extra, picked: extra, omitted: extra },
      })
    })

    it('writes types arrays and strings satisfy by their members as those too', () => {
      const lookup = 'An interface of methods only, which a `Set` satisfies'
      const arrayLike = {
        anyOf: [
          { type: 'array', items: { type: 'number' } },
          {
            type: 'object',
            properties: { length: { type: 'number' } },
            required: ['length'],
            additionalProperties: { type: 'number' },
          },
        ],
      }

      expect(schemaOf('structuralTypes').properties).toEqual({
        iterable: {},
        set: {},
        entries: {},
        chars: {},
        ids: { type: 'object', properties: { ids: {} }, required: ['ids'] },
        arrayLike,
        numbered: {
          anyOf: [
            { type: 'array', items: strings },
            strings,
            { type: 'object', additionalProperties: strings },
          ],
        },
        indexed: {
          anyOf: [
            { type: 'array', items: { $ref: '#/components/schemas/IndexedItem' } },
            {
              type: 'object',
              additionalProperties: { $ref: '#/components/schemas/IndexedItem' },
            },
          ],
        },
        lookup: { $ref: '#/components/schemas/Lookup' },
        empty: { $ref: '#/components/schemas/EmptyClass' },
      })
      expect(schemas().Lookup).toEqual({ description: lookup })
      expect(schemas().EmptyClass).toEqual({ description: expect.any(String) })
      expect(schemaOf('arrayLikeRoot')).toEqual(arrayLike)
    })

    it('writes sets as unique items only of values written apart', () => {
      const set = (items: object) => ({ 'type': 'array', items, 'x-native-type': 'set' })

      expect(schemaOf('writtenAlike').properties).toEqual({
        dates: set({ 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' }),
        items: set({ $ref: '#/components/schemas/SetItem' }),
        lists: set({ type: 'array', items: strings }),
        strings: { ...set(strings), uniqueItems: true },
      })
    })

    it('reads the comment of an alias only where a property has its type', () => {
      const numberOrString = { anyOf: [strings, { type: 'number' }] }

      expect(schemas().CountedValues.properties).toEqual({
        c: { type: 'integer' },
        d: numberOrString,
      })
      expect(schemas().Loose_CountedValues.properties).toEqual({
        c: numberOrString,
        d: numberOrString,
      })
    })
  })

  describe('round thirty-six', () => {
    const schemaOf = (name: string) =>
      (spec.paths as any)[`/${name}`].post.responses['200'].content['application/json'].schema
    const page = (items: object) => ({
      type: 'object',
      properties: { items: { type: 'array', items }, total: { type: 'number' } },
      required: ['items', 'total'],
    })
    const model = (properties: Record<string, object>) => ({
      type: 'object',
      properties,
      required: Object.keys(properties),
    })
    const text = { type: 'string' }

    it('expands conditional deep mapped types over finite models with nested generic relations', () => {
      // each page maps over the properties of `FeedPage` again, of another instantiation
      expect(schemaOf('deepFeed')).toEqual(
        model({
          name: text,
          posts: page(
            model({
              title: text,
              comments: page(
                model({
                  text,
                  replies: page(model({ text, likes: page(model({ by: text })) })),
                }),
              ),
            }),
          ),
        }),
      )
      expect(JSON.stringify(schemaOf('partialFeed'))).toContain(
        '"likes":{"type":"object","properties":{"items":{"type":"array","items":{"anyOf":[{"type":"object","properties":{"by":{"type":"string"}}}',
      )
      expect(schemaOf('nestedBoxes')).toEqual(
        model({ v: model({ v: model({ v: model({ v: { type: 'number' } }) }) }) }),
      )
    })

    it('writes an array form of a type an array satisfies besides optional properties', () => {
      expect(schemaOf('lengthExtra')).toEqual({
        anyOf: [
          { type: 'array', items: {} },
          text,
          {
            type: 'object',
            properties: { length: { type: 'number' }, extra: text },
            required: ['length'],
          },
        ],
      })
    })
  })

  describe('round thirty-seven', () => {
    const schemaOf = (name: string) =>
      deref(
        (spec.paths as any)[`/${name}`].post.responses['200'].content['application/json'].schema,
      )
    const model = (properties: Record<string, object>) => ({
      type: 'object',
      properties,
      required: Object.keys(properties),
    })
    const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] })
    const levels = (count: number, level: (inner: object) => object, end: object = {}): object =>
      count === 0 ? end : level(levels(count - 1, level, end))

    it('cuts cycles through conditional deep mapped types over generic models', () => {
      // each level maps over the one outside it again, as a different type
      const a = model({ a: { type: 'number' } })
      const described = { description: expect.any(String) }
      expect(schemaOf('genericCycle')).toEqual({
        ...levels(4, (f0) => model({ f0: nullable(f0), f2: a })),
        ...described,
      })
      expect(schemaOf('genericSelf')).toEqual({
        ...levels(4, (self) => model({ v: { type: 'string' }, self: nullable(self) })),
        ...described,
      })
      expect(schemaOf('wrapCycle')).toEqual({
        ...levels(4, (f0) => model({ inner: a, f0: nullable(f0) })),
        ...described,
      })
      // its type arguments grow too
      expect(JSON.stringify(schemaOf('growingPair'))).toContain('"nested":{"anyOf":[{},')
    })

    it('expands a conditional deep mapped type over a generic model nested in itself in full', () => {
      expect(schemaOf('deepBoxes')).toEqual(levels(8, (v) => model({ v }), { type: 'number' }))
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
    const other = await new OpenAPIGenerator().generate(reversed as typeof router, {
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
  const generator = new OpenAPIGenerator()
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

describe('chains of deep views of classes', async () => {
  const file = new URL('../tests/fixtures/app/src/deep-view-chains.ts', import.meta.url)
  const routers = { shortDeepChain, longDeepChain, longerDeepChain, mixedDeepChain }
  const generate = async (name: keyof typeof routers) => {
    const start = performance.now()
    const spec = await new OpenAPIGenerator().generate(routers[name], {
      source: { file, export: name },
    })
    return { spec, time: performance.now() - start }
  }

  // the first generation also starts the compiler
  await generate('shortDeepChain')
  const results = {
    shortDeepChain: await generate('shortDeepChain'),
    longDeepChain: await generate('longDeepChain'),
    longerDeepChain: await generate('longerDeepChain'),
    mixedDeepChain: await generate('mixedDeepChain'),
  }
  const serializer = new OpenAPIJsonSerializer()

  it.each([
    ['shortDeepChain', 'chain'],
    ['longDeepChain', 'chain'],
    ['longerDeepChain', 'chain'],
    ['longerDeepChain', 'root'],
    ['mixedDeepChain', 'chain'],
  ] as const)('match serialized outputs (%s, %s)', async (name, procedure) => {
    const { spec } = results[name]
    const ajv = new Ajv2020({ strict: false, allErrors: true })
    const json = JSON.stringify({
      $id: 'spec',
      $defs: spec.components?.schemas ?? {},
      ...(spec.paths as any)[`/${procedure}`].post.responses['200'].content['application/json']
        .schema,
    }).replaceAll('#/components/schemas/', '#/$defs/')
    const validate = ajv.compile(JSON.parse(json))
    const output = await call((routers[name] as any)[procedure], undefined)
    const serialized = JSON.parse(JSON.stringify(serializer.serializeJson(output).json))

    expect(validate(serialized) ? [] : validate.errors).toEqual([])
  })

  it('generate in time growing linearly with the length of the chain', () => {
    expect(results.longDeepChain.time).toBeLessThan(3000)
    expect(results.longerDeepChain.time).toBeLessThan(3000)
    expect(results.mixedDeepChain.time).toBeLessThan(3000)
    // the checks of a view reuse what the views of the next classes were found to keep
    expect(results.longDeepChain.time / results.shortDeepChain.time).toBeLessThan(3)
    expect(results.longerDeepChain.time / results.longDeepChain.time).toBeLessThan(3)
  })
})

describe('rings of deep views of classes', async () => {
  const file = new URL('../tests/fixtures/app/src/deep-view-rings.ts', import.meta.url)
  const routers = { nullRing, conditionalRing }
  const generate = async (name: keyof typeof routers) => {
    const start = performance.now()
    const spec = await new OpenAPIGenerator().generate(routers[name], {
      source: { file, export: name },
    })
    return { spec, time: performance.now() - start }
  }

  // the first generation also starts the compiler
  await generate('nullRing')
  const results = {
    nullRing: await generate('nullRing'),
    conditionalRing: await generate('conditionalRing'),
  }
  const serializer = new OpenAPIJsonSerializer()

  it.each([
    ['nullRing', 'root'],
    ['conditionalRing', 'ringA'],
    ['conditionalRing', 'ringT'],
  ] as const)('match serialized outputs (%s, %s)', async (name, procedure) => {
    const { spec } = results[name]
    const ajv = new Ajv2020({ strict: false, allErrors: true })
    const json = JSON.stringify({
      $id: 'spec',
      $defs: spec.components?.schemas ?? {},
      ...(spec.paths as any)[`/${procedure}`].post.responses['200'].content['application/json']
        .schema,
    }).replaceAll('#/components/schemas/', '#/$defs/')
    const validate = ajv.compile(JSON.parse(json))
    const output = await call((routers[name] as any)[procedure], undefined)
    const serialized = JSON.parse(JSON.stringify(serializer.serializeJson(output).json))

    expect(validate(serialized) ? [] : validate.errors).toEqual([])
  })

  it('generate in time growing linearly with the size of the ring', () => {
    // each class added used to multiply the time by ten
    expect(results.nullRing.time).toBeLessThan(3000)
    expect(results.conditionalRing.time).toBeLessThan(5000)
  })

  it('write one component per deep view of a class of the ring', () => {
    const names = Object.keys(results.nullRing.spec.components?.schemas ?? {})

    // views of one class instantiated apart within the ring share their component and its name
    expect(names.filter((name) => name.startsWith('DeepNull_')).toSorted()).toEqual(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((letter) => `DeepNull_NullRing${letter}`),
    )
  })
})

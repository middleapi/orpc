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
  const spec = await new TypeScriptOpenAPIGenerator().generate(router, {
    source: { file: new URL('../tests/fixtures/app/src/serialization.ts', import.meta.url) },
  })

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
  ] as const)('%s', async (name, input) => {
    const output = await call((router as any)[name], input)
    const json = serialize(output)
    const validate = ajv.compile(responseSchema(`/${name}`))

    expect(validate(json) ? [] : validate.errors).toEqual([])
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
})

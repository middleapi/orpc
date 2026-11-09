import { OpenAPIGeneratorError, OpenAPIJsonSerializer } from '@orpc/openapi'
import { Procedure } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { Ajv2020 } from 'ajv/dist/2020.js'

import { router as brokenRouter } from '../tests/fixtures/app/src/broken'
import { contract, implemented } from '../tests/fixtures/app/src/contract'
import { router as detailedRouter } from '../tests/fixtures/app/src/detailed'
import { router as headersRouter } from '../tests/fixtures/app/src/headers'
import { decomposed, optional, records, spread } from '../tests/fixtures/app/src/round2'
import { router as round3Router } from '../tests/fixtures/app/src/round3'
import { classes, directions, jsdoc, mixed, streams } from '../tests/fixtures/app/src/round11'
import { errorData } from '../tests/fixtures/app/src/round11-broken'
import { StringRows, viewInputs } from '../tests/fixtures/app/src/round25'
import {
  callables,
  FullName,
  instanceInputs,
  LabeledStamp,
} from '../tests/fixtures/app/src/round26'
import { Getters, StampedDate, viewedInputs } from '../tests/fixtures/app/src/round27'
import { WithArrow, roundTwentyEightInputs } from '../tests/fixtures/app/src/round28'
import {
  GetterOnly,
  roundTwentyNineComponents,
  roundTwentyNineInputs,
  roundTwentyNineNamed,
  StampDate,
  TaggedDate,
  TaggedSet,
  TaggedURL,
} from '../tests/fixtures/app/src/round29'
import { roundThirtyOneInputs } from '../tests/fixtures/app/src/round31'
import { roundThirtyTwoInputs } from '../tests/fixtures/app/src/round32'
import { roundThirtyThreeInputs } from '../tests/fixtures/app/src/round33'
import { router } from '../tests/fixtures/app/src/router'
import { router as shorthandRouter } from '../tests/fixtures/app/src/shorthand'
import { router as nestedRouter } from '../tests/fixtures/nested/proj/scripts/router'
import { OpenAPIGenerator } from './openapi-generator'

const fixture = (file: string) => new URL(`../tests/fixtures/app/src/${file}`, import.meta.url)

const PLANET = {
  type: 'object',
  properties: {
    id: { type: 'number', description: 'Unique id' },
    name: { type: 'string' },
    description: { type: 'string' },
    discoveredAt: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
    moons: { type: 'array', items: { $ref: '#/components/schemas/Planet' } },
  },
  required: ['id', 'name', 'discoveredAt', 'moons'],
  description: 'A planet in the solar system',
}

describe('openAPIGenerator', () => {
  const generator = new OpenAPIGenerator({
    converters: [new ZodToJsonSchemaConverter()],
  })

  describe('router', async () => {
    const spec = await generator.generate(router, {
      source: { file: fixture('router.ts') },
      base: { info: { title: 'Planets', version: '1.0.0' } },
    })

    it('keeps base options', () => {
      expect(spec.openapi).toBe('3.2.0')
      expect(spec.info).toEqual({ title: 'Planets', version: '1.0.0' })
    })

    it('infers outputs without .output, resolving `@/` imports and named types', () => {
      expect(spec.components?.schemas?.Planet).toEqual(PLANET)
      // union members are ordered as the checker stores them
      expect(spec.components?.schemas?.PlanetKind).toEqual({
        type: 'string',
        enum: expect.toSatisfy(
          (e: string[]) => e.length === 2 && e.includes('rocky') && e.includes('gas'),
        ),
      })

      expect(spec.paths?.['/planets/{id}']?.get?.responses?.['200']).toEqual({
        description: 'OK',
        content: {
          'application/json': {
            schema: { anyOf: [{ $ref: '#/components/schemas/Planet' }, { type: 'null' }] },
          },
        },
      })
    })

    it('infers inputs of type-only schemas', () => {
      expect(spec.paths?.['/planets/{id}']?.get?.parameters).toEqual([
        { in: 'path', required: true, name: 'id', schema: { type: 'number' } },
      ])

      expect(spec.paths?.['/planets']?.post?.requestBody).toEqual({
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                discoveredAt: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
              },
              required: ['name', 'discoveredAt'],
            },
          },
        },
      })
    })

    it('prefers converters when they support the schema', () => {
      const parameters = spec.paths?.['/planets']?.get?.parameters as any[]

      expect(parameters.map((p) => [p.name, p.schema])).toEqual([
        ['limit', { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 }],
        ['kind', { type: 'string', enum: ['rocky', 'gas'] }],
      ])

      // the zod error data is converted, the type-only one inferred
      expect(spec.components?.schemas?.Forbidden).toMatchObject({
        properties: { data: { properties: { reason: { type: 'string' } } } },
      })
      expect(spec.components?.schemas?.Conflict).toMatchObject({
        properties: {
          data: {
            type: 'object',
            properties: { existingId: { type: 'number' } },
            required: ['existingId'],
          },
        },
      })
    })

    it('fills operation meta from JSDoc, keeping .route values', () => {
      const find = spec.paths?.['/planets/{id}']?.get
      expect(find?.summary).toBe('Find a planet')
      expect(find?.description).toBe('Looks a planet up by its id.')

      const list = spec.paths?.['/planets']?.get
      expect(list?.deprecated).toBe(true)
      expect(list?.tags).toEqual(['planets', 'legacy'])
      expect(list?.summary).toBeUndefined()

      const create = spec.paths?.['/planets']?.post
      expect(create?.summary).toBe('Summary from route')
      expect(Object.keys(create?.responses ?? {})).toEqual(['201', '403', '409'])

      expect(spec.paths?.['/health']?.post?.summary).toBe('Health check')
    })

    it('infers async iterator outputs of lazy routers as event streams', () => {
      const content = (spec.paths?.['/stream/ticks']?.post?.responses?.['200'] as any).content
      const [message, close] = content['text/event-stream'].schema.oneOf

      expect(message.properties.data).toEqual({
        type: 'object',
        properties: { tick: { type: 'number' } },
        required: ['tick'],
      })
      expect(close.properties.data).toEqual({ type: 'string', const: 'done' })

      const plain = (spec.paths?.['/stream/plain']?.post?.responses?.['200'] as any).content
      expect(plain['text/event-stream'].schema.oneOf[0].properties.data).toEqual({ type: 'string' })
      expect(plain['text/event-stream'].schema.oneOf[1].properties.data).toEqual({})
    })

    it('documents void outputs as empty responses', () => {
      expect(spec.paths?.['/void']?.post?.responses?.['200']).toEqual({
        description: 'OK',
        content: {},
      })
    })

    it('infers plain outputs', () => {
      expect(spec.paths?.['/health']?.post?.responses?.['200']).toEqual({
        description: 'OK',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean', const: true },
                uptime: { type: 'number' },
                at: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
              },
              required: ['ok', 'uptime', 'at'],
            },
          },
        },
      })
    })
  })

  it('resolves type exports', async () => {
    const fromValue = await generator.generate(router, { source: { file: fixture('router.ts') } })
    const fromType = await generator.generate(router, {
      source: { file: fixture('router.ts'), export: 'AppRouter' },
    })

    expect(fromType).toEqual(fromValue)
  })

  it('accepts an explicit tsconfig', async () => {
    const spec = await generator.generate(router, {
      source: { file: fixture('router.ts'), tsconfig: fixture('../tsconfig.json') },
    })

    expect(spec.components?.schemas?.Planet).toEqual(PLANET)
  })

  it.each([
    ['contract', contract, 'contract'],
    ['implemented router', implemented, 'implemented'],
  ])('supports a %s', async (_, value, exportName) => {
    const spec = await generator.generate(value, {
      source: { file: fixture('contract.ts'), export: exportName },
    })

    const todo = {
      type: 'object',
      properties: { id: { type: 'string' }, title: { type: 'string' }, done: { type: 'boolean' } },
      required: ['id', 'title', 'done'],
    }

    expect(spec.components?.schemas?.Todo).toEqual(todo)
    expect(spec.paths?.['/todo/get']?.post?.summary).toBe('Get a todo')
    expect(spec.paths?.['/todo/get']?.post?.description).toBe('Fetches one todo.')
    expect(spec.paths?.['/todo/get']?.post?.tags).toEqual(['todos'])
    expect(spec.paths?.['/todo/get']?.post?.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        },
      },
    })
    expect((spec.paths?.['/todo/get']?.post?.responses?.['200'] as any).content).toEqual({
      'application/json': { schema: { $ref: '#/components/schemas/Todo' } },
    })
    expect((spec.paths?.['/todo/list']?.post?.responses?.['200'] as any).content).toEqual({
      'application/json': {
        schema: { type: 'array', items: { $ref: '#/components/schemas/Todo' } },
      },
    })
  })

  it.each(['3.1.1', '3.0.4'] as const)('downgrades to %s', async (version) => {
    const spec = await generator.generate(router, {
      source: { file: fixture('router.ts') },
      version,
    })

    expect(spec.openapi).toBe(version)

    const schema = (spec.paths?.['/planets/{id}']?.get?.responses?.['200'] as any).content[
      'application/json'
    ].schema

    if (version === '3.0.4') {
      expect(JSON.stringify(spec)).not.toContain('"type":"null"')
      expect(JSON.stringify(spec)).not.toContain('"const"')
      expect(JSON.stringify(schema)).toContain('"nullable":true')
    } else {
      expect(schema).toEqual({
        anyOf: [{ $ref: '#/components/schemas/Planet' }, { type: 'null' }],
      })
    }
  })

  it('filters procedures with the original procedure', async () => {
    const filter = vi.fn((procedure: unknown, path: readonly string[]) => {
      expect(procedure).toBeInstanceOf(Procedure)
      return path[0] === 'health'
    })

    const spec = await generator.generate(router, {
      source: { file: fixture('router.ts') },
      filter,
    })

    expect(Object.keys(spec.paths ?? {})).toEqual(['/health'])
    expect(filter).toHaveBeenCalledTimes(7)
  })

  it('reports unresolved types per procedure', async () => {
    await expect(
      generator.generate(brokenRouter, { source: { file: fixture('broken.ts') } }),
    ).rejects.toThrow(OpenAPIGeneratorError)

    await expect(
      generator.generate(brokenRouter, { source: { file: fixture('broken.ts') } }),
    ).rejects.toThrow(
      'Failed to infer types for the OpenAPI document (1 error):\n\nProcedure at broken: Could not resolve the type "Missing"',
    )
  })

  it('reports procedures missing from the router type', async () => {
    await expect(
      generator.generate(
        { ...router, extra: router.health },
        { source: { file: fixture('router.ts') } },
      ),
    ).rejects.toThrow('Procedure at extra: its type was not found in the router type')
  })

  it('throws on a wrong source', async () => {
    await expect(
      generator.generate(router, { source: { file: fixture('router.ts'), export: 'nope' } }),
    ).rejects.toThrow('has no export named "nope"')

    await expect(
      generator.generate(router, { source: { file: fixture('missing.ts') } }),
    ).rejects.toThrow('does not exist')
  })

  it('works without converters, inferring zod schemas from their types', async () => {
    const spec = await new OpenAPIGenerator().generate(router, {
      source: { file: fixture('router.ts') },
    })

    // zod 4 implements Standard JSON Schema, so it is still converted
    expect((spec.paths?.['/planets']?.get?.parameters as any[])[0].schema.type).toBe('integer')
  })

  it('supports detailed input and output structures', async () => {
    const spec = await generator.generate(detailedRouter, {
      source: { file: fixture('detailed.ts') },
    })

    const operation = spec.paths?.['/things/{id}']?.patch

    expect(operation?.summary).toBe('Update a thing')
    expect(operation?.description).toBe('Updates a thing by id.')
    expect(operation?.parameters).toEqual([
      { in: 'path', required: true, name: 'id', schema: { type: 'string' } },
      {
        in: 'query',
        name: 'force',
        schema: { type: 'boolean' },
        allowEmptyValue: true,
        allowReserved: true,
      },
      { in: 'header', name: 'x-token', required: true, schema: { type: 'string' } },
    ])
    expect(operation?.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['name'],
          },
        },
      },
    })
    expect(operation?.responses).toEqual({
      202: {
        description: 'OK',
        headers: { 'x-request-id': { required: true, schema: { type: 'string' } } },
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { ok: { type: 'boolean' } },
              required: ['ok'],
            },
          },
        },
      },
    })
  })

  it('reads JSDoc of procedures assigned from variables', async () => {
    const spec = await generator.generate(shorthandRouter, {
      source: { file: fixture('shorthand.ts') },
    })

    const meta = (path: `/${string}`) => {
      const { summary, description } = spec.paths?.[path]?.post ?? {}
      return { summary, description }
    }

    expect(meta('/ping')).toEqual({ summary: 'Ping it', description: undefined })
    expect(meta('/pong')).toEqual({ summary: 'Pong', description: 'Answers with pong.' })
    expect(meta('/renamed')).toEqual({ summary: 'Ping it', description: undefined })
    expect(meta('/overridden')).toEqual({ summary: 'Own JSDoc wins', description: undefined })
  })

  describe('router types', () => {
    const OK = {
      'application/json': {
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      },
    }

    const outputOf = (spec: any, path: string) => spec.paths[path].post.responses['200'].content

    it('resolves routers typed with index signatures', async () => {
      const spec = await generator.generate(records, {
        source: { file: fixture('round2.ts'), export: 'records' },
      })
      expect(outputOf(spec, '/planets/a')).toEqual(OK)
    })

    it('resolves optional procedures and sub-routers', async () => {
      const spec = await generator.generate(optional, {
        source: { file: fixture('round2.ts'), export: 'optional' },
      })
      expect(outputOf(spec, '/ping')).toEqual(OK)
      expect(outputOf(spec, '/nested/a')).toEqual(OK)

      const spreadSpec = await generator.generate(
        { ...spread, debug: spread.ping },
        { source: { file: fixture('round2.ts'), export: 'spread' } },
      )
      expect(outputOf(spreadSpec, '/debug')).toEqual(OK)
    })

    it('reports types that are not procedures', async () => {
      await expect(
        generator.generate(
          { ping: optional.ping, nested: { pong: optional.ping } },
          { source: { file: fixture('round2.ts'), export: 'notProcedures' } },
        ),
      ).rejects.toThrow(
        'Failed to infer types for the OpenAPI document (2 errors):\n\nProcedure at ping: its type "string" is not a procedure or contract',
      )
    })

    it('does not leave components for split inputs and detailed outputs', async () => {
      const spec = await generator.generate(decomposed, {
        source: { file: fixture('round2.ts'), export: 'decomposed' },
      })

      expect(spec.components?.schemas).toBeUndefined()
      expect(spec.paths?.['/things']?.get?.parameters).toEqual([
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'number' },
          allowEmptyValue: true,
          allowReserved: true,
        },
        {
          in: 'query',
          name: 'search',
          required: true,
          schema: { type: 'string' },
          allowEmptyValue: true,
          allowReserved: true,
        },
      ])
      expect(Object.keys(spec.paths?.['/things']?.post?.responses ?? {})).toEqual(['201', '202'])
    })

    it('adds JSDoc tags to router-level tags', async () => {
      const spec = await generator.generate(decomposed, {
        source: { file: fixture('round2.ts'), export: 'decomposed' },
      })
      expect(spec.paths?.['/things']?.get?.tags).toEqual(['grp', 'fromdoc'])
      expect(spec.paths?.['/things']?.get?.summary).toBe('Find things')
    })

    it('finds an ancestor tsconfig.json when the nearest one does not include the file', async () => {
      const spec = await generator.generate(nestedRouter, {
        source: {
          file: new URL('../tests/fixtures/nested/proj/scripts/router.ts', import.meta.url),
        },
      })
      expect(spec.components?.schemas?.Account).toEqual({
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      })
    })
  })

  describe('detailed structures', async () => {
    const spec = await generator.generate(round3Router, {
      source: { file: fixture('round3.ts') },
    })

    it('reads statuses of named aliases and enums', () => {
      expect(Object.keys(spec.paths?.['/alias']?.post?.responses ?? {})).toEqual(['200', '201'])
      expect(Object.keys(spec.paths?.['/enum']?.post?.responses ?? {})).toEqual(['200', '201'])
      expect((spec.paths?.['/alias']?.post?.responses?.['201'] as any).headers).toEqual({
        location: { required: true, schema: { type: 'string' } },
      })
    })

    it('does not leave components for split sections', () => {
      expect(Object.keys(spec.components?.schemas ?? {})).toEqual(['Item'])
      expect(spec.paths?.['/sections/{id}']?.patch?.parameters).toEqual([
        { in: 'path', required: true, name: 'id', schema: { type: 'string' } },
        {
          in: 'query',
          name: 'limit',
          schema: { type: 'number' },
          allowEmptyValue: true,
          allowReserved: true,
        },
        { in: 'header', name: 'location', required: true, schema: { type: 'string' } },
      ])
    })

    it('reports procedures whose type can not be resolved', async () => {
      await expect(
        generator.generate(
          { missing: round3Router.sections, ok: round3Router.sections },
          { source: { file: fixture('round3-unresolved.ts'), export: 'unresolved' } },
        ),
      ).rejects.toThrow('Procedure at missing: Could not resolve its type')
    })
  })

  it('keeps the value type of template literal keys in OpenAPI 3.0', async () => {
    const spec = await generator.generate(headersRouter, {
      source: { file: fixture('headers.ts') },
      version: '3.0.4',
    })

    expect(
      (spec.paths?.['/headers']?.post?.responses?.['200'] as any).content['application/json'].schema
        .properties.headers.additionalProperties,
    ).toEqual({ type: 'string' })
  })

  describe('round eleven', () => {
    it('reads JSDoc through variables of implemented procedures and namespace members', async () => {
      const spec = await generator.generate(jsdoc, {
        source: { file: fixture('round11.ts'), export: 'jsdoc' },
      })
      const operation = (path: string) => (spec.paths as any)[path].post

      expect(operation('/users/get')).toMatchObject({
        summary: 'Get a user',
        description: 'Looks a user up by id.',
        tags: ['users'],
      })
      expect(operation('/users/list').summary).toBe('List users')

      // comments of builders and helpers are not the procedure's
      expect(operation('/getMe').summary).toBeUndefined()
      expect(operation('/getGeneric').summary).toBeUndefined()
      expect(operation('/secret').summary).toBeUndefined()

      for (const path of ['/ns', '/star', '/healthPing']) {
        expect(operation(path)).toMatchObject({
          summary: 'Ping the server',
          description: 'Returns pong.',
          tags: ['health'],
        })
      }
    })

    it('keeps converted schemas of slots that also have type-only schemas', async () => {
      const spec = await generator.generate(mixed, {
        source: { file: fixture('round11.ts'), export: 'mixed' },
      })
      const paths = spec.paths as any
      // the inferred schema leaves out the keys the converted schemas describe
      const inferred = {
        type: 'object',
        properties: { b: { type: 'number' } },
        required: ['b'],
      }

      expect(paths['/input'].post.requestBody.content['application/json'].schema).toEqual({
        allOf: [
          {
            type: 'object',
            properties: { a: { type: 'string', minLength: 3 } },
            required: ['a'],
          },
          inferred,
        ],
      })
      expect(
        paths['/output'].post.responses['200'].content['application/json'].schema.allOf,
      ).toEqual([
        expect.objectContaining({ properties: { a: { type: 'string', minLength: 3 } } }),
        inferred,
      ])

      const [message, close] =
        paths['/iterator'].post.responses['200'].content['text/event-stream'].schema.oneOf
      expect(message.properties.data.properties).toEqual({ id: { type: 'string', minLength: 2 } })
      expect(close.properties.data).toEqual({
        type: 'object',
        properties: { total: { type: 'number' } },
        required: ['total'],
      })

      // query parameters stay primitive
      const parameters = paths['/query'].get.parameters
      expect(parameters.map((p: any) => [p.name, p.schema, p.style])).toEqual([
        ['a', { type: 'string', minLength: 3 }, undefined],
        ['b', { type: 'number' }, undefined],
      ])

      // several event iterators are an intersection of iterators
      const [streamMessage] =
        paths['/iterators'].post.responses['200'].content['text/event-stream'].schema.oneOf
      expect(streamMessage.properties.data).toEqual({
        allOf: [
          expect.objectContaining({ properties: { id: { type: 'string', minLength: 2 } } }),
          { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
        ],
      })
    })

    it('keeps what type-only schemas add inside keys converted schemas describe', async () => {
      const spec = await generator.generate(mixed, {
        source: { file: fixture('round11.ts'), export: 'mixed' },
      })
      const paths = spec.paths as any
      const body = (path: string) =>
        paths[path].post.requestBody.content['application/json'].schema.allOf[1]

      expect(
        paths['/detailed/{id}'].post.parameters.map((p: any) => [p.in, p.name, p.schema]),
      ).toEqual([
        ['path', 'id', { type: 'string' }],
        ['query', 'a', { type: 'string' }],
        ['query', 'b', { type: 'number' }],
      ])
      expect(body('/nested')).toEqual({
        type: 'object',
        properties: {
          user: { type: 'object', properties: { age: { type: 'number' } }, required: ['age'] },
        },
        required: ['user'],
      })
      // refs point into different `$defs`, so the same ref text is not the same schema
      // (zod's `Tag` takes the name, so the inferred one is renamed)
      const tagSchema = (ref: string) =>
        (spec.components?.schemas as any)[ref.replace('#/components/schemas/', '')]
      expect(tagSchema(body('/sameRef').properties.tag.$ref)).toMatchObject({
        required: ['label', 'color'],
      })
      // the type requires `a`, which zod makes optional
      // (on the converted schema, which query parameters read)
      const optionalInZod =
        paths['/optionalInZod'].post.requestBody.content['application/json'].schema.allOf
      expect(optionalInZod[0]).toMatchObject({
        properties: { a: { type: 'string' } },
        required: ['a'],
      })
      expect(optionalInZod[1]).toEqual({
        type: 'object',
        properties: { b: { type: 'number' } },
        required: ['b'],
      })
      // query parameters stay primitive, also with equal enums in another order
      const parameters = (path: string) =>
        paths[path].get.parameters.map((p: any) => [p.name, p.schema, p.style])
      expect(parameters('/queryDefault')).toEqual([
        ['lim', { type: 'number', default: 10 }, undefined],
        ['extra', { type: 'string' }, undefined],
      ])
      expect(
        paths['/queryRequired'].get.parameters.map((p: any) => [p.name, p.required, p.style]),
      ).toEqual([
        ['a', true, undefined],
        ['b', true, undefined],
      ])
      for (const path of ['/queryNullableEnum', '/queryDuplicateEnum', '/queryConst']) {
        expect(parameters(path).map(([name, , style]: any) => [name, style])).toEqual([
          ['s', undefined],
          ['extra', undefined],
        ])
      }
      expect(parameters('/queryEnum')).toEqual([
        ['s', { type: 'string', enum: ['archived', 'active'] }, undefined],
        ['extra', { type: 'string' }, undefined],
      ])

      // a recursive schema keeps its levels, the inferred part requires `name` at the root only
      const recursive =
        paths['/recursive'].post.requestBody.content['application/json'].schema.allOf
      const category = (spec.components?.schemas as any)[
        recursive[0].$ref.replace('#/components/schemas/', '')
      ]
      expect(category.required).toEqual(['children'])
      expect(recursive[1].properties.extra).toEqual({ type: 'number' })
      // not named after the `Array` around the anonymous recursive item
      expect(Object.keys(spec.components?.schemas ?? {})).not.toContain('Array')
      expect(recursive[1].required).toEqual(expect.arrayContaining(['name', 'extra']))

      // refs into the converted schema's own defs are not recursion, and describe their keys
      expect(
        paths['/path-with-ref/{id}'].post.parameters.map((p: any) => [p.in, p.name, p.required]),
      ).toEqual([['path', 'id', true]])
      expect(
        paths['/queryWithRef'].get.parameters.map((p: any) => [p.name, p.required, p.style]),
      ).toEqual([
        ['a', true, undefined],
        ['s', true, undefined],
        ['b', true, undefined],
      ])

      expect(paths['/queryDescribedRef'].get.parameters.map((p: any) => [p.name, p.style])).toEqual(
        [
          ['s', undefined],
          ['b', undefined],
        ],
      )

      // constraints only the type has
      expect(body('/constraints').properties.id).toEqual({
        type: 'string',
        pattern: '^user_[\\s\\S]*$',
      })

      // `z.unknown()` says less than `Tag`
      expect(Object.keys(body('/weaker').properties)).toEqual(['tag', 'b'])
      expect(tagSchema(body('/weaker').properties.tag.$ref)).toMatchObject({
        required: ['label', 'color'],
      })
    })

    it('documents unions of event iterators as event streams', async () => {
      const spec = await generator.generate(streams, {
        source: { file: fixture('round11.ts'), export: 'streams' },
      })

      for (const path of ['/union', '/nullable']) {
        const content = (spec.paths as any)[path].post.responses['200'].content
        expect(Object.keys(content)).toEqual(['text/event-stream'])
      }

      const [message] = (spec.paths as any)['/union'].post.responses['200'].content[
        'text/event-stream'
      ].schema.oneOf
      expect(message.properties.data.anyOf).toHaveLength(2)

      // `genA` returns nothing, so the close event may have no data
      const [, close] = (spec.paths as any)['/partialReturn'].post.responses['200'].content[
        'text/event-stream'
      ].schema.oneOf
      expect(close.required).toEqual(['event'])
    })

    it('documents class inputs as the plain JSON a client sends', async () => {
      const spec = await generator.generate(classes, {
        source: { file: fixture('round11.ts'), export: 'classes' },
      })
      const operation = (spec.paths as any)['/create'].post
      const component = (schema: any) =>
        schema.$ref
          ? (spec.components?.schemas as any)[schema.$ref.replace('#/components/schemas/', '')]
          : schema

      const input = component(operation.requestBody.content['application/json'].schema)
      expect(input.properties.tags).toMatchObject({ 'type': 'array', 'x-native-type': 'set' })
      expect(input.properties.views).toMatchObject({ 'type': 'string', 'x-native-type': 'bigint' })

      // the server sends an instance, which `JSON.stringify` writes
      const output = component(operation.responses['200'].content['application/json'].schema)
      expect(output.properties.tags).toEqual({ type: 'object' })
    })

    it('names a model the same in both directions, and ignores toJSON in inputs', async () => {
      const spec = await generator.generate(directions, {
        source: { file: fixture('round11.ts'), export: 'directions' },
      })
      const paths = spec.paths as any
      const two = paths['/two'].post

      // one component for the second `Item`, used by the request and the response
      const names = Object.keys(spec.components?.schemas ?? {})
      expect(names).toEqual(expect.arrayContaining(['Item', 'Item2']))
      expect(names).not.toContain('ItemInput')
      expect(two.requestBody.content['application/json'].schema).toEqual(
        two.responses['200'].content['application/json'].schema,
      )

      const secret = (spec.components?.schemas as any).HoldsSecret
      expect(secret.required).toEqual(['secret', 'list'])
      expect(secret.properties.list.items).toEqual({ $ref: '#/components/schemas/SecretJSON' })
    })

    it('reports unresolved types when only error data needs inference', async () => {
      await expect(
        generator.generate({ proc: errorData }, { source: { file: fixture('round11-broken.ts') } }),
      ).rejects.toThrow('Procedure at proc: Could not resolve its type "Missing"')
    })
  })

  describe('round twenty-five', () => {
    it('documents inputs of views of built-ins as the built-in or a plain object', async () => {
      const spec = await generator.generate(viewInputs, {
        source: { file: fixture('round25.ts'), export: 'viewInputs' },
      })
      const body = (path: string) =>
        (spec.paths as any)[path].post.requestBody.content['application/json'].schema
      const uri = { 'type': 'string', 'format': 'uri', 'x-native-type': 'url' }
      const href = expect.objectContaining({ type: 'string' })

      expect(body('/partialDate')).toEqual({
        anyOf: [
          { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
          { type: 'object' },
        ],
      })
      expect(body('/pickedURL')).toEqual({
        anyOf: [uri, { type: 'object', properties: { href }, required: ['href'] }],
      })
      expect(body('/pickedURLWithX')).toEqual({
        anyOf: [
          uri,
          { type: 'object', properties: { href, x: { type: 'number' } }, required: ['href', 'x'] },
        ],
      })
      // a client sends an instance of the array subclass as an array, a plain object by its fields
      expect(body('/partialRowsWithX')).toEqual({
        anyOf: [
          { type: 'array', items: { type: 'string' } },
          expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({
              label: { type: 'string' },
              x: { type: 'string' },
            }),
            required: ['x'],
          }),
        ],
      })

      // what a client holding these values sends
      const serializer = new OpenAPIJsonSerializer()
      const ajv = new Ajv2020({ strict: false, allErrors: true })
      for (const [path, value] of [
        ['/partialDate', new Date(0)],
        ['/partialDate', {}],
        ['/pickedURL', new URL('http://x/')],
        ['/pickedURL', { href: 'http://x/' }],
        ['/pickedURLWithX', Object.assign(new URL('http://x/'), { x: 1 })],
        ['/pickedURLWithX', { href: 'h', x: 1 }],
        ['/partialRowsWithX', { label: 'a', x: 'x' }],
        ['/partialRowsWithX', Object.assign(new StringRows(), { x: 'x' })],
      ] as const) {
        const validate = ajv.compile(body(path))
        const json = JSON.parse(JSON.stringify(serializer.serializeJson(value).json))
        expect(validate(json) ? [] : validate.errors).toEqual([])
      }
    })
  })

  describe('round twenty-six', () => {
    it('documents functions at the root as no body, also in a union', async () => {
      const spec = await generator.generate(callables, {
        source: { file: fixture('round26.ts'), export: 'callables' },
      })
      const response = (path: string) => (spec.paths as any)[path].post.responses['200']

      // like a plain function or `undefined`
      expect(response('/tagged')).toEqual({ description: 'OK', content: {} })
      expect(response('/callable')).toEqual({ description: 'OK', content: {} })
      expect(response('/taggedOrNumber').content['application/json'].schema).toEqual({
        type: 'number',
      })
      expect(spec.components?.schemas ?? {}).toEqual({})
    })

    it('documents inputs a client may send as an instance or a plain object', async () => {
      const spec = await generator.generate(instanceInputs, {
        source: { file: fixture('round26.ts'), export: 'instanceInputs' },
      })
      const body = (path: string) =>
        JSON.parse(
          JSON.stringify(
            (spec.paths as any)[path].post.requestBody.content['application/json'].schema,
          ).replaceAll('#/components/schemas/', 'spec#/$defs/'),
        )

      // the getter is optional, as in the class itself an instance does not write it
      expect(body('/frozenFullName')).toEqual({
        type: 'object',
        properties: { name: { type: 'string' }, full: { type: 'string' } },
        required: ['name'],
      })
      expect(body('/pickedStamp')).toEqual({
        anyOf: [
          { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
          { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
        ],
      })
      expect((spec.components?.schemas as any).LabeledLink.anyOf[0]).toEqual({
        'type': 'string',
        'format': 'uri',
        'x-native-type': 'url',
      })
      expect((spec.components?.schemas as any).MaybeCodedError.required).toBeUndefined()
      expect(body('/branded')).toEqual({
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      })

      // what a client holding these values sends
      const serializer = new OpenAPIJsonSerializer()
      const ajv = new Ajv2020({ strict: false, allErrors: true })
      ajv.addSchema(
        JSON.parse(
          JSON.stringify({ $id: 'spec', $defs: spec.components?.schemas ?? {} }).replaceAll(
            '#/components/schemas/',
            'spec#/$defs/',
          ),
        ),
      )
      for (const [path, value] of [
        ['/frozenFullName', new FullName()],
        ['/frozenFullName', { name: 'n', full: 'f' }],
        ['/fullName', new FullName()],
        ['/pickedStamp', new LabeledStamp(0)],
        ['/pickedStamp', { label: 'l' }],
        ['/link', new URL('http://x/')],
        ['/link', { href: 'h', label: 'l' }],
        ['/error', new Error('boom')],
        ['/error', { code: 1, message: 'm' }],
        ['/branded', { id: 'abc' }],
      ] as const) {
        const validate = ajv.compile(body(path))
        const json = JSON.parse(JSON.stringify(serializer.serializeJson(value).json))
        expect(validate(json) ? [] : validate.errors).toEqual([])
      }
    })
  })

  describe('round twenty-seven', () => {
    it('documents inputs of views, deep views, and redeclared built-in members', async () => {
      const spec = await generator.generate(viewedInputs, {
        source: { file: fixture('round27.ts'), export: 'viewedInputs' },
      })
      const schemas = spec.components?.schemas as any
      const body = (path: string) =>
        JSON.parse(
          JSON.stringify(
            (spec.paths as any)[path].post.requestBody.content['application/json'].schema,
          ).replaceAll('#/components/schemas/', 'spec#/$defs/'),
        )
      const dateTime = { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' }
      const stamped = {
        anyOf: [
          dateTime,
          {
            type: 'object',
            properties: { id: { type: 'number' }, label: { type: 'string' } },
            required: ['id', 'label'],
          },
        ],
      }

      // the built-in of each class behind it, whatever their order
      expect(schemas.IdStamp).toEqual(stamped)
      expect(schemas.StampId).toEqual(stamped)
      expect(schemas.InterStamp).toEqual(stamped)
      // a getter is optional in a deep view too
      expect(schemas.DeepRO_Getters.required).toBeUndefined()
      // redeclared members of a built-in are not written by an instance
      expect(schemas.MsgError.required).toBeUndefined()
      expect(schemas.ViaMsgError.required).toEqual(['code'])
      expect(schemas.SizedParams.required).toBeUndefined()
      expect(schemas.DeepRO_RegExp).toEqual({ description: 'Read-only all the way down' })
      expect(body('/partialSized').anyOf[0]).toEqual(
        expect.objectContaining({ 'type': 'array', 'x-native-type': 'set' }),
      )
      expect(body('/readonlyLink').anyOf[0]).toEqual({
        'type': 'string',
        'format': 'uri',
        'x-native-type': 'url',
      })
      expect(body('/partialStr').anyOf[1]).toEqual(
        expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({ a: { type: 'number' } }),
        }),
      )

      // what a client holding these values sends
      const serializer = new OpenAPIJsonSerializer()
      const ajv = new Ajv2020({ strict: false, allErrors: true })
      ajv.addSchema(
        JSON.parse(
          JSON.stringify({ $id: 'spec', $defs: schemas ?? {} }).replaceAll(
            '#/components/schemas/',
            'spec#/$defs/',
          ),
        ),
      )
      for (const [path, value] of [
        ['/idStamp', Object.assign(new StampedDate(0), { id: 1 })],
        ['/idStamp', { id: 1, label: 'l' }],
        ['/interStamp', Object.assign(new StampedDate(0), { id: 1 })],
        ['/stampId', Object.assign(new StampedDate(0), { id: 1 })],
        ['/deepGetters', new Getters()],
        ['/msg', new Error('m')],
        ['/msg', { message: 'm' }],
        ['/via', { e: Object.assign(new Error('m'), { code: 'c' }) }],
        ['/params', { p: new URLSearchParams('a=1') }],
        ['/deepRe', { r: /a/u }],
        ['/dateOrSized', new Set(['a'])],
        ['/dateOrSized', new Date(0)],
        ['/readonlyLink', new URL('http://x/')],
        ['/readonlyLink', { href: 'h', label: 'l' }],
        ['/pickedLink', new URL('http://x/')],
        ['/partialSized', new Set(['a'])],
        ['/partialSized', {}],
        ['/partialStr', {}],
        ['/partialStr', 'abc'],
        ['/bufView', { buffer: new ArrayBuffer(1), label: 'l' }],
        ['/bufView', Object.assign(new Uint8Array([1]), { label: 'l' })],
      ] as const) {
        const validate = ajv.compile(body(path))
        const json = JSON.parse(JSON.stringify(serializer.serializeJson(value).json))
        expect(validate(json) ? [] : [path, validate.errors]).toEqual([])
      }
    })
  })

  describe('round twenty-eight', () => {
    it('documents inputs of intersections, conditional deep views, and views of functions', async () => {
      const spec = await generator.generate(roundTwentyEightInputs, {
        source: { file: fixture('round28.ts'), export: 'roundTwentyEightInputs' },
      })
      const schemas = spec.components?.schemas as any
      const body = (path: string) =>
        JSON.parse(
          JSON.stringify(
            (spec.paths as any)[path].post.requestBody.content['application/json'].schema,
          ).replaceAll('#/components/schemas/', 'spec#/$defs/'),
        )

      // members inherited from `Error` are not written by an instance
      expect(schemas.CodedFailureExtra.required).toEqual(['code', 'extra'])
      expect(body('/brandedConditional').properties.id).toEqual({ type: 'string' })
      expect(body('/simplified').properties.n).toEqual({ type: 'number' })
      expect(body('/conditionalDate').properties.at).toMatchObject({
        type: 'string',
        format: 'date-time',
      })
      // a client drops the function a view of it holds
      for (const path of ['/frozenCallback', '/conditionalCallback', '/conditionalCallbackField']) {
        expect(body(path).required).toEqual(['n'])
      }
      expect(schemas.DeepRO_WithCallback.required).toEqual(['n'])
      expect(body('/conditionalArrow').required).toEqual(['n'])

      // what a client holding these values sends
      const serializer = new OpenAPIJsonSerializer()
      const ajv = new Ajv2020({ strict: false, allErrors: true })
      ajv.addSchema(
        JSON.parse(
          JSON.stringify({ $id: 'spec', $defs: schemas ?? {} }).replaceAll(
            '#/components/schemas/',
            'spec#/$defs/',
          ),
        ),
      )
      for (const [path, value] of [
        ['/errorIntersection', { e: Object.assign(new Error('m'), { code: 1, extra: 1 }) }],
        ['/brandedConditional', { id: 'x' }],
        ['/simplified', { n: 1 }],
        ['/conditionalDate', { at: new Date(0) }],
        ['/frozenCallback', { cb: () => {}, n: 1 }],
        ['/deepCallback', { cb: () => {}, n: 1 }],
        ['/conditionalCallback', { cb: () => {}, n: 1 }],
        ['/conditionalCallbackField', { cb: () => {}, n: 1 }],
        ['/conditionalArrow', new WithArrow()],
      ] as const) {
        const validate = ajv.compile(body(path))
        const json = JSON.parse(JSON.stringify(serializer.serializeJson(value).json))
        expect(validate(json) ? [] : [path, validate.errors]).toEqual([])
      }
    })
  })

  describe('round twenty-nine', () => {
    const second: any = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    }
    const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
    const responseOf = (spec: any, path: string) =>
      spec.paths[path].post.responses['200'].content['application/json'].schema
    const legacy = (schema: unknown): any => ({
      get: {
        responses: { 200: { description: 'OK', content: { 'application/json': { schema } } } },
      },
    })

    it('documents inputs of widened views, mixins applied to built-ins, and URLSearchParams', async () => {
      const spec = await generator.generate(roundTwentyNineInputs, {
        source: { file: fixture('round29.ts'), export: 'roundTwentyNineInputs' },
      })
      const schemas = spec.components?.schemas as any
      const body = (path: string) =>
        JSON.parse(
          JSON.stringify(
            (spec.paths as any)[path].post.requestBody.content['application/json'].schema,
          ).replaceAll('#/components/schemas/', 'spec#/$defs/'),
        )
      const date = { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' }

      expect(body('/orString').properties.id).toEqual({
        type: 'string',
        description: 'Values, or strings',
      })
      expect(body('/mixinDate').properties.d).toEqual(date)
      expect(body('/mixinURL').properties.u).toEqual({
        'type': 'string',
        'format': 'uri',
        'x-native-type': 'url',
      })
      expect(schemas.TaggedSet).toEqual({
        'type': 'array',
        'uniqueItems': true,
        'items': { type: 'number' },
        'x-native-type': 'set',
      })
      expect(body('/pickedMixinDate').properties.d.anyOf[0]).toEqual(date)
      // an instance does not write the `size` a `URLSearchParams` has on its prototype
      expect(body('/params').properties.p.type).toBe('object')
      expect(body('/params').properties.p.required).toBeUndefined()
      expect(schemas.OrList_GetterOnly.required).toEqual(['n'])

      // what a client holding these values sends
      const serializer = new OpenAPIJsonSerializer()
      const ajv = new Ajv2020({ strict: false, allErrors: true })
      ajv.addSchema(
        JSON.parse(
          JSON.stringify({ $id: 'spec', $defs: schemas ?? {} }).replaceAll(
            '#/components/schemas/',
            'spec#/$defs/',
          ),
        ),
      )
      for (const [path, value] of [
        ['/orString', { id: 'x' }],
        ['/orListStamp', { at: new StampDate(0) }],
        ['/orListGetter', new GetterOnly()],
        ['/mixinDate', { d: new TaggedDate(0) }],
        ['/mixinURL', { u: new TaggedURL('http://x/') }],
        ['/mixinSet', { s: new TaggedSet([1]) }],
        ['/pickedMixinDate', { d: new TaggedDate(0) }],
        ['/params', { p: new URLSearchParams('a=1') }],
      ] as const) {
        const validate = ajv.compile(body(path))
        const json = JSON.parse(JSON.stringify(serializer.serializeJson(value).json))
        expect(validate(json) ? [] : [path, validate.errors]).toEqual([])
      }
    })

    it('names the numbered component of a type after it, once its name is free', async () => {
      const spec = await generator.generate(roundTwentyNineComponents, {
        source: { file: fixture('round29.ts'), export: 'roundTwentyNineComponents' },
      })

      expect(spec.components?.schemas).toEqual({ Item: second })
      expect(responseOf(spec, '/second').properties.i).toEqual(ref('Item'))
    })

    it('keeps the components of base and the references to them', async () => {
      const user: any = { type: 'string', description: 'user-defined' }
      const spec: any = await generator.generate(roundTwentyNineComponents, {
        source: { file: fixture('round29.ts'), export: 'roundTwentyNineComponents' },
        base: {
          paths: { '/legacy': legacy(ref('Item2')) },
          components: { schemas: { Item2: user } },
        },
      })

      expect(spec.components.schemas.Item2).toEqual(user)
      expect(spec.components.schemas.Item).toBeUndefined()
      expect(spec.paths['/legacy'].get.responses['200'].content['application/json'].schema).toEqual(
        ref('Item2'),
      )
      expect(
        spec.components.schemas[responseOf(spec, '/second').properties.i.$ref.split('/').at(-1)],
      ).toEqual(second)

      // a component of base equal to a generated one is shared, under its own name
      const shared: any = await generator.generate(roundTwentyNineComponents, {
        source: { file: fixture('round29.ts'), export: 'roundTwentyNineComponents' },
        base: {
          paths: { '/legacy': legacy(ref('Item2')) },
          components: { schemas: { Item2: second } },
        },
      })

      expect(shared.components.schemas).toEqual({ Item2: second })
      expect(responseOf(shared, '/second').properties.i).toEqual(ref('Item2'))
      expect(
        shared.paths['/legacy'].get.responses['200'].content['application/json'].schema,
      ).toEqual(ref('Item2'))
    })

    it('keeps the names componentName chooses', async () => {
      const componentName = vi.fn((name: string) => (name === 'Item' ? 'FirstItem' : name))
      const spec = await generator.generate(roundTwentyNineNamed, {
        source: { file: fixture('round29.ts'), export: 'roundTwentyNineNamed' },
        componentName,
      })

      expect(componentName.mock.calls.map(([name]) => name).toSorted()).toEqual(['Item', 'Item2'])
      expect(Object.keys(spec.components?.schemas ?? {}).toSorted()).toEqual(['FirstItem', 'Item2'])
      expect(responseOf(spec, '/second').properties.i).toEqual(ref('Item2'))
    })
  })

  describe('round thirty-one', () => {
    it('documents inputs of array-like views, views of primitives, and object', async () => {
      const spec = await generator.generate(roundThirtyOneInputs, {
        source: { file: fixture('round31.ts'), export: 'roundThirtyOneInputs' },
      })
      const schemas = spec.components?.schemas as any
      const body = (path: string) =>
        JSON.parse(
          JSON.stringify(
            (spec.paths as any)[path].post.requestBody.content['application/json'].schema,
          ).replaceAll('#/components/schemas/', 'spec#/$defs/'),
        )

      expect(body('/pickedTuple')).toEqual({
        anyOf: [
          { type: 'array', prefixItems: [{ type: 'number' }, {}], minItems: 2, maxItems: 2 },
          { type: 'object', properties: { 0: { type: 'number' } }, required: ['0'] },
        ],
      })
      expect(body('/omittedString').anyOf[0]).toEqual({ type: 'string' })
      expect(body('/brandedView')).toEqual({ type: 'string' })
      expect(body('/objectField')).toEqual({ type: 'object', properties: { v: {} } })
      expect(schemas.OrString.anyOf[0]).toEqual({ type: 'array', items: { type: 'string' } })

      // what a client holding these values sends
      const ajv = new Ajv2020({ strict: false, allErrors: true })
      ajv.addSchema(
        JSON.parse(
          JSON.stringify({ $id: 'spec', $defs: schemas ?? {} }).replaceAll(
            '#/components/schemas/',
            'spec#/$defs/',
          ),
        ),
      )
      for (const [path, value] of [
        ['/partialPair', {}],
        ['/partialPair', { extra: 'x' }],
        ['/partialPair', [1, 'a']],
        ['/widenedArray', ['a']],
        ['/pickedTuple', [1, 'a']],
        ['/pickedTuple', { 0: 1 }],
        ['/omittedString', 'abc'],
        ['/brandedView', 'abc'],
        ['/objectField', {}],
      ] as const) {
        const validate = ajv.compile(body(path))
        expect(validate(value) ? [] : [path, validate.errors]).toEqual([])
      }
    })
  })
  describe('round thirty-two', () => {
    it('documents inputs of views of primitives a plain object satisfies', async () => {
      const spec = await generator.generate(roundThirtyTwoInputs, {
        source: { file: fixture('round32.ts'), export: 'roundThirtyTwoInputs' },
      })
      const schemas = spec.components?.schemas as any
      const body = (path: string) =>
        JSON.parse(
          JSON.stringify(
            (spec.paths as any)[path].post.requestBody.content['application/json'].schema,
          ).replaceAll('#/components/schemas/', 'spec#/$defs/'),
        )

      expect(schemas.PlainBoolean.anyOf).toEqual([{ type: 'boolean' }, { type: 'object' }])

      // what a client holding these values sends
      const ajv = new Ajv2020({ strict: false, allErrors: true })
      ajv.addSchema(
        JSON.parse(
          JSON.stringify({ $id: 'spec', $defs: schemas ?? {} }).replaceAll(
            '#/components/schemas/',
            'spec#/$defs/',
          ),
        ),
      )
      for (const [path, value] of [
        ['/plainBoolean', { v: {} }],
        ['/plainBoolean', { v: true }],
        ['/plainBooleanRoot', {}],
        ['/plainBooleanRoot', false],
      ] as const) {
        const validate = ajv.compile(body(path))
        expect(validate(value) ? [] : [path, validate.errors]).toEqual([])
      }
    })
  })
  describe('round thirty-three', () => {
    it('documents inputs of views of branded primitives a plain object satisfies', async () => {
      const spec = await generator.generate(roundThirtyThreeInputs, {
        source: { file: fixture('round33.ts'), export: 'roundThirtyThreeInputs' },
      })
      const schemas = spec.components?.schemas as any
      const body = (path: string) =>
        JSON.parse(
          JSON.stringify(
            (spec.paths as any)[path].post.requestBody.content['application/json'].schema,
          ).replaceAll('#/components/schemas/', 'spec#/$defs/'),
        )

      expect(body('/omittedBrand').properties.v.anyOf[0]).toEqual({ type: 'string' })
      expect(body('/partialBrand').properties.v.anyOf[0]).toEqual({ type: 'string' })
      expect(body('/keylessClass')).toEqual({ type: 'object', properties: { v: {} } })

      // what a client holding these values sends
      const ajv = new Ajv2020({ strict: false, allErrors: true })
      ajv.addSchema(
        JSON.parse(
          JSON.stringify({ $id: 'spec', $defs: schemas ?? {} }).replaceAll(
            '#/components/schemas/',
            'spec#/$defs/',
          ),
        ),
      )
      for (const [path, value] of [
        ['/omittedBrand', { v: 'abc' }],
        ['/omittedBrand', { v: { length: 1 } }],
        ['/partialBrand', { v: 'abc' }],
        ['/partialBrand', { v: {} }],
        ['/keylessClass', {}],
        ['/keylessClass', { v: 'str' }],
      ] as const) {
        const validate = ajv.compile(body(path))
        expect(validate(value) ? [] : [path, validate.errors]).toEqual([])
      }
    })
  })
})

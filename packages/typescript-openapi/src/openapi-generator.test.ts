import { OpenAPIGeneratorError } from '@orpc/openapi'
import { Procedure } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'

import { router as brokenRouter } from '../tests/fixtures/app/src/broken.ts'
import { contract, implemented } from '../tests/fixtures/app/src/contract.ts'
import { router as detailedRouter } from '../tests/fixtures/app/src/detailed.ts'
import { router as headersRouter } from '../tests/fixtures/app/src/headers.ts'
import { decomposed, optional, records, spread } from '../tests/fixtures/app/src/round2.ts'
import { router as round3Router } from '../tests/fixtures/app/src/round3.ts'
import { errorData } from '../tests/fixtures/app/src/round11-broken.ts'
import { jsdoc, mixed, streams } from '../tests/fixtures/app/src/round11.ts'
import { router } from '../tests/fixtures/app/src/router.ts'
import { router as shorthandRouter } from '../tests/fixtures/app/src/shorthand.ts'
import { router as nestedRouter } from '../tests/fixtures/nested/proj/scripts/router.ts'
import { TypeScriptOpenAPIGenerator } from './openapi-generator.ts'

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

describe('typeScriptOpenAPIGenerator', () => {
  const generator = new TypeScriptOpenAPIGenerator({
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
    const spec = await new TypeScriptOpenAPIGenerator().generate(router, {
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

    it('reports unresolved types when only error data needs inference', async () => {
      await expect(
        generator.generate({ proc: errorData }, { source: { file: fixture('round11-broken.ts') } }),
      ).rejects.toThrow('Procedure at proc: Could not resolve its type "Missing"')
    })
  })
})

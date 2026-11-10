import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  OpenAPIGenerator as BaseOpenAPIGenerator,
  openapi,
  OpenAPIGeneratorError,
  OpenAPIJsonSerializer,
} from '@orpc/openapi'
import { OpenAPIHandler, OpenAPILink } from '@orpc/openapi/fetch'
import { call, os, Procedure } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { Program } from 'typescript/unstable/sync'

import { canGenerateWithin, generateWithin } from '../tests/bounded-generate'
import { router as brokenRouter } from '../tests/fixtures/app/src/broken'
import {
  classInputs,
  Guarded,
  Labels,
  Link,
  Lookup,
  Money,
  Order,
  Person,
  Sealed,
  Stamp,
  Tagged,
} from '../tests/fixtures/app/src/class-inputs'
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
import {
  roundThirtyFourInner,
  roundThirtyFourJSDoc,
  roundThirtyFourOuter,
} from '../tests/fixtures/app/src/round34'
import { roundThirtyFiveInputs } from '../tests/fixtures/app/src/round35'
import { roundThirtySixInputs } from '../tests/fixtures/app/src/round36'
import { roundThirtySevenInputs } from '../tests/fixtures/app/src/round37'
import { roundThirtyEightJSDoc } from '../tests/fixtures/app/src/round38'
import { roundThirtyNine, roundThirtyNineInputs } from '../tests/fixtures/app/src/round39'
import { roundFortyFour } from '../tests/fixtures/app/src/round44'
import {
  FunctionHolder,
  jsonFn,
  JsonFnForms,
  JsonFnHolder,
  MaybeStampHolder,
  roundFortySixInputs,
  StampHolder,
} from '../tests/fixtures/app/src/round46'
import {
  JsonPointImpl,
  labelledBytes,
  labelledError,
  roundFortyEightInputs,
} from '../tests/fixtures/app/src/round48'
import { DateViewHolder, roundFiftyInputs, UndefPointImpl } from '../tests/fixtures/app/src/round50'
import { router } from '../tests/fixtures/app/src/router'
import streamRouter from '../tests/fixtures/app/src/routers/stream'
import { router as shorthandRouter } from '../tests/fixtures/app/src/shorthand'
import { router as nestedRouter } from '../tests/fixtures/nested/proj/scripts/router'
import { router as outsideRouter } from '../tests/fixtures/solution-outside/router'
import { router as solutionRouter } from '../tests/fixtures/solution/app/router'
import { OpenAPIGenerator } from './openapi-generator'

// the documents of the `app` fixture are generated from one compiler, started once
const projects = vi.hoisted(() => ({ close: () => {} }))
vi.mock('./project', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./project')>()
  const { shareProjects } = await import('../tests/shared-project')
  const shared = shareProjects(
    actual.openTypeScriptProject,
    new URL('../tests/fixtures/app/src/', import.meta.url),
  )
  projects.close = shared.close
  return { ...actual, openTypeScriptProject: shared.open }
})
afterAll(() => projects.close())

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

  it('documents an operation given whole by a spec object without its types', async () => {
    const spec = { operationId: 'upload', responses: { 200: { description: 'Uploaded' } } }
    const withSpec = {
      ok: brokenRouter.ok,
      broken: brokenRouter.broken.meta(openapi({ spec })),
      extra: brokenRouter.ok.meta(openapi({ spec: { ...spec, operationId: 'extra' } })),
    }

    const document = await generator.generate(withSpec, { source: { file: fixture('broken.ts') } })
    const stock = await new BaseOpenAPIGenerator().generate(withSpec)

    expect(document.paths?.['/broken']).toEqual(stock.paths?.['/broken'])
    expect(document.paths?.['/extra']).toEqual(stock.paths?.['/extra'])
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

  it('lists the exports of the file when the export is missing', async () => {
    await expect(
      generator.generate(streamRouter, { source: { file: fixture('routers/stream.ts') } }),
    ).rejects.toThrow(
      `has no export named "router". Available exports: default. Use export: 'default' for the default export.`,
    )
    await expect(
      generator.generate(router, { source: { file: fixture('router.ts'), export: 'nope' } }),
    ).rejects.toThrow('Available exports: router, AppRouter.')
  })

  it('names missing files, missing tsconfigs, and directories', async () => {
    const src = fileURLToPath(fixture(''))

    await expect(generator.generate(router, { source: { file: src } })).rejects.toThrow(
      `File "${path.resolve(src)}" is a directory, expected a source file.`,
    )
    await expect(
      generator.generate(router, {
        source: { file: fixture('router.ts'), tsconfig: fixture('../nope.json') },
      }),
    ).rejects.toThrow(`tsconfig "${fileURLToPath(fixture('../nope.json'))}" does not exist.`)

    // a directory stands for its tsconfig.json
    const spec = await generator.generate(router, {
      source: { file: fixture('router.ts'), tsconfig: fixture('..') },
    })
    expect(spec.components?.schemas?.Planet).toEqual(PLANET)
  })

  it('accepts a solution tsconfig, using the referenced project that includes the file', async () => {
    const solution = new URL('../tests/fixtures/solution/tsconfig.json', import.meta.url)
    const spec = await generator.generate(solutionRouter, {
      source: {
        file: new URL('../tests/fixtures/solution/app/router.ts', import.meta.url),
        tsconfig: solution,
      },
    })
    expect((spec.paths?.['/ping']?.post?.responses?.['200'] as any).content).toEqual({
      'application/json': {
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      },
    })

    // a file outside the solution is not part of it
    await expect(
      generator.generate(router, { source: { file: fixture('router.ts'), tsconfig: solution } }),
    ).rejects.toThrow('Pass the tsconfig that includes it, or leave out "tsconfig"')

    // nor is a file of a project under the solution's directory that it does not reference
    await expect(
      generator.generate(solutionRouter, {
        source: {
          file: new URL('../tests/fixtures/solution/unreferenced/router.ts', import.meta.url),
          tsconfig: solution,
        },
      }),
    ).rejects.toThrow(`is not part of the project "${fileURLToPath(solution)}"`)

    // a referenced project outside the solution's directory is part of it
    const outside = await generator.generate(outsideRouter, {
      source: {
        file: new URL('../tests/fixtures/solution-outside/router.ts', import.meta.url),
        tsconfig: solution,
      },
    })
    expect((outside.paths?.['/pong']?.post?.responses?.['200'] as any).content).toEqual({
      'application/json': {
        schema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
      },
    })
  })

  it.each([
    ['a file URL string', () => fixture('routers/stream.ts').href],
    [
      'a path relative to the current working directory',
      () => path.relative(process.cwd(), fileURLToPath(fixture('routers/stream.ts'))),
    ],
  ])('reads the default export from %s', async (_, file) => {
    const fromURL = await generator.generate(streamRouter, {
      source: { file: fixture('routers/stream.ts'), export: 'default' },
    })
    expect(Object.keys(fromURL.paths ?? {})).toEqual(['/ticks', '/plain'])

    const spec = await generator.generate(streamRouter, {
      source: { file: file(), export: 'default' },
    })
    expect(spec).toEqual(fromURL)
  })

  it('reports an export that is not a router once', async () => {
    const procedure = router.health
    const value = { a: procedure, b: procedure, c: { d: procedure } }
    const file = fixture('round34.ts')

    for (const [exportName, typeName] of [
      ['notARouter', '1'],
      ['NotARouterShape', 'NotARouterShape'],
      ['notARouterFunction', '() => number'],
    ]) {
      await expect(
        generator.generate(value, { source: { file, export: exportName } }),
      ).rejects.toThrow(
        `[OpenAPIGenerator] The export "${exportName}" of "${fileURLToPath(file)}" has type "${typeName}", which is not a router, procedure or contract.`,
      )
    }
  })

  it('reports the unmatched paths when "source" names another level of the router', async () => {
    const file = fixture('round34.ts')
    const hint = 'its type was not found in the router type'

    const outer = generator.generate(roundThirtyFourOuter, {
      source: { file, export: 'roundThirtyFourInner' },
    })
    await expect(outer).rejects.toThrow(`Procedure at inner.list: ${hint}`)
    await expect(outer).rejects.toThrow(`Procedure at inner.find: ${hint}`)
    await expect(outer).rejects.not.toThrow('which is not a router')

    const inner = generator.generate(roundThirtyFourInner, {
      source: { file, export: 'roundThirtyFourOuter' },
    })
    await expect(inner).rejects.toThrow(`Procedure at list: ${hint}`)
    await expect(inner).rejects.toThrow(`Procedure at find: ${hint}`)
    await expect(inner).rejects.not.toThrow('which is not a router')

    const wrapped = generator.generate(roundThirtyFourInner, {
      source: { file, export: 'roundThirtyFourWrapped' },
    })
    await expect(wrapped).rejects.toThrow(`Procedure at list: ${hint}`)
    await expect(wrapped).rejects.not.toThrow('which is not a router')
  })

  it('reports the unmatched paths of routers that are no plain objects', async () => {
    const file = fixture('round34.ts')
    const other = { zzz: os.handler(() => 1) }

    for (const exportName of [
      'assignedRouter',
      'nestedAssigned',
      'intersectedRouter',
      'heldRouter',
      'heldService',
      'callableRouter',
    ]) {
      const generated = generator.generate(other, { source: { file, export: exportName } })
      await expect(generated).rejects.toThrow(
        'Procedure at zzz: its type was not found in the router type',
      )
      await expect(generated).rejects.not.toThrow('which is not a router')
    }

    const assigned = await generator.generate(
      Object.assign(
        {},
        { users: { list: os.handler(() => [1]) } },
        { posts: { list: os.handler(() => ['p']) } },
      ),
      { source: { file, export: 'assignedRouter' } },
    )
    expect(Object.keys(assigned.paths ?? {})).toEqual(['/users/list', '/posts/list'])
  })

  it('tells fast that an export whose type expands generically is no router', async () => {
    const file = fixture('round34.ts')

    for (const [exportName, typeName] of [
      ['grow', 'Grow<number>'],
      ['chain', 'Chain<number>'],
      ['cursor', 'Cursor<string>'],
    ]) {
      const start = performance.now()
      await expect(
        generator.generate(roundThirtyFourInner, { source: { file, export: exportName } }),
      ).rejects.toThrow(
        `[OpenAPIGenerator] The export "${exportName}" of "${fileURLToPath(file)}" has type "${typeName}", which is not a router, procedure or contract.`,
      )
      expect(performance.now() - start).toBeLessThan(1000)
    }

    // a library class instance with a large type graph
    const start = performance.now()
    await expect(
      generator.generate(roundThirtyFourInner, { source: { file, export: 'userSchema' } }),
    ).rejects.toThrow(/The export "userSchema" .* has type "ZodObject<.*which is not a router/su)
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it('keeps the first line of the comment for an empty @summary or @description', async () => {
    const spec = await generator.generate(roundThirtyFourJSDoc, {
      source: { file: fixture('round34.ts'), export: 'roundThirtyFourJSDoc' },
    })
    const meta = (path: string) => {
      const { summary, description } = (spec.paths as any)[path].post
      return { summary, description }
    }

    expect(meta('/emptySummary')).toEqual({ summary: 'Get it', description: undefined })
    expect(meta('/emptyDescription')).toEqual({
      summary: 'Describe it',
      description: 'From the comment.',
    })
  })

  it('takes the success description from @returns, keeping one set by the openapi metadata', async () => {
    const spec = await generator.generate(roundThirtyEightJSDoc, {
      source: { file: fixture('round38.ts'), export: 'roundThirtyEightJSDoc' },
    })
    const description = (path: string, method: string, status: number) =>
      (spec.paths as any)[path][method].responses[status].description

    expect(description('/created', 'post', 201)).toBe('The created account')
    expect(description('/found', 'post', 200)).toBe('The found account')
    expect(description('/updated', 'post', 200)).toBe('From the route')
    expect(description('/removed', 'post', 200)).toBe('From the metadata')
    expect(description('/listed', 'post', 200)).toBe('OK')
  })

  it('shows the compiler errors behind an unresolved type', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'orpc-inference-'))

    try {
      writeFileSync(
        path.join(directory, 'tsconfig.json'),
        JSON.stringify({ extends: './missing-base.json', include: ['*.ts'] }),
      )
      writeFileSync(
        path.join(directory, 'sub.ts'),
        `import type { User } from './nope-user'\nexport const a = null as unknown as User\n`,
      )
      writeFileSync(
        path.join(directory, 'router.ts'),
        `import { a } from './sub'\nexport const router = { a, b: undefinedVariable }\n`,
      )

      const procedure = os.handler(() => 1)
      const error = await generator
        .generate(
          { a: procedure, b: procedure },
          { source: { file: path.join(directory, 'router.ts') } },
        )
        .catch((e: unknown) => e as Error)

      const file = (name: string) => path.join(directory, name)
      expect(error).toBeInstanceOf(OpenAPIGeneratorError)
      const resolution = `Check its import, and the tsconfig "paths" for aliases like "@/".`
      const config = `error TS5083: Cannot read file '${file('missing-base.json')}'.`
      const undeclared = `${file('router.ts')}:2:31 - error TS2304: Cannot find name 'undefinedVariable'.`

      // of the router file, and of the file a procedure assigned to it is declared in, once
      expect((error as Error).message).toBe(
        [
          '[OpenAPIGenerator] Failed to infer types for the OpenAPI document (2 errors):',
          `Procedure at a: Could not resolve its type "User". ${resolution}`,
          `Procedure at b: Could not resolve its type "any". ${resolution}`,
          [
            'Compiler errors:',
            `Using the compiler options of "${file('tsconfig.json')}".`,
            config,
            undeclared,
            `${file('sub.ts')}:1:27 - error TS2307: Cannot find module './nope-user' or its corresponding type declarations.`,
          ].join('\n  '),
        ].join('\n\n'),
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  describe('compiler errors of project setups', () => {
    const procedure = os.handler(() => 1)
    const roots: string[] = []
    afterAll(() => {
      for (const root of roots) {
        rmSync(root, { recursive: true, force: true })
      }
    })

    /** A project in a temporary directory, which resolves `@orpc/server` */
    const project = (files: Record<string, string>) => {
      const root = mkdtempSync(path.join(tmpdir(), 'orpc-inference-'))
      roots.push(root)
      symlinkSync(
        fileURLToPath(new URL('../node_modules', import.meta.url)),
        path.join(root, 'node_modules'),
      )
      for (const [name, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
        writeFileSync(path.join(root, name), content)
      }
      return (name: string) => path.join(root, name)
    }
    const options = { strict: true, module: 'esnext', moduleResolution: 'bundler' }
    const message = (promise: Promise<unknown>) =>
      promise.then(
        () => '',
        (e: Error) => e.message,
      )
    const unresolved = (name: string) =>
      `Could not resolve the type "${name}". Check its import, and the tsconfig "paths" for aliases like "@/".`

    it('shows the errors of the compiler options, like a removed baseUrl', async () => {
      const file = project({
        'tsconfig.json': JSON.stringify({
          compilerOptions: { ...options, baseUrl: 'src', paths: { '@/*': ['*'] } },
          include: ['src'],
        }),
        'src/model.ts': 'export interface M { v: number; at: Date }\n',
        'src/router.ts': `import { os } from '@orpc/server'\nimport type { M } from '@/model'\nexport const router = { m: os.handler((): M => ({ v: 1, at: new Date(0) })) }\n`,
      })

      expect(
        await message(
          generator.generate({ m: procedure }, { source: { file: file('src/router.ts') } }),
        ),
      ).toBe(
        [
          '[OpenAPIGenerator] Failed to infer types for the OpenAPI document (1 error):',
          `Procedure at m: ${unresolved('M')}`,
          [
            'Compiler errors:',
            `Using the compiler options of "${file('tsconfig.json')}".`,
            `${file('tsconfig.json')} - error TS5102: Option 'baseUrl' has been removed. Please remove it from your configuration.`,
            `${file('tsconfig.json')} - error TS5090: Non-relative paths are not allowed. Did you forget a leading './'?`,
            `${file('src/router.ts')}:2:24 - error TS2307: Cannot find module '@/model' or its corresponding type declarations.`,
          ].join('\n  '),
        ].join('\n\n'),
      )
    })

    it('shows the errors of the files declaring the types that lead to an unresolved one', async () => {
      const file = project({
        'tsconfig.json': JSON.stringify({ compilerOptions: options, include: ['src'] }),
        'src/models.ts': `import type { Address } from './adress'\nexport interface Bad { a: string; missing: Missing }\nexport interface Holder { addr: Address }\n`,
        'src/router.ts': `import { os } from '@orpc/server'\nimport type { Bad, Holder } from './models'\nexport const router = { bad: os.handler((): Bad => ({ a: 'x' }) as any), holder: os.handler((): Holder => ({}) as any) }\n`,
      })

      expect(
        await message(
          generator.generate(
            { bad: procedure, holder: procedure },
            { source: { file: file('src/router.ts') } },
          ),
        ),
      ).toBe(
        [
          '[OpenAPIGenerator] Failed to infer types for the OpenAPI document (2 errors):',
          `Procedure at bad: ${unresolved('Missing')}`,
          `Procedure at holder: ${unresolved('Address')}`,
          [
            'Compiler errors:',
            `Using the compiler options of "${file('tsconfig.json')}".`,
            `${file('src/models.ts')}:1:30 - error TS2307: Cannot find module './adress' or its corresponding type declarations.`,
            `${file('src/models.ts')}:2:44 - error TS2304: Cannot find name 'Missing'.`,
          ].join('\n  '),
        ].join('\n\n'),
      )
    })

    it('throws on unresolved names in the template of a mapped type, and nested deep', async () => {
      const file = project({
        'tsconfig.json': JSON.stringify({ compilerOptions: options, include: ['src'] }),
        'src/router.ts': [
          `import { os } from '@orpc/server'`,
          `import type { Jsonify } from './nope'`,
          'interface Model { a: number; at: Date }',
          'interface Box<T> { v: T }',
          'type Serialized<T> = { [K in keyof T]: Jsonify<T[K]> }',
          'type Queried<T> = { [K in keyof T]: typeof missingValue }',
          'type Bare<T> = { [K in keyof T]: Missing }',
          'type CD<T> = T extends object ? { readonly [K in keyof T]: CD<T[K]> } : T',
          'export const router = {',
          '  serialized: os.handler((): { v: Serialized<Model> } => ({}) as any),',
          '  queried: os.handler((): { v: Queried<Model> } => ({}) as any),',
          '  lists: os.handler((): { v: Missing[][][][] } => ({}) as any),',
          '  boxes: os.handler((): { v: Box<Box<Box<Box<Missing>>>> } => ({}) as any),',
          '  typed: os.handler((): { v: Box<Box<Box<Box<typeof missingValue>>>> } => ({}) as any),',
          // under a mapped view of a mapped type, whose declaration is on no way to the error
          '  cdSerialized: os.handler((): CD<Serialized<Model>> => ({}) as any),',
          '  cdNested: os.handler((): CD<{ c: Serialized<Model> }> => ({}) as any),',
          '  cdBare: os.handler((): CD<{ c: Bare<Model> }> => ({}) as any),',
          '  cdQueried: os.handler((): CD<Queried<Model>> => ({}) as any),',
          '  partialQueried: os.handler((): Partial<Queried<Model>> => ({}) as any),',
          '  twice: os.handler((): Twice => ({ f0: null, f2: { a: { b: 1 } } })),',
          '}',
          'type Expanding<T> = T extends object ? { [K in keyof T]: Expanding<Expanding<T[K]>> } : T',
          'interface Twice { f0: Expanding<Expanding<Expanding<Twice>>> | null; f2: { a: { b: number } } }',
          '',
        ].join('\n'),
      })
      const names = [
        'serialized',
        'queried',
        'lists',
        'boxes',
        'typed',
        'cdSerialized',
        'cdNested',
        'cdBare',
        'cdQueried',
        'partialQueried',
        'twice',
      ]

      const thrown = await message(
        generator.generate(Object.fromEntries(names.map((name) => [name, procedure])), {
          source: { file: file('src/router.ts') },
        }),
      )
      expect(thrown).toContain(`(${names.length} errors)`)
      expect(thrown).toContain(`Procedure at serialized: ${unresolved('Jsonify<T[K]>')}`)
      expect(thrown).toContain(`Procedure at queried: ${unresolved('any')}`)
      expect(thrown).toContain(`Procedure at lists: ${unresolved('Missing')}`)
      expect(thrown).toContain(`Procedure at boxes: ${unresolved('Missing')}`)
      expect(thrown).toContain(`Procedure at typed: ${unresolved('any')}`)
      expect(thrown).toContain(`Procedure at cdSerialized: ${unresolved('any')}`)
      expect(thrown).toContain(`Procedure at cdNested: ${unresolved('any')}`)
      expect(thrown).toContain(`Procedure at cdBare: ${unresolved('any')}`)
      expect(thrown).toContain(`Procedure at cdQueried: ${unresolved('any')}`)
      expect(thrown).toContain(`Procedure at partialQueried: ${unresolved('any')}`)
      expect(thrown).toContain(
        `${file('src/router.ts')}:6:44 - error TS2304: Cannot find name 'missingValue'.`,
      )

      // the error type of an instantiation the compiler gives up on is not told from an
      // unresolved name, which is never written as any value
      expect(thrown).toContain(
        `Procedure at twice: ${unresolved('any')} It may also be an unresolved name under a mapped type, or a type nested too deep for the compiler to instantiate.`,
      )
    })

    it('throws on unresolved names in files whose errors the compiler does not report', async () => {
      const file = project({
        'tsconfig.json': JSON.stringify({
          compilerOptions: { ...options, skipLibCheck: true },
          include: ['src'],
        }),
        'src/types.d.ts': [
          'export interface DModel { a: number; at: Date }',
          'export type DQueried<T> = { [K in keyof T]: typeof missingValue }',
          'export type DBare<T> = { [K in keyof T]: Missing }',
          '',
        ].join('\n'),
        'src/unchecked.ts': [
          '// @ts-nocheck',
          `import { os } from '@orpc/server'`,
          'interface Model { a: number; at: Date }',
          'interface Box<T> { v: T }',
          'type Queried<T> = { [K in keyof T]: typeof missingValue }',
          'export const unchecked = {',
          '  queried: os.handler((): { v: Queried<Model> } => ({}) as any),',
          '  boxes: os.handler((): { v: Box<Box<Box<Box<Queried<Model>>>>> } => ({}) as any),',
          '  bare: os.handler((): { v: Missing } => ({}) as any),',
          '}',
          '',
        ].join('\n'),
        'src/router.ts': [
          `import { os } from '@orpc/server'`,
          `import type { DBare, DModel, DQueried } from './types'`,
          `export { unchecked } from './unchecked'`,
          'export const router = {',
          '  declared: os.handler((): { v: DQueried<DModel> } => ({}) as any),',
          '  declaredBare: os.handler((): { v: DBare<DModel> } => ({}) as any),',
          '}',
          '',
        ].join('\n'),
      })

      const declared = await message(
        generator.generate(
          { declared: procedure, declaredBare: procedure },
          { source: { file: file('src/router.ts') } },
        ),
      )
      expect(declared).toContain('(2 errors)')
      expect(declared).toContain(`Procedure at declared: ${unresolved('any')}`)
      expect(declared).toContain(`Procedure at declaredBare: ${unresolved('Missing')}`)

      const unchecked = await message(
        generator.generate(
          { queried: procedure, boxes: procedure, bare: procedure },
          { source: { file: file('src/router.ts'), export: 'unchecked' } },
        ),
      )
      expect(unchecked).toContain('(3 errors)')
      expect(unchecked).toContain(`Procedure at queried: ${unresolved('any')}`)
      expect(unchecked).toContain(`Procedure at boxes: ${unresolved('any')}`)
      expect(unchecked).toContain(`Procedure at bare: ${unresolved('Missing')}`)
    })

    it('throws on index signatures of unresolved names, which are no index signature of any', async () => {
      const file = project({
        'tsconfig.json': JSON.stringify({ compilerOptions: options, include: ['src'] }),
        'src/router.ts': [
          `import { os } from '@orpc/server'`,
          'export const router = {',
          '  record: os.handler((): { v: Record<string, Missing> } => ({}) as any),',
          '  root: os.handler((): Record<string, Missing> => ({}) as any),',
          '  signature: os.handler((): { v: { [k: string]: Missing } } => ({}) as any),',
          '  partial: os.handler((): { v: Partial<Record<string, Missing>> } => ({}) as any),',
          '  lists: os.handler((): { v: Record<string, Missing>[][][] } => ({}) as any),',
          '  intersection: os.handler((): { v: object & Record<string, Missing> } => ({}) as any),',
          '}',
          '',
        ].join('\n'),
      })
      const names = ['record', 'root', 'signature', 'partial', 'lists', 'intersection']

      const thrown = await message(
        generator.generate(Object.fromEntries(names.map((name) => [name, procedure])), {
          source: { file: file('src/router.ts') },
        }),
      )
      expect(thrown).toContain(`(${names.length} errors)`)
      for (const name of names) {
        expect(thrown).toContain(
          `Procedure at ${name}: ${unresolved(name === 'partial' ? 'any' : 'Missing')}`,
        )
      }
    })

    it.runIf(canGenerateWithin)(
      'cuts cycles through conditional deep mapped types, also over generic models, in time',
      () => {
        const cases: Record<string, string> = {
          generic: 'os.handler((): GenCycle<number> => ({}) as any)',
          genericInput: 'os.input(type<GenCycle<number>>()).handler(() => 1)',
          self: 'os.handler((): GenSelf<string> => ({}) as any)',
          wrap: 'os.handler((): Wrap<{ a: number }> => ({}) as any)',
          wrapInput: 'os.input(type<Wrap<{ a: number }>>()).handler(() => 1)',
          pair: 'os.handler((): CD<Pair<number>> => ({}) as any)',
          mutual: 'os.handler((): Expanding<MA> => ({}) as any)',
          list: 'os.handler((): ListCycle => ({}) as any)',
          index: 'os.handler((): IndexCycle => ({}) as any)',
          aliased: 'os.handler((): AliasCycle => ({}) as any)',
          recursive: 'os.handler((): Expanding<Rec> => ({}) as any)',
          branches: 'os.handler((): CD<Der<number>> => ({}) as any)',
          branchesInput: 'os.input(type<CD<Der<number>>>()).handler(() => 1)',
          viewed: 'os.handler((): CD<DerView<number>> => ({}) as any)',
          x1: 'os.handler((): CD<Der1<number>> => ({}) as any)',
          x2: 'os.handler((): CD<Der2<number>> => ({}) as any)',
          x3: 'os.handler((): CD<Der3<number>> => ({}) as any)',
          x3i: 'os.input(type<CD<Der3<number>>>()).handler(() => 1)',
          x4: 'os.handler((): CD<Der4<number>> => ({}) as any)',
          mapped: 'os.handler((): CD<MapDer<number>> => ({}) as any)',
          mappedInput: 'os.input(type<CD<MapDer<number>>>()).handler(() => 1)',
          mappedClass: 'os.handler((): CD<MapDerClass<number>> => ({}) as any)',
          method: 'os.handler((): CD<MethodDer<number>> => ({}) as any)',
          mapView: 'os.handler((): CD<MapView<number>> => ({}) as any)',
          mapViewInput: 'os.input(type<Expanding<MapView<number>>>()).handler(() => 1)',
          mapDirect: 'os.handler((): CD<MapDirect<number>> => ({}) as any)',
          swapped: 'os.handler((): CD<Swap<number, string>> => ({}) as any)',
          swappedInput: 'os.input(type<CD<Swap<number, string>>>()).handler(() => 1)',
          mapSwapped: 'os.handler((): CD<MapSwap<number, string>> => ({}) as any)',
          mapSwappedInput: 'os.input(type<Expanding<MapSwap<number, string>>>()).handler(() => 1)',
          swappedFour: 'os.handler((): CD<SwapFour<number, string>> => ({}) as any)',
          swappedFourInput:
            'os.input(type<Expanding<SwapFour<number, string>>>()).handler(() => 1)',
          rotated: 'os.handler((): CD<Rotate<number, string, boolean>> => ({}) as any)',
          rotatedInput: 'os.input(type<CD<Rotate<number, string, boolean>>>()).handler(() => 1)',
          indexed: 'os.handler((): CD<IndexDer<number>> => ({}) as any)',
          indexedSwapped: 'os.handler((): CD<IndexSwap<number, string>> => ({}) as any)',
          indexedSwappedInput: 'os.input(type<CD<IndexSwap<number, string>>>()).handler(() => 1)',
          mutualLiterals: 'os.handler((): CD<LitA<number>> => ({}) as any)',
          mutualLiteralsInput: 'os.input(type<Expanding<LitA<number>>>()).handler(() => 1)',
          mutualGetters: 'os.handler((): CD<FnA<number>> => ({}) as any)',
          mutualGettersInput: 'os.input(type<CD<FnA<number>>>()).handler(() => 1)',
          boxedLiteral: 'os.handler((): CD<BoxLit<number>> => ({}) as any)',
          boxedLiteralInput: 'os.input(type<Expanding<BoxLitMap<number>>>()).handler(() => 1)',
          passedOn: 'os.handler((): CD<PassBox<number>> => ({}) as any)',
          passedOnInput: 'os.input(type<Expanding<PassBox<number>>>()).handler(() => 1)',
          shortRoute: 'os.handler((): CD<Route<number>> => ({}) as any)',
          longRoute: 'os.handler((): CD<LongRoute<number>> => ({}) as any)',
          tupleView: 'os.handler((): CD<TupleDer<number>> => ({}) as any)',
          tupleViewInput: 'os.input(type<CD<TupleDer<number>>>()).handler(() => 1)',
          tupleGrow: 'os.handler((): CD<TupleGrow<number>> => ({}) as any)',
          tupleGrowInput: 'os.input(type<CD<TupleGrow<number>>>()).handler(() => 1)',
          pairView: 'os.handler((): CD<PairDer<number>> => ({}) as any)',
          pairViewInput: 'os.input(type<CD<PairDer<number>>>()).handler(() => 1)',
          dictView: 'os.handler((): CD<DictDer<number>> => ({}) as any)',
          dictViewInput: 'os.input(type<CD<DictDer<number>>>()).handler(() => 1)',
          listView: 'os.handler((): CD<ListDer<number>> => ({}) as any)',
          listViewInput: 'os.input(type<CD<ListDer<number>>>()).handler(() => 1)',
          plainSelf: 'os.handler((): CD<PlainSelf<number>> => ({}) as any)',
          tupleSelf: 'os.handler((): CD<TupleSelf<number>> => ({}) as any)',
          pairSelf: 'os.handler((): CD<PairSelf<number>> => ({}) as any)',
          dictSelf: 'os.handler((): CD<DictSelf<number>> => ({}) as any)',
          listSelf: 'os.handler((): CD<ListSelf<number>> => ({}) as any)',
          boxedSelf: 'os.handler((): CD<BoxedSelf<number>> => ({}) as any)',
          passedArgument: 'os.handler((): PassArg<number, string> => ({}) as any)',
          passedSameArgument: 'os.handler((): PassArg<number, number> => ({}) as any)',
          passedSameArgumentInput: 'os.input(type<PassArg<number, number>>()).handler(() => 1)',
        }
        const file = project({
          'tsconfig.json': JSON.stringify({ compilerOptions: options, include: ['src'] }),
          'src/router.ts': [
            `import { os, type } from '@orpc/server'`,
            'type Expanding<T> = T extends object ? { [K in keyof T]: Expanding<T[K]> } : T',
            'type CD<T> = T extends object ? { readonly [K in keyof T]: CD<T[K]> } : T',
            'interface GenCycle<T> { f0: Expanding<GenCycle<T>> | null; f2: { a: T } }',
            'interface GenSelf<T> { v: T; self: CD<GenSelf<T>> | null }',
            'interface Wrap<T> { inner: T; f0: Expanding<Wrap<T>> | null }',
            'interface Pair<T> { v: T; nested: Pair<T[]> | null }',
            'interface MA { b: Expanding<MB> | null; x: { a: number } }',
            'interface MB { a: Expanding<MA> | null; y: { b: string } }',
            'interface ListCycle { kids: Expanding<ListCycle>[]; f2: { a: number } }',
            'interface IndexCycle { m: Record<string, Expanding<IndexCycle>>; f2: { a: number } }',
            'type Aliased = Expanding<AliasCycle>',
            'interface AliasCycle { f0: Aliased | null; f2: { a: number } }',
            'interface Box<T> { v: T }',
            'type Rec = Box<Expanding<Rec>>',
            'interface Base<T> { a: Box<T>; b: Box<T> }',
            'interface Der<T> extends Base<Der<T[]>> { v: T }',
            'interface DerView<T> extends Base<CD<DerView<T>>> { v: T }',
            'interface BoxVia<T> { inner: Box<T> }',
            'interface Base1<T> { inner: Box<T>; other: BoxVia<T> }',
            'interface Der1<T> extends Base1<Der1<BoxVia<T>>> { v: T }',
            'interface Base2<T> { list: Box<T>[]; rec: Record<string, BoxVia<T>> }',
            'interface Der2<T> extends Base2<CD<Der2<T>>> { v: T }',
            'type I<T> = BoxVia<T> & { x: T }',
            'interface Der3<T> extends BoxVia<I<Der3<T[]>>> { v: T }',
            'interface Der4<T> extends Base<Der4<T[]>> { v: T; w: BoxVia<T> }',
            'interface MapBase<T> { a: Map<string, Box<T>>; b: Box<T>[]; c: BoxVia<T> }',
            'interface MapDer<T> extends MapBase<MapDer<T[]>> { v: T }',
            'class MapBaseClass<T> { a!: Map<string, Box<T>>; b!: Box<T>[]; c!: BoxVia<T> }',
            'class MapDerClass<T> extends MapBaseClass<MapDerClass<T[]>> { v!: T }',
            'interface MethodBase<T> { f: () => Box<T>; b: Box<T>[]; c: BoxVia<T> }',
            'interface MethodDer<T> extends MethodBase<MethodDer<T[]>> { v: T }',
            'interface MapView<T> extends MapBase<CD<MapView<T>>> { v: T }',
            'interface MapDirect<T> { a: Map<string, T>; b: MapDirect<T[]>[]; c: BoxVia<MapDirect<T[]>> }',
            'interface Swap<T, U> extends Base<Swap<U, T[]>> { v: T; u: U }',
            'interface MapSwap<T, U> extends MapBase<MapSwap<U, T[]>> { v: T; u: U }',
            'interface BaseFour<T> { a: Box<T>; b: Box<T>; c: Box<T>; d: BoxVia<T> }',
            'interface SwapFour<T, U> extends BaseFour<SwapFour<U, T[]>> { v: T; u: U }',
            'interface LitBase<T> { a: { x: Box<T>; m: Map<string, T> }; b: { y: Box<T>; f: () => T }; c: { z: BoxVia<T> } }',
            'interface Rotate<T, U, V> extends LitBase<CD<Rotate<U, V, T>>> { v: T; u: U; w: V }',
            'interface IndexBase<T> { a: Map<string, Box<T>>; i: { [k: string]: Box<T> }; j: { [k: string]: Box<T> } }',
            'interface IndexDer<T> extends IndexBase<CD<IndexDer<T>>> { v: T }',
            'interface IndexSwap<T, U> extends IndexBase<IndexSwap<U, T[]>> { v: T; u: U }',
            'interface LitA<T> { b: Box<CD<LitB<T>>>; c: { d: Box<CD<LitB<T>>> }; m: Map<string, T> }',
            'interface LitB<T> { a: Box<CD<LitA<T>>>; e: { f: CD<LitA<T>> }; v: T; g: () => T }',
            'interface FnA<T> { c: { d: Box<CD<FnB<T>>> }; e: { f: CD<FnB<T>> }; g: () => T }',
            'interface FnB<T> { c: { d: Box<CD<FnA<T>>> }; e: { f: CD<FnA<T>> }; v: T; h: () => T }',
            'interface BoxLit<T> { inner: Box<{ a: T; b: Box<CD<BoxLit<T>>> }>; m: Map<string, T> }',
            'interface BoxLitMap<T> { inner: Box<{ a: T; m: Map<string, BoxLitMap<T>>; b: Box<CD<BoxLitMap<T>>> }> }',
            'interface PassBox<T, U = string> { v: T; u: U; next: Box<PassBox<Box<T>, U>> | null }',
            'interface Route<T> { v: T; c: { p: Route<T[]> | null } }',
            // its route is 17 object literals long
            `interface LongRoute<T> { v: T; c: ${'{ p: '.repeat(17)}LongRoute<T[]> | null${' }'.repeat(17)} }`,
            // through the items of a tuple, an index signature or an array the project declares
            'interface TupleBase<T> { a: [T, number]; b: Box<T>; c: BoxVia<T> }',
            'interface TupleDer<T> extends TupleBase<CD<TupleDer<T>>> { v: T }',
            'interface TupleGrow<T> extends TupleBase<TupleGrow<T[]>> { v: T }',
            'type Pairish<T> = [T, number]',
            'interface PairBase<T> { a: Pairish<T>; b: Pairish<T>; c: Pairish<T> }',
            'interface PairDer<T> extends PairBase<CD<PairDer<T>>> { v: T }',
            'interface Dict<T> { [k: string]: T }',
            'interface DictBase<T> { a: Dict<T>; b: Dict<T>; c: BoxVia<T> }',
            'interface DictDer<T> extends DictBase<CD<DictDer<T>>> { v: T }',
            'interface List<T> extends Array<T> {}',
            'interface ListBase<T> { a: List<T>; b: List<T>; c: BoxVia<T> }',
            'interface ListDer<T> extends ListBase<CD<ListDer<T>>> { v: T }',
            'interface PlainSelf<T> { v: T; a: CD<PlainSelf<T>> | null }',
            'interface TupleSelf<T> { v: T; a: [CD<TupleSelf<T>>, T] | null }',
            'interface PairSelf<T> { v: T; a: Pairish<CD<PairSelf<T>>> | null }',
            'interface DictSelf<T> { v: T; a: Dict<CD<DictSelf<T>>> }',
            'interface ListSelf<T> { v: T; a: List<CD<ListSelf<T>>> }',
            'interface BoxedSelf<T> { v: T; a: Box<Box<CD<BoxedSelf<T>>>> | null }',
            'interface PassArg<T, U> { v: T; u: U; next: PassArg<U, Box<T>> | null }',
            'export const router = {',
            ...Object.entries(cases).map(([name, procedure]) => `  ${name}: ${procedure},`),
            '}',
            '',
          ].join('\n'),
        })

        const { spec, error } = generateWithin(file('src/router.ts'), 60_000)
        expect(error).toBeUndefined()

        const schemas = spec.components?.schemas ?? {}
        const deref = (schema: any): any =>
          schema?.$ref ? deref(schemas[schema.$ref.replace('#/components/schemas/', '')]) : schema
        const growing = ['passedArgument', 'passedSameArgument', 'passedSameArgumentInput']
        for (const [name, procedure] of Object.entries(cases)) {
          if (growing.includes(name)) {
            continue
          }
          const operation = spec.paths[`/${name}`].post
          const schema = procedure.includes('input')
            ? operation.requestBody.content['application/json'].schema
            : operation.responses['200'].content['application/json'].schema
          // cut after a few levels
          expect([name, JSON.stringify(deref(schema))]).toEqual([
            name,
            expect.stringMatching(/\{\}/),
          ])
        }
        // a cycle through models holding each other in object literals, cut as early as others
        for (const name of [
          'mutualLiterals',
          'mutualLiteralsInput',
          ...['tupleView', 'tupleGrow', 'pairView', 'dictView', 'listView'].flatMap((name) => [
            name,
            `${name}Input`,
          ]),
        ]) {
          const operation = spec.paths[`/${name}`].post
          const schema = name.endsWith('Input')
            ? operation.requestBody.content['application/json'].schema
            : operation.responses['200'].content['application/json'].schema
          expect([name, JSON.stringify(schema).length < 50_000]).toEqual([name, true])
        }
        // also through a long route, after as many levels as through a short one
        const levels = (name: string) =>
          JSON.stringify(spec.paths[`/${name}`].post.responses['200']).match(/"v":/g)?.length
        expect(levels('longRoute')).toBe(levels('shortRoute'))
        // a model nesting itself through a tuple, an index signature or an array the project
        // declares, as early as directly
        const nested = (name: string) =>
          JSON.stringify(spec.paths[`/${name}`].post.responses['200']).match(/"a":/g)?.length
        for (const name of ['tupleSelf', 'pairSelf', 'dictSelf', 'listSelf', 'boxedSelf']) {
          expect([name, nested(name)]).toEqual([name, nested('plainSelf')])
        }
        // a model growing a type argument as many levels when its other one is the same type
        const inline = (schema: any): any =>
          schema?.$ref
            ? inline(schemas[schema.$ref.replace('#/components/schemas/', '')])
            : schema && typeof schema === 'object'
              ? Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, inline(v)]))
              : schema
        const grown = (name: string) => {
          const operation = spec.paths[`/${name}`].post
          const schema = name.endsWith('Input')
            ? operation.requestBody.content['application/json'].schema
            : operation.responses['200'].content['application/json'].schema
          return JSON.stringify(inline(schema)).match(/"next":/g)?.length
        }
        for (const name of growing) {
          expect([name, grown(name)]).toEqual([name, grown('passedArgument')])
        }
      },
      120_000,
    )

    it.runIf(canGenerateWithin)(
      'cuts cycles growing a type argument from one passed on in place as early, in time',
      () => {
        const cases: Record<string, string> = {
          branches: 'os.handler((): KeepGrow<number, string> => ({}) as any)',
          branchesSame: 'os.handler((): KeepGrow<number, number> => ({}) as any)',
          branchesInput: 'os.input(type<KeepGrow<number, string>>()).handler(() => 1)',
          literal: 'os.handler((): KeepGrowLit<number, string> => ({}) as any)',
          literalInput: 'os.input(type<KeepGrowLit<number, string>>()).handler(() => 1)',
          wrapped: 'os.handler((): KeepGrowWrap<number, string> => ({}) as any)',
          wrappedInput: 'os.input(type<KeepGrowWrap<number, string>>()).handler(() => 1)',
          three: 'os.handler((): KeepGrowThree<number, string, boolean> => ({}) as any)',
          kept: `os.handler((): ${'Kept<'.repeat(6)}number${'>'.repeat(6)} => ({}) as any)`,
          keptInput: `os.input(type<${'Kept<'.repeat(6)}number${'>'.repeat(6)}>()).handler(() => 1)`,
        }
        const file = project({
          'tsconfig.json': JSON.stringify({ compilerOptions: options, include: ['src'] }),
          'src/router.ts': [
            `import { os, type } from '@orpc/server'`,
            'interface Box<T> { v: T }',
            'interface KeepGrow<T, U> { v: T; u: U; x: KeepGrow<T, Box<T>> | null; y: KeepGrow<Box<T>, U> | null; z: KeepGrow<T, Set<T>> | null; w: KeepGrow<Set<T>, U> | null }',
            'interface KeepGrowLit<T, U> { v: T; u: U; n: { x: KeepGrowLit<T, Box<T>> | null; y: KeepGrowLit<Box<T>, U> | null; z: KeepGrowLit<T, Set<T>> | null; w: KeepGrowLit<Set<T>, U> | null } }',
            'interface KeepGrowWrap<T, U> { v: T; u: U; x: Map<string, KeepGrowWrap<T, Box<T>>>; y: Set<KeepGrowWrap<Box<T>, U>>; z: KeepGrowWrap<T, T[]>[]; w: Record<string, KeepGrowWrap<T[], U>> }',
            'interface KeepGrowThree<A, B, C> { a: A; b: B; c: C; x: KeepGrowThree<A, Box<A>, C> | null; y: KeepGrowThree<Box<A>, B, C> | null; z: KeepGrowThree<A, B, Box<B>> | null }',
            'interface Kept<T, U = string> { a: T; b: U; m: Map<string, Kept<T, U>> }',
            'export const router = {',
            ...Object.entries(cases).map(([name, procedure]) => `  ${name}: ${procedure},`),
            '}',
            '',
          ].join('\n'),
        })

        const { spec, error } = generateWithin(file('src/router.ts'), 60_000)
        expect(error).toBeUndefined()

        const schemas = spec.components?.schemas ?? {}
        const component = (ref: string) => schemas[ref.replace('#/components/schemas/', '')]
        const schemaOf = (name: string) => {
          const operation = spec.paths[`/${name}`].post
          return name.endsWith('Input')
            ? operation.requestBody.content['application/json'].schema
            : operation.responses['200'].content['application/json'].schema
        }
        // the schema with every component it reaches
        const reached = (schema: unknown, seen = new Set<string>()): number => {
          const json = JSON.stringify(schema)
          let size = json.length
          for (const [, ref] of json.matchAll(/"\$ref":"([^"]+)"/g)) {
            if (!seen.has(ref!)) {
              seen.add(ref!)
              size += reached(component(ref!), seen)
            }
          }
          return size
        }
        for (const name of Object.keys(cases).filter((name) => !name.startsWith('kept'))) {
          expect([name, reached(schemaOf(name)) < 20_000]).toEqual([name, true])
        }

        // a finite nesting passing on its default type argument is expanded in full
        const deref = (schema: any): any => (schema?.$ref ? deref(component(schema.$ref)) : schema)
        for (const name of ['kept', 'keptInput']) {
          let schema = deref(schemaOf(name))
          let levels = 0
          while (schema.type === 'object') {
            expect([name, levels, schema.properties.b]).toEqual([name, levels, { type: 'string' }])
            schema = deref(schema.properties.a)
            levels++
          }
          expect([name, levels, schema]).toEqual([name, 6, { type: 'number' }])
        }
      },
      120_000,
    )

    it('reads no diagnostics of the whole program, which would check all of it', async () => {
      const file = project({
        'tsconfig.json': JSON.stringify({ compilerOptions: options, include: ['src'] }),
        'src/router.ts': `import { os } from '@orpc/server'\nimport type { M } from './nope'\nexport const router = { m: os.handler((): M => ({}) as any) }\n`,
      })
      const global = vi.spyOn(Program.prototype, 'getGlobalDiagnostics')

      try {
        expect(
          await message(
            generator.generate({ m: procedure }, { source: { file: file('src/router.ts') } }),
          ),
        ).toContain(`Procedure at m: ${unresolved('M')}`)
        expect(global).not.toHaveBeenCalled()
      } finally {
        global.mockRestore()
      }
    })

    it('names the nearest tsconfig when it does not include the file, and why', async () => {
      const file = project({
        'app/tsconfig.json': JSON.stringify({
          extends: '@scr/tsconfig/base',
          compilerOptions: { paths: { '@/*': ['./src/*'] } },
        }),
        'app/node_modules/@scr/tsconfig/package.json': JSON.stringify({ name: '@scr/tsconfig' }),
        'app/node_modules/@scr/tsconfig/base.json': JSON.stringify({
          compilerOptions: options,
          include: ['src'],
        }),
        'app/src/model.ts': 'export interface M { v: number }\n',
        'app/src/router.ts': `import { os } from '@orpc/server'\nimport type { M } from '@/model'\nexport const router = { m: os.handler((): M => ({ v: 1 })) }\n`,
      })
      const router = file('app/src/router.ts')
      const noInputs = `error TS18003: No inputs were found in config file '${file('app/tsconfig.json')}'. Specified 'include' paths were '["node_modules/@scr/tsconfig/src"]' and 'exclude' paths were '[]'.`

      // the include of a base tsconfig is relative to the base
      const nearest = await message(
        generator.generate({ m: procedure }, { source: { file: router } }),
      )
      expect(nearest).toContain(
        [
          'Compiler errors:',
          `"${file('app/tsconfig.json')}" does not include "${router}".`,
          noInputs,
        ].join('\n  '),
      )
      expect(nearest).toContain(
        `${router}:2:24 - error TS2307: Cannot find module '@/model' or its corresponding type declarations.`,
      )

      // passing the nearest tsconfig, leaving it out is no help
      expect(
        await message(
          generator.generate({ m: procedure }, { source: { file: router, tsconfig: file('app') } }),
        ),
      ).toBe(
        `[TypeScript] "${router}" is not part of the project "${file('app/tsconfig.json')}". Pass the tsconfig that includes it.\n  ${noInputs}`,
      )
    }, 20_000)

    it('names files of other languages, which the compiler can not parse', async () => {
      const file = project({ 'App.vue': 'export const router = {}\n', 'notes.txt': '' })

      for (const name of ['App.vue', 'notes.txt']) {
        await expect(generator.generate({}, { source: { file: file(name) } })).rejects.toThrow(
          `[TypeScript] File "${file(name)}" is not a TypeScript or JavaScript source file (.ts, .tsx, .mts, .cts, .js, .jsx, .mjs, .cjs).`,
        )
      }
    })
  })

  it('documents with recursive defs only', async () => {
    const spec = await new OpenAPIGenerator({
      converters: [new ZodToJsonSchemaConverter()],
      defs: 'recursive',
    }).generate(router, { source: { file: fixture('router.ts') } })
    const schemas = spec.components?.schemas ?? {}

    // `Planet` refers to itself, `PlanetKind` is written where it is used
    expect(schemas.Planet).toEqual(PLANET)
    expect(schemas).not.toHaveProperty('PlanetKind')
    expect(JSON.stringify(spec)).not.toContain('PlanetKind')
    expect(JSON.stringify(spec)).toMatch(/"enum":\["(rocky|gas)","(rocky|gas)"\]/u)
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

    it('documents class inputs as the plain objects or instances a client sends', async () => {
      const spec = await generator.generate(classes, {
        source: { file: fixture('round11.ts'), export: 'classes' },
      })
      const operation = (spec.paths as any)['/create'].post
      const component = (schema: any) =>
        schema.$ref
          ? (spec.components?.schemas as any)[schema.$ref.replace('#/components/schemas/', '')]
          : schema

      const input = component(operation.requestBody.content['application/json'].schema)
      // `JSON.stringify` writes the `Set` of an instance as `{}`, and throws on its bigint
      expect(input.properties.tags).toEqual({
        anyOf: [
          expect.objectContaining({ 'type': 'array', 'x-native-type': 'set' }),
          { type: 'object' },
        ],
      })
      expect(input.properties.views).toMatchObject({ 'type': 'string', 'x-native-type': 'bigint' })

      // the server sends an instance, which `JSON.stringify` writes
      const output = component(operation.responses['200'].content['application/json'].schema)
      expect(output.properties.tags).toEqual({ type: 'object' })
      // which throws on a bigint field
      expect(output.properties.views).toEqual({ not: {} })
      expect(output.required).toContain('views')

      const value = await call(classes.create, { title: 't', tags: new Set(['a']), views: 1n })
      expect(() => JSON.stringify(new OpenAPIJsonSerializer().serializeJson(value).json)).toThrow(
        'BigInt',
      )
    })

    it('names a model the same in both directions, and calls toJSON only of instances in inputs', async () => {
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

      // an instance of `SecretJSON` is written as nothing, a plain object by its fields
      const secret = (spec.components?.schemas as any).HoldsSecret
      expect(secret.required).toEqual(['list'])
      expect(secret.properties.list.items).toEqual({
        anyOf: [{ $ref: '#/components/schemas/SecretJSON' }, { type: 'null' }],
      })
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

  describe('class inputs', () => {
    it('documents inputs of class types as the instances and plain objects a client sends', async () => {
      const spec = await generator.generate(classInputs, {
        source: { file: fixture('class-inputs.ts'), export: 'classInputs' },
      })
      const schemas = spec.components?.schemas as any
      const ajv = new Ajv2020({ strict: false, allErrors: true })
      ajv.addSchema(
        JSON.parse(
          JSON.stringify({ $id: 'spec', $defs: schemas ?? {} }).replaceAll(
            '#/components/schemas/',
            'spec#/$defs/',
          ),
        ),
      )
      const body = (path: string) =>
        JSON.parse(
          JSON.stringify(
            (spec.paths as any)[path].post.requestBody.content['application/json'].schema,
          ).replaceAll('#/components/schemas/', 'spec#/$defs/'),
        )

      // an instance leaves its getter out, a plain object has it
      expect(schemas.Person.required).toEqual(['first', 'last'])
      expect(schemas.Person.properties.full).toEqual({ type: 'string' })
      // only an instance satisfies a class with private members, `JSON.stringify` writes it
      expect(schemas.Sealed.properties.tags).toEqual({ type: 'object' })

      // what a client holding these values sends, which the server accepts
      const handler = new OpenAPIHandler(classInputs)
      const sent: string[] = []
      const link = new OpenAPILink(classInputs, {
        origin: 'http://localhost',
        url: '/',
        fetch: async (request, init) => {
          const handled = new Request(request, init)
          sent.push(await handled.clone().text())
          return (await handler.handle(handled)).response!
        },
      })
      const plainTagged = { tags: new Set(['a']), counts: new Map([['a', 1]]), name: 'n' }
      const plainMoney = { amount: 1, currency: 'X' }

      for (const [name, value] of [
        ['money', { m: new Money(1, 'X') }],
        ['money', { m: plainMoney }],
        ['tagged', new Tagged()],
        ['tagged', plainTagged],
        ['person', new Person()],
        ['person', { first: 'a', last: 'b', full: 'a b' }],
        ['readonlyTagged', new Tagged()],
        ['readonlyTagged', plainTagged],
        ['pickedMoney', new Money(1, 'X')],
        ['pickedMoney', { amount: 1 }],
        ['partialPerson', new Person()],
        ['partialPerson', { full: 'a b' }],
        ['order', new Order()],
        ['order', { total: plainMoney, items: [plainTagged, new Tagged()] }],
        ['readonlyOrder', new Order()],
        ['readonlyOrder', { total: new Money(1, 'X'), items: [plainTagged] }],
        ['moneys', [new Money(1, 'X'), plainMoney]],
        ['tags', { list: [new Tagged(), plainTagged] }],
        ['sealed', new Sealed()],
        ['guarded', { g: new Guarded() }],
        ['stamp', new Stamp(0)],
        ['link', new Link('http://x/')],
        ['labels', new Labels(['a'])],
        ['lookup', new Lookup([['a', 1]])],
      ] as const) {
        await expect(link.call([name], value, { context: {} })).resolves.toBe(1)
        const validate = ajv.compile(body(`/${name}`))
        const json = JSON.parse(sent.at(-1)!)
        expect(validate(json) ? [] : [name, json, validate.errors]).toEqual([])
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
  describe('round thirty-five', () => {
    it('documents inputs of the values a client holding them sends', async () => {
      const spec = await generator.generate(roundThirtyFiveInputs, {
        source: { file: fixture('round35.ts'), export: 'roundThirtyFiveInputs' },
      })
      const body = (path: string) =>
        JSON.parse(
          JSON.stringify(
            (spec.paths as any)[path].post.requestBody.content['application/json'].schema,
          ).replaceAll('#/components/schemas/', 'spec#/$defs/'),
        )

      // an instance of a view of a class, written by `JSON.stringify`, or a plain object
      expect(body('/moneyView').properties.m).toEqual({
        anyOf: [
          { type: 'string' },
          { type: 'object', properties: { cents: { type: 'number' } }, required: ['cents'] },
        ],
      })
      expect(body('/taggedView').properties.t.properties.tags).toEqual({
        anyOf: [expect.objectContaining({ 'x-native-type': 'set' }), { type: 'object' }],
      })
      expect(body('/anyRecord')).toEqual({ type: 'object', properties: { v: {} } })

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
        ['/expandingCycle', { f0: null, f2: { a: 1 } }],
        ['/anyRecord', { v: [1, 2] }],
        ['/primitiveView', { v: 'x' }],
        ['/omittedLength', { v: [[1]] }],
        ['/objectIntersection', { v: [1] }],
        ['/keylessIntersection', { v: 5 }],
        ['/iterable', { ids: ['a'] }],
        ['/arrayLike', { ids: [1, 2] }],
        ['/numbered', { ids: ['a', 'b'] }],
        ['/moneyView', { m: '1c' }],
        ['/moneyView', { m: { cents: 1 } }],
        ['/taggedView', { t: { tags: {} } }],
        ['/taggedView', { t: { tags: ['a'] } }],
      ] as const) {
        const validate = ajv.compile(body(path))
        expect(validate(value) ? [] : [path, validate.errors]).toEqual([])
      }
    })
  })
  describe('round thirty-six', () => {
    it('documents inputs of conditional deep mapped types over finite models in full', async () => {
      const spec = await generator.generate(roundThirtySixInputs, {
        source: { file: fixture('round36.ts'), export: 'roundThirtySixInputs' },
      })
      const body = (path: string) =>
        (spec.paths as any)[path].post.requestBody.content['application/json'].schema

      // the fourth nested page is documented, not cut
      expect(JSON.stringify(body('/deepFeed'))).toContain(
        '"likes":{"type":"object","properties":{"items":{"type":"array","items":{"type":"object","properties":{"by":{"type":"string"}},"required":["by"]}}',
      )

      const ajv = new Ajv2020({ strict: false, allErrors: true })
      const page = <T>(items: T[]) => ({ items, total: items.length })
      for (const [path, value, valid] of [
        [
          '/deepFeed',
          {
            name: 'a',
            posts: page([
              {
                title: 't',
                comments: page([
                  { text: 'c', replies: page([{ text: 'r', likes: page([{ by: 'b' }]) }]) },
                ]),
              },
            ]),
          },
          true,
        ],
        [
          '/deepFeed',
          {
            name: 'a',
            posts: page([
              {
                title: 't',
                comments: page([{ text: 'c', replies: page([{ text: 'r', likes: 1 }]) }]),
              },
            ]),
          },
          false,
        ],
        ['/nestedBoxes', { v: { v: { v: { v: 1 } } } }, true],
        ['/nestedBoxes', { v: { v: { v: { v: 'x' } } } }, false],
        ['/lengthExtra', { v: [1] }, true],
      ] as const) {
        expect([path, ajv.validate(body(path), value)]).toEqual([path, valid])
      }
    })
  })
  describe('round thirty-seven', () => {
    it('documents inputs of cycles through conditional deep mapped types over generic models', async () => {
      const spec = await generator.generate(roundThirtySevenInputs, {
        source: { file: fixture('round37.ts'), export: 'roundThirtySevenInputs' },
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
      const body = (path: string) =>
        JSON.parse(
          JSON.stringify(
            (spec.paths as any)[path].post.requestBody.content['application/json'].schema,
          ).replaceAll('#/components/schemas/', 'spec#/$defs/'),
        )
      const boxes = (depth: number, end: unknown): unknown =>
        depth === 0 ? end : { v: boxes(depth - 1, end) }
      const getters = (depth: number, end: unknown): unknown =>
        depth === 0 ? end : { inner: { a: getters(depth - 1, end) } }
      const linked = (depth: number, end: unknown): unknown =>
        depth === 0 ? end : { inner: { a: linked(depth - 1, end), next: null } }
      const mapped = (depth: number, end: unknown): unknown =>
        depth === 0 ? end : { inner: { a: mapped(depth - 1, end), m: [] } }
      const sets = (depth: number, end: unknown): unknown =>
        depth === 0 ? end : { inner: { a: sets(depth - 1, end), s: [] } }
      const deep = (depth: number, end: unknown): unknown =>
        depth === 0 ? end : { inner: { deep: { a: deep(depth - 1, end), m: [] } } }
      const lists = (depth: number, end: unknown): unknown =>
        depth === 0 ? end : { inner: { a: lists(depth - 1, end), l: [] } }
      const records = (depth: number, end: unknown): unknown =>
        depth === 0 ? end : { inner: { a: records(depth - 1, end), r: {} } }
      const boxed = (depth: number, end: unknown): unknown =>
        depth === 0 ? end : { inner: { v: { a: boxed(depth - 1, end), m: [] } } }
      const passed = (depth: number, end: unknown): unknown =>
        depth === 0 ? end : { inner: { a: passed(depth - 1, end), b: 'b', m: [] } }

      for (const [path, value, valid] of [
        ['/genericCycle', { f0: { f0: null, f2: { a: 2 } }, f2: { a: 1 } }, true],
        ['/genericCycle', { f0: { f0: null, f2: { a: 'x' } }, f2: { a: 1 } }, false],
        ['/genericSelf', { v: 'a', self: { v: 'b', self: null } }, true],
        ['/wrapCycle', { inner: { a: 1 }, f0: { inner: { a: 2 }, f0: null } }, true],
        ['/deepBoxes', boxes(8, 1), true],
        ['/deepBoxes', boxes(8, 'x'), false],
        // a function beside the type argument tells the levels apart, so all six are documented
        ['/viaGetters', getters(6, 1), true],
        ['/viaGetters', getters(6, 'x'), false],
        // also when the alias between them names itself
        ['/viaLinkedGetters', linked(6, 1), true],
        ['/viaLinkedGetters', linked(6, 'x'), false],
        // and when the object literal between them holds a map or set of the model
        ['/viaSelfMaps', mapped(8, 1), true],
        ['/viaSelfMaps', mapped(8, 'x'), false],
        ['/viaSelfSets', sets(5, 1), true],
        ['/viaSelfSets', sets(5, 'x'), false],
        // also two object literals deep, and beside a list or record of the model
        ['/viaDeepMaps', deep(5, 1), true],
        ['/viaDeepMaps', deep(5, 'x'), false],
        ['/viaSelfLists', lists(8, 1), true],
        ['/viaSelfLists', lists(8, 'x'), false],
        ['/viaSelfRecords', records(5, 1), true],
        ['/viaSelfRecords', records(5, 'x'), false],
        // also through a generic model of the object literal, and passing on a type argument
        ['/viaBoxedMaps', boxed(8, 1), true],
        ['/viaBoxedMaps', boxed(8, 'x'), false],
        ['/viaExpandedBoxedMaps', boxed(5, 1), true],
        ['/viaExpandedBoxedMaps', boxed(5, 'x'), false],
        ['/viaDefaultMaps', passed(6, 1), true],
        ['/viaDefaultMaps', passed(6, 'x'), false],
      ] as const) {
        expect([path, ajv.validate(body(path), value)]).toEqual([path, valid])
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

  describe('round thirty-nine', () => {
    const component = (name: string) => `#/components/schemas/${name}`

    it.each(['3.2.0', '3.1.1', '3.0.4'] as const)(
      'documents discriminated unions with a discriminator in %s',
      async (version) => {
        const spec = await generator.generate(roundThirtyNine, {
          source: { file: fixture('round39.ts'), export: 'roundThirtyNine' },
          version,
        })
        const schemas = spec.components?.schemas as any
        const discriminated = (mapping: Record<string, string>) => ({
          oneOf: [...new Set(Object.values(mapping))].map((name) => ({ $ref: component(name) })),
          discriminator: {
            propertyName: 'kind',
            mapping: Object.fromEntries(
              Object.entries(mapping).map(([value, name]) => [value, component(name)]),
            ),
          },
        })

        expect(schemas.Shape).toEqual({
          description: 'A shape, told apart by its kind',
          ...discriminated({ circle: 'Circle', square: 'Square' }),
        })
        expect(schemas.Tree).toEqual({
          description: 'A tree of leaves',
          ...discriminated({ branch: 'Branch', leaf: 'Leaf' }),
        })
        expect(
          (spec.paths as any)['/relabelled'].post.responses['200'].content['application/json']
            .schema.items,
        ).toEqual(discriminated({ renamed: 'Relabelled', square: 'Square' }))
        expect(schemas.Circle.properties.kind).toEqual(
          version === '3.0.4'
            ? { type: 'string', enum: ['circle'] }
            : { type: 'string', const: 'circle' },
        )
      },
    )

    it('documents inputs of discriminated unions, not when they are split into parameters', async () => {
      const spec = await generator.generate(roundThirtyNineInputs, {
        source: { file: fixture('round39.ts'), export: 'roundThirtyNineInputs' },
      })
      const paths = spec.paths as any

      expect(paths['/shape'].post.requestBody.content['application/json'].schema).toEqual({
        $ref: component('Shape'),
      })
      // an instance is sent with the kind of its `toJSON`, a plain object with its own
      expect(paths['/relabelled'].post.requestBody.content['application/json'].schema).toEqual({
        anyOf: [{ $ref: component('Relabelled') }, { $ref: component('Square') }],
      })
      expect(paths['/queried'].get.parameters.map((p: any) => p.name)).toEqual([
        'kind',
        'radius',
        'size',
      ])
    })
  })

  describe('round forty-four', () => {
    it('makes components of the models of a cycle with defs: recursive', async () => {
      const spec = await new OpenAPIGenerator({ defs: 'recursive' }).generate(roundFortyFour, {
        source: { file: fixture('round44.ts'), export: 'roundFortyFour' },
      })

      // each refers to itself through the others, so none is written again at each use
      expect(
        Object.keys(spec.components?.schemas ?? {})
          .filter((name) => name.startsWith('Linked'))
          .toSorted(),
      ).toEqual(['LinkedComment', 'LinkedPost', 'LinkedUser'])

      const ajv = new Ajv2020({ strict: false, allErrors: true })
      const validate = ajv.compile(
        JSON.parse(
          JSON.stringify({
            $defs: spec.components?.schemas,
            ...(spec.paths as any)['/linkedUser'].post.responses['200'].content['application/json']
              .schema,
          }).replaceAll('#/components/schemas/', '#/$defs/'),
        ),
      )
      const output = await call(roundFortyFour.linkedUser, undefined)
      const json = JSON.parse(
        JSON.stringify(new OpenAPIJsonSerializer().serializeJson(output).json),
      )
      expect(validate(json) ? [] : validate.errors).toEqual([])
    })

    it('makes components of models that reach the cycle only through finished defs', async () => {
      const spec = await new OpenAPIGenerator({ defs: 'recursive' }).generate(roundFortyFour, {
        source: { file: fixture('round44.ts'), export: 'roundFortyFour' },
      })

      // each but the last refers to the first only through the next two, defs before it
      expect(
        Object.keys(spec.components?.schemas ?? {}).filter((name) => name.startsWith('FibTwenty')),
      ).toHaveLength(20)
      expect(JSON.stringify(spec).length).toBeLessThan(50_000)

      const ajv = new Ajv2020({ strict: false, allErrors: true })
      const validate = ajv.compile(
        JSON.parse(
          JSON.stringify({
            $defs: spec.components?.schemas,
            ...(spec.paths as any)['/fibTwenty'].post.responses['200'].content['application/json']
              .schema,
          }).replaceAll('#/components/schemas/', '#/$defs/'),
        ),
      )
      const output = await call(roundFortyFour.fibTwenty, undefined)
      const json = JSON.parse(
        JSON.stringify(new OpenAPIJsonSerializer().serializeJson(output).json),
      )
      expect(validate(json) ? [] : validate.errors).toEqual([])
    })
  })
  describe('round forty-six', () => {
    it('documents inputs holding built-ins with an added toJSON, and functions typed by interfaces', async () => {
      const spec = await generator.generate(roundFortySixInputs, {
        source: { file: fixture('round46.ts'), export: 'roundFortySixInputs' },
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
      const body = (path: string) =>
        JSON.parse(
          JSON.stringify(
            (spec.paths as any)[path].post.requestBody.content['application/json'].schema,
          ).replaceAll('#/components/schemas/', 'spec#/$defs/'),
        )
      const serializer = new OpenAPIJsonSerializer()

      // what a client holding these values sends: an instance by `JSON.stringify`, which calls
      // the added `toJSON`, a plain object by the serializer, which does not
      for (const [name, value] of [
        ['stampHolder', new StampHolder()],
        // oxlint-disable-next-line typescript/no-misused-spread -- the plain object a client sends
        ['stampHolder', { ...new StampHolder() }],
        ['functionHolder', new FunctionHolder()],
        // oxlint-disable-next-line typescript/no-misused-spread -- the plain object a client sends
        ['functionHolder', { ...new FunctionHolder() }],
        ['maybeStampHolder', new MaybeStampHolder()],
        // oxlint-disable-next-line typescript/no-misused-spread -- the plain object a client sends
        ['maybeStampHolder', { ...new MaybeStampHolder() }],
        ['jsonFnHolder', new JsonFnHolder()],
        // oxlint-disable-next-line typescript/no-misused-spread -- the plain object a client sends
        ['jsonFnHolder', { ...new JsonFnHolder() }],
        ['jsonFnForms', new JsonFnForms()],
        // oxlint-disable-next-line typescript/no-misused-spread -- the plain object a client sends
        ['jsonFnForms', { ...new JsonFnForms() }],
        ['jsonFnViews', { added: jsonFn(), fn: jsonFn(), view: jsonFn(), addedView: jsonFn() }],
        ['jsonFnViews', { added: jsonFn(), fn: jsonFn(), view: { name: 'n' }, addedView: {} }],
      ] as const) {
        const validate = ajv.compile(body(`/${name}`))
        const json = JSON.parse(JSON.stringify(serializer.serializeJson(value).json))
        expect(validate(json) ? [] : [name, json, validate.errors]).toEqual([])
      }
    })
  })

  describe('round forty-eight', () => {
    it('documents inputs holding errors with an added toJSON, and interfaces declaring toJSON', async () => {
      const spec = await generator.generate(roundFortyEightInputs, {
        source: { file: fixture('round48.ts'), export: 'roundFortyEightInputs' },
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
      const body = (path: string) =>
        JSON.parse(
          JSON.stringify(
            (spec.paths as any)[path].post.requestBody.content['application/json'].schema,
          ).replaceAll('#/components/schemas/', 'spec#/$defs/'),
        )
      const serializer = new OpenAPIJsonSerializer()

      // the serializer leaves an error to `JSON.stringify`, which calls its `toJSON`, and so is
      // an instance of a class implementing an interface that declares one
      for (const [name, value] of [
        ['plainLabelledError', { e: labelledError() }],
        ['plainLabelledBytes', { b: labelledBytes() }],
        ['jsonPoint', new JsonPointImpl()],
        ['jsonPoint', { x: 1 }],
        ['jsonPoints', { p: new JsonPointImpl(), list: [new JsonPointImpl(), { x: 1 }] }],
        ['jsonPoints', { p: { x: 1 }, list: [] }],
      ] as const) {
        const validate = ajv.compile(body(`/${name}`))
        const json = JSON.parse(JSON.stringify(serializer.serializeJson(value).json))
        expect(validate(json) ? [] : [name, json, validate.errors]).toEqual([])
      }
    })
  })

  describe('round fifty', () => {
    it('documents inputs holding dates intersected with views of a date, and toJSON writing nothing', async () => {
      const spec = await generator.generate(roundFiftyInputs, {
        source: { file: fixture('round50.ts'), export: 'roundFiftyInputs' },
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
      const body = (path: string) =>
        JSON.parse(
          JSON.stringify(
            (spec.paths as any)[path].post.requestBody.content['application/json'].schema,
          ).replaceAll('#/components/schemas/', 'spec#/$defs/'),
        )
      const serializer = new OpenAPIJsonSerializer()

      for (const [name, value] of [
        ['dateViewHolder', new DateViewHolder()],
        ['undefPoint', { p: new UndefPointImpl(), n: 1 }],
        ['undefPoint', { p: { x: 1 }, n: 1 }],
      ] as const) {
        const validate = ajv.compile(body(`/${name}`))
        const json = JSON.parse(JSON.stringify(serializer.serializeJson(value).json))
        expect(validate(json) ? [] : [name, json, validate.errors]).toEqual([])
      }

      // a view of the date adds no `toJSON` to it
      const { dr, dp, dg } = (spec.components?.schemas as any)[
        body('/dateViewHolder').$ref.replace('spec#/$defs/', '')
      ].properties
      expect(dr).toEqual({ 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' })
      expect(dp).toEqual(dg)
    })
  })
})

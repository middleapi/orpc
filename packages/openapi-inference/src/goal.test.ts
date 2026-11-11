import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { OpenAPIJsonSerializer } from '@orpc/openapi'
import { call } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { Ajv2020 } from 'ajv/dist/2020.js'

import { router } from '../tests/fixtures/goal/src/router'
import { OpenAPIGenerator } from './index'

/**
 * The package's goal end to end, as a user's app uses it: a project with `@/` paths, a converter,
 * procedures without `.output`, complex types, and every OpenAPI version.
 */
describe('goal', async () => {
  const fixture = new URL('../tests/fixtures/goal/', import.meta.url)
  const source = { file: new URL('src/router.ts', fixture) }
  const generator = new OpenAPIGenerator({ converters: [new ZodToJsonSchemaConverter()] })

  // plain JSON, as the document is served
  const generate = async (version: '3.2.0' | '3.1.1' | '3.0.4'): Promise<any> =>
    JSON.parse(JSON.stringify(await generator.generate(router, { source, version })))

  const spec = await generate('3.2.0')
  const versions = { '3.1.1': await generate('3.1.1'), '3.0.4': await generate('3.0.4') }

  const operation = (doc: any, name: string) => doc.paths[`/${name}`].post
  const body = (name: string) =>
    operation(spec, name).requestBody.content['application/json'].schema
  const json = (name: string) =>
    operation(spec, name).responses['200'].content['application/json'].schema
  const component = (name: string) => spec.components.schemas[name]

  it('is a separate package on the TypeScript 7 API, importing only its dependencies', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.name).toBe('@orpc/experimental-openapi-inference')
    expect(pkg.dependencies.typescript).toMatch(/^~7\./)

    const directory = fileURLToPath(new URL('.', import.meta.url))
    const imports = new Set<string>()
    for (const file of readdirSync(directory).filter((name) => !name.includes('.test'))) {
      const code = readFileSync(path.join(directory, file), 'utf8')
      for (const [, specifier] of code.matchAll(
        /^(?:import|export)\b[^'{}\n]*(?:\{[^}]*\}[^'\n]*)?from '([^'.][^']*)'/gmu,
      )) {
        // the package name: `@scope/name` or `name`
        imports.add(specifier!.split('/', specifier!.startsWith('@') ? 2 : 1).join('/'))
      }
    }

    expect(imports).toContain('typescript')
    expect(
      [...imports].filter((name) => !name.startsWith('node:') && !(name in pkg.dependencies)),
    ).toEqual([])
    expect(
      readFileSync(new URL('./project.ts', import.meta.url), 'utf8').includes(
        "from 'typescript/unstable/sync'",
      ),
    ).toBe(true)
  })

  it('documents procedures without .output and inputs of type<...>()', () => {
    expect(json('me')).toEqual({ $ref: '#/components/schemas/User' })
    expect(operation(spec, 'me').summary).toBe('Find the current user')
    expect(Object.keys(component('User').properties)).toEqual([
      'id',
      'name',
      'role',
      'score',
      'nickname',
      'location',
      'createdAt',
    ])

    expect(body('createUser')).toEqual({ $ref: '#/components/schemas/CreateUserInput' })
    expect(component('CreateUserInput').required).toEqual([
      'name',
      'role',
      'score',
      'nickname',
      'location',
    ])
  })

  it('uses converters for the schemas they support and infers the rest', () => {
    // converted input, inferred output in one procedure
    expect(body('greet')).toEqual({
      type: 'object',
      properties: { name: { type: 'string', minLength: 2 } },
      required: ['name'],
    })
    expect(json('greet')).toEqual({
      type: 'object',
      properties: {
        greeting: { type: 'string' },
        at: { 'type': 'string', 'format': 'date-time', 'x-native-type': 'date' },
      },
      required: ['greeting', 'at'],
    })

    // a fully converted procedure next to inferred ones
    expect(body('echo').properties.text).toEqual({ type: 'string', maxLength: 10 })
    expect(json('echo').additionalProperties).toBe(false)
  })

  it('downgrades to OpenAPI 3.1', () => {
    const doc = versions['3.1.1']
    expect(doc.openapi).toBe('3.1.1')
    expect({ ...doc, openapi: '3.2.0' }).toEqual(spec)
    expect(doc.components.schemas.User.properties.score).toEqual({
      type: 'number',
      description: 'Reputation',
      exclusiveMinimum: 0,
      examples: [4.5],
    })
  })

  it('downgrades to OpenAPI 3.0', () => {
    const doc = versions['3.0.4']
    expect(doc.openapi).toBe('3.0.4')

    const user = doc.components.schemas.User.properties
    expect(user.nickname).toEqual({ type: 'string', nullable: true })
    expect(user.score).toEqual({
      type: 'number',
      description: 'Reputation',
      minimum: 0,
      exclusiveMinimum: true,
      example: 4.5,
    })
    expect(user.location).toEqual({
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2,
    })

    const text = JSON.stringify(doc)
    for (const keyword of ['"prefixItems"', '"const"', '"examples"', '"type":"null"', '"type":[']) {
      expect(text).not.toContain(keyword)
    }
  })

  it.each(['3.2.0', '3.1.1'] as const)('writes valid JSON Schema 2020-12 for %s', (version) => {
    const doc = version === '3.2.0' ? spec : versions[version]
    const ajv = new Ajv2020({
      strict: true,
      strictTypes: false,
      keywords: ['x-native-type', 'discriminator'],
      formats: { 'date-time': true },
    })

    expect(() =>
      ajv.compile(
        JSON.parse(
          JSON.stringify({ $defs: doc.components.schemas }).replaceAll(
            '#/components/schemas/',
            '#/$defs/',
          ),
        ),
      ),
    ).not.toThrow()
  })

  it("resolves '@/' paths in nested imports and through barrels", async () => {
    // router.ts -> '@/models' (a barrel) -> ./user -> '@/lib/ids' -> '@/lib/brand'
    expect(component('User').properties.id).toEqual({ type: 'string' })
    expect(component('Role')).toEqual({ type: 'string', enum: ['admin', 'member'] })

    // the same project without its paths can not resolve them
    const directory = mkdtempSync(path.join(tmpdir(), 'orpc-goal-'))
    try {
      const tsconfig = JSON.parse(readFileSync(new URL('tsconfig.json', fixture), 'utf8'))
      delete tsconfig.compilerOptions.paths
      tsconfig.include = [fileURLToPath(new URL('src', fixture))]
      writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify(tsconfig))

      await expect(
        generator.generate(router, { source: { ...source, tsconfig: directory } }),
      ).rejects.toThrow('Procedure at me: Could not resolve the type "User"')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('documents complex types', () => {
    const showcase = component('Showcase').properties

    // discriminated unions, recursive and generic types
    expect(component('Shape').discriminator).toEqual({
      propertyName: 'kind',
      mapping: { circle: '#/components/schemas/Circle', rect: '#/components/schemas/Rect' },
    })
    expect(component('Category').properties.children.items).toEqual({
      $ref: '#/components/schemas/Category',
    })
    expect(showcase.page).toEqual({ $ref: '#/components/schemas/Page_Shape' })

    // template literals, type-fest, key remapping and conditional types
    expect(showcase.event).toEqual({ type: 'string', enum: ['onClick', 'onHover'] })
    expect(showcase.slug.pattern).toMatch(/^\^user-/)
    expect(showcase.patch.required).toBeUndefined()
    expect(showcase.patch.properties.theme.required).toBeUndefined()
    expect(showcase.frozen.properties.theme.required).toEqual(['color', 'dark'])
    expect(showcase.flat.required).toEqual(['a', 'b'])
    expect(component('Getters_version_label').required).toEqual(['getLabel', 'getVersion'])
    expect(showcase.unwrapped).toEqual({ type: 'number' })

    // built-ins, and classes as JSON.stringify writes them
    const natives = json('natives').properties
    expect(natives.big['x-native-type']).toBe('bigint')
    expect(natives.tags['x-native-type']).toBe('set')
    expect(natives.scores['x-native-type']).toBe('map')
    expect(natives.money).toEqual({ type: 'string' })
    expect(component('Account').properties.balance).toEqual({ type: 'string' })

    const stream = operation(spec, 'events').responses['200'].content['text/event-stream'].schema
    expect(stream.oneOf.map((member: any) => member.properties.event.const)).toEqual([
      'message',
      'close',
      'error',
    ])
  })

  it.each(['3.2.0', '3.1.1'] as const)(
    'validates real serialized outputs against the %s schemas',
    async (version) => {
      const doc = version === '3.2.0' ? spec : versions[version]
      const ajv = new Ajv2020({
        strict: false,
        allErrors: true,
        formats: { 'date-time': (value: string) => !Number.isNaN(Date.parse(value)) },
      })
      const local = (schema: unknown) =>
        JSON.parse(JSON.stringify(schema).replaceAll('#/components/schemas/', 'spec#/$defs/'))
      ajv.addSchema(local({ $id: 'spec', $defs: doc.components.schemas }))

      const serializer = new OpenAPIJsonSerializer()
      const serialize = (value: unknown) =>
        JSON.parse(JSON.stringify(serializer.serializeJson(value).json) ?? 'null')
      const expectValid = (schema: unknown, value: unknown) => {
        const validate = ajv.compile(local(schema))
        expect(validate(value), ajv.errorsText(validate.errors)).toBe(true)
      }

      const inputs = {
        me: undefined,
        createUser: { name: 'Bob', role: 'member', score: 1, nickname: 'b', location: [0, 0] },
        greet: { name: 'Bob' },
        echo: { text: 'hi' },
        complex: undefined,
        natives: undefined,
      } as const

      for (const [name, input] of Object.entries(inputs)) {
        if (input !== undefined) {
          expectValid(operation(doc, name).requestBody.content['application/json'].schema, input)
        }
        expectValid(
          operation(doc, name).responses['200'].content['application/json'].schema,
          serialize(await call(router[name as keyof typeof inputs] as any, input)),
        )
      }

      const [message, close] = operation(doc, 'events').responses['200'].content[
        'text/event-stream'
      ].schema.oneOf
      const iterator = await call(router.events, undefined)
      let next = await iterator.next()
      while (!next.done) {
        expectValid(message.properties.data, serialize(next.value))
        next = await iterator.next()
      }
      expectValid(close.properties.data, serialize(next.value))
    },
  )
})

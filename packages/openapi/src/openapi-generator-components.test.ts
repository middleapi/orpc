import type { JsonSchema } from '@orpc/json-schema'
import type { OpenAPIDocument } from './types'
import { OpenAPIComponentRegistry } from './openapi-generator-components'

describe('openAPIComponentRegistry', () => {
  function createRegistry(options: {
    schemas?: Record<string, any>
    shouldHoistDef?: (defName: string, defSchema: JsonSchema) => boolean
  } = {}) {
    const doc: OpenAPIDocument = {
      openapi: '3.1.2',
      info: { title: 'API Reference', version: '0.0.0' },
      ...(options.schemas ? { components: { schemas: options.schemas } } : {}),
    }

    return { doc, registry: new OpenAPIComponentRegistry(doc, options.shouldHoistDef) }
  }

  describe('hoistDefs', () => {
    it('returns schemas without root $defs unchanged', () => {
      const { doc, registry } = createRegistry()

      expect(registry.hoistDefs(true)).toBe(true)
      expect(registry.hoistDefs({ type: 'string' })).toEqual({ type: 'string' })
      expect(doc.components).toBeUndefined()
    })

    it('hoists defs into components and rewrites refs', () => {
      const { doc, registry } = createRegistry()

      const result = registry.hoistDefs({
        type: 'object',
        properties: { planet: { $ref: '#/$defs/Planet' } },
        $defs: { Planet: { type: 'string' } },
      })

      expect(result).toEqual({
        type: 'object',
        properties: { planet: { $ref: '#/components/schemas/Planet' } },
      })
      expect(doc.components?.schemas).toEqual({
        Planet: { type: 'string' },
      })
    })

    it('supports JSON Pointer encoded def names', () => {
      const { doc, registry } = createRegistry()

      const result = registry.hoistDefs({
        type: 'object',
        properties: { planet: { $ref: '#/$defs/domain~1Planet' } },
        $defs: { 'domain/Planet': { type: 'string' } },
      })

      expect(result).toEqual({
        type: 'object',
        properties: { planet: { $ref: '#/components/schemas/domain~1Planet' } },
      })
      expect(doc.components?.schemas).toEqual({
        'domain/Planet': { type: 'string' },
      })
    })

    it('normalizes boolean defs and skips undefined defs', () => {
      const { doc, registry } = createRegistry()

      registry.hoistDefs({
        $defs: {
          Anything: true,
          Nothing: false,
          Ghost: undefined,
        },
      } as any)

      expect(doc.components?.schemas).toEqual({
        Anything: {},
        Nothing: { not: {} },
      })
    })

    it('keeps every def local when shouldHoistDef always returns false', () => {
      const { doc, registry } = createRegistry({ shouldHoistDef: () => false })

      const schema = {
        $ref: '#/$defs/Planet',
        $defs: { Planet: { type: 'string' as const } },
      }

      expect(registry.hoistDefs(schema)).toBe(schema)
      expect(doc.components).toBeUndefined()
    })

    it('force-hoists local defs referenced by hoisted defs and drops unreferenced ones', () => {
      const { doc, registry } = createRegistry({ shouldHoistDef: name => name === 'Root' })

      const result = registry.hoistDefs({
        $ref: '#/$defs/Root',
        $defs: {
          Root: { type: 'object', properties: { child: { $ref: '#/$defs/Local' } } },
          Local: { type: 'string' },
          Unreferenced: { type: 'number' },
        },
      })

      expect(result).toEqual({ $ref: '#/components/schemas/Root' })
      expect(doc.components?.schemas).toEqual({
        Root: { type: 'object', properties: { child: { $ref: '#/components/schemas/Local' } } },
        Local: { type: 'string' },
      })
    })

    it('attaches local defs referenced only from the remaining schema', () => {
      const { doc, registry } = createRegistry({ shouldHoistDef: name => name !== 'Alias' })

      const result = registry.hoistDefs({
        $ref: '#/$defs/Alias',
        $defs: {
          Planet: { type: 'object', properties: { id: { $ref: '#/$defs/Id' } }, required: ['id'] },
          Id: { type: 'string' },
          Alias: { $ref: '#/$defs/Planet' },
        },
      })

      expect(result).toEqual({
        $ref: '#/$defs/Alias',
        $defs: {
          Alias: { $ref: '#/components/schemas/Planet' },
        },
      })
      expect(doc.components?.schemas).toEqual({
        Planet: { type: 'object', properties: { id: { $ref: '#/components/schemas/Id' } }, required: ['id'] },
        Id: { type: 'string' },
      })
    })

    it('leaves dangling local refs untouched', () => {
      const { doc, registry } = createRegistry()

      registry.hoistDefs({
        $ref: '#/$defs/Holder',
        $defs: {
          Holder: { type: 'object', properties: { x: { $ref: '#/$defs/Missing' } } },
        },
      })

      expect(doc.components?.schemas).toEqual({
        Holder: { type: 'object', properties: { x: { $ref: '#/$defs/Missing' } } },
      })
    })
  })

  describe('component reuse', () => {
    it('reuses an equal existing component with the same name', () => {
      const planet = {
        type: 'object' as const,
        properties: { id: { type: 'string' as const } },
        required: ['id'],
      }
      const { doc, registry } = createRegistry({ schemas: { Planet: structuredClone(planet) } })

      const result = registry.hoistDefs({
        $ref: '#/$defs/Planet',
        $defs: { Planet: structuredClone(planet) },
      })

      expect(result).toEqual({ $ref: '#/components/schemas/Planet' })
      expect(doc.components?.schemas).toEqual({ Planet: planet })
    })

    it('reuses an equal existing component under a different name', () => {
      const { doc, registry } = createRegistry({ schemas: { Existing: { type: 'string' } } })

      const result = registry.hoistDefs({
        $ref: '#/$defs/Renamed',
        $defs: { Renamed: { type: 'string' } },
      })

      expect(result).toEqual({ $ref: '#/components/schemas/Existing' })
      expect(doc.components?.schemas).toEqual({ Existing: { type: 'string' } })
    })

    it('ignores undefined-valued keys when comparing schemas', () => {
      const { doc, registry } = createRegistry({ schemas: { Message: { type: 'string' } } })

      const result = registry.hoistDefs({
        $ref: '#/$defs/Message',
        $defs: { Message: { type: 'string', default: undefined } },
      })

      expect(result).toEqual({ $ref: '#/components/schemas/Message' })
      expect(doc.components?.schemas).toEqual({ Message: { type: 'string' } })
    })

    it('reuses components containing dangling local refs by exact ref equality', () => {
      const holder = {
        type: 'object' as const,
        properties: { x: { $ref: '#/$defs/Missing' } },
      }
      const { doc, registry } = createRegistry({ schemas: { Holder: structuredClone(holder) } })

      const result = registry.hoistDefs({
        $ref: '#/$defs/Holder',
        $defs: { Holder: structuredClone(holder) },
      })

      expect(result).toEqual({ $ref: '#/components/schemas/Holder' })
      expect(Object.keys(doc.components?.schemas ?? {})).toEqual(['Holder'])
    })

    it('compares refs against nested local defs when reusing components', () => {
      const wrapped = {
        type: 'object' as const,
        properties: { x: { $ref: '#/$defs/Inner' } },
        $defs: { Inner: { type: 'string' as const } },
      }
      const { doc, registry } = createRegistry({ schemas: { Wrapped: structuredClone(wrapped) } })

      const result = registry.hoistDefs({
        $ref: '#/$defs/Wrapped',
        $defs: { Wrapped: structuredClone(wrapped) },
      })

      expect(result).toEqual({ $ref: '#/components/schemas/Wrapped' })
      expect(Object.keys(doc.components?.schemas ?? {})).toEqual(['Wrapped'])
    })

    it('compares refs to components hoisted in earlier calls by exact ref equality', () => {
      const { doc, registry } = createRegistry()

      registry.hoistDefs({ $ref: '#/$defs/Data', $defs: { Data: { type: 'string' } } })

      const wrapper = {
        $ref: '#/$defs/Wrapper',
        $defs: {
          Wrapper: {
            type: 'object' as const,
            properties: { data: { $ref: '#/components/schemas/Data' } },
          },
        },
      }

      expect(registry.hoistDefs(structuredClone(wrapper))).toEqual({ $ref: '#/components/schemas/Wrapper' })
      expect(registry.hoistDefs(structuredClone(wrapper))).toEqual({ $ref: '#/components/schemas/Wrapper' })
      expect(Object.keys(doc.components?.schemas ?? {}).sort()).toEqual(['Data', 'Wrapper'])
    })

    it('handles shared subschema instances during traversal and comparison', () => {
      const sharedDefault = { unit: 'km' }
      const sharedRef = { $ref: '#/$defs/Leaf' }

      const { doc, registry } = createRegistry({
        schemas: {
          Leaf: { type: 'string' },
          Pair: {
            type: 'object',
            properties: {
              a: { type: 'number', default: { unit: 'km' } },
              b: { type: 'number', default: { unit: 'km' } },
              c: { $ref: '#/components/schemas/Leaf' },
              d: { $ref: '#/components/schemas/Leaf' },
            },
          },
        },
      })

      const result = registry.hoistDefs({
        $ref: '#/$defs/Pair',
        $defs: {
          Leaf: { type: 'string' },
          Pair: {
            type: 'object',
            properties: {
              a: { type: 'number', default: sharedDefault },
              b: { type: 'number', default: sharedDefault },
              c: sharedRef,
              d: sharedRef,
            },
          },
        },
      })

      expect(result).toEqual({ $ref: '#/components/schemas/Pair' })
      expect(Object.keys(doc.components?.schemas ?? {}).sort()).toEqual(['Leaf', 'Pair'])
    })
  })

  describe('name conflicts', () => {
    it('adds a numbered postfix when the name maps to a different schema', () => {
      const { doc, registry } = createRegistry({ schemas: { Planet: { type: 'string' } } })

      const result = registry.hoistDefs({
        $ref: '#/$defs/Planet',
        $defs: { Planet: { type: 'number' } },
      })

      expect(result).toEqual({ $ref: '#/components/schemas/Planet2' })
      expect(doc.components?.schemas).toEqual({
        Planet: { type: 'string' },
        Planet2: { type: 'number' },
      })
    })

    it('increments the postfix until a free component name is found', () => {
      const { doc, registry } = createRegistry({
        schemas: {
          Planet: { type: 'string' },
          Planet2: { type: 'number' },
        },
      })

      const result = registry.hoistDefs({
        $ref: '#/$defs/Planet',
        $defs: { Planet: { type: 'boolean' } },
      })

      expect(result).toEqual({ $ref: '#/components/schemas/Planet3' })
      expect(doc.components?.schemas?.Planet3).toEqual({ type: 'boolean' })
    })

    it.each([
      {
        name: 'nested values have different types',
        existing: { type: 'object', default: 'text' },
        candidate: { type: 'object', default: 5 },
      },
      {
        name: 'a nested value is null on one side only',
        existing: { type: 'object', default: {} },
        candidate: { type: 'object', default: null },
      },
      {
        name: 'nested arrays have different lengths',
        existing: { type: 'string', enum: ['a'] },
        candidate: { type: 'string', enum: ['a', 'b'] },
      },
      {
        name: 'dangling local refs differ',
        existing: { $ref: '#/$defs/X' },
        candidate: { $ref: '#/$defs/Y' },
      },
    ])('does not reuse when $name', ({ existing, candidate }) => {
      const { doc, registry } = createRegistry({ schemas: { Schema: existing } })

      const result = registry.hoistDefs({
        $ref: '#/$defs/Schema',
        $defs: { Schema: candidate as any },
      })

      expect(result).toEqual({ $ref: '#/components/schemas/Schema2' })
      expect(doc.components?.schemas?.Schema2).toEqual(candidate)
    })

    it('does not reuse a component when a component ref faces a local ref', () => {
      const { doc, registry } = createRegistry({
        schemas: {
          Wrapped: {
            type: 'object',
            properties: { x: { $ref: '#/$defs/Inner' } },
            $defs: { Inner: { type: 'string' } },
          },
        },
      })

      const result = registry.hoistDefs({
        $ref: '#/$defs/Wrapped',
        $defs: {
          Inner: { type: 'string' },
          Wrapped: {
            type: 'object',
            properties: { x: { $ref: '#/$defs/Inner' } },
            $defs: { Inner: { type: 'string' } },
          },
        },
      })

      expect(result).toEqual({ $ref: '#/components/schemas/Wrapped2' })
      expect(doc.components?.schemas?.Wrapped2).toEqual(expect.objectContaining({
        properties: { x: { $ref: '#/components/schemas/Inner' } },
      }))
    })

    it('distinguishes a self-recursive schema from mutually recursive components', () => {
      const { doc, registry } = createRegistry({
        schemas: {
          NodeA: { type: 'object', properties: { next: { $ref: '#/components/schemas/NodeB' } } },
          NodeB: { type: 'object', properties: { next: { $ref: '#/components/schemas/NodeA' } } },
        },
      })

      const result = registry.hoistDefs({
        $ref: '#/$defs/NodeA',
        $defs: {
          NodeA: { type: 'object', properties: { next: { $ref: '#/$defs/NodeA' } } },
        },
      })

      expect(result).toEqual({ $ref: '#/components/schemas/NodeA2' })
      expect(doc.components?.schemas?.NodeA2).toEqual({
        type: 'object',
        properties: { next: { $ref: '#/components/schemas/NodeA2' } },
      })
    })

    it('distinguishes mutually recursive schemas from a self-recursive component', () => {
      const { doc, registry } = createRegistry({
        schemas: {
          Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Node' } } },
        },
      })

      const result = registry.hoistDefs({
        $ref: '#/$defs/NodeX',
        $defs: {
          NodeX: { type: 'object', properties: { next: { $ref: '#/$defs/NodeY' } } },
          NodeY: { type: 'object', properties: { next: { $ref: '#/$defs/NodeX' } } },
        },
      })

      expect(result).toEqual({ $ref: '#/components/schemas/NodeX' })
      expect(doc.components?.schemas?.NodeX).toEqual({
        type: 'object',
        properties: { next: { $ref: '#/components/schemas/NodeY' } },
      })
      expect(doc.components?.schemas?.NodeY).toEqual({
        type: 'object',
        properties: { next: { $ref: '#/components/schemas/NodeX' } },
      })
    })
  })

  describe('register', () => {
    it('registers a schema and returns a component ref', () => {
      const { doc, registry } = createRegistry()

      const result = registry.register('Planet', { type: 'object', properties: { id: { type: 'string' } } })

      expect(result).toEqual({ $ref: '#/components/schemas/Planet' })
      expect(doc.components?.schemas).toEqual({
        Planet: { type: 'object', properties: { id: { type: 'string' } } },
      })
    })

    it('reuses equivalent registrations', () => {
      const { doc, registry } = createRegistry()

      const first = registry.register('Planet', { type: 'object' })
      const second = registry.register('Planet', { type: 'object' })

      expect(first).toEqual({ $ref: '#/components/schemas/Planet' })
      expect(second).toEqual(first)
      expect(Object.keys(doc.components?.schemas ?? {})).toEqual(['Planet'])
    })

    it('keeps the registered name unique among the schema own local defs', () => {
      const { doc, registry } = createRegistry()

      const result = registry.register('Planet', {
        type: 'object',
        properties: { nested: { $ref: '#/$defs/Planet' } },
        $defs: { Planet: { type: 'string' } },
      })

      expect(result).toEqual({ $ref: '#/components/schemas/Planet2' })
      expect(doc.components?.schemas).toEqual({
        Planet: { type: 'string' },
        Planet2: {
          type: 'object',
          properties: { nested: { $ref: '#/components/schemas/Planet' } },
        },
      })
    })

    it('returns the local $defs form when hoisting is declined', () => {
      const { doc, registry } = createRegistry({ shouldHoistDef: () => false })

      const result = registry.register('Planet', { type: 'object' })

      expect(result).toEqual({
        $ref: '#/$defs/Planet',
        $defs: { Planet: { type: 'object' } },
      })
      expect(doc.components).toBeUndefined()
    })
  })

  describe('toOpenAPISchema', () => {
    it('normalizes boolean schemas into objects', () => {
      const { registry } = createRegistry()

      expect(registry.toOpenAPISchema(true)).toEqual({})
      expect(registry.toOpenAPISchema(false)).toEqual({ not: {} })
    })

    it('hoists defs before returning the schema', () => {
      const { doc, registry } = createRegistry()

      expect(registry.toOpenAPISchema({
        type: 'object',
        properties: { planet: { $ref: '#/$defs/Planet' } },
        $defs: { Planet: { type: 'string' } },
      })).toEqual({
        type: 'object',
        properties: { planet: { $ref: '#/components/schemas/Planet' } },
      })
      expect(doc.components?.schemas).toEqual({ Planet: { type: 'string' } })
    })
  })
})

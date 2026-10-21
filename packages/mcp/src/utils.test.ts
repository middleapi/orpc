import type { JsonSchemaConverter } from '@orpc/json-schema'
import { asyncIteratorObject, type } from '@orpc/contract'
import { z } from 'zod'
import { resolveToolInput, resolveToolInputJsonSchema, resolveToolOutputJsonSchema, toPassthroughStandardSchema } from './utils'

function createConverter(...results: [any, boolean][]): JsonSchemaConverter {
  let index = 0

  return {
    condition: () => true,
    convert: () => results[index++ % results.length]!,
  }
}

describe('resolveToolInputJsonSchema', () => {
  it('describes an empty object without input schemas', () => {
    expect(resolveToolInputJsonSchema(createConverter(), [])).toEqual({
      jsonSchema: { type: 'object', properties: {} },
      wrapped: false,
      emptyAsUndefined: false,
    })
  })

  it('keeps object schemas and strips $schema', () => {
    const converter = createConverter([{ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' }, false])

    expect(resolveToolInputJsonSchema(converter, [type()])).toEqual({
      jsonSchema: { type: 'object' },
      wrapped: false,
      emptyAsUndefined: false,
    })
  })

  it.each([
    [{ type: 'object' }, false],
    [{ type: 'string' }, true],
    [true, false],
    [{ $ref: '#/$defs/object', $defs: { object: { type: 'object' } } }, false],
    [{ $ref: '#/$defs/string', $defs: { string: { type: 'string' } } }, true],
  ])('nests %j under `input`: %s', (jsonSchema, wrapped) => {
    expect(resolveToolInputJsonSchema(createConverter([jsonSchema, false]), [type()]).wrapped).toBe(wrapped)
  })

  it('leaves unconstrained schemas for the MCP SDK to type as objects', () => {
    expect(resolveToolInputJsonSchema(createConverter([true, true]), [type()]).jsonSchema).toEqual({})
    expect(resolveToolInputJsonSchema(createConverter([{ description: 'any' }, true]), [type()]).jsonSchema).toEqual({ description: 'any' })
  })

  it('nests other schemas under `input`, required unless optional', () => {
    expect(resolveToolInputJsonSchema(createConverter([{ type: 'string' }, false]), [type()])).toEqual({
      jsonSchema: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
      wrapped: true,
      emptyAsUndefined: false,
    })

    expect(resolveToolInputJsonSchema(createConverter([{ type: 'string' }, true]), [type()]).jsonSchema).toEqual({
      type: 'object',
      properties: { input: { type: 'string' } },
    })
  })

  it('moves defs to the root and rewrites root refs when nesting', () => {
    const converter = createConverter([{
      type: 'array',
      items: { $ref: '#' },
      $defs: { other: { type: 'string' } },
    }, false])

    expect(resolveToolInputJsonSchema(converter, [type()]).jsonSchema).toEqual({
      type: 'object',
      properties: { input: { $ref: '#/$defs/__schema0' } },
      required: ['input'],
      $defs: {
        other: { type: 'string' },
        __schema0: { type: 'array', items: { $ref: '#/$defs/__schema0' } },
      },
    })
  })

  it('combines multiple schemas with allOf', () => {
    const converter = createConverter([{ type: 'object', required: ['a'] }, false], [{ type: 'object', required: ['b'] }, true])

    expect(resolveToolInputJsonSchema(converter, [type(), type()])).toEqual({
      jsonSchema: { allOf: [{ type: 'object', required: ['a'] }, { type: 'object', required: ['b'] }] },
      wrapped: false,
      emptyAsUndefined: false,
    })
  })

  it('ignores unconstrained schemas when combining', () => {
    const converter = createConverter([{ type: 'object', required: ['a'] }, false], [{ description: 'no JSON Schema' }, true])

    expect(resolveToolInputJsonSchema(converter, [type(), type()]).jsonSchema).toEqual({ type: 'object', required: ['a'] })
    expect(resolveToolInputJsonSchema(createConverter([{}, true]), [type(), type()]).jsonSchema).toEqual({})
  })

  it('treats combined schemas as optional only when every schema is optional', () => {
    const optional = createConverter([{ type: 'string' }, true], [{ minLength: 1 }, true])
    expect(resolveToolInputJsonSchema(optional, [type(), type()]).jsonSchema.required).toBeUndefined()

    const required = createConverter([{ type: 'string' }, true], [{ minLength: 1 }, false])
    expect(resolveToolInputJsonSchema(required, [type(), type()]).jsonSchema.required).toEqual(['input'])
  })
})

describe('resolveToolOutputJsonSchema', () => {
  it('returns undefined without output schemas', () => {
    expect(resolveToolOutputJsonSchema(createConverter(), [])).toBeUndefined()
  })

  it('returns the converted schema', () => {
    expect(resolveToolOutputJsonSchema(createConverter([{ type: 'array' }, false]), [type()])).toEqual({ type: 'array' })
  })

  it.each([
    ['optional', [{ type: 'object' }, true]],
    ['unconstrained', [{}, false]],
    ['binary', [{ type: 'string', contentMediaType: 'image/png' }, false]],
    ['possibly binary', [{ anyOf: [{ type: 'object' }, { type: 'string', contentMediaType: 'image/png' }] }, false]],
    ['intersected binary', [{ allOf: [{ type: 'string' }, { type: 'string', contentMediaType: 'image/png' }] }, false]],
    ['referenced binary', [{ $ref: '#/$defs/Image', $defs: { Image: { type: 'string', contentMediaType: 'image/png' } } }, false]],
    ['nested binary', [{ type: 'object', properties: { image: { type: 'string', contentMediaType: 'image/png' } } }, false]],
  ] as const)('returns undefined for %s outputs', (_, result) => {
    expect(resolveToolOutputJsonSchema(createConverter(result as any), [type()])).toBeUndefined()
  })

  it('uses yield schemas when every output schema describes an async iterator', () => {
    const convert = vi.fn((): [any, boolean] => [{ type: 'object' }, false])
    const converter = { condition: () => true, convert }

    const yieldSchema = z.object({ status: z.string() })
    resolveToolOutputJsonSchema(converter, [asyncIteratorObject(yieldSchema)])
    expect(convert).toHaveBeenLastCalledWith(yieldSchema, 'output')

    const iterator = asyncIteratorObject(yieldSchema)
    const other = z.object({})
    resolveToolOutputJsonSchema(converter, [iterator, other])
    expect(convert).toHaveBeenNthCalledWith(2, iterator, 'output')
    expect(convert).toHaveBeenNthCalledWith(3, other, 'output')
  })
})

describe('resolveToolInput', () => {
  it('passes arguments through', () => {
    const inputJsonSchema = resolveToolInputJsonSchema(createConverter([{ type: 'object' }, false]), [type()])
    const args = { id: 1 }

    expect(resolveToolInput(args, inputJsonSchema)).toBe(args)
  })

  it('unwraps nested inputs', () => {
    const inputJsonSchema = resolveToolInputJsonSchema(createConverter([{ type: 'string' }, true]), [type()])

    expect(resolveToolInput({ input: 'Earth' }, inputJsonSchema)).toBe('Earth')
    expect(resolveToolInput({}, inputJsonSchema)).toBeUndefined()
    expect(resolveToolInput(undefined, inputJsonSchema)).toBeUndefined()
  })
})

describe('resolveToolInput empty arguments', () => {
  const objectConverter = createConverter([{ type: 'object' }, true])

  it('passes no input for empty arguments when every input schema accepts undefined and one rejects an object', () => {
    expect(resolveToolInput({}, resolveToolInputJsonSchema(objectConverter, [z.void()]))).toBeUndefined()
    expect(resolveToolInput({}, resolveToolInputJsonSchema(objectConverter, [z.void().or(z.object({ id: z.number() }))]))).toBeUndefined()
    expect(resolveToolInput({ id: 1 }, resolveToolInputJsonSchema(objectConverter, [z.void()]))).toEqual({ id: 1 })
  })

  it('keeps empty arguments for inputs accepting an object or validating asynchronously', () => {
    expect(resolveToolInput({}, resolveToolInputJsonSchema(objectConverter, [type()]))).toEqual({})
    expect(resolveToolInput({}, resolveToolInputJsonSchema(objectConverter, [z.any()]))).toEqual({})
    expect(resolveToolInput({}, resolveToolInputJsonSchema(objectConverter, [z.object({}).optional()]))).toEqual({})
    expect(resolveToolInput({}, resolveToolInputJsonSchema(objectConverter, [z.void().refine(async () => true)]))).toEqual({})

    // accepts undefined, but cannot tell synchronously whether it rejects an object
    const probe = (onObject: () => any) => ({
      '~standard': { vendor: 'test', version: 1, validate: (value: unknown) => value === undefined ? { value } : onObject() },
    } as const)
    expect(resolveToolInput({}, resolveToolInputJsonSchema(objectConverter, [probe(async () => ({ issues: [] }))]))).toEqual({})
    expect(resolveToolInput({}, resolveToolInputJsonSchema(objectConverter, [probe(() => {
      throw new Error('boom')
    })]))).toEqual({})
  })
})

it('toPassthroughStandardSchema', async () => {
  const schema = toPassthroughStandardSchema({ type: 'object' })

  const value = { anything: true }
  expect(await schema['~standard'].validate(value)).toEqual({ value })
  expect(schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toEqual({ type: 'object' })
  expect(schema['~standard'].jsonSchema.output({ target: 'draft-07' })).toEqual({ type: 'object' })
})

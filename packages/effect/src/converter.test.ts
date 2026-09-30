import * as Effect from 'effect'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { EffectSchemaToJsonSchemaConverter } from './converter'
import { toStandardSchema } from './schema'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('effectSchemaToJsonSchemaConverter', () => {
  const converter = new EffectSchemaToJsonSchemaConverter()

  describe('.condition', () => {
    it('returns true for effect schema', () => {
      expect(converter.condition(toStandardSchema(Effect.Schema.String), 'input')).toBe(true)
    })

    it('returns false for non-effect schema', () => {
      expect(converter.condition(z.string(), 'input')).toBe(false)
    })

    it('returns false for undefined schema', () => {
      expect(converter.condition(undefined, 'input')).toBe(false)
    })
  })

  describe('.convert', () => {
    it('converts effect schema to JSON schema', () => {
      const schema = toStandardSchema(Effect.Schema.String)
      const [jsonSchema, optional] = converter.convert(schema, 'input')
      expect(jsonSchema).toMatchObject({ type: 'string' })
      expect(optional).toBe(false)
    })

    it('uses standard json schema input and output generators', () => {
      const schema = toStandardSchema(Effect.Schema.NumberFromString)
      expect(converter.convert(schema, 'input')).toEqual([
        expect.objectContaining({ type: 'string' }),
        false,
      ])
      expect(converter.convert(schema, 'output')).toEqual([
        expect.objectContaining({
          anyOf: expect.arrayContaining([
            expect.objectContaining({ type: 'number' }),
          ]),
        }),
        false,
      ])
    })

    it('marks as optional if direction is input and schema accept undefined', () => {
      const [, optional1] = converter.convert(toStandardSchema(Effect.Schema.Unknown), 'input')
      expect(optional1).toBe(true)
    })

    it('marks as optional if direction is output and validated data is undefined', () => {
      const [, optional1] = converter.convert(toStandardSchema(Effect.Schema.Unknown), 'output')
      expect(optional1).toBe(true)
    })

    it('reads optionality from the encoded and decoded sides of a transformation', () => {
      const schema = toStandardSchema(Effect.Schema.UndefinedOr(Effect.Schema.String).pipe(
        Effect.Schema.decodeTo(Effect.Schema.String, Effect.SchemaTransformation.transform<string, string | undefined>({
          decode: value => value ?? 'fallback',
          encode: value => value,
        })),
      ))

      expect(converter.convert(schema, 'input')[1]).toBe(true)
      expect(converter.convert(schema, 'output')[1]).toBe(false)
    })

    it('does not run standard validation to check optionality', () => {
      const schema = toStandardSchema(Effect.Schema.Unknown)
      const validate = vi.fn(() => {
        throw new Error('test')
      })
      ;(schema as any)['~standard'].validate = validate

      const [jsonSchema, optional] = converter.convert(schema, 'input')
      expect(jsonSchema).toEqual(expect.any(Object))
      expect(optional).toBe(true)
      expect(validate).not.toHaveBeenCalled()
    })
  })
})

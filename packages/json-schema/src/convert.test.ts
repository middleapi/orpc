import type { AnySchema } from '@orpc/contract'
import type { JsonSchemaConverter } from './convert'
import * as v from 'valibot'
import z from 'zod'
import { DelegatingJsonSchemaConverter } from './convert'

describe('delegatingJsonSchemaConverter', () => {
  it('uses the first matching custom converter', () => {
    const schema = z.object({ value: z.string() })

    const firstConverter: JsonSchemaConverter = {
      condition: vi.fn().mockReturnValue(true),
      convert: vi.fn().mockReturnValue([{ type: 'string' }, false]),
    }

    const secondConverter: JsonSchemaConverter = {
      condition: vi.fn().mockReturnValue(true),
      convert: vi.fn().mockReturnValue([{ type: 'number' }, true]),
    }

    const converter = new DelegatingJsonSchemaConverter([firstConverter, secondConverter])

    expect(converter.convert(schema, 'input')).toEqual([{ type: 'string' }, false])
    expect(firstConverter.condition).toHaveBeenCalledWith(schema, 'input')
    expect(firstConverter.convert).toHaveBeenCalledWith(schema, 'input')
    expect(secondConverter.condition).not.toHaveBeenCalled()
    expect(secondConverter.convert).not.toHaveBeenCalled()
  })

  it('converts schemas using the standard json schema fallback behavior', () => {
    const converter = new DelegatingJsonSchemaConverter([])

    const schema = z.number().transform(String).pipe(z.string())
    expect(converter.convert(schema, 'input')).toEqual([
      expect.objectContaining({ type: 'number' }),
      false,
    ])
    expect(converter.convert(schema, 'output')).toEqual([
      expect.objectContaining({ type: 'string' }),
      false,
    ])

    const optionalSchema = v.optional(v.string())
    expect(converter.convert(optionalSchema, 'input')).toEqual([
      expect.objectContaining({ }),
      true,
    ])
    expect(converter.convert(optionalSchema, 'output')).toEqual([
      expect.objectContaining({ }),
      true,
    ])
  })

  it('returns an empty schema when ~standard does not expose jsonSchema', () => {
    const schema: AnySchema = {
      '~standard': {
        vendor: 'custom',
        version: 1,
        validate: vi.fn().mockReturnValue({}),
      },
    }

    const converter = new DelegatingJsonSchemaConverter([])

    expect(converter.convert(schema, 'input')).toEqual([{}, true])
  })

  it('treats schemas with async validation as required', () => {
    const schema: AnySchema = {
      '~standard': {
        vendor: 'custom',
        version: 1,
        validate: vi.fn().mockResolvedValue({}),
      },
    }

    const converter = new DelegatingJsonSchemaConverter([])

    expect(converter.convert(schema, 'input')).toEqual([{}, false])
  })
})

import type { AnySchema } from '@orpc/contract'
import type { JsonSchemaConverter } from './convert'
import * as v from 'valibot'
import z from 'zod'
import { DelegatingJsonSchemaConverter } from './convert'

describe('delegatingJsonSchemaConverter', () => {
  it('uses the first matching custom converter', async () => {
    const schema = z.object({ value: z.string() })

    const firstConverter: JsonSchemaConverter = {
      condition: vi.fn().mockResolvedValue(true),
      convert: vi.fn().mockResolvedValue([{ type: 'string' }, false]),
    }

    const secondConverter: JsonSchemaConverter = {
      condition: vi.fn().mockResolvedValue(true),
      convert: vi.fn().mockResolvedValue([{ type: 'number' }, true]),
    }

    const converter = new DelegatingJsonSchemaConverter([firstConverter, secondConverter])

    await expect(converter.convert(schema, 'input')).resolves.toEqual([{ type: 'string' }, false])
    expect(firstConverter.condition).toHaveBeenCalledWith(schema, 'input')
    expect(firstConverter.convert).toHaveBeenCalledWith(schema, 'input')
    expect(secondConverter.condition).not.toHaveBeenCalled()
    expect(secondConverter.convert).not.toHaveBeenCalled()
  })

  it('converts schemas using the standard json schema fallback behavior', async () => {
    const converter = new DelegatingJsonSchemaConverter([])

    const schema = z.number().transform(String).pipe(z.string())
    await expect(converter.convert(schema, 'input')).resolves.toEqual([
      expect.objectContaining({ type: 'number' }),
      false,
    ])
    await expect(converter.convert(schema, 'output')).resolves.toEqual([
      expect.objectContaining({ type: 'string' }),
      false,
    ])

    const optionalSchema = v.optional(v.string())
    await expect(converter.convert(optionalSchema, 'input')).resolves.toEqual([
      expect.objectContaining({ }),
      true,
    ])
    await expect(converter.convert(optionalSchema, 'output')).resolves.toEqual([
      expect.objectContaining({ }),
      true,
    ])
  })

  it('returns an empty schema when ~standard does not expose jsonSchema', async () => {
    const schema: AnySchema = {
      '~standard': {
        vendor: 'custom',
        version: 1,
        validate: vi.fn().mockResolvedValue({}),
      },
    }

    const converter = new DelegatingJsonSchemaConverter([])

    await expect(converter.convert(schema, 'input')).resolves.toEqual([{}, true])
  })
})

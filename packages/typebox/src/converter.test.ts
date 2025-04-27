import { Type } from '@sinclair/typebox'
import { z } from 'zod'
import { experimental_TypeBoxToJsonSchemaConverter as TypeBoxToJsonSchemaConverter } from './converter'

it('typeBoxToJsonSchemaConverter.convert', async () => {
  const converter = new TypeBoxToJsonSchemaConverter()
  expect(converter.convert(Type.String(), { strategy: 'input' })).toMatchObject([
    true,
    { type: 'string' },
  ])
  const convertedObjectSchema = converter.convert(Type.Object({ a: Type.String() }), { strategy: 'input' })
  expect(convertedObjectSchema).toMatchObject([
    true,
    {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
    },
  ])
})

it('typeBoxToJsonSchemaConverter.condition', async () => {
  const converter = new TypeBoxToJsonSchemaConverter()
  // Positive cases: TypeBox schemas (with the vendor tag)
  expect(converter.condition(Type.String())).toBe(true)
  expect(converter.condition(Type.Optional(Type.String()))).toBe(true)
  expect(converter.condition(Type.Object({ name: Type.String() }))).toBe(true)

  // Negative cases: Zod schemas or plain objects without the tag/structure
  expect(converter.condition(z.string())).toBe(false)
  expect(converter.condition(z.string().optional())).toBe(false)
  expect(converter.condition({ type: 'string' } as any)).toBe(false) // Plain object
  expect(converter.condition(undefined)).toBe(false)
})

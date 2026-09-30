import type { AnySchema } from '@orpc/contract'
// eslint-disable-next-line no-restricted-imports
import type { StandardJSONSchemaV1 } from '@standard-schema/spec'
import type { JsonSchemaConverter, JsonSchemaConverterDirection } from './convert'
import type { JsonSchema } from './types'
import { isTypescriptObject } from '@orpc/shared'

export class StandardJsonSchemaConverter implements JsonSchemaConverter {
  condition(schema: AnySchema | undefined, _direction: JsonSchemaConverterDirection): boolean {
    return Boolean(
      schema
      && 'jsonSchema' in schema['~standard']
      && isTypescriptObject(schema['~standard'].jsonSchema)
      && 'input' in schema['~standard'].jsonSchema
      && typeof schema['~standard'].jsonSchema.input === 'function'
      && 'output' in schema['~standard'].jsonSchema
      && typeof schema['~standard'].jsonSchema.output === 'function',
    )
  }

  convert(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
    return this.convertInternal(schema as any, direction)
  }

  convertInternal(schema: StandardJSONSchemaV1 & AnySchema, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
    try {
      const jsonSchema = direction === 'input'
        ? schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
        : schema['~standard'].jsonSchema.output({ target: 'draft-2020-12' })

      return [jsonSchema, isOptional(schema, direction)]
    }
    catch {
      return [{}, true]
    }
  }
}

/**
 * Standard Schema does not describe optionality, and validating `undefined` to find out
 * would run refinements and transforms, so read it from vendors that expose it
 * and treat other schemas as required.
 */
function isOptional(schema: AnySchema, direction: JsonSchemaConverterDirection): boolean {
  // Zod v4 exposes the optionality it uses for object keys.
  if (schema['~standard'].vendor === 'zod' && '_zod' in schema && isTypescriptObject(schema._zod)) {
    return direction === 'input'
      ? schema._zod.optin !== undefined
      : schema._zod.optout === 'optional'
  }

  return false
}

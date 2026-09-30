import type { AnySchema } from '@orpc/contract'
import type { JsonSchema, JsonSchemaConverter, JsonSchemaConverterDirection } from '@orpc/json-schema'
import { StandardJsonSchemaConverter } from '@orpc/json-schema'
import { Schema as EffectSchema, SchemaAST } from 'effect'

/**
 * A JSON Schema converter for Effect Schema, built on top of
 * [Effect Schema to JSON Schema](https://effect.website/docs/schema/json-schema/).
 * Useful with tools such as the OpenAPI Generator.
 *
 * @see {@link https://orpc.dev/docs/integrations/effect#json-schema-converter | Effect Integration - JSON Schema Converter}
 */
export class EffectSchemaToJsonSchemaConverter implements JsonSchemaConverter {
  private readonly converter = new StandardJsonSchemaConverter()

  condition(schema: AnySchema | undefined, _direction: JsonSchemaConverterDirection): boolean {
    return schema?.['~standard'].vendor === 'effect'
  }

  convert(schema: AnySchema | undefined, direction: JsonSchemaConverterDirection): [jsonSchema: JsonSchema, optional: boolean] {
    const effectSchema = schema as EffectSchema.Constraint & AnySchema
    const standardJsonSchema = EffectSchema.toStandardJSONSchemaV1(effectSchema)
    const [jsonSchema, optional] = this.converter.convert(standardJsonSchema, direction)
    return [jsonSchema, optional || isOptional(effectSchema.ast, direction)]
  }
}

/**
 * Reads optionality from the schema AST instead of validating `undefined`,
 * which would run transformations.
 */
function isOptional(ast: SchemaAST.AST, direction: JsonSchemaConverterDirection): boolean {
  return allowsUndefined(direction === 'input' ? SchemaAST.toEncoded(ast) : SchemaAST.toType(ast))
}

function allowsUndefined(ast: SchemaAST.AST): boolean {
  return SchemaAST.isOptional(ast)
    || SchemaAST.isUndefined(ast)
    || SchemaAST.isVoid(ast)
    || SchemaAST.isUnknown(ast)
    || SchemaAST.isAny(ast)
    || (SchemaAST.isUnion(ast) && ast.types.some(allowsUndefined))
}

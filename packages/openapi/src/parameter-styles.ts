import type { AnySchema } from '@orpc/contract'

/**
 * Encoding and decoding strategies for OpenAPI path parameters.
 *
 * @see {@link https://orpc.dev/docs/openapi/input-and-output-mapping#dynamic-parameter-style-resolvers | OpenAPI Input and Output Mapping - Dynamic Parameter Style Resolvers}
 */
export type OpenAPIParamsStyle
  = | 'primitive'
    | 'comma-delimited-array'
    | 'comma-delimited-object'

/**
 * Encoding and decoding strategies for OpenAPI query parameters.
 *
 * @see {@link https://orpc.dev/docs/openapi/input-and-output-mapping#dynamic-parameter-style-resolvers | OpenAPI Input and Output Mapping - Dynamic Parameter Style Resolvers}
 */
export type OpenAPIQueryStyle
  = | 'primitive'
    | 'array'
    | 'comma-delimited-array'
    | 'comma-delimited-object'
    | 'space-delimited-array'
    | 'space-delimited-object'
    | 'pipe-delimited-array'
    | 'pipe-delimited-object'
    | 'json'

/**
 * Resolves a parameter style from its name and the procedure's ordered input schema stack.
 *
 * @see {@link https://orpc.dev/docs/openapi/input-and-output-mapping#dynamic-parameter-style-resolvers | OpenAPI Input and Output Mapping - Dynamic Parameter Style Resolvers}
 */
export type OpenAPIParameterStyleResolver<TStyle> = (
  name: string,
  inputSchemas: readonly AnySchema[] | undefined,
) => TStyle | undefined

/**
 * Parameter styles defined per name or resolved dynamically.
 *
 * @see {@link https://orpc.dev/docs/openapi/input-and-output-mapping#dynamic-parameter-style-resolvers | OpenAPI Input and Output Mapping - Dynamic Parameter Style Resolvers}
 */
export type OpenAPIParameterStyles<TStyle>
  = | Record<string, TStyle | undefined>
    | OpenAPIParameterStyleResolver<TStyle>

export function resolveOpenAPIParameterStyle<TStyle>(
  styles: OpenAPIParameterStyles<TStyle> | undefined,
  name: string,
  inputSchemas: readonly AnySchema[] | undefined,
): TStyle | undefined {
  return typeof styles === 'function'
    ? styles(name, inputSchemas)
    : styles?.[name]
}

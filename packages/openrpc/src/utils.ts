import type { AnyProcedureContract, AnySchema } from '@orpc/contract'
import type { JsonSchemaConverterDirection } from '@orpc/json-schema'
import type { JsonRpcId } from './json-rpc'
import { getAsyncIteratorObjectSchemaDetails } from '@orpc/contract'
import { isStandardSchemaOptional } from '@orpc/json-schema'

/**
 * Prefix of the method names JSON-RPC reserves for rpc-internal methods and extensions, like `rpc.discover`.
 */
export const RESERVED_JSON_RPC_METHOD_PREFIX = 'rpc.'

/**
 * Separator between the router keys of a procedure path in a JSON-RPC method name.
 */
export const JSON_RPC_METHOD_SEPARATOR = '.'

/**
 * Whether a value is a valid JSON-RPC request id: a string, a finite number, or `null`.
 */
export function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

/**
 * Splits a JSON-RPC method name into a procedure path, or returns `undefined` for names no procedure can have:
 * the reserved `rpc.*` names and names with an empty segment (`''`, `.a`, `a.`, `a..b`), which could otherwise
 * alias another procedure once turned into an HTTP path.
 */
export function toProcedurePath(method: string): string[] | undefined {
  if (method.startsWith(RESERVED_JSON_RPC_METHOD_PREFIX)) {
    return undefined
  }

  const path = method.split(JSON_RPC_METHOD_SEPARATOR)

  if (path.includes('')) {
    return undefined
  }

  return path
}

/**
 * Whether any input or output schema of a procedure describes an AsyncIteratorObject (event iterator),
 * which JSON-RPC over HTTP cannot carry. The handler and the generator both exclude such procedures.
 */
export function isEventIteratorProcedure(procedure: AnyProcedureContract): boolean {
  const { inputSchemas, outputSchemas } = procedure['~orpc']

  return [...(inputSchemas ?? []), ...(outputSchemas ?? [])]
    .some(schema => getAsyncIteratorObjectSchemaDetails(schema) !== undefined)
}

/**
 * Whether a schema synchronously accepts an empty object, or `false` when it validates asynchronously or throws.
 */
export function acceptsEmptyObject(schema: AnySchema): boolean {
  try {
    const result = schema['~standard'].validate({})

    if (result instanceof Promise) {
      result.catch(() => {})
      return false
    }

    return result.issues === undefined
  }
  catch {
    return false
  }
}

/**
 * Whether schemas describe "no value", like `z.void()`: every schema accepts `undefined` and some rejects `{}`.
 * Schemas that also accept `{}`, like `z.any()` or `z.object({}).optional()`, are not void-like.
 */
export function isVoidLikeSchemas(schemas: readonly AnySchema[], direction: JsonSchemaConverterDirection): boolean {
  return schemas.length > 0
    && schemas.every(schema => isStandardSchemaOptional(schema, direction))
    && schemas.some(schema => !acceptsEmptyObject(schema))
}

/**
 * Throws a `TypeError` when an error code map has a value that is not a safe integer,
 * since JSON-RPC error codes must be integers.
 */
export function assertJsonRpcErrorCodeMap(errorCodeMap: Record<string, number> | undefined, owner: string): void {
  if (errorCodeMap === undefined) {
    return
  }

  for (const [code, jsonRpcCode] of Object.entries(errorCodeMap)) {
    if (!Number.isSafeInteger(jsonRpcCode)) {
      throw new TypeError(`[${owner}] "errorCodeMap.${code}" must be an integer JSON-RPC error code, received ${String(jsonRpcCode)}.`)
    }
  }
}

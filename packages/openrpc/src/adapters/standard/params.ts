import type { AnyProcedureContract } from '@orpc/contract'
import type { JsonRpcParams } from '../../json-rpc'
import { ORPCError } from '@orpc/client'
import { isStandardSchemaOptional } from '@orpc/json-schema'
import { isPlainObject } from '@orpc/shared'
import { acceptsEmptyObject } from '../../utils'

/**
 * Which empty input values a procedure's input schemas accept.
 */
interface EmptyInputProbe {
  undefinedOk: boolean
  emptyObjectOk: boolean
}

const EMPTY_INPUT_PROBES = new WeakMap<AnyProcedureContract, EmptyInputProbe>()

function probeEmptyInput(procedure: AnyProcedureContract): EmptyInputProbe | undefined {
  const inputSchemas = procedure['~orpc'].inputSchemas

  if (!inputSchemas?.length) {
    return undefined
  }

  let probe = EMPTY_INPUT_PROBES.get(procedure)

  if (probe === undefined) {
    probe = {
      undefinedOk: inputSchemas.every(schema => isStandardSchemaOptional(schema, 'input')),
      emptyObjectOk: inputSchemas.every(acceptsEmptyObject),
    }

    EMPTY_INPUT_PROBES.set(procedure, probe)
  }

  return probe
}

/**
 * Resolves empty params to the empty input the procedure accepts, since generic clients send any of
 * an absent `params`, `null`, `[]`, or `{}` for methods without (required) input.
 *
 * `absent` (no params, `null`, `[]`) prefers `undefined`, and `object` (`{}`) prefers `{}`,
 * unless only the other value passes the input schemas.
 */
function resolveEmptyInput(kind: 'absent' | 'object', procedure: AnyProcedureContract): unknown {
  const probe = probeEmptyInput(procedure)

  if (probe === undefined) {
    return kind === 'object' ? {} : undefined
  }

  if (kind === 'absent') {
    return probe.undefinedOk || !probe.emptyObjectOk ? undefined : {}
  }

  return probe.emptyObjectOk || !probe.undefinedOk ? {} : undefined
}

/**
 * Converts the `params` of a JSON-RPC request into the procedure input:
 * - absent, `null`, or `[]`: the empty input the procedure accepts (`undefined` preferred),
 * - `[x]`: `x` (by-position),
 * - `{}`: the empty input the procedure accepts (`{}` preferred),
 * - any other object: the object itself (by-name).
 *
 * Throws a `BAD_REQUEST` `ORPCError` (JSON-RPC "Invalid params") for more than one positional param
 * or any other value.
 */
export function decodeJsonRpcParams(params: unknown, procedure: AnyProcedureContract): unknown {
  if (params === undefined || params === null) {
    return resolveEmptyInput('absent', procedure)
  }

  if (Array.isArray(params)) {
    if (params.length === 0) {
      return resolveEmptyInput('absent', procedure)
    }

    if (params.length === 1) {
      return params[0]
    }

    throw new ORPCError('BAD_REQUEST', {
      message: `Invalid params: expected at most 1 positional parameter, received ${params.length}.`,
    })
  }

  if (isPlainObject(params)) {
    return Object.keys(params).length === 0 ? resolveEmptyInput('object', procedure) : params
  }

  throw new ORPCError('BAD_REQUEST', {
    message: 'Invalid params: expected an array or an object.',
  })
}

/**
 * The default mapping from a serialized procedure input to JSON-RPC `params`:
 * `undefined` omits `params`, a plain object is sent by-name, and anything else by-position as `[input]`.
 */
export function encodeJsonRpcParams(serializedInput: unknown): JsonRpcParams | undefined {
  if (serializedInput === undefined) {
    return undefined
  }

  if (isPlainObject(serializedInput)) {
    return serializedInput as Record<string, unknown>
  }

  return [serializedInput]
}

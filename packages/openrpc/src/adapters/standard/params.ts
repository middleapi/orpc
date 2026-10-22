import type { AnyProcedureContract, AnySchema } from '@orpc/contract'
import type { JsonRpcParams } from '../../json-rpc'
import { ORPCError } from '@orpc/client'
import { isPlainObject } from '@orpc/shared'

/**
 * Which empty input values a procedure's input schemas accept.
 */
interface EmptyInputProbe {
  undefinedOk: boolean
  emptyObjectOk: boolean
}

const EMPTY_INPUT_PROBES = new WeakMap<AnyProcedureContract, Promise<EmptyInputProbe>>()

/**
 * Whether every schema accepts the value `createValue` returns (a fresh one per schema), awaiting async validation.
 * A validation that throws or rejects does not accept it.
 */
async function acceptsEmptyValue(schemas: readonly AnySchema[], createValue: () => unknown): Promise<boolean> {
  for (const schema of schemas) {
    try {
      const result = await schema['~standard'].validate(createValue())

      if (result.issues !== undefined) {
        return false
      }
    }
    catch {
      return false
    }
  }

  return true
}

async function probeInputSchemas(schemas: readonly AnySchema[]): Promise<EmptyInputProbe> {
  const [undefinedOk, emptyObjectOk] = await Promise.all([
    acceptsEmptyValue(schemas, () => undefined),
    acceptsEmptyValue(schemas, () => ({})),
  ])

  return { undefinedOk, emptyObjectOk }
}

/**
 * Probes the input schemas once per procedure. The probe is async, like the input validation itself,
 * so schemas with async validation resolve the same as sync ones.
 */
function probeEmptyInput(procedure: AnyProcedureContract): Promise<EmptyInputProbe> | undefined {
  const inputSchemas = procedure['~orpc'].inputSchemas

  if (!inputSchemas?.length) {
    return undefined
  }

  let probe = EMPTY_INPUT_PROBES.get(procedure)

  if (probe === undefined) {
    probe = probeInputSchemas(inputSchemas)
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
async function resolveEmptyInput(kind: 'absent' | 'object', procedure: AnyProcedureContract): Promise<unknown> {
  const probe = await probeEmptyInput(procedure)

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
 * Rejects with a `BAD_REQUEST` `ORPCError` (JSON-RPC "Invalid params") for more than one positional param
 * or any other value.
 */
export async function decodeJsonRpcParams(params: unknown, procedure: AnyProcedureContract): Promise<unknown> {
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

import type { AnyProcedureContract } from '@orpc/contract'
import { getAsyncIteratorObjectSchemaDetails } from '@orpc/contract'

/**
 * Whether a procedure takes or returns an event iterator, which JSON-RPC over HTTP cannot stream.
 * The handler and the generator both exclude such procedures.
 */
export function isEventIteratorProcedure(procedure: AnyProcedureContract): boolean {
  const { inputSchemas, outputSchemas } = procedure['~orpc']

  return [...(inputSchemas ?? []), ...(outputSchemas ?? [])]
    .some(schema => getAsyncIteratorObjectSchemaDetails(schema) !== undefined)
}

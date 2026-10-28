import type { AnyProcedureContract } from '@orpc/contract'
import { getAsyncIteratorObjectSchemasDetails } from '@orpc/contract'

/**
 * Whether a procedure takes or returns an event iterator, which JSON-RPC over HTTP cannot stream.
 * The handler and the generator both exclude such procedures.
 */
export function isEventIteratorProcedure(procedure: AnyProcedureContract): boolean {
  const { inputSchemas, outputSchemas } = procedure['~orpc']

  // checked per schema: chaining an event iterator with other schemas still streams
  return [...(inputSchemas ?? []), ...(outputSchemas ?? [])]
    .some(schema => getAsyncIteratorObjectSchemasDetails([schema]) !== undefined)
}

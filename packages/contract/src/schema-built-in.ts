import type { AsyncIteratorClass } from '@orpc/shared'
import type { AnySchema, Schema } from './schema'
import { ORPCError, wrapAsyncIteratorPreservingEventMeta } from '@orpc/client'
import { isAsyncIteratorObject, ORPC_NAME } from '@orpc/shared'
import { ValidationError } from './error'

const ASYNC_ITERATOR_OBJECT_SCHEMA_DETAILS_SYMBOL = Symbol.for('ORPC_ASYNC_ITERATOR_OBJECT_SCHEMA_DETAILS')

export interface AsyncIteratorObjectSchemaDetails {
  yieldSchema: AnySchema
  returnSchema?: AnySchema
}

/**
 * Define schema for an async iterator object.
 */
export function asyncIteratorObject<TYieldIn, TYieldOut, TReturnIn = unknown, TReturnOut = unknown>(
  yieldSchema: Schema<TYieldIn, TYieldOut>,
  returnSchema?: Schema<TReturnIn, TReturnOut>,
): Schema<AsyncIteratorObject<TYieldIn, TReturnIn, void>, AsyncIteratorClass<TYieldOut, TReturnOut, void>> {
  return {
    '~standard': {
      [ASYNC_ITERATOR_OBJECT_SCHEMA_DETAILS_SYMBOL as any]: { yieldSchema, returnSchema } satisfies AsyncIteratorObjectSchemaDetails,
      vendor: ORPC_NAME,
      version: 1,
      validate(iterator) {
        if (!isAsyncIteratorObject(iterator)) {
          return { issues: [{ message: 'Expect async iterator object', path: [] }] }
        }

        const mapped = wrapAsyncIteratorPreservingEventMeta(iterator, {
          async mapResult(result) {
            const schema = result.done ? returnSchema : yieldSchema

            if (!schema) {
              return result
            }

            const validated = await schema['~standard'].validate(result.value)

            if (validated.issues) {
              throw new ORPCError('EVENT_ITERATOR_VALIDATION_FAILED', {
                message: 'Event iterator validation failed',
                cause: new ValidationError({
                  issues: validated.issues,
                  message: 'Event iterator validation failed',
                  invalidData: result.value,
                }),
              })
            }

            return { done: result.done, value: validated.value }
          },
        })

        return { value: mapped }
      },
    },
  }
}

export function getAsyncIteratorObjectSchemaDetails(schema: AnySchema | undefined): undefined | AsyncIteratorObjectSchemaDetails {
  if (schema === undefined) {
    return undefined
  }

  return (schema['~standard'] as any)[ASYNC_ITERATOR_OBJECT_SCHEMA_DETAILS_SYMBOL]
}

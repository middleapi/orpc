import type { AsyncIteratorClass } from '@orpc/shared'
import type { AnySchema, Schema } from './schema'
import { ORPCError, wrapEventIteratorPreservingMeta } from '@orpc/client'
import { isAsyncIteratorObject, ORPC_NAME } from '@orpc/shared'
import { ValidationError } from './error'

const EVENT_ITERATOR_SCHEMA_DETAILS_SYMBOL = Symbol.for('ORPC_EVENT_ITERATOR_SCHEMA_DETAILS')

export interface EventIteratorSchemaDetails {
  yieldSchema: AnySchema
  returnSchema?: AnySchema
}

/**
 * Define schema for an event iterator.
 *
 * @see {@link https://orpc.dev/docs/event-iterator#validate-event-iterator Validate Event Iterator Docs}
 */
export function eventIterator<TYieldIn, TYieldOut, TReturnIn = unknown, TReturnOut = unknown>(
  yieldSchema: Schema<TYieldIn, TYieldOut>,
  returnSchema?: Schema<TReturnIn, TReturnOut>,
): Schema<AsyncIteratorObject<TYieldIn, TReturnIn, void>, AsyncIteratorClass<TYieldOut, TReturnOut, void>> {
  return {
    '~standard': {
      [EVENT_ITERATOR_SCHEMA_DETAILS_SYMBOL as any]: { yieldSchema, returnSchema } satisfies EventIteratorSchemaDetails,
      vendor: ORPC_NAME,
      version: 1,
      validate(iterator) {
        if (!isAsyncIteratorObject(iterator)) {
          return { issues: [{ message: 'Expect event iterator', path: [] }] }
        }

        const mapped = wrapEventIteratorPreservingMeta(iterator, {
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

export function getEventIteratorSchemaDetails(schema: AnySchema | undefined): undefined | EventIteratorSchemaDetails {
  if (schema === undefined) {
    return undefined
  }

  return (schema['~standard'] as any)[EVENT_ITERATOR_SCHEMA_DETAILS_SYMBOL]
}

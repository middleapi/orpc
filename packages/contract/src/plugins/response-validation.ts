import type { ClientContext } from '@orpc/client'
import type { StandardLinkOptions, StandardLinkPlugin } from '@orpc/client/standard'
import type { ThrowableError } from '@orpc/shared'
import type { RouterContract } from '../router'
import { ORPCError, wrapAsyncIteratorPreservingEventMeta } from '@orpc/client'
import { isAsyncIteratorObject, override, toArray } from '@orpc/shared'
import { ValidationError } from '../error'
import { reconcileORPCError } from '../error-utils'
import { getProcedureContractOrThrow } from '../router-utils'

/**
 * Validates server responses against contract schemas before your application uses them.
 * This helps ensure the data returned by the server matches the types defined in your contract.
 *
 * @see {@link https://orpc.dev/docs/plugins/response-validation | Response Validation Plugin}
 */
export class ResponseValidationLinkPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  name = '~response-validation'

  constructor(
    private readonly contract: RouterContract,
  ) {
  }

  init(options: StandardLinkOptions<T>): StandardLinkOptions<T> {
    return {
      ...options,
      interceptors: [
        async ({ next, path }) => {
          const procedure = getProcedureContractOrThrow(this.contract, path)

          const reconcileError = async (error: ThrowableError) => {
            if (error instanceof ORPCError) {
              return await reconcileORPCError(procedure['~orpc'].errorMap, error)
            }

            return error
          }

          try {
            const output = await next()

            if (isAsyncIteratorObject(output)) {
              /**
               * Errors thrown while consuming the iterator must be reconciled too.
               *
               * @warning
               * Remember use `override` for AsyncIteratorObject to remain other special properties
               */
              return override(output, wrapAsyncIteratorPreservingEventMeta(
                output,
                { mapError: reconcileError },
              )) as typeof output
            }

            return output
          }
          catch (error) {
            throw await reconcileError(error as ThrowableError)
          }
        },
        ...toArray(options.interceptors),
        async ({ next, path }) => {
          const procedure = getProcedureContractOrThrow(this.contract, path)

          const outputSchemas = toArray(procedure['~orpc'].outputSchemas)

          let output = await next()

          for (let i = outputSchemas.length - 1; i >= 0; i--) {
            const schema = outputSchemas[i]!
            const result = await schema['~standard'].validate(output)

            if (result.issues) {
              throw new ORPCError('INTERNAL_SERVER_ERROR', {
                message: 'Output validation failed',
                cause: new ValidationError({
                  message: 'Output validation failed',
                  issues: result.issues,
                  invalidData: output,
                }),
              })
            }

            output = result.value
          }

          return output
        },
      ],
    }
  }
}

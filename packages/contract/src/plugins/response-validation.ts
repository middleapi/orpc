import type { ClientContext } from '@orpc/client'
import type { StandardLinkOptions, StandardLinkPlugin } from '@orpc/client/standard'
import type { RouterContract } from '../router'
import { ORPCError } from '@orpc/client'
import { toArray } from '@orpc/shared'
import { ValidationError } from '../error'
import { reconcileORPCError } from '../error-utils'
import { getProcedureContractOrThrow } from '../router-utils'

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

          try {
            return await next()
          }
          catch (error) {
            if (error instanceof ORPCError) {
              /**
               * Even if the error is inferable (returned), we still need to apply `reconcileError`.
               * Defined errors take priority over inferable errors.
               * `reconcileError` attempts to mark the error as defined, or keeps it inferable if that's not possible.
               */
              throw await reconcileORPCError(procedure['~orpc'].errorMap, error)
            }

            throw error
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
